import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { offsetOf } from '../lib/validation';
import { diffSnapshot, logActivity, verifyActivityChain } from '../lib/audit';
import { hashPassword } from '../lib/crypto';
import { fail } from '../lib/errors';
import { validatePassword } from '../lib/passwords';
import { todayIn } from '../lib/dates';
import { optionalText, paginationSchema, parseInput } from '../lib/validation';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import { rebuildAllInvoiceTaxLines } from '../services/documents';
import type { AppEnv, UserRow } from '../types';

const companySchema = z.object({
  name: z.string().trim().min(2).max(120),
  legal_name: optionalText(160),
  email: z.union([z.string().trim().email().max(190), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  phone: optionalText(40),
  address1: optionalText(160),
  address2: optionalText(160),
  city: optionalText(80),
  postal_code: optionalText(20),
  country: z.string().trim().max(80),
  timezone: z.string().trim().max(60),
  currency: z.string().trim().length(3),
  locale: z.string().trim().max(10),
  tax_id: optionalText(20),
  rcs: optionalText(40),
  share_capital: optionalText(40),
  vat_regime: z.enum(['standard', 'franchise']),
  default_tax_rate: z.coerce.number().int().min(0).max(100),
  payment_terms: z.coerce.number().int().min(0).max(365),
  number_pattern: z.string().trim().min(3).max(40),
  invoice_terms: optionalText(2000),
  invoice_footer: optionalText(1000),
  legal_notes: optionalText(2000),
  bank_name: optionalText(80),
  bank_holder: optionalText(120),
  bank_iban: optionalText(60),
  bank_bic: optionalText(20),
  session_idle_minutes: z.coerce.number().int().min(5).max(240),
  session_absolute_hours: z.coerce.number().int().min(1).max(72),
});

/** Company fields worth recording as before/after values in the journal. */
const COMPANY_DIFF_KEYS = [
  'name', 'legal_name', 'email', 'phone', 'address1', 'address2', 'city', 'postal_code',
  'country', 'timezone', 'currency', 'locale', 'tax_id', 'rcs', 'share_capital', 'vat_regime',
  'default_tax_rate', 'payment_terms', 'number_pattern', 'invoice_terms', 'invoice_footer',
  'legal_notes', 'bank_name', 'bank_holder', 'bank_iban', 'bank_bic',
  'session_idle_minutes', 'session_absolute_hours',
] as const;

export const settingsRoutes = new Hono<AppEnv>();
settingsRoutes.use('*', requireAuth);

// --- M0 (T-001): per-entity numbering configuration (CC-RA-1, editable pattern+prefix) ---
settingsRoutes.get('/numbering', requirePermission('settings.read'), async (c) => {
  const entityNumbering = await c.env.DB.prepare(`SELECT entity, prefix, pattern, updated_at FROM entity_numbering ORDER BY entity`).all();
  const gaps = await c.env.DB.prepare(
    `SELECT entity, number, reason, created_by, created_at FROM number_gaps ORDER BY created_at DESC LIMIT 200`,
  ).all();
  return c.json({ entity_numbering: entityNumbering.results ?? [], gaps: gaps.results ?? [] });
});

settingsRoutes.put('/numbering/:entity', requirePermission('settings.write'), async (c) => {
  const entity = c.req.param('entity');
  const body = parseInput(
    z.object({ prefix: z.string().trim().min(1).max(10), pattern: z.string().trim().min(3).max(40) }),
    await c.req.json().catch(() => ({})),
  );
  if (!['invoice', 'quote', 'credit', 'payment'].includes(entity)) {
    return fail(422, 'VALIDATION_ERROR', { entity: 'unsupported' });
  }
  // Only known placeholders are accepted (R-A: unsupported tokens must not
  // leak literally into document numbers).
  const leftover = body.pattern
    .replace(/\{prefix\}/g, '')
    .replace(/\{YYYY\}/g, '')
    .replace(/\{YY\}/g, '')
    .replace(/\{MM\}/g, '')
    .replace(/\{######\}|\{#####\}|\{####\}|\{###\}|\{##\}|\{#\}/g, '');
  if (/[{}]/.test(leftover)) {
    return fail(422, 'VALIDATION_ERROR', { pattern: 'unsupported_placeholder' });
  }
  const user = c.get('user')!;
  await c.env.DB.prepare(
    `INSERT INTO entity_numbering (entity, prefix, pattern, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(entity) DO UPDATE SET prefix = excluded.prefix, pattern = excluded.pattern, updated_at = excluded.updated_at`,
  ).bind(entity, body.prefix, body.pattern, nowISO()).run();
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'settings',
    entityId: `numbering:${entity}`,
    summary: 'activity.settings_numbering_changed',
    meta: { entity, prefix: body.prefix, pattern: body.pattern },
  });
  return c.json({ ok: true });
});

// --- M0 (T-003/T-009): key/value extension settings (retention years, UI language variant) ---
const EXTRA_KEYS = ['retention_years', 'ui_language', 'franchise_threshold'] as const;

/**
 * Standard defaults adopted while no accountant has reviewed them (owner
 * decision 2026-10-29): 10 years of retention, the DICP franchise ceiling of
 * 10 000 000 XPF, French UI. They are ordinary settings, editable without code.
 */
const EXTRA_DEFAULTS: Record<string, string> = {
  retention_years: '10',
  franchise_threshold: '10000000',
  ui_language: 'fr',
};

settingsRoutes.get('/extras', requirePermission('settings.read'), async (c) => {
  const rows = await c.env.DB.prepare(`SELECT key, value FROM settings_extra`).all<{ key: string; value: string }>();
  const stored = new Map((rows.results ?? []).map((row) => [row.key, row.value]));
  return c.json({
    extras: EXTRA_KEYS.map((key) => ({
      key,
      value: stored.get(key) ?? EXTRA_DEFAULTS[key] ?? '',
      is_default: !stored.has(key),
    })),
  });
});

/** Batch update of the fiscal defaults, validated and journalled once. */
settingsRoutes.patch('/extras', requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      retention_years: z.coerce.string().regex(/^[1-9]\d{0,2}$/).optional(),
      franchise_threshold: z.coerce.string().regex(/^\d{1,12}$/).optional(),
    }).refine((value) => Object.keys(value).length > 0, { message: 'empty' }),
    await c.req.json().catch(() => ({})),
  );
  const now = nowISO();
  for (const [key, value] of Object.entries(body)) {
    await c.env.DB.prepare(
      `INSERT INTO settings_extra (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).bind(key, value, user.id, now).run();
  }
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'settings',
    entityId: 'extras:fiscal',
    summary: 'activity.settings_extra_changed',
    meta: body as Record<string, string>,
  });
  return c.json({ ok: true });
});

settingsRoutes.put('/extras/:key', requirePermission('settings.write'), async (c) => {
  const key = c.req.param('key');
  const body = parseInput(z.object({ value: z.string().trim().min(1).max(80) }), await c.req.json().catch(() => ({})));
  if (!(EXTRA_KEYS as readonly string[]).includes(key)) return fail(422, 'VALIDATION_ERROR', { key: 'unsupported' });
  if (key === 'retention_years' && !/^[1-9]\d{0,2}$/.test(body.value)) {
    return fail(422, 'VALIDATION_ERROR', { value: 'invalid' });
  }
  if (key === 'ui_language' && !['fr', 'en'].includes(body.value)) {
    return fail(422, 'VALIDATION_ERROR', { value: 'invalid' });
  }
  const user = c.get('user')!;
  await c.env.DB.prepare(
    `INSERT INTO settings_extra (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(key, body.value, user.id, nowISO()).run();
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'settings',
    entityId: `extras:${key}`,
    summary: 'activity.settings_extra_changed',
    meta: { key, value: body.value },
  });
  return c.json({ ok: true });
});

