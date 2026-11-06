import { Hono } from 'hono';
import { z } from 'zod';
import { parseInput } from '../lib/validation';
import { balanceSheet, incomeStatement, trialBalance } from '../lib/accounting';
import { buildVatReturn, type VatBucket } from '../lib/vat-return';
import { convertToBase } from '../lib/fx';
import { safeLines } from '../services/documents';
import { computeTotals } from '../lib/tax';
import { logActivity } from '../lib/audit';
import { requireAuth, requirePermission } from '../middleware';
import {
  allLines, catchUpAccounting, chart, journalEntries, openingBalances, saveOpeningBalances, syncAccounting,
} from '../services/accounting';
import type { AppEnv } from '../types';

/**
 * Accounting reads (AUDIT §7 P0.2). Every read first runs the bounded catch-up (A-18):
 * at most `ACCOUNTING_CATCH_UP_LIMIT` documents newer than `app_meta.journal_synced_at`,
 * so a read never walks the whole journal. `POST /sync` stays the full repair pass and
 * `POST /catch-up` exposes the incremental one with its counters.
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
  const pass = await catchUpAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const journal = await journalEntries(c.env.DB, { ...range, limit: 200 });
  return c.json({ ...journal, created: pass.created, processed: pass.processed, remaining: pass.remaining });
});

accountingRoutes.get('/trial-balance', requirePermission('accounting.read'), async (c) => {
  await catchUpAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(trialBalance(lines, accounts));
});

accountingRoutes.get('/income-statement', requirePermission('accounting.read'), async (c) => {
  await catchUpAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(incomeStatement(lines, accounts));
});

accountingRoutes.post('/sync', requirePermission('accounting.write'), async (c) => {
  const user = c.get('user')!;
  const created = await syncAccounting(c.env.DB);
  await logActivity(c.env.DB, { userId: user.id, action: 'synced', entityType: 'accounting', entityId: 'journal', summary: 'activity.accounting_synced', meta: { entries: created } });
  return c.json({ created, mode: 'full' });
});

// A-18: the incremental pass, exposed for an operator who wants the counters.
accountingRoutes.post('/catch-up', requirePermission('accounting.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(z.object({ limit: z.coerce.number().int().min(1).max(500).optional() }), await c.req.json().catch(() => ({})));
  const pass = await catchUpAccounting(c.env.DB, body.limit);
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'synced',
    entityType: 'accounting',
    entityId: 'journal',
    summary: 'activity.accounting_synced',
    meta: { entries: pass.created, processed: pass.processed, remaining: pass.remaining },
  });
  return c.json(pass);
});

/** Balance sheet (T-304): only meaningful once opening balances exist. */
accountingRoutes.get('/balance-sheet', requirePermission('accounting.read'), async (c) => {
  await catchUpAccounting(c.env.DB);
  const range = parseInput(rangeSchema, c.req.query());
  const [lines, accounts] = [await allLines(c.env.DB, range), await chart(c.env.DB)];
  return c.json(balanceSheet(lines, accounts));
});

/**
 * VAT recap for the 1010 declaration, expressed in XPF at each document's frozen
 * rate: a declaration is filed in the unit of account, not in the currency the
 * customer was billed in. The original-currency breakdown travels alongside so
 * the accountant can reconcile a foreign invoice without a second ledger.
 */
accountingRoutes.get('/vat-return', requirePermission('accounting.read'), async (c) => {
  const range = parseInput(rangeSchema, c.req.query());
  const from = range.from ?? '0000-01-01';
  const to = range.to ?? '9999-12-31';
  const rows = await c.env.DB.prepare(
    `SELECT i.id, i.tax_exempt, i.subtotal, i.currency, i.exchange_rate, i.currency_decimals,
            l.rate, l.base, l.amount
     FROM invoices i LEFT JOIN invoice_tax_lines l ON l.invoice_id = i.id
     WHERE i.deleted_at IS NULL AND i.status NOT IN ('draft', 'cancelled')
       AND i.date >= ? AND i.date <= ?
     ORDER BY i.date, i.number`,
  ).bind(from, to).all<{
    id: string; tax_exempt: number; subtotal: number; currency: string;
    exchange_rate: number; currency_decimals: number;
    rate: number | null; base: number | null; amount: number | null;
  }>();

  const byInvoice = new Map<string, VatBucket[]>();
  const origin = new Map<string, { currency: string; rate: number; base: number; tax: number }>();
  let exemptBase = 0;
  for (const row of rows.results ?? []) {
    const decimals = Number(row.currency_decimals ?? 0);
    const rate = Number(row.exchange_rate ?? 1);
    const currency = row.currency || 'XPF';
    if (!byInvoice.has(row.id)) byInvoice.set(row.id, []);
    if (row.tax_exempt) exemptBase += convertToBase(Number(row.subtotal), decimals, rate);
    if (row.rate !== null) {
      const base = convertToBase(Number(row.base ?? 0), decimals, rate);
      const tax = convertToBase(Number(row.amount ?? 0), decimals, rate);
      byInvoice.get(row.id)!.push({ rate: Number(row.rate), base, amount: tax });
      const key = `${currency}/${row.rate}`;
      const bucket = origin.get(key) ?? { currency, rate: Number(row.rate), base: 0, tax: 0 };
      bucket.base += Number(row.base ?? 0);
      bucket.tax += Number(row.amount ?? 0);
      origin.set(key, bucket);
    }
  }

  const credits = await c.env.DB.prepare(
    `SELECT line_items, discount_type, discount_value, tax_exempt, currency, exchange_rate, currency_decimals
     FROM credits WHERE deleted_at IS NULL AND status NOT IN ('draft', 'cancelled')
       AND date >= ? AND date <= ?`,
  ).bind(from, to).all<{
    line_items: string; discount_type: string; discount_value: number; tax_exempt: number;
    currency: string; exchange_rate: number; currency_decimals: number;
  }>();

  let creditExemptBase = 0;
  const creditBuckets = (credits.results ?? []).map((credit) => {
    const decimals = Number(credit.currency_decimals ?? 0);
    const rate = Number(credit.exchange_rate ?? 1);
    const totals = computeTotals(
      safeLines(credit.line_items),
      { discount_type: credit.discount_type === 'amount' ? 'amount' : 'percent', discount_value: credit.discount_value },
      Boolean(credit.tax_exempt),
    );
    if (credit.tax_exempt) creditExemptBase += convertToBase(totals.subtotal, decimals, rate);
    return totals.tax_buckets.map((bucket) => ({
      rate: bucket.rate,
      base: convertToBase(bucket.base, decimals, rate),
      amount: convertToBase(bucket.amount, decimals, rate),
    }));
  });

  const recap = buildVatReturn({
    invoices: [...byInvoice.values()],
    credits: creditBuckets,
    exemptBase,
    creditExemptBase,
  });
  return c.json({
    from: range.from ?? null,
    to: range.to ?? null,
    currency: 'XPF',
    ...recap,
    by_currency: [...origin.values()].sort((a, b) => a.currency.localeCompare(b.currency) || a.rate - b.rate),
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
