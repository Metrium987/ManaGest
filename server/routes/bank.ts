import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { nextNumber } from '../lib/numbering';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { recalcInvoice } from '../services/documents';
import { buildLedger, suggestMatches, type LedgerDocument } from '../lib/bank-match';
import type { AppEnv } from '../types';

export const bankRoutes = new Hono<AppEnv>();
bankRoutes.use('*', requireAuth);

bankRoutes.get('/accounts', requirePermission('bank.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT a.*,
      a.opening_balance + COALESCE((SELECT SUM(amount) FROM bank_transactions t WHERE t.account_id = a.id), 0) AS current_balance,
      (SELECT COUNT(*) FROM bank_transactions t WHERE t.account_id = a.id AND t.status = 'unmatched') AS unmatched_count
     FROM bank_accounts a ORDER BY a.created_at ASC`,
  ).all();
  return c.json({ data: rows.results ?? [] });
});

bankRoutes.post('/accounts', requirePermission('bank.write'), async (c) => {
  const body = parseInput(
    z.object({
      name: z.string().trim().min(1).max(120),
      bank_name: z.string().trim().max(120).optional().default(''),
      iban: z.string().trim().max(60).optional().default(''),
      currency: z.string().trim().length(3).default('XPF'),
      opening_balance: z.coerce.number().int().default(0),
    }),
    await c.req.json().catch(() => ({})),
  );
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO bank_accounts (id, name, bank_name, iban, currency, opening_balance, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.name, body.bank_name || null, body.iban || null, body.currency, body.opening_balance, nowISO(), nowISO()).run();
  return c.json({ id }, 201);
});

bankRoutes.get('/transactions', requirePermission('bank.read'), async (c) => {
  const accountId = c.req.query('account_id') ?? '';
  const status = c.req.query('status') ?? '';
  const filters = ['1 = 1'];
  const bindings: string[] = [];
  if (accountId) { filters.push('t.account_id = ?'); bindings.push(accountId); }
  if (status) { filters.push('t.status = ?'); bindings.push(status); }
  const rows = await c.env.DB.prepare(
    `SELECT t.* FROM bank_transactions t WHERE ${filters.join(' AND ')} ORDER BY t.date DESC LIMIT 200`,
  ).bind(...bindings).all();
  return c.json({ data: rows.results ?? [] });
});

/**
 * Matching suggestions (T-204): the rules live in `lib/bank-match.ts`; this route
 * only loads the open candidates and says which lines the screen should propose.
 */
bankRoutes.get('/suggestions', requirePermission('bank.read'), async (c) => {
  const accountId = c.req.query('account_id') ?? '';
  if (!accountId) return fail(422, 'VALIDATION_ERROR', { account_id: 'required' });

  const transactions = await c.env.DB.prepare(
    `SELECT id, date, label, amount, reference FROM bank_transactions
     WHERE account_id = ? AND status = 'unmatched' AND amount > 0 ORDER BY date DESC LIMIT 50`,
  ).bind(accountId).all<{ id: string; date: string; label: string; amount: number; reference: string | null }>();

  const invoices = await c.env.DB.prepare(
    `SELECT i.id, i.number, i.balance, i.date, cl.display_name AS client_name
     FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
     WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial') AND i.balance > 0
     ORDER BY i.date ASC LIMIT 500`,
  ).all<{ id: string; number: string; balance: number; date: string; client_name: string | null }>();

  const data = (transactions.results ?? []).map((transaction) => ({
    transaction_id: transaction.id,
    suggestions: suggestMatches(transaction, invoices.results ?? []),
  }));

  return c.json({ data });
});

/** Ledger view: every document, chronologically, with the running balance. */
bankRoutes.get('/ledger', requirePermission('bank.read'), async (c) => {
  const accountId = c.req.query('account_id') ?? '';
  const account = accountId
    ? await c.env.DB.prepare(`SELECT id, opening_balance FROM bank_accounts WHERE id = ?`)
        .bind(accountId).first<{ id: string; opening_balance: number }>()
    : await c.env.DB.prepare(`SELECT id, opening_balance FROM bank_accounts ORDER BY created_at ASC LIMIT 1`)
        .first<{ id: string; opening_balance: number }>();
  if (!account) return c.json({ data: [], opening_balance: 0 });

  const invoices = await c.env.DB.prepare(
    `SELECT i.date, i.number AS reference, i.total, cl.display_name AS client_name
     FROM invoices i LEFT JOIN clients cl ON cl.id = i.client_id
     WHERE i.deleted_at IS NULL AND i.status != 'cancelled' ORDER BY i.date ASC LIMIT 500`,
  ).all<{ date: string; reference: string; total: number; client_name: string | null }>();
  const payments = await c.env.DB.prepare(
    `SELECT p.date, COALESCE(p.number, 'REG') AS reference, p.amount, cl.display_name AS client_name
     FROM payments p LEFT JOIN clients cl ON cl.id = p.client_id
     WHERE p.status = 'completed' ORDER BY p.date ASC LIMIT 500`,
  ).all<{ date: string; reference: string; amount: number; client_name: string | null }>();
  const expenses = await c.env.DB.prepare(
    `SELECT e.date, COALESCE(e.reference, 'DEP') AS reference, e.amount, e.category
     FROM expenses e WHERE e.deleted_at IS NULL ORDER BY e.date ASC LIMIT 500`,
  ).all<{ date: string; reference: string; amount: number; category: string }>();

  const documents: LedgerDocument[] = [
    ...(invoices.results ?? []).map((row) => ({
      date: row.date, kind: 'invoice' as const, reference: row.reference,
      label: row.client_name ?? '', debit: row.total, credit: 0,
    })),
    ...(payments.results ?? []).map((row) => ({
      date: row.date, kind: 'payment' as const, reference: row.reference,
      label: row.client_name ?? '', debit: 0, credit: row.amount,
    })),
    ...(expenses.results ?? []).map((row) => ({
      date: row.date, kind: 'expense' as const, reference: row.reference,
      label: row.category, debit: 0, credit: row.amount,
    })),
  ];

  return c.json({ data: buildLedger(documents, account.opening_balance ?? 0), opening_balance: account.opening_balance ?? 0 });
});

bankRoutes.post('/transactions/import', requirePermission('bank.write'), async (c) => {
  const body = parseInput(
    z.object({
      account_id: z.string().min(8).max(60),
      transactions: z.array(
        z.object({
          date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
          label: z.string().trim().min(1).max(200),
          amount: z.coerce.number().int(),
          reference: z.string().max(120).nullish(),
        }),
      ).min(1).max(500),
    }),
    await c.req.json().catch(() => ({})),
  );

  const account = await c.env.DB.prepare(`SELECT id FROM bank_accounts WHERE id = ?`).bind(body.account_id).first();
  if (!account) return fail(404, 'NOT_FOUND');

  await c.env.DB.batch(
    body.transactions.map((tx) =>
      c.env.DB.prepare(
        `INSERT INTO bank_transactions (id, account_id, date, label, amount, reference, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'unmatched', ?)`,
      ).bind(crypto.randomUUID(), body.account_id, tx.date, tx.label, tx.amount, tx.reference ?? null, nowISO()),
    ),
  );

  return c.json({ imported: body.transactions.length }, 201);
});

bankRoutes.post('/transactions/:id/match', requirePermission('bank.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({ invoice_id: z.string().min(8).max(60) }),
    await c.req.json().catch(() => ({})),
  );

  const tx = await c.env.DB.prepare(`SELECT * FROM bank_transactions WHERE id = ? AND status = 'unmatched'`)
    .bind(id).first<{ id: string; date: string; label: string; amount: number; status: string }>();
  if (!tx) return fail(404, 'NOT_FOUND');
  if (tx.amount <= 0) return fail(409, 'NOT_INCOMING');

  const invoice = await c.env.DB.prepare(
    `SELECT id, client_id, balance, number FROM invoices WHERE id = ? AND deleted_at IS NULL AND status IN ('sent','partial')`,
  ).bind(body.invoice_id).first<{ id: string; client_id: string; balance: number; number: string }>();
  if (!invoice) return fail(409, 'INVOICE_NOT_OPEN');

  const amount = Math.min(tx.amount, invoice.balance);
  const paymentId = crypto.randomUUID();
  const number = await nextNumber(c.env.DB, 'payment', 'REG', company.number_pattern, tx.date);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO payments (id, client_id, number, date, amount, method, reference, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'transfer', ?, ?, 'completed', ?, ?, ?)`,
    ).bind(paymentId, invoice.client_id, number, tx.date, amount, tx.label.slice(0, 120), 'Rapprochement bancaire', user.id, nowISO(), nowISO()),
    c.env.DB.prepare(
      `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), paymentId, invoice.id, amount, nowISO()),
    c.env.DB.prepare(`UPDATE bank_transactions SET status = 'matched', matched_payment_id = ? WHERE id = ?`)
      .bind(paymentId, id),
  ]);

  await recalcInvoice(c.env.DB, invoice.id);
  await logActivity(c.env.DB, {
    userId: user.id, action: 'matched', entityType: 'bank_transaction', entityId: id,
    summary: 'activity.bank_matched', meta: { invoice: invoice.number, amount, date: todayIn(company.timezone) },
  });

  return c.json({ ok: true, payment_id: paymentId, allocated: amount });
});

bankRoutes.patch('/transactions/:id', requirePermission('bank.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(z.object({ status: z.enum(['ignored', 'unmatched']) }), await c.req.json().catch(() => ({})));
  await c.env.DB.prepare(`UPDATE bank_transactions SET status = ? WHERE id = ?`).bind(body.status, id).run();
  return c.json({ ok: true });
});