settingsRoutes.get('/', requirePermission('settings.read'), async (c) => {
  const company = c.get('company')!;
  const taxRates = await c.env.DB.prepare(`SELECT * FROM tax_rates ORDER BY rate DESC`).all();
  const sequences = await c.env.DB.prepare(
    `SELECT entity, period, last_number FROM number_sequences ORDER BY entity, period`,
  ).all();
  return c.json({ company, tax_rates: taxRates.results ?? [], sequences: sequences.results ?? [] });
});

settingsRoutes.patch('/', requirePermission('settings.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(companySchema, await c.req.json().catch(() => ({})));

  await c.env.DB.prepare(
    `UPDATE company SET name = ?, legal_name = ?, email = ?, phone = ?, address1 = ?, address2 = ?, city = ?,
      postal_code = ?, country = ?, timezone = ?, currency = ?, locale = ?, tax_id = ?, rcs = ?, share_capital = ?,
      vat_regime = ?, default_tax_rate = ?, payment_terms = ?, number_pattern = ?, invoice_terms = ?, invoice_footer = ?,
      legal_notes = ?, bank_name = ?, bank_holder = ?, bank_iban = ?, bank_bic = ?, session_idle_minutes = ?,
      session_absolute_hours = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    body.name, body.legal_name, body.email, body.phone, body.address1, body.address2, body.city, body.postal_code,
    body.country, body.timezone, body.currency, body.locale, body.tax_id, body.rcs, body.share_capital, body.vat_regime,
    body.default_tax_rate, body.payment_terms, body.number_pattern, body.invoice_terms, body.invoice_footer,
    body.legal_notes, body.bank_name, body.bank_holder, body.bank_iban, body.bank_bic, body.session_idle_minutes,
    body.session_absolute_hours, nowISO(), company.id,
  ).run();

  const changes = diffSnapshot(company, body, COMPANY_DIFF_KEYS);
  await logActivity(c.env.DB, {
    userId: user.id, action: 'updated', entityType: 'company', entityId: company.id,
    summary: 'activity.settings_updated',
    before: changes?.before ?? null,
    after: changes?.after ?? null,
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

/* --------------------------------------------------------- period closure */

const PERIOD_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

settingsRoutes.get('/periods', requirePermission('periods.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT p.period, p.note, p.closed_at, p.closed_by, u.first_name, u.last_name
     FROM period_locks p LEFT JOIN users u ON u.id = p.closed_by
     ORDER BY p.period DESC`,
  ).all();
  return c.json({ data: rows.results ?? [] });
});

