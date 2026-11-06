import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_COUNTRY, DEFAULT_CURRENCY, DEFAULT_LOCALE, DEFAULT_TAX_RATE, DEFAULT_TIMEZONE, TVA_RATES } from '../../shared/domain';
import { DEFAULT_INVOICE_FOOTER, DEFAULT_INVOICE_TERMS, FRANCHISE_LEGAL_NOTE } from '../../shared/company-defaults';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_PAYMENT_TERM_DAYS,
  CLIENT_VAT_REGIMES,
  ENTITY_CATEGORIES,
  LEGAL_FORMS,
  legacyVatRegimeFor,
  mailingAddressLine,
  mailingCity,
} from '../../shared/client-profile';
import { nowISO, one } from '../db';
import { constantTimeEqual, hashPassword } from '../lib/crypto';
import { fail } from '../lib/errors';
import { logActivity } from '../lib/audit';
import { validatePassword } from '../lib/passwords';
import { optionalIsoDate, parseInput } from '../lib/validation';
import { clientIp, loadCompany } from '../middleware';
import { recordSetupAttempt, setupThrottle } from '../lib/limits';
import { seedDemoData } from '../services/seed';
import type { AppEnv } from '../types';

const setupSchema = z.object({
  // Same rubrics as a client record, applied to the workspace's own company.
  company: z
    .object({
      name: z.string().trim().min(2).max(120),
      entity_category: z.enum(ENTITY_CATEGORIES).default('PRIVATE_COMPANY'),
      legal_name: z.string().trim().min(1).max(160),
      legal_form: z.enum(LEGAL_FORMS),
      email: z.string().trim().email().max(190).optional().or(z.literal('')),
      phone: z.string().trim().max(40).optional().default(''),
      contact_role: z.string().trim().max(80).optional().default(''),
      address1: z.string().trim().max(160).optional().default(''),
      address2: z.string().trim().max(160).optional().default(''),
      city: z.string().trim().max(80).optional().default(''),
      po_box_number: z.string().trim().max(40).optional().default(''),
      po_box_municipality: z.string().trim().min(1).max(80),
      postal_code: z.string().trim().min(1).max(20),
      island: z.string().trim().max(80).optional().default(''),
      physical_municipality: z.string().trim().max(80).optional().default(''),
      district: z.string().trim().max(80).optional().default(''),
      pk_landmark: z.string().trim().max(80).optional().default(''),
      street_building_zone: z.string().trim().max(160).optional().default(''),
      delivery_instructions: z.string().trim().max(500).optional().default(''),
      // Legal identifiers are optional: a fresh workspace can be installed
      // before the RIDET or the NIF is known, and every one stays editable.
      tax_id: z
        .string()
        .trim()
        .max(20)
        .optional()
        .default('')
        .refine((value) => value === '' || /^([A-Za-z]\d{5}|\d{7})$/.test(value), 'invalid_tahiti_number')
        .transform((value) => value.toUpperCase()),
      ridet: z.string().trim().max(40).optional().default(''),
      nif: z.string().trim().max(30).optional().default(''),
      rcs: z.string().trim().max(40).optional().default(''),
      numero_tps: z.string().trim().max(40).optional().default(''),
      share_capital: z.string().trim().max(40).optional().default(''),
      vat_regime_detail: z.enum(CLIENT_VAT_REGIMES),
      default_tax_rate: z.coerce.number().int().min(0).max(100).default(DEFAULT_TAX_RATE),
      payment_method: z.enum(CLIENT_PAYMENT_METHODS),
      payment_terms_code: z.enum(CLIENT_PAYMENT_TERMS),
      bank_name: z.string().trim().max(80).optional().default(''),
      bank_holder: z.string().trim().max(120).optional().default(''),
      bank_iban: z.string().trim().max(60).optional().default(''),
      bank_bic: z.string().trim().max(20).optional().default(''),
      tax_exemption_decree_num: z.string().trim().max(60).optional().default(''),
      tax_exemption_expiry: optionalIsoDate,
      data_consent_accepted: z.boolean().default(false),
      invoice_terms: z.string().trim().max(1000).optional().default(''),
      invoice_footer: z.string().trim().max(500).optional().default(''),
    })
    .superRefine((company, ctx) => {
      if (!company.data_consent_accepted) {
        ctx.addIssue({ code: 'custom', path: ['data_consent_accepted'], message: 'consent_required' });
      }
    }),
  admin: z.object({
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(190),
    password: z.string().min(1).max(200),
  }),
  demo_data: z.boolean().default(false),
});

