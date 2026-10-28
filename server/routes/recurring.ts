import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { addDays, addMonths, todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { nextNumber } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import { assertPeriodOpen } from '../lib/locks';
import { lineItemsSchema, offsetOf, optionalIsoDate, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { safeLines, serialiseLines, syncInvoiceFromRow } from '../services/documents';
import type { AppEnv } from '../types';

const recurringSchema = z.object({
  client_id: z.string().min(8).max(60),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']).default('monthly'),
  interval_count: z.coerce.number().int().min(1).max(12).default(1),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: optionalIsoDate,
  remaining_cycles: z.coerce.number().int().min(0).max(999).nullish(),
  auto_send: z.boolean().default(false),
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(2000).nullish(),
});

const FREQUENCY_MONTHS: Record<string, number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

function advance(date: string, frequency: string, interval: number): string {
  if (frequency === 'weekly') return addDays(date, 7 * interval);
  return addMonths(date, FREQUENCY_MONTHS[frequency] * interval);
}

export const recurringRoutes = new Hono<AppEnv>();
recurringRoutes.use('*', requireAuth);

recurringRoutes.get('/', requirePermission('recurring.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM recurring_invoices WHERE deleted_at IS NULL`)
    .first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT r.*, c.display_name AS client_name,
      (SELECT COALESCE(SUM(total), 0) FROM invoices i WHERE i.recurring_id = r.id AND i.deleted_at IS NULL) AS generated_total,
      (SELECT COUNT(*) FROM invoices i WHERE i.recurring_id = r.id AND i.deleted_at IS NULL) AS generated_count
     FROM recurring_invoices r JOIN clients c ON c.id = r.client_id
     WHERE r.deleted_at IS NULL ORDER BY r.next_run_date ASC LIMIT ? OFFSET ?`,
  )
    .bind(per_page, offsetOf(page, per_page))
    .all();

  const total = count?.count ?? 0;
  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, line_items: safeLines(row.line_items) })),
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

recurringRoutes.get('/:id', requirePermission('recurring.read'), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT r.*, c.display_name AS client_name FROM recurring_invoices r JOIN clients c ON c.id = r.client_id
     WHERE r.id = ? AND r.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!row) return fail(404, 'NOT_FOUND');
  return c.json({ ...row, line_items: safeLines(row.line_items) });
});

recurringRoutes.post('/', requirePermission('recurring.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(recurringSchema, await c.req.json().catch(() => ({})));
  const client = await c.env.DB.prepare(
    `SELECT id, is_tax_exempt, currency FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.client_id)
    .first<{ id: string; is_tax_exempt: number; currency: string }>();
  if (!client) return fail(422, 'VALIDATION_ERROR', { client_id: 'not_found' });

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO recurring_invoices (id, client_id, number, status, frequency, interval_count, next_run_date, end_date,
      remaining_cycles, auto_send, currency, discount_type, discount_value, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, NULL, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, body.frequency, body.interval_count, body.next_run_date, body.end_date,
      body.remaining_cycles ?? null, body.auto_send ? 1 : 0, client.currency, body.discount_type,
      body.discount_value, client.is_tax_exempt, serialiseLines(body.line_items), body.notes ?? null,
      body.terms ?? null, user.id, nowISO(), nowISO(),
    )
    .run();

  return c.json({ id }, 201);
});

recurringRoutes.patch('/:id', requirePermission('recurring.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(recurringSchema, await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(`SELECT id FROM recurring_invoices WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first();
  if (!existing) return fail(404, 'NOT_FOUND');

  await c.env.DB.prepare(
    `UPDATE recurring_invoices SET client_id = ?, frequency = ?, interval_count = ?, next_run_date = ?, end_date = ?,
      remaining_cycles = ?, auto_send = ?, discount_type = ?, discount_value = ?, line_items = ?, notes = ?, terms = ?,
      updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.client_id, body.frequency, body.interval_count, body.next_run_date, body.end_date,
      body.remaining_cycles ?? null, body.auto_send ? 1 : 0, body.discount_type, body.discount_value,
      serialiseLines(body.line_items), body.notes ?? null, body.terms ?? null, nowISO(), id,
    )
    .run();
  return c.json({ ok: true });
});

recurringRoutes.post('/:id/status', requirePermission('recurring.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(
    z.object({ status: z.enum(['active', 'paused']) }),
    await c.req.json().catch(() => ({})),
  );
  const existing = await c.env.DB.prepare(`SELECT id FROM recurring_invoices WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first();
  if (!existing) return fail(404, 'NOT_FOUND');
  await c.env.DB.prepare(`UPDATE recurring_invoices SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(body.status, nowISO(), id)
    .run();
  return c.json({ ok: true });
});

recurringRoutes.post('/:id/run', requirePermission('recurring.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const id = c.req.param('id');
  const recurring = await c.env.DB.prepare(
    `SELECT r.*, c.payment_terms, c.is_tax_exempt FROM recurring_invoices r JOIN clients c ON c.id = r.client_id
     WHERE r.id = ? AND r.deleted_at IS NULL`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!recurring) return fail(404, 'NOT_FOUND');

  const today = todayIn(company.timezone);
  await assertPeriodOpen(c.env.DB, today);
  const lines = safeLines(recurring.line_items);
  const totals = computeTotals(
    lines,
    { discount_type: recurring.discount_type as 'percent' | 'amount', discount_value: recurring.discount_value as number },
    Boolean(recurring.tax_exempt),
  );
  const invoiceId = crypto.randomUUID();
  const number = await nextNumber(c.env.DB, 'invoice', 'FAC', company.number_pattern, today);
  const dueDate = addDays(today, Number(recurring.payment_terms ?? company.payment_terms));
  const status = recurring.auto_send ? 'sent' : 'draft';

  const remaining =
    recurring.remaining_cycles === null || recurring.remaining_cycles === undefined
      ? null
      : Math.max(0, Number(recurring.remaining_cycles) - 1);
  const completed = remaining === 0;
  const nextRun = advance(String(recurring.next_run_date), String(recurring.frequency), Number(recurring.interval_count));
  const endDate = recurring.end_date ? String(recurring.end_date) : null;
  const finished = completed || (endDate !== null && nextRun > endDate);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
        discount_total, tax_total, total, paid_total, balance, tax_exempt, line_items, notes, terms, recurring_id, created_by,
        created_at, updated_at, sent_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      invoiceId, recurring.client_id, number, status, today, dueDate, recurring.currency, totals.subtotal,
      recurring.discount_type, recurring.discount_value, totals.discount_total, totals.tax_total, totals.total,
      totals.total, recurring.tax_exempt, recurring.line_items, recurring.notes, recurring.terms, id, user.id,
      nowISO(), nowISO(), status === 'sent' ? nowISO() : null,
    ),
    c.env.DB.prepare(
      `UPDATE recurring_invoices SET status = ?, remaining_cycles = ?, next_run_date = ?, last_generated_at = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(finished ? 'completed' : 'active', remaining, nextRun, nowISO(), nowISO(), id),
  ]);

  await syncInvoiceFromRow(c.env.DB, {
    id: invoiceId,
    line_items: recurring.line_items,
    discount_type: String(recurring.discount_type),
    discount_value: Number(recurring.discount_value),
    tax_exempt: Number(recurring.tax_exempt),
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'generated',
    entityType: 'recurring_invoice',
    entityId: id,
    summary: 'activity.recurring_generated',
    meta: { invoice: number, total: totals.total },
  });

  return c.json({ id: invoiceId, number, next_run_date: nextRun, completed: finished });
});

recurringRoutes.delete('/:id', requirePermission('recurring.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE recurring_invoices SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  return c.json({ ok: true });
});
