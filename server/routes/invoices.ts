import { Hono } from 'hono';
import { z } from 'zod';
import { addDays, todayIn } from '../lib/dates';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { retentionElapsed, DEFAULT_RETENTION_YEARS } from '../lib/retention';
import { fail } from '../lib/errors';
import { nextNumber, recordNumberGap } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import { offsetOf, paginationSchema, parseInput, lineItemsSchema, optionalIsoDate } from '../lib/validation';
import { assertPeriodOpen } from '../lib/locks';
import { diffSnapshot } from '../lib/audit';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import {
  serialiseLines, recalcInvoice, safeLines, syncInvoiceTaxLines,
} from '../services/documents';
import { buildInvoicePdf } from '../services/pdf';
import { deriveInvoiceStatus, isOverdue, refundableAmount } from '../services/status';
import { recalcCredit } from '../services/documents';
import type { AppEnv } from '../types';

const invoiceSchema = z.object({
  client_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: optionalIsoDate,
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(2000).nullish(),
  footer: z.string().max(1000).nullish(),
  po_number: z.string().max(80).nullish(),
});

export const invoiceRoutes = new Hono<AppEnv>();
invoiceRoutes.use('*', requireAuth);

invoiceRoutes.get('/', requirePermission('invoices.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const status = c.req.query('status') ?? '';
  const clientId = c.req.query('client_id') ?? '';
  const search = (c.req.query('q') ?? '').trim();
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const company = c.get('company')!;

  const filters = ['i.deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (status && status !== 'overdue') {
    filters.push('i.status = ?');
    bindings.push(status);
  }
  if (status === 'overdue') {
    filters.push(`i.status IN ('sent','partial') AND i.due_date IS NOT NULL AND i.due_date < ?`);
    bindings.push(todayIn(company.timezone));
  }
  if (clientId) {
    filters.push('i.client_id = ?');
    bindings.push(clientId);
  }
  if (search) {
    filters.push('(i.number LIKE ? OR c.display_name LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`);
  }
  if (from) {
    filters.push('i.date >= ?');
    bindings.push(from);
  }
  if (to) {
    filters.push('i.date <= ?');
    bindings.push(to);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM invoices i JOIN clients c ON c.id = i.client_id ${where}`,
  )
    .bind(...bindings)
    .first<{ count: number }>();
  const total = totalRow?.count ?? 0;

  const rows = await c.env.DB.prepare(
    `SELECT i.*, c.display_name AS client_name
     FROM invoices i JOIN clients c ON c.id = i.client_id
     ${where}
     ORDER BY i.date DESC, i.created_at DESC
     LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all<Record<string, unknown>>();

  const today = todayIn(company.timezone);
  const data = (rows.results ?? []).map((row) => ({
    ...row,
    line_items: safeLines(row.line_items),
    overdue: isOverdue(String(row.status), row.due_date as string | null, today),
  }));

  return c.json({
    data,
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

invoiceRoutes.get('/:id', requirePermission('invoices.read'), async (c) => {
  const company = c.get('company')!;
  const invoice = await c.env.DB.prepare(
    `SELECT i.*, c.display_name AS client_name, c.email AS client_email, c.address1 AS client_address1,
            c.city AS client_city, c.postal_code AS client_postal_code, c.country AS client_country,
            c.tax_id AS client_tax_id
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.id = ? AND i.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!invoice) return fail(404, 'NOT_FOUND');

  const allocations = await c.env.DB.prepare(
    `SELECT pa.id, pa.amount, p.number AS payment_number, p.date, p.method, p.reference
     FROM payment_allocations pa JOIN payments p ON p.id = pa.payment_id
     WHERE pa.invoice_id = ? AND p.deleted_at IS NULL
     ORDER BY p.date DESC`,
  )
    .bind(c.req.param('id'))
    .all();

  const lines = safeLines(invoice.line_items);
  const totals = computeTotals(
    lines,
    { discount_type: invoice.discount_type as 'percent' | 'amount', discount_value: invoice.discount_value as number },
    Boolean(invoice.tax_exempt),
  );

  return c.json({
    ...invoice,
    line_items: lines,
    tax_buckets: totals.tax_buckets,
    payments: allocations.results ?? [],
    overdue: isOverdue(String(invoice.status), invoice.due_date as string | null, todayIn(company.timezone)),
  });
});

invoiceRoutes.post('/', requirePermission('invoices.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(invoiceSchema, await c.req.json().catch(() => ({})));
  await assertPeriodOpen(c.env.DB, body.date);

  const client = await c.env.DB.prepare(
    `SELECT id, is_tax_exempt, payment_terms, currency FROM clients
     WHERE id = ? AND deleted_at IS NULL AND archived = 0`,
  )
    .bind(body.client_id)
    .first<{ id: string; is_tax_exempt: number; payment_terms: number; currency: string }>();
  if (!client) return fail(422, 'VALIDATION_ERROR', { client_id: 'not_found' });

  const totals = computeTotals(
    body.line_items,
    { discount_type: body.discount_type, discount_value: body.discount_value },
    Boolean(client.is_tax_exempt),
  );
  const id = crypto.randomUUID();
  const number = await nextNumber(c.env.DB, 'invoice', 'FAC', company.number_pattern, body.date);
  const terms = body.terms || company.invoice_terms;
  const dueDate = body.due_date ?? (company.payment_terms >= 0 ? addDays(body.date, client.payment_terms ?? company.payment_terms) : null);

  await c.env.DB.prepare(
    `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
      discount_total, tax_total, total, paid_total, balance, tax_exempt, po_number, line_items, notes, terms, footer, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, number, body.date, dueDate, client.currency || company.currency,
      totals.subtotal, body.discount_type, body.discount_value, totals.discount_total, totals.tax_total,
      totals.total, totals.total, client.is_tax_exempt, body.po_number ?? null, serialiseLines(body.line_items),
      body.notes ?? null, terms, body.footer || company.invoice_footer, user.id, nowISO(), nowISO(),
    )
    .run();

  await syncInvoiceTaxLines(c.env.DB, id, totals.tax_buckets);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_created',
    meta: { number, total: totals.total },
    after: { number, total: totals.total, date: body.date },
    ip: clientIp(c),
  });

  return c.json({ id, number }, 201);
});

invoiceRoutes.patch('/:id', requirePermission('invoices.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(invoiceSchema, await c.req.json().catch(() => ({})));

  const existing = await c.env.DB.prepare(
    `SELECT i.*, c.is_tax_exempt FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.id = ? AND i.deleted_at IS NULL`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return fail(404, 'NOT_FOUND');
  if (existing.status === 'cancelled' || existing.status === 'paid') return fail(409, 'INVOICE_LOCKED');
  if ((existing.paid_total as number) > 0) return fail(409, 'INVOICE_HAS_PAYMENTS');
  // Both dates: re-dating must not move a document into or out of a closed month.
  await assertPeriodOpen(c.env.DB, existing.date as string, body.date);

  const totals = computeTotals(
    body.line_items,
    { discount_type: body.discount_type, discount_value: body.discount_value },
    Boolean(existing.is_tax_exempt),
  );

  await c.env.DB.prepare(
    `UPDATE invoices SET client_id = ?, date = ?, due_date = ?, subtotal = ?, discount_type = ?, discount_value = ?,
      discount_total = ?, tax_total = ?, total = ?, balance = ?, po_number = ?, line_items = ?, notes = ?, terms = ?,
      footer = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.client_id, body.date, body.due_date, totals.subtotal, body.discount_type, body.discount_value,
      totals.discount_total, totals.tax_total, totals.total, totals.total, body.po_number ?? null,
      serialiseLines(body.line_items), body.notes ?? null, body.terms || company.invoice_terms,
      body.footer || company.invoice_footer, nowISO(), id,
    )
    .run();

  await syncInvoiceTaxLines(c.env.DB, id, totals.tax_buckets);

  const changes = diffSnapshot(existing, body, [
    'client_id', 'date', 'due_date', 'subtotal', 'tax_total', 'total', 'po_number', 'notes', 'terms',
  ]);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_updated',
    meta: { number: existing.number },
    before: changes?.before ?? null,
    after: changes?.after ?? null,
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

invoiceRoutes.post('/:id/send', requirePermission('invoices.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const invoice = await c.env.DB.prepare(
    `SELECT id, number, status, date FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; number: string; status: string; date: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (invoice.status !== 'draft') return fail(409, 'INVALID_TRANSITION');
  await assertPeriodOpen(c.env.DB, invoice.date);

  await c.env.DB.prepare(
    `UPDATE invoices SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ? AND status = 'draft'`,
  )
    .bind(nowISO(), nowISO(), id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'sent',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_sent',
    meta: { number: invoice.number },
  });

  return c.json({ ok: true });
});

invoiceRoutes.post('/:id/cancel', requirePermission('invoices.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const invoice = await c.env.DB.prepare(
    `SELECT id, number, status, paid_total, date FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; number: string; status: string; paid_total: number; date: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (invoice.status === 'cancelled') return fail(409, 'INVALID_TRANSITION');
  if (invoice.paid_total > 0) return fail(409, 'INVOICE_HAS_PAYMENTS');
  await assertPeriodOpen(c.env.DB, invoice.date);

  // Retention guard (OQ-006): issued documents leave the deletion window
  // only after the configurable retention period (default 10 years).
  if (invoice.status !== undefined && invoice.status !== 'draft') {
    const retentionYears = Number(
      (await c.env.DB.prepare(`SELECT value FROM settings_extra WHERE key = 'retention_years'`).first())?.value
        ?? DEFAULT_RETENTION_YEARS,
    );
    const today = todayIn(c.get('company')!.timezone);
    if (!retentionElapsed(invoice.date, retentionYears, today)) {
      return fail(409, 'RETENTION_LOCKED');
    }
  }

  await c.env.DB.prepare(
    `UPDATE invoices SET status = 'cancelled', balance = 0, cancelled_at = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(nowISO(), nowISO(), id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'cancelled',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_cancelled',
    meta: { number: invoice.number },
  });

  return c.json({ ok: true });
});

invoiceRoutes.post('/:id/duplicate', requirePermission('invoices.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const source = await c.env.DB.prepare(
    `SELECT * FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!source) return fail(404, 'NOT_FOUND');

  const id = crypto.randomUUID();
  const date = todayIn(company.timezone);
  await assertPeriodOpen(c.env.DB, date);
  const number = await nextNumber(c.env.DB, 'invoice', 'FAC', company.number_pattern, date);

  await c.env.DB.prepare(
    `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
      discount_total, tax_total, total, paid_total, balance, tax_exempt, po_number, line_items, notes, terms, footer, created_by, created_at, updated_at)
     SELECT ?, client_id, ?, 'draft', ?, ?, currency, subtotal, discount_type, discount_value, discount_total, tax_total, total,
            0, total, tax_exempt, po_number, line_items, notes, terms, footer, ?, ?, ?
     FROM invoices WHERE id = ?`,
  )
    .bind(id, number, date, addDays(date, company.payment_terms), user.id, nowISO(), nowISO(), source.id)
    .run();

  await syncInvoiceTaxLines(c.env.DB, id, computeTotals(
    safeLines(source.line_items),
    {
      discount_type: source.discount_type === 'amount' ? 'amount' : 'percent',
      discount_value: Number(source.discount_value),
    },
    Boolean(source.tax_exempt),
  ).tax_buckets);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_duplicated',
    meta: { number, source: source.number },
  });

  return c.json({ id, number }, 201);
});

invoiceRoutes.post('/:id/mark-paid', requirePermission('payments.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const company = c.get('company')!;
  const body = parseInput(
    z.object({ method: z.string().max(30).default('transfer'), reference: z.string().max(120).optional() }),
    await c.req.json().catch(() => ({})),
  );

  const invoice = await c.env.DB.prepare(
    `SELECT id, client_id, number, status, balance, total, date FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; client_id: string; number: string; status: string; balance: number; total: number; date: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (invoice.balance <= 0) return fail(409, 'INVOICE_ALREADY_PAID');
  if (invoice.status === 'cancelled') return fail(409, 'INVOICE_CANCELLED');

  const today = todayIn(company.timezone);
  // The payment is dated today: only the payment's own period must be open.
  await assertPeriodOpen(c.env.DB, today);
  const paymentId = crypto.randomUUID();
  const paymentNumber = await nextNumber(c.env.DB, 'payment', 'REG', company.number_pattern, today);

  const statements = [
    c.env.DB.prepare(
      `INSERT INTO payments (id, client_id, number, date, amount, method, reference, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
    ).bind(paymentId, invoice.client_id, paymentNumber, today, invoice.balance, body.method, body.reference ?? null, user.id, nowISO(), nowISO()),
    c.env.DB.prepare(
      `INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), paymentId, id, invoice.balance, nowISO()),
    c.env.DB.prepare(
      `UPDATE invoices SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END,
       sent_at = COALESCE(sent_at, ?) WHERE id = ?`,
    ).bind(nowISO(), id),
  ];
  await c.env.DB.batch(statements);
  await recalcInvoice(c.env.DB, id);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'paid',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_marked_paid',
    meta: { number: invoice.number, payment: paymentNumber, amount: invoice.balance },
  });

  return c.json({ ok: true, payment_id: paymentId, number: paymentNumber });
});

