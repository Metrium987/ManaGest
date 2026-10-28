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
