import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { nextNumber } from '../lib/numbering';
import { offsetOf, paginationSchema, parseInput } from '../lib/validation';
import { assertPeriodOpen } from '../lib/locks';
import { requireAuth, requirePermission } from '../middleware';
import { recalcInvoice } from '../services/documents';
import type { AppEnv } from '../types';

const allocationSchema = z.object({
  invoice_id: z.string().min(8).max(60),
  amount: z.coerce.number().int().positive(),
});

const paymentSchema = z.object({
  client_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().int().positive(),
  method: z.enum(['transfer', 'cash', 'cheque', 'card', 'direct_debit', 'credit', 'other']).default('transfer'),
  reference: z.string().max(120).nullish(),
  notes: z.string().max(2000).nullish(),
  allocations: z.array(allocationSchema).max(50).default([]),
  auto_apply: z.boolean().default(true),
});

export const paymentRoutes = new Hono<AppEnv>();
paymentRoutes.use('*', requireAuth);

paymentRoutes.get('/', requirePermission('payments.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const clientId = c.req.query('client_id') ?? '';

  const filters = ['p.deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (search) {
    filters.push('(p.number LIKE ? OR p.reference LIKE ? OR c.display_name LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (clientId) {
    filters.push('p.client_id = ?');
    bindings.push(clientId);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM payments p JOIN clients c ON c.id = p.client_id ${where}`,
  )
    .bind(...bindings)
    .first<{ count: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.display_name AS client_name,
      (SELECT COALESCE(SUM(pa.amount), 0) FROM payment_allocations pa WHERE pa.payment_id = p.id) AS applied,
      (SELECT COUNT(*) FROM payment_allocations pa WHERE pa.payment_id = p.id) AS invoice_count
     FROM payments p JOIN clients c ON c.id = p.client_id
     ${where}
     ORDER BY p.date DESC, p.created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all();

  const total = count?.count ?? 0;
  return c.json({
    data: rows.results ?? [],
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

paymentRoutes.get('/:id', requirePermission('payments.read'), async (c) => {
  const payment = await c.env.DB.prepare(
    `SELECT p.*, c.display_name AS client_name FROM payments p JOIN clients c ON c.id = p.client_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first();
  if (!payment) return fail(404, 'NOT_FOUND');

  const allocations = await c.env.DB.prepare(
    `SELECT pa.id, pa.amount, i.number AS invoice_number, i.id AS invoice_id, i.balance AS invoice_balance
     FROM payment_allocations pa JOIN invoices i ON i.id = pa.invoice_id
     WHERE pa.payment_id = ?`,
  )
    .bind(c.req.param('id'))
    .all();

  return c.json({ ...payment, allocations: allocations.results ?? [] });
});

paymentRoutes.post('/', requirePermission('payments.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(paymentSchema, await c.req.json().catch(() => ({})));
  await assertPeriodOpen(c.env.DB, body.date);

  const client = await c.env.DB.prepare(
    `SELECT id FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.client_id)
    .first<{ id: string }>();
  if (!client) return fail(422, 'VALIDATION_ERROR', { client_id: 'not_found' });

  const openInvoices = await c.env.DB.prepare(
    `SELECT id, balance FROM invoices
     WHERE client_id = ? AND deleted_at IS NULL AND status IN ('sent', 'partial') AND balance > 0
     ORDER BY date ASC, created_at ASC`,
  )
    .bind(body.client_id)
    .all<{ id: string; balance: number }>();
  const open = openInvoices.results ?? [];

  let allocations = body.allocations;
  if (allocations.length === 0 && body.auto_apply) {
    let remaining = body.amount;
    allocations = [];
    for (const invoice of open) {
      if (remaining <= 0) break;
      const amount = Math.min(remaining, invoice.balance);
      allocations.push({ invoice_id: invoice.id, amount });
      remaining -= amount;
    }
  }

  const allocatedTotal = allocations.reduce((sum, row) => sum + row.amount, 0);
  if (allocatedTotal > body.amount) return fail(422, 'VALIDATION_ERROR', { allocations: 'exceeds_amount' });

  for (const allocation of allocations) {
    const invoice = open.find((row) => row.id === allocation.invoice_id);
    if (!invoice) return fail(409, 'INVOICE_NOT_OPEN');
    if (allocation.amount > invoice.balance) return fail(409, 'AMOUNT_EXCEEDS_BALANCE');
  }

  const id = crypto.randomUUID();
  const number = await nextNumber(c.env.DB, 'payment', 'REG', company.number_pattern, body.date);

  const statements = [
    c.env.DB.prepare(
      `INSERT INTO payments (id, client_id, number, date, amount, method, reference, notes, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    ).bind(id, body.client_id, number, body.date, body.amount, body.method, body.reference ?? null, body.notes ?? null, user.id, nowISO(), nowISO()),
    ...allocations.map((allocation) =>
      c.env.DB.prepare(
        `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, allocation.invoice_id, allocation.amount, nowISO()),
    ),
  ];
  await c.env.DB.batch(statements);
  for (const allocation of allocations) {
    await recalcInvoice(c.env.DB, allocation.invoice_id);
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'payment',
    entityId: id,
    summary: 'activity.payment_created',
    meta: { number, amount: body.amount, allocations: allocations.length, date: todayIn(company.timezone) },
  });

  return c.json({ id, number, allocated: allocatedTotal }, 201);
});

paymentRoutes.delete('/:id', requirePermission('payments.delete'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const payment = await c.env.DB.prepare(
    `SELECT id, number, date FROM payments WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; number: string; date: string }>();
  if (!payment) return fail(404, 'NOT_FOUND');
  await assertPeriodOpen(c.env.DB, payment.date);

  const allocations = await c.env.DB.prepare(
    `SELECT invoice_id FROM payment_allocations WHERE payment_id = ?`,
  )
    .bind(id)
    .all<{ invoice_id: string }>();

  await c.env.DB.prepare(
    `UPDATE payments SET deleted_at = ?, status = 'void', updated_at = ? WHERE id = ?`,
  )
    .bind(nowISO(), nowISO(), id)
    .run();

  for (const allocation of allocations.results ?? []) {
    await recalcInvoice(c.env.DB, allocation.invoice_id);
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'deleted',
    entityType: 'payment',
    entityId: id,
    summary: 'activity.payment_voided',
    meta: { number: payment.number },
  });

  return c.json({ ok: true });
});