settingsRoutes.post('/periods', requirePermission('periods.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      period: z.string().regex(PERIOD_PATTERN, 'invalid_period'),
      note: optionalText(300),
    }),
    await c.req.json().catch(() => ({})),
  );

  // Nothing to freeze yet: a future period has no documents to protect.
  if (body.period > todayIn(company.timezone).slice(0, 7)) {
    return fail(422, 'VALIDATION_ERROR', { period: 'future_period' });
  }

  const existing = await c.env.DB.prepare(`SELECT period FROM period_locks WHERE period = ?`)
    .bind(body.period)
    .first<{ period: string }>();
  if (existing) return fail(409, 'PERIOD_ALREADY_CLOSED');

  await c.env.DB.prepare(
    `INSERT INTO period_locks (period, note, closed_at, closed_by) VALUES (?, ?, ?, ?)`,
  )
    .bind(body.period, body.note ?? null, nowISO(), user.id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'closed',
    entityType: 'period',
    entityId: body.period,
    summary: 'activity.period_closed',
    meta: { period: body.period },
    after: { period: body.period, note: body.note ?? null },
    ip: clientIp(c),
  });

  return c.json({ ok: true, period: body.period }, 201);
});

settingsRoutes.delete('/periods/:period', requirePermission('periods.write'), async (c) => {
  const period = c.req.param('period');
  if (!PERIOD_PATTERN.test(period)) return fail(404, 'NOT_FOUND');

  const body = parseInput(
    z.object({ reason: optionalText(300) }),
    await c.req.json().catch(() => ({})),
  );

  const existing = await c.env.DB.prepare(`SELECT period, note FROM period_locks WHERE period = ?`)
    .bind(period)
    .first<{ period: string; note: string | null }>();
  if (!existing) return fail(404, 'NOT_FOUND');

  await c.env.DB.prepare(`DELETE FROM period_locks WHERE period = ?`).bind(period).run();

  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'reopened',
    entityType: 'period',
    entityId: period,
    summary: 'activity.period_reopened',
    meta: { period, reason: body.reason ?? null },
    before: { period, note: existing.note },
    after: { period, note: null, reason: body.reason ?? null },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

/** Maintenance: rebuild the invoice tax mirror after an import or restore. */
settingsRoutes.post('/rebuild-tax-lines', requirePermission('settings.write'), async (c) => {
  const rebuilt = await rebuildAllInvoiceTaxLines(c.env.DB);
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'rebuilt',
    entityType: 'invoice_tax_lines',
    summary: 'activity.tax_lines_rebuilt',
    meta: { invoices: rebuilt },
    ip: clientIp(c),
  });
  return c.json({ ok: true, invoices: rebuilt });
});