const DEFAULT_TERMS = DEFAULT_INVOICE_TERMS;
const DEFAULT_FOOTER = DEFAULT_INVOICE_FOOTER;
const FRANCHISE_NOTE = FRANCHISE_LEGAL_NOTE;

export const setupRoutes = new Hono<AppEnv>();

setupRoutes.get('/status', async (c) => {
  const company = await loadCompany(c.env.DB);
  if (!company) return c.json({ configured: false });
  return c.json({ configured: true, company_name: company.name, currency: company.currency });
});

setupRoutes.post('/install', async (c) => {
  // A-23: installation is one-shot and takes no credential, so it is limited
  // per address before any work; the sixth attempt waits for the window.
  const ip = clientIp(c);
  const throttle = await setupThrottle(c.env.DB, { key: 'setup:install', ip });
  if (throttle.blocked) {
    return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(throttle.retryAfterSeconds) });
  }
  await recordSetupAttempt(c.env.DB, { key: 'setup:install', ip });

  const existing = await loadCompany(c.env.DB);
  if (existing) return fail(409, 'ALREADY_CONFIGURED');

  const body = parseInput(setupSchema, await c.req.json().catch(() => ({})));
  validatePassword({
    password: body.admin.password,
    email: body.admin.email,
    firstName: body.admin.first_name,
    lastName: body.admin.last_name,
  });

  const now = nowISO();
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const currency = DEFAULT_CURRENCY;
  const passwordHash = await hashPassword(body.admin.password);

  const companyValues = {
    id: companyId,
    name: body.company.name,
    legal_name: body.company.legal_name,
    entity_category: body.company.entity_category,
    legal_form: body.company.legal_form,
    numero_tps: body.company.numero_tps || null,
    email: body.company.email || null,
    phone: body.company.phone || null,
    contact_role: body.company.contact_role || null,
    po_box_number: body.company.po_box_number || null,
    po_box_municipality: body.company.po_box_municipality,
    address1: mailingAddressLine(body.company),
    address2: body.company.address2 || null,
    city: mailingCity(body.company),
    postal_code: body.company.postal_code,
    island: body.company.island || null,
    physical_municipality: body.company.physical_municipality || null,
    district: body.company.district || null,
    pk_landmark: body.company.pk_landmark || null,
    street_building_zone: body.company.street_building_zone || null,
    delivery_instructions: body.company.delivery_instructions || null,
    country: DEFAULT_COUNTRY,
    timezone: DEFAULT_TIMEZONE,
    currency,
    locale: DEFAULT_LOCALE,
    tax_id: body.company.tax_id || null,
    rcs: body.company.rcs || null,
    ridet: body.company.ridet || null,
    nif: body.company.nif || null,
    share_capital: body.company.share_capital || null,
    vat_regime: legacyVatRegimeFor(body.company.vat_regime_detail),
    vat_regime_detail: body.company.vat_regime_detail,
    default_tax_rate: body.company.default_tax_rate,
    payment_method: body.company.payment_method,
    payment_terms_code: body.company.payment_terms_code,
    payment_terms: CLIENT_PAYMENT_TERM_DAYS[body.company.payment_terms_code],
    number_pattern: '{prefix}-{YYYY}-{####}',
    invoice_terms: body.company.invoice_terms || DEFAULT_TERMS,
    invoice_footer: body.company.invoice_footer || DEFAULT_FOOTER,
    legal_notes: legacyVatRegimeFor(body.company.vat_regime_detail) === 'franchise' ? FRANCHISE_NOTE : null,
    bank_name: body.company.bank_name || null,
    bank_holder: body.company.bank_holder || null,
    bank_iban: body.company.bank_iban || null,
    bank_bic: body.company.bank_bic || null,
    tax_exemption_decree_num: body.company.tax_exemption_decree_num || null,
    tax_exemption_expiry: body.company.tax_exemption_expiry,
    data_consent_accepted: body.company.data_consent_accepted ? 1 : 0,
    created_at: now,
    updated_at: now,
  } satisfies Record<string, string | number | null>;
  const companyColumns = Object.keys(companyValues) as (keyof typeof companyValues)[];
  // A-23: the check above is only a fast path. The insert itself refuses to add
  // a second company, and the owner row follows the company that won, so two
  // simultaneous installations cannot both succeed.
  const companyStatement = c.env.DB.prepare(
    `INSERT INTO company (${companyColumns.join(', ')})
     SELECT ${companyColumns.map(() => '?').join(', ')}
     WHERE NOT EXISTS (SELECT 1 FROM company)`,
  ).bind(...companyColumns.map((column) => companyValues[column]));

  const userStatement = c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
     SELECT ?, ?, ?, ?, ?, 'owner', 1, ?, ?
     WHERE EXISTS (SELECT 1 FROM company WHERE id = ?)`,
  ).bind(
    userId, body.admin.email, passwordHash, body.admin.first_name, body.admin.last_name, now, now,
    companyId,
  );

  await c.env.DB.batch([companyStatement, userStatement]);

  const installed = await c.env.DB.prepare(`SELECT id FROM company WHERE id = ?`)
    .bind(companyId)
    .first<{ id: string }>();
  if (!installed) return fail(409, 'ALREADY_CONFIGURED');

  // The whole local plan, including the exempt line and the 1 % archipelago
  // rate with the date it starts to apply.
  const taxStatements = TVA_RATES.map((rate) =>
    c.env.DB.prepare(
      `INSERT INTO tax_rates (id, name, rate, is_default, valid_from, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      rate.label,
      rate.rate,
      rate.rate === body.company.default_tax_rate ? 1 : 0,
      rate.valid_from,
      now,
    ),
  );
  if (taxStatements.length) await c.env.DB.batch(taxStatements);

  await logActivity(c.env.DB, {
    userId,
    action: 'created',
    entityType: 'company',
    entityId: companyId,
    summary: 'activity.company_installed',
    meta: { name: body.company.name },
  });

  if (body.demo_data) {
    await seedDemoData({
      db: c.env.DB,
      companyId,
      userId,
      currency,
      timezone: DEFAULT_TIMEZONE,
      taxRate: body.company.default_tax_rate,
    });
  }

  await one(
    c.env.DB
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES ('installed_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(now),
  );

  return c.json({ configured: true }, 201);
});

