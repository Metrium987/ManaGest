import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { IMPORT_TRANSPORTS, TAX_BASES } from '../../shared/import-taxes';
import type { AppEnv } from '../types';

/**
 * Q6/Q7 — the import tariff and the taxes that ride on it.
 *
 * Both are ordinary rows rather than constants: a rate changes by editing a row,
 * and an old landed cost stays explainable because a rule keeps its source and its
 * validity window. The tariff is fed lazily — only the headings the business
 * actually imports — because the official tariff is a PDF of several thousand
 * lines and a guessed average rate would be wrong by construction.
 */
export const importTaxRoutes = new Hono<AppEnv>();
importTaxRoutes.use('*', requireAuth);

const ORIGINS = ['standard', 'eu', 'oceania'] as const;

importTaxRoutes.get('/', requirePermission('products.read'), async (c) => {
  const [rules, tariffs] = await Promise.all([
    c.env.DB.prepare(`SELECT * FROM import_tax_rules ORDER BY sort_order ASC, code ASC`).all(),
    c.env.DB.prepare(`SELECT * FROM tariff_codes ORDER BY code ASC`).all(),
  ]);
  return c.json({
    rules: rules.results ?? [],
    tariffs: tariffs.results ?? [],
    bases: TAX_BASES,
    transports: IMPORT_TRANSPORTS,
    origins: ORIGINS,
  });
});

const ruleSchema = z.object({
  label: z.string().trim().min(1).max(120),
  base: z.enum(TAX_BASES),
  /** Percentage of the base, in basis points (125 = 1,25 %). */
  rate_bp: z.coerce.number().int().min(0).max(10_000).default(0),
  /** Fixed amount in XPF per unit of the base. */
  amount: z.coerce.number().int().min(0).max(10_000_000).default(0),
  transport: z.enum(IMPORT_TRANSPORTS).default('any'),
  sort_order: z.coerce.number().int().min(0).max(10_000).default(100),
  is_active: z.boolean().default(true),
  valid_from: z.string().max(10).nullish(),
  valid_to: z.string().max(10).nullish(),
  source: z.string().max(300).nullish(),
});

importTaxRoutes.put('/rules/:code', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  // Writing a cost rule from a screen where costs are masked would be blind (D4).
  if (!user.permissions.includes('products.cost.read')) return fail(403, 'FORBIDDEN');

  const code = c.req.param('code').trim().toUpperCase();
  if (!/^[A-Z0-9_]{2,12}$/.test(code)) return fail(422, 'VALIDATION_ERROR', { code: 'invalid' });
  const body = parseInput(ruleSchema, await c.req.json().catch(() => ({})));
  const now = nowISO();

  await c.env.DB.prepare(
    `INSERT INTO import_tax_rules
       (code, label, base, rate_bp, amount, transport, sort_order, is_active, valid_from, valid_to, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       label = excluded.label, base = excluded.base, rate_bp = excluded.rate_bp, amount = excluded.amount,
       transport = excluded.transport, sort_order = excluded.sort_order, is_active = excluded.is_active,
       valid_from = excluded.valid_from, valid_to = excluded.valid_to, source = excluded.source,
       updated_at = excluded.updated_at`,
  )
    .bind(
      code, body.label, body.base, body.rate_bp, body.amount, body.transport, body.sort_order,
      body.is_active ? 1 : 0, body.valid_from ?? null, body.valid_to ?? null, body.source ?? null, now, now,
    )
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'import_tax_rule',
    entityId: code,
    summary: 'activity.import_tax_rule',
    meta: { base: body.base, rate_bp: body.rate_bp, amount: body.amount, active: body.is_active },
  });

  return c.json({ ok: true, code });
});

/** Deactivating keeps the row: a rule that served is never deleted, it stops
 * applying — otherwise an old landed cost would lose its explanation. */
importTaxRoutes.delete('/rules/:code', requirePermission('products.write'), async (c) => {
  const code = c.req.param('code').trim().toUpperCase();
  const result = await c.env.DB
    .prepare(`UPDATE import_tax_rules SET is_active = 0, updated_at = ? WHERE code = ?`)
    .bind(nowISO(), code)
    .run();
  if (!result.meta.changes) return fail(404, 'NOT_FOUND');
  return c.json({ ok: true });
});

const tariffSchema = z.object({
  label: z.string().trim().min(1).max(160),
  duty_rate_bp: z.coerce.number().int().min(0).max(10_000),
  duty_rate_eu_bp: z.coerce.number().int().min(0).max(10_000).nullish(),
  duty_rate_oceania_bp: z.coerce.number().int().min(0).max(10_000).nullish(),
  vat_rate_bp: z.coerce.number().int().min(0).max(10_000).default(1600),
  is_active: z.boolean().default(true),
  source: z.string().max(300).nullish(),
});

importTaxRoutes.put('/tariffs/:code', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  if (!user.permissions.includes('products.cost.read')) return fail(403, 'FORBIDDEN');

  const code = c.req.param('code').trim();
  if (!/^\d{6,10}$/.test(code)) return fail(422, 'VALIDATION_ERROR', { code: 'invalid' });
  const body = parseInput(tariffSchema, await c.req.json().catch(() => ({})));
  const now = nowISO();

  await c.env.DB.prepare(
    `INSERT INTO tariff_codes
       (code, label, duty_rate_bp, duty_rate_eu_bp, duty_rate_oceania_bp, vat_rate_bp, is_active, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET
       label = excluded.label, duty_rate_bp = excluded.duty_rate_bp,
       duty_rate_eu_bp = excluded.duty_rate_eu_bp, duty_rate_oceania_bp = excluded.duty_rate_oceania_bp,
       vat_rate_bp = excluded.vat_rate_bp, is_active = excluded.is_active, source = excluded.source,
       updated_at = excluded.updated_at`,
  )
    .bind(
      code, body.label, body.duty_rate_bp, body.duty_rate_eu_bp ?? null, body.duty_rate_oceania_bp ?? null,
      body.vat_rate_bp, body.is_active ? 1 : 0, body.source ?? null, now, now,
    )
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'tariff_code',
    entityId: code,
    summary: 'activity.tariff_code',
    meta: { duty_rate_bp: body.duty_rate_bp, origin_eu: body.duty_rate_eu_bp ?? null },
  });

  return c.json({ ok: true, code });
});