export const taxRateRoutes = new Hono<AppEnv>();
taxRateRoutes.use('*', requireAuth);

// Readable by anyone who can issue a document: the rates feed the line editor.
taxRateRoutes.get('/', requirePermission('invoices.read'), async (c) => {
  const rows = await c.env.DB.prepare(`SELECT id, name, rate, is_default FROM tax_rates ORDER BY rate DESC`).all();
  return c.json({ data: rows.results ?? [] });
});

taxRateRoutes.post('/', requirePermission('settings.write'), async (c) => {
  const body = parseInput(
    z.object({ name: z.string().trim().min(1).max(80), rate: z.coerce.number().int().min(0).max(100) }),
    await c.req.json().catch(() => ({})),
  );
  const id = crypto.randomUUID();
  await c.env.DB.prepare(`INSERT INTO tax_rates (id, name, rate, is_default, created_at) VALUES (?, ?, ?, 0, ?)`)
    .bind(id, body.name, body.rate, nowISO()).run();
  return c.json({ id }, 201);
});

taxRateRoutes.delete('/:id', requirePermission('settings.write'), async (c) => {
  await c.env.DB.prepare(`DELETE FROM tax_rates WHERE id = ?`).bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

/* --------------------------------------------------------------------- users */

const userCreateSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email().max(190),
  role: z.enum(['owner', 'admin', 'accountant', 'sales', 'viewer']),
  password: z.string().min(1).max(200),
});

export const userRoutes = new Hono<AppEnv>();
userRoutes.use('*', requireAuth);

userRoutes.get('/', requirePermission('users.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT id, email, first_name, last_name, role, is_active, last_login_at, created_at FROM users
     WHERE deleted_at IS NULL ORDER BY created_at ASC`,
  ).all();
  return c.json({ data: rows.results ?? [] });
});

userRoutes.post('/', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const body = parseInput(userCreateSchema, await c.req.json().catch(() => ({})));
  if (actor.role !== 'owner' && (body.role === 'owner' || body.role === 'admin')) {
    return fail(403, 'FORBIDDEN');
  }
  validatePassword({ password: body.password, email: body.email, firstName: body.first_name, lastName: body.last_name });

  const duplicate = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ? AND deleted_at IS NULL`).bind(body.email).first();
  if (duplicate) return fail(409, 'EMAIL_TAKEN');

  const id = crypto.randomUUID();
  const hash = await hashPassword(body.password);
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(id, body.email, hash, body.first_name, body.last_name, body.role, nowISO(), nowISO()).run();

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'created', entityType: 'user', entityId: id,
    summary: 'activity.user_created', meta: { email: body.email, role: body.role },
  });

  return c.json({ id }, 201);
});

