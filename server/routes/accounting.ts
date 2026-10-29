import { Hono } from 'hono';
import { z } from 'zod';
import { parseInput } from '../lib/validation';
import { incomeStatement, trialBalance } from '../lib/accounting';
import { requireAuth, requirePermission } from '../middleware';
import {
  allLines, chart, journalEntries, syncAccounting,
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
