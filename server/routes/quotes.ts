import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { addDays, todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { nextNumber } from '../lib/numbering';
import { isExpiredQuote } from '../services/status';
import { computeTotals } from '../lib/tax';
import { assertPeriodOpen } from '../lib/locks';
import { lineItemsSchema, offsetOf, optionalIsoDate, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { safeLines, serialiseLines, syncInvoiceFromRow } from '../services/documents';
import { buildDocumentPdf } from '../services/pdf-documents';
import type { AppEnv } from '../types';

const quoteSchema = z.object({
  client_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  valid_until: optionalIsoDate,
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(2000).nullish(),
});

export const quoteRoutes = new Hono<AppEnv>();
quoteRoutes.use('*', requireAuth);

quoteRoutes.get('/', requirePermission('quotes.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const status = c.req.query('status') ?? '';
  const search = (c.req.query('q') ?? '').trim();
  const filters = ['q.deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (status) {
    filters.push('q.status = ?');
    bindings.push(status);
  }
  if (search) {
    filters.push('(q.number LIKE ? OR c.display_name LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM quotes q JOIN clients c ON c.id = q.client_id ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT q.*, c.display_name AS client_name FROM quotes q JOIN clients c ON c.id = q.client_id
     ${where} ORDER BY q.date DESC, q.created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all();

  const total = count?.count ?? 0;
  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, line_items: safeLines(row.line_items), expired: isExpiredQuote(String(row.status), (row.valid_until as string | null) ?? null, todayIn(c.get('company')!.timezone)) })),
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

quoteRoutes.get('/:id', requirePermission('quotes.read'), async (c) => {
  const quote = await c.env.DB.prepare(
    `SELECT q.*, c.display_name AS client_name, c.email AS client_email, c.address1 AS client_address1,
            c.city AS client_city, c.postal_code AS client_postal_code, c.tax_id AS client_tax_id
     FROM quotes q JOIN clients c ON c.id = q.client_id WHERE q.id = ? AND q.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!quote) return fail(404, 'NOT_FOUND');
  return c.json({
    ...quote,
    line_items: safeLines(quote.line_items),
    expired: isExpiredQuote(String(quote.status), (quote.valid_until as string | null) ?? null, todayIn(c.get('company')!.timezone)),
  });
});

quoteRoutes.get('/:id/pdf', requirePermission('quotes.read'), async (c) => {
  const company = c.get('company')!;
  const quote = await c.env.DB.prepare(
    `SELECT q.*, c.display_name AS client_name, c.address1 AS client_address1, c.address2 AS client_address2,
            c.city AS client_city, c.postal_code AS client_postal_code, c.country AS client_country,
            c.tax_id AS client_tax_id
     FROM quotes q JOIN clients c ON c.id = q.client_id
     WHERE q.id = ? AND q.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!quote) return fail(404, 'NOT_FOUND');

  // T-108a: quotes now print with the same wording rules as invoices.
  const bytes = await buildDocumentPdf('quote', company, {
    number: quote.number as string | null,
    date: String(quote.date),
    secondary: (quote.valid_until as string | null) ?? null,
    currency: String(quote.currency ?? company.currency),
    line_items: safeLines(quote.line_items),
    discount_type: String(quote.discount_type ?? 'percent'),
    discount_value: Number(quote.discount_value ?? 0),
    discount_total: Number(quote.discount_total ?? 0),
    subtotal: Number(quote.subtotal ?? 0),
    tax_total: Number(quote.tax_total ?? 0),
    total: Number(quote.total ?? 0),
    tax_exempt: Number(quote.tax_exempt ?? 0),
    notes: (quote.notes as string | null) ?? null,
    terms: (quote.terms as string | null) ?? null,
    client: {
      name: String(quote.client_name ?? ''),
      address1: (quote.client_address1 as string | null) ?? null,
      address2: (quote.client_address2 as string | null) ?? null,
      city: (quote.client_city as string | null) ?? null,
      postal_code: (quote.client_postal_code as string | null) ?? null,
      country: (quote.client_country as string | null) ?? null,
      tax_id: (quote.client_tax_id as string | null) ?? null,
    },
  });
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${String(quote.number ?? 'devis')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

quoteRoutes.post('/', requirePermission('quotes.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(quoteSchema, await c.req.json().catch(() => ({})));

  const client = await c.env.DB.prepare(
    `SELECT id, is_tax_exempt, currency FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.client_id)
    .first<{ id: string; is_tax_exempt: number; currency: string }>();
  if (!client) return fail(422, 'VALIDATION_ERROR', { client_id: 'not_found' });

  const totals = computeTotals(
    body.line_items,
    { discount_type: body.discount_type, discount_value: body.discount_value },
    Boolean(client.is_tax_exempt),
  );
  const id = crypto.randomUUID();
  const number = await nextNumber(c.env.DB, 'quote', 'DEV', company.number_pattern, body.date);

  await c.env.DB.prepare(
    `INSERT INTO quotes (id, client_id, number, status, date, valid_until, currency, subtotal, discount_type, discount_value,
      discount_total, tax_total, total, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, number, body.date, body.valid_until ?? addDays(body.date, 30), client.currency || company.currency,
      totals.subtotal, body.discount_type, body.discount_value, totals.discount_total, totals.tax_total, totals.total,
      client.is_tax_exempt, serialiseLines(body.line_items), body.notes ?? null, body.terms || company.invoice_terms,
      user.id, nowISO(), nowISO(),
    )
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'quote',
    entityId: id,
    summary: 'activity.quote_created',
    meta: { number, total: totals.total },
  });

  return c.json({ id, number }, 201);
});

quoteRoutes.patch('/:id', requirePermission('quotes.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(quoteSchema, await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(
    `SELECT q.status, c.is_tax_exempt, q.currency FROM quotes q JOIN clients c ON c.id = q.client_id
     WHERE q.id = ? AND q.deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ status: string; is_tax_exempt: number; currency: string }>();
  if (!existing) return fail(404, 'NOT_FOUND');
  if (['converted', 'rejected'].includes(existing.status)) return fail(409, 'QUOTE_LOCKED');

  const totals = computeTotals(
    body.line_items,
    { discount_type: body.discount_type, discount_value: body.discount_value },
    Boolean(existing.is_tax_exempt),
  );

  await c.env.DB.prepare(
    `UPDATE quotes SET client_id = ?, date = ?, valid_until = ?, subtotal = ?, discount_type = ?, discount_value = ?,
      discount_total = ?, tax_total = ?, total = ?, line_items = ?, notes = ?, terms = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.client_id, body.date, body.valid_until, totals.subtotal, body.discount_type, body.discount_value,
      totals.discount_total, totals.tax_total, totals.total, serialiseLines(body.line_items),
      body.notes ?? null, body.terms, nowISO(), id,
    )
    .run();
  return c.json({ ok: true });
});

quoteRoutes.post('/:id/send', requirePermission('quotes.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const quote = await c.env.DB.prepare(`SELECT id, number, status FROM quotes WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string; number: string; status: string }>();
  if (!quote) return fail(404, 'NOT_FOUND');
  if (quote.status !== 'draft') return fail(409, 'INVALID_TRANSITION');

  await c.env.DB.prepare(`UPDATE quotes SET status = 'sent', sent_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'sent',
    entityType: 'quote',
    entityId: id,
    summary: 'activity.quote_sent',
    meta: { number: quote.number },
  });
  return c.json({ ok: true });
});

quoteRoutes.post('/:id/approve', requirePermission('quotes.write'), async (c) => {
  const id = c.req.param('id');
  const quote = await c.env.DB.prepare(`SELECT id, status FROM quotes WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!quote) return fail(404, 'NOT_FOUND');
  if (quote.status !== 'sent') return fail(409, 'INVALID_TRANSITION');
  await c.env.DB.prepare(`UPDATE quotes SET status = 'approved', updated_at = ? WHERE id = ?`)
    .bind(nowISO(), id)
    .run();
  return c.json({ ok: true });
});

quoteRoutes.post('/:id/reject', requirePermission('quotes.write'), async (c) => {
  const id = c.req.param('id');
  const quote = await c.env.DB.prepare(`SELECT id, status FROM quotes WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string; status: string }>();
  if (!quote) return fail(404, 'NOT_FOUND');
  if (quote.status !== 'sent') return fail(409, 'INVALID_TRANSITION');
  await c.env.DB.prepare(`UPDATE quotes SET status = 'rejected', updated_at = ? WHERE id = ?`)
    .bind(nowISO(), id)
    .run();
  return c.json({ ok: true });
});

quoteRoutes.post('/:id/convert', requirePermission('invoices.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const id = c.req.param('id');

  const quote = await c.env.DB.prepare(
    `SELECT q.*, c.payment_terms FROM quotes q JOIN clients c ON c.id = q.client_id
     WHERE q.id = ? AND q.deleted_at IS NULL`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!quote) return fail(404, 'NOT_FOUND');
  if (quote.status === 'converted') return fail(409, 'QUOTE_ALREADY_CONVERTED');
  if (quote.status === 'rejected') return fail(409, 'QUOTE_REJECTED');
  if (quote.converted_invoice_id) return fail(409, 'QUOTE_ALREADY_CONVERTED');

  const invoiceId = crypto.randomUUID();
  const date = new Date().toISOString().slice(0, 10);
  await assertPeriodOpen(c.env.DB, date);
  const number = await nextNumber(c.env.DB, 'invoice', 'FAC', company.number_pattern, date);
  const dueDate = addDays(date, Number(quote.payment_terms ?? company.payment_terms));

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
        discount_total, tax_total, total, paid_total, balance, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      invoiceId, quote.client_id, number, date, dueDate, quote.currency, quote.subtotal, quote.discount_type,
      quote.discount_value, quote.discount_total, quote.tax_total, quote.total, quote.total, quote.tax_exempt,
      quote.line_items, quote.notes, quote.terms, user.id, nowISO(), nowISO(),
    ),
    c.env.DB.prepare(
      `UPDATE quotes SET status = 'converted', converted_invoice_id = ?, updated_at = ? WHERE id = ?`,
    ).bind(invoiceId, nowISO(), id),
  ]);

  await syncInvoiceFromRow(c.env.DB, {
    id: invoiceId,
    line_items: quote.line_items,
    discount_type: String(quote.discount_type),
    discount_value: Number(quote.discount_value),
    tax_exempt: Number(quote.tax_exempt),
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'converted',
    entityType: 'quote',
    entityId: id,
    summary: 'activity.quote_converted',
    meta: { number: quote.number, invoice: number },
  });

  return c.json({ id: invoiceId, number });
});

quoteRoutes.delete('/:id', requirePermission('quotes.delete'), async (c) => {
  const id = c.req.param('id');
  const quote = await c.env.DB.prepare(`SELECT status FROM quotes WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ status: string }>();
  if (!quote) return fail(404, 'NOT_FOUND');
  if (quote.status === 'converted') return fail(409, 'QUOTE_LOCKED');
  await c.env.DB.prepare(`UPDATE quotes SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  return c.json({ ok: true });
});