userRoutes.patch('/:id', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      first_name: z.string().trim().min(1).max(80),
      last_name: z.string().trim().min(1).max(80),
      role: z.enum(['owner', 'admin', 'accountant', 'sales', 'viewer']),
      is_active: z.boolean(),
    }),
    await c.req.json().catch(() => ({})),
  );

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`).bind(id).first<UserRow>();
  if (!target) return fail(404, 'NOT_FOUND');
  if (actor.role !== 'owner' && (target.role === 'owner' || body.role === 'owner' || body.role === 'admin')) {
    return fail(403, 'FORBIDDEN');
  }
  if (target.role === 'owner' && (body.role !== 'owner' || !body.is_active)) {
    const owners = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND is_active = 1 AND deleted_at IS NULL`,
    ).first<{ count: number }>();
    if ((owners?.count ?? 0) <= 1) return fail(409, 'LAST_OWNER');
  }

  const changes = diffSnapshot(
    target,
    { ...body, is_active: body.is_active ? 1 : 0 },
    ['first_name', 'last_name', 'role', 'is_active'],
  );

  await c.env.DB.prepare(
    `UPDATE users SET first_name = ?, last_name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.first_name, body.last_name, body.role, body.is_active ? 1 : 0, nowISO(), id).run();

  if (!body.is_active) {
    await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id).run();
  }

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'updated', entityType: 'user', entityId: id,
    summary: 'activity.user_updated', meta: { role: body.role, active: body.is_active },
    before: changes?.before ?? null,
    after: changes?.after ?? null,
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

userRoutes.post('/:id/reset-password', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(z.object({ password: z.string().min(1).max(200) }), await c.req.json().catch(() => ({})));

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`).bind(id).first<UserRow>();
  if (!target) return fail(404, 'NOT_FOUND');
  if (actor.role !== 'owner' && target.role === 'owner') return fail(403, 'FORBIDDEN');
  validatePassword({ password: body.password, email: target.email, firstName: target.first_name, lastName: target.last_name });

  const hash = await hashPassword(body.password);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(hash, nowISO(), id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
  ]);

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'updated', entityType: 'user', entityId: id,
    summary: 'activity.user_password_reset', ip: clientIp(c),
  });
  return c.json({ ok: true });
});

/**
 * An administrator clears a lost second factor so the user can enroll again.
 * The target's sessions are revoked, exactly like a password reset.
 */
userRoutes.post('/:id/reset-mfa', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<UserRow>();
  if (!target) return fail(404, 'NOT_FOUND');
  if (actor.role !== 'owner' && target.role === 'owner') return fail(403, 'FORBIDDEN');

  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_codes = NULL, updated_at = ? WHERE id = ?`,
    ).bind(nowISO(), id),
    c.env.DB.prepare(`DELETE FROM mfa_challenges WHERE user_id = ?`).bind(id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
  ]);

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'reset', entityType: 'user', entityId: id,
    summary: 'activity.mfa_reset', meta: { email: target.email },
    before: { mfa_enabled: target.mfa_enabled ? 1 : 0 },
    after: { mfa_enabled: 0 },
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

userRoutes.delete('/:id', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  if (id === actor.id) return fail(409, 'CANNOT_DELETE_SELF');

  const target = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`).bind(id).first<UserRow>();
  if (!target) return fail(404, 'NOT_FOUND');
  if (actor.role !== 'owner' && target.role === 'owner') return fail(403, 'FORBIDDEN');
  if (target.role === 'owner') {
    const owners = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND deleted_at IS NULL`,
    ).first<{ count: number }>();
    if ((owners?.count ?? 0) <= 1) return fail(409, 'LAST_OWNER');
  }

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET deleted_at = ?, is_active = 0, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(id),
  ]);
  return c.json({ ok: true });
});

/* ----------------------------------------------------------------- activities */

export const activityRoutes = new Hono<AppEnv>();
activityRoutes.use('*', requireAuth);

activityRoutes.get('/', requirePermission('activity.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM activities`).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT a.*, u.first_name, u.last_name FROM activities a LEFT JOIN users u ON u.id = a.user_id
     ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;
  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

/** Recomputes the hash chain so tampering with the journal is detectable. */
activityRoutes.get('/verify', requirePermission('activity.read'), async (c) => {
  const result = await verifyActivityChain(c.env.DB);
  return c.json(result);
});