/**
 * Break-glass: restores an owner account when nobody can sign in any more.
 * Closed unless the platform secret OWNER_RECOVERY_TOKEN is provisioned, usable
 * once per database, and every use is recorded in the audit journal.
 */
setupRoutes.post('/recover-owner', async (c) => {
  // A-23: the recovery token is high-value, so guessing it is throttled per
  // address; the single-use marker below is untouched.
  const ip = clientIp(c);
  const throttle = await setupThrottle(c.env.DB, { key: 'setup:recover-owner', ip });
  if (throttle.blocked) {
    return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(throttle.retryAfterSeconds) });
  }
  await recordSetupAttempt(c.env.DB, { key: 'setup:recover-owner', ip });

  const secret = c.env.OWNER_RECOVERY_TOKEN;
  if (!secret) return fail(503, 'RECOVERY_NOT_CONFIGURED');
  const presented = c.req.header('x-recovery-token') ?? '';
  if (!presented || !constantTimeEqual(presented, secret)) return fail(401, 'INVALID_RECOVERY_TOKEN');

  const company = await loadCompany(c.env.DB);
  if (!company) return fail(409, 'SETUP_REQUIRED');

  const used = await one(
    c.env.DB.prepare(`SELECT value FROM app_meta WHERE key = 'owner_recovery_used'`),
  ) as { value: string } | null;
  if (used) return fail(409, 'RECOVERY_ALREADY_USED');

  const body = parseInput(
    z.object({
      email: z.string().trim().toLowerCase().email().max(190),
      password: z.string().min(1).max(200),
      first_name: z.string().trim().min(1).max(80).default('Admin'),
      last_name: z.string().trim().min(1).max(80).default('ManaGest'),
    }),
    await c.req.json().catch(() => ({})),
  );
  validatePassword({
    password: body.password,
    email: body.email,
    firstName: body.first_name,
    lastName: body.last_name,
  });

  const now = nowISO();
  const hash = await hashPassword(body.password);
  const existing = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(body.email)
    .first<{ id: string }>();
  const userId = existing?.id ?? crypto.randomUUID();

  if (existing) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE users SET password_hash = ?, role = 'owner', is_active = 1, deleted_at = NULL, updated_at = ? WHERE id = ?`,
      ).bind(hash, now, userId),
      c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId),
    ]);
  } else {
    await c.env.DB.prepare(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'owner', 1, ?, ?)`,
    ).bind(userId, body.email, hash, body.first_name, body.last_name, now, now).run();
  }

  await c.env.DB.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('owner_recovery_used', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(now).run();

  await logActivity(c.env.DB, {
    userId,
    action: 'updated',
    entityType: 'user',
    entityId: userId,
    summary: 'activity.user_password_reset',
    meta: { email: body.email, via: 'recover-owner' },
  });

  return c.json({ ok: true, user_id: userId, email: body.email });
});
