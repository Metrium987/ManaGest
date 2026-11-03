import { Hono } from 'hono';
import { z } from 'zod';
import { parseInput } from '../lib/validation';
import { balanceSheet, incomeStatement, trialBalance } from '../lib/accounting';
import { buildVatReturn, type VatBucket } from '../lib/vat-return';
import { safeLines } from '../services/documents';
import { computeTotals } from '../lib/tax';
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
  const user = c.get('user')!;
  const created = await syncAccounting(c.env.DB);
  await logActivity(c.env.DB, { userId: user.id, action: 'synced', entityType: 'accounting', entityId: 'journal', summary: 'activity.accounting_synced', meta: { entries: created } });
  return c.json({ created });
});

/** Balance sheet (T-304): only meaningful once opening balances exist. */
accountingRoutes.get('/balance-sheet', requirePermission('accounting.read'), async (c) => {
  await syncAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(balanceSheet(lines, accounts));
});

/**
 * VAT recap for the 1010 declaration: the issued invoices' stored buckets minus
 * the credit notes of the period. Amounts are in the document currency (XPF for
 * now); the screen says so and never pretends to fill the official form.
 */
accountingRoutes.get('/vat-return', requirePermission('accounting.read'), async (c) => {
  const range = parseInput(rangeSchema, c.req.query());
  const from = range.from ?? '0000-01-01';
  const to = range.to ?? '9999-12-31';
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.tax_exempt, i.subtotal, l.rate, l.base, l.amount
     FROM invoices i LEFT JOIN invoice_tax_lines l ON l.invoice_id = i.id
     WHERE i.deleted_at IS NULL AND i.status NOT IN ('draft', 'cancelled')
       AND i.date >= ? AND i.date <= ?
     ORDER BY i.date, i.number`,
  ).bind(from, to).all<{ id: string; tax_exempt: number; subtotal: number; rate: number | null; base: number | null; amount: number | null }>();

  const byInvoice = new Map<string, VatBucket[]>();
  let exemptBase = 0;
  for (const row of rows.results ?? []) {
    if (!byInvoice.has(row.id)) byInvoice.set(row.id, []);
    if (row.tax_exempt) exemptBase += row.subtotal;
    if (row.rate !== null) {
      byInvoice.get(row.id)!.push({ rate: row.rate, base: row.base ?? 0, amount: row.amount ?? 0 });
    }
  }

  const credits = await c.env.DB.prepare(
    `SELECT line_items, discount_type, discount_value, tax_exempt
     FROM credits WHERE deleted_at IS NULL AND status NOT IN ('draft', 'cancelled')
       AND date >= ? AND date <= ?`,
  ).bind(from, to).all<{ line_items: string; discount_type: string; discount_value: number; tax_exempt: number }>();

  let creditExemptBase = 0;
  const creditBuckets = (credits.results ?? []).map((credit) => {
    const totals = computeTotals(
      safeLines(credit.line_items),
      { discount_type: credit.discount_type === 'amount' ? 'amount' : 'percent', discount_value: credit.discount_value },
      Boolean(credit.tax_exempt),
    );
    if (credit.tax_exempt) creditExemptBase += totals.subtotal;
    return totals.tax_buckets;
  });

  return c.json({
    from: range.from ?? null,
    to: range.to ?? null,
    ...buildVatReturn({ invoices: [...byInvoice.values()], credits: creditBuckets, exemptBase, creditExemptBase }),
  });
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