invoiceRoutes.post('/:id/apply-credit', requirePermission('invoices.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ credit_id: z.string().min(8).max(60), amount: z.coerce.number().int().positive() }),
    await c.req.json().catch(() => ({})),
  );

  const invoice = await c.env.DB.prepare(
    `SELECT id, client_id, balance, number FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; client_id: string; balance: number; number: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');

  const credit = await c.env.DB.prepare(
    `SELECT id, client_id, balance, status FROM credits WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.credit_id)
    .first<{ id: string; client_id: string; balance: number; status: string; date: string }>();
  if (!credit) return fail(404, 'NOT_FOUND');
  if (credit.client_id !== invoice.client_id) return fail(409, 'CLIENT_MISMATCH');
  if (credit.balance < body.amount) return fail(409, 'CREDIT_INSUFFICIENT_BALANCE');
  if (invoice.balance < body.amount) return fail(409, 'AMOUNT_EXCEEDS_BALANCE');

  await c.env.DB.prepare(
    `INSERT INTO credit_allocations (id, credit_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), credit.id, id, body.amount, nowISO())
    .run();

  await recalcInvoice(c.env.DB, id);
  // Derive the credit from its allocations (status applied/partial included),
  // instead of decrementing counters by hand: a fully used credit must not stay
  // labelled "sent" with a zero balance.
  await recalcCredit(c.env.DB, credit.id);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'applied',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.credit_applied',
    meta: { number: invoice.number, amount: body.amount },
  });

  return c.json({ ok: true });
});

invoiceRoutes.delete('/:id', requirePermission('invoices.delete'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const invoice = await c.env.DB.prepare(
    `SELECT id, number, paid_total, date, status FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; number: string; paid_total: number; date: string; status: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (invoice.paid_total > 0) return fail(409, 'INVOICE_HAS_PAYMENTS');
  await assertPeriodOpen(c.env.DB, invoice.date);

  // Retention guard (OQ-006): issued documents leave the deletion window
  // only after the configurable retention period (default 10 years).
  if (invoice.status !== undefined && invoice.status !== 'draft') {
    const retentionYears = Number(
      (await c.env.DB.prepare(`SELECT value FROM settings_extra WHERE key = 'retention_years'`).first())?.value
        ?? DEFAULT_RETENTION_YEARS,
    );
    const today = todayIn(c.get('company')!.timezone);
    if (!retentionElapsed(invoice.date, retentionYears, today)) {
      return fail(409, 'RETENTION_LOCKED');
    }
  }

  await recordNumberGap(c.env.DB, 'invoice', invoice.number, user.id);
  await c.env.DB.prepare(`UPDATE invoices SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'deleted',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_deleted',
    meta: { number: invoice.number },
  });

  return c.json({ ok: true });
});

// T-004 (BK-006 adaptation per OQ-012): refunds go through credit notes — no separate refund flow.
// This convenience action creates a DRAFT credit note pre-filled from an issued invoice;
// the user then sends/applies it through the normal credit workflow.
invoiceRoutes.post('/:id/remind', requirePermission('invoices.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const today = todayIn(company.timezone);
  const invoice = await c.env.DB.prepare(
    `SELECT id, number, status, due_date FROM invoices WHERE id = ? AND deleted_at IS NULL AND status IN ('sent','partial')`,
  ).bind(c.req.param('id')).first<{ id: string; number: string; status: string; due_date: string | null }>();
  if (!invoice) return fail(409, 'INVOICE_NOT_OPEN');
  if (!isOverdue(invoice.status, invoice.due_date, today)) return fail(409, 'NOT_OVERDUE');

  await logActivity(c.env.DB, {
    userId: user.id, action: 'reminded', entityType: 'invoice', entityId: invoice.id,
    summary: 'activity.invoice_reminded',
    meta: { number: invoice.number, due_date: invoice.due_date },
  });
  return c.json({ ok: true });
});

invoiceRoutes.post('/:id/credit-note', requirePermission('credits.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ amount: z.coerce.number().int().positive(), notes: z.string().max(2000).nullish() }),
    await c.req.json().catch(() => ({})),
  );
  const today = todayIn(company.timezone);

  const invoice = await c.env.DB.prepare(
    `SELECT id, client_id, number, status, balance, total, paid_total FROM invoices WHERE id = ? AND deleted_at IS NULL AND status IN ('sent','partial','paid')`,
  ).bind(c.req.param('id')).first<{ id: string; client_id: string; number: string; status: string; balance: number; total: number; paid_total: number }>();
  if (!invoice) return fail(409, 'INVOICE_NOT_OPEN');

  // Refund ceiling: what was received on a paid invoice, else the open balance.
  const refundable = refundableAmount(invoice.status, invoice.balance, invoice.paid_total);
  if (refundable <= 0) return fail(409, 'INVOICE_NOT_OPEN');
  if (body.amount > refundable) return fail(409, 'AMOUNT_EXCEEDS_BALANCE');
  const amount = body.amount;

  const number = await nextNumber(c.env.DB, 'credit', 'AV', company.number_pattern, today);
  const totals = computeTotals(
    [{ id: 'credit-ref', description: `Avoir sur facture ${invoice.number ?? ''}`.trim(), quantity: 1, unit_price: amount, tax_rate: 0 }],
    { discount_type: 'percent', discount_value: 0 },
    false,
  );
  const id = crypto.randomUUID();
  const date = today;
  await c.env.DB.prepare(
    `INSERT INTO credits (id, client_id, number, status, date, currency, subtotal, discount_type, discount_value,
      discount_total, tax_total, total, applied_total, balance, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, 'percent', 0, 0, 0, ?, 0, ?, 1, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, invoice.client_id, number, date, company.currency, totals.subtotal, totals.total, totals.total,
    serialiseLines([{ id: 'credit-ref', description: `Avoir sur facture ${invoice.number ?? ''}`.trim(), quantity: 1, unit_price: amount, tax_rate: 0 }]),
    body.notes ?? null, company.invoice_terms, user.id, nowISO(), nowISO()).run();

  await logActivity(c.env.DB, {
    userId: user.id, action: 'created', entityType: 'credit', entityId: id,
    summary: 'activity.credit_created_from_invoice',
    meta: { number, invoice_number: invoice.number, amount },
  });
  return c.json({ id, number, amount }, 201);
});

invoiceRoutes.get('/:id/pdf', requirePermission('invoices.read'), async (c) => {
  const company = c.get('company')!;
  const invoice = await c.env.DB.prepare(
    `SELECT i.*, c.display_name AS client_name, c.email AS client_email, c.address1 AS client_address1,
            c.address2 AS client_address2, c.city AS client_city, c.postal_code AS client_postal_code,
            c.country AS client_country, c.tax_id AS client_tax_id
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.id = ? AND i.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!invoice) return fail(404, 'NOT_FOUND');

  const bytes = await buildInvoicePdf(company, invoice, safeLines(invoice.line_items));
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${String(invoice.number ?? 'facture')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

export { deriveInvoiceStatus };
