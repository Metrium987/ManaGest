import { Hono } from 'hono';
import { z } from 'zod';
import { parseInput } from '../lib/validation';
import { balanceSheet, incomeStatement, trialBalance } from '../lib/accounting';
import { logActivity } from '../lib/audit';
import { requireAuth, requirePermission } from '../middleware';
import {
  allLines, chart, journalEntries, openingBalances, saveOpeningBalances, syncAccounting,
} from '../services/accounting';
import type { AppEnv } from '../types';

/**
 * Accounting reads (AUDIT §7 P0.2). Every read first runs the idempotent sync, so
 * the journal always reflects the documents that exist; `POST /sync` is the same
 * pass on demand, for an operator who wants to see it happen.
 */
export const accountingRoutes = new Hono<AppEnv>();
accountingRoutes.use('*', requireAuth);

const rangeSchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

accountingRoutes.get('/accounts', requirePermission('accounting.read'), async (c) => {
  return c.json({ data: await chart(c.env.DB) });
});

accountingRoutes.get('/journal', requirePermission('accounting.read'), async (c) => {
  await syncAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const journal = await journalEntries(c.env.DB, { ...range, limit: 200 });
  return c.json({ ...journal, created: 0 });
});

accountingRoutes.get('/trial-balance', requirePermission('accounting.read'), async (c) => {
  await syncAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(trialBalance(lines, accounts));
});

accountingRoutes.get('/income-statement', requirePermission('accounting.read'), async (c) => {
  await syncAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(incomeStatement(lines, accounts));
});

accountingRoutes.post('/sync', requirePermission('accounting.write'), async (c) => {
  const created = await syncAccounting(c.env.DB);
  return c.json({ created });
});

/** Balance sheet (T-304): only meaningful once opening balances exist. */
accountingRoutes.get('/balance-sheet', requirePermission('accounting.read'), async (c) => {
  await syncAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(balanceSheet(lines, accounts));
});

accountingRoutes.get('/opening-balances', requirePermission('accounting.read'), async (c) => {
  return c.json(await openingBalances(c.env.DB));
});

const openingSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  rows: z.array(
    z.object({
      code: z.string().trim().regex(/^\d{3,8}$/),
      label: z.string().trim().max(120).optional(),
      debit: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
      credit: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
    }).refine((row) => !(row.debit > 0 && row.credit > 0), { message: 'debit_or_credit' }),
  ).min(1).max(500),
}).refine((body) => body.rows.some((row) => row.debit > 0 || row.credit > 0), { message: 'empty' });

/** Opening balances import: replaced on re-import, journalled once. */
accountingRoutes.put('/opening-balances', requirePermission('accounting.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(openingSchema, await c.req.json().catch(() => ({})));
  const result = await saveOpeningBalances(c.env.DB, body);
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'accounting',
    entityId: 'opening-balances',
    summary: 'activity.opening_balances_imported',
    meta: { date: body.date, accounts: result.lines, difference: result.difference },
  });
  return c.json({ ok: true, ...result });
});
