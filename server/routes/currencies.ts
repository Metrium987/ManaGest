import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { currencyCodeError } from '../lib/fx';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { getCurrency, listCurrencies, listRates, saveRate } from '../services/currencies';
import type { AppEnv } from '../types';

/**
 * Currencies and their rates are workspace data, not a banking feed: the owner
 * types them. Reading is open to anyone who may read the books (the accountant
 * needs them); writing is the settings permission, so an accountant can use
 * them but not change them.
 */

const currencySchema = z.object({
  code: z.string().trim().toUpperCase().min(3).max(5),
  label: z.string().trim().min(1).max(80),
  symbol: z.string().trim().min(1).max(8),
  decimals: z.coerce.number().int().min(0).max(4).default(2),
  active: z.boolean().default(true),
});

const patchSchema = z.object({
  label: z.string().trim().min(1).max(80).optional(),
  symbol: z.string().trim().min(1).max(8).optional(),
  decimals: z.coerce.number().int().min(0).max(4).optional(),
  active: z.boolean().optional(),
});

const rateSchema = z.object({
  rate: z.coerce.number().positive().max(1_000_000),
  effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(200).nullish(),
});

export const currencyRoutes = new Hono<AppEnv>();
currencyRoutes.use('*', requireAuth);

currencyRoutes.get('/', requirePermission('settings.read'), async (c) => {
  return c.json({ data: await listCurrencies(c.env.DB) });
});

currencyRoutes.post('/', requirePermission('settings.write'), async (c) => {
  const body = parseInput(currencySchema, await c.req.json().catch(() => ({})));
  if (currencyCodeError(body.code)) return fail(422, 'VALIDATION_ERROR', { code: 'invalid_code' });
  if (await getCurrency(c.env.DB, body.code)) return fail(409, 'CURRENCY_EXISTS', { code: body.code });
  const now = nowISO();
  await c.env.DB.prepare(
    `INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(body.code, body.label, body.symbol, body.decimals, body.active ? 1 : 0, now, now)
    .run();
  const created = await getCurrency(c.env.DB, body.code);
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'created',
    entityType: 'currency',
    entityId: body.code,
    summary: 'activity.currency_created',
    meta: { code: body.code, label: body.label },
  });
  return c.json({ data: created }, 201);
});

currencyRoutes.patch('/:code', requirePermission('settings.write'), async (c) => {
  const code = c.req.param('code').trim().toUpperCase();
  const current = await getCurrency(c.env.DB, code);
  if (!current) return fail(404, 'NOT_FOUND');
  const body = parseInput(patchSchema, await c.req.json().catch(() => ({})));
  // The base currency's decimals and activity are structural: the whole ledger
  // is expressed in it, so deactivating it would leave no unit of account.
  if (current.is_base && (body.active === false || (body.decimals !== undefined && body.decimals !== current.decimals))) {
    return fail(422, 'BASE_CURRENCY_LOCKED');
  }
  await c.env.DB.prepare(
    `UPDATE currencies SET label = ?, symbol = ?, decimals = ?, active = ?, updated_at = ? WHERE code = ?`,
  )
    .bind(
      body.label ?? current.label,
      body.symbol ?? current.symbol,
      body.decimals ?? current.decimals,
      body.active === undefined ? current.active : body.active ? 1 : 0,
      nowISO(),
      code,
    )
    .run();
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'updated',
    entityType: 'currency',
    entityId: code,
    summary: 'activity.currency_updated',
    meta: { code, active: body.active === undefined ? current.active : body.active },
  });
  return c.json({ data: await getCurrency(c.env.DB, code) });
});

currencyRoutes.get('/:code/rates', requirePermission('settings.read'), async (c) => {
  const code = c.req.param('code').trim().toUpperCase();
  if (!await getCurrency(c.env.DB, code)) return fail(404, 'NOT_FOUND');
  return c.json({ data: await listRates(c.env.DB, code) });
});

currencyRoutes.post('/:code/rates', requirePermission('settings.write'), async (c) => {
  const code = c.req.param('code').trim().toUpperCase();
  const body = parseInput(rateSchema, await c.req.json().catch(() => ({})));
  await saveRate(c.env.DB, {
    currency: code,
    rate: body.rate,
    date: body.effective_date,
    note: body.note ?? null,
    userId: c.get('user')!.id,
  });
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'created',
    entityType: 'exchange_rate',
    entityId: `${code}/${body.effective_date}`,
    summary: 'activity.exchange_rate_saved',
    meta: { currency: code, rate: body.rate, effective_date: body.effective_date },
  });
  return c.json({ ok: true }, 201);
});
