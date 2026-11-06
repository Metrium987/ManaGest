import { discountPercentOf } from '../lib/approvals';
import { assertSeparation, requireApprovalIfNeeded } from '../services/approvals';
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { addDays, todayIn } from '../lib/dates';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { retentionElapsed, DEFAULT_RETENTION_YEARS } from '../lib/retention';
import { fail } from '../lib/errors';
import { nextNumber, recordNumberGap } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import { enrichLines } from '../lib/catalogue';
import { applyClientPricingForClient } from '../lib/client-pricing';
import { applyExpertiseForLines } from '../lib/expertise';
import { consumeInvoiceStock } from '../services/stock';
import { lotTrackingMode } from '../lib/lots';
import {
  returnableQuantities, sumByProduct, validateReturn, type StockQuantityRow,
} from '../lib/stock-returns';
import { offsetOf, paginationSchema, parseInput, lineItemsSchema, optionalIsoDate } from '../lib/validation';
import { assertPeriodOpen } from '../lib/locks';
import { diffSnapshot } from '../lib/audit';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import {
  serialiseLines, recalcInvoice, safeLines, syncCreditTaxLines, syncInvoiceTaxLines,
} from '../services/documents';
import { buildInvoicePdf } from '../services/pdf';
import { resolveLayout } from '../services/pdf-style';
import { getExtra } from '../lib/settings-extra';
import { convertToBase } from '../lib/fx';
import { freezeFx } from '../services/currencies';
import { validateArchipelagoVat } from '../../shared/archipelago';
import { assertEditable, deriveInvoiceStatus, isOverdue, refundableAmount } from '../services/status';
import { creditNoteFromInvoice } from '../lib/credit-note';
import { settleInvoice } from '../services/settlements';
import { recalcCredit } from '../services/documents';
import { recordManualReminder } from '../services/reminders';
import type { AppEnv } from '../types';

/**
 * Q4: the 1 % archipelago rate is refused without its proof — the customer's
 * Tahiti number (which the transport contract must carry), the archipelago, the
 * transport reference and the fact that we ship the goods ourselves. Applying it
 * loosely means paying the missing VAT back.
 */
async function assertArchipelagoEvidence(
  c: Context<AppEnv>,
  body: { line_items: { tax_rate: number; tax_status?: string | null; product_family?: string | null }[]; archipelago?: string | null; transport_reference?: string | null; shipped_by_seller: boolean },
  clientTaxId: string | null,
) {
  const excluded = (await getExtra(c.env.DB, 'archipelago_excluded_families')).split(',');
  const check = validateArchipelagoVat({
    lines: body.line_items,
    evidence: {
      client_tax_id: clientTaxId,
      archipelago: body.archipelago,
      transport_reference: body.transport_reference,
      shipped_by_seller: body.shipped_by_seller,
    },
    excluded_families: excluded,
  });
  if (check.ok) return null;
  return fail(422, check.code, check.details);
}

const invoiceSchema = z.object({
  client_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  due_date: optionalIsoDate,
  line_items: lineItemsSchema,
  // Any active workspace currency; defaults to the customer's, then the company's.
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3,5}$/).optional(),
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(2000).nullish(),
  footer: z.string().max(1000).nullish(),
  po_number: z.string().max(80).nullish(),
  // Q4: the evidence that a 1 % archipelago rate is legitimate. Stored with the
  // document, because the tax is refunded if it cannot be produced.
  archipelago: z.string().max(20).nullish(),
  transport_reference: z.string().max(80).nullish(),
  shipped_by_seller: z.boolean().default(false),
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
            c.tax_id AS client_tax_id, c.numero_rcs AS client_ridet, c.nif AS client_nif
     FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.id = ? AND i.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!invoice) return fail(404, 'NOT_FOUND');

  const allocations = await c.env.DB.prepare(
    `SELECT pa.id, pa.amount, pa.amount_xpf, pa.exchange_rate, pa.fx_difference,
            p.currency, p.number AS payment_number, p.date, p.method, p.reference
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
  // Freeze the catalogue identity on the lines before any total is computed.
  body.line_items = await enrichLines(c.env.DB, body.line_items);
  // D1: the client grid only fills lines nobody priced yet.
  body.line_items = await applyExpertiseForLines(c.env.DB, body.line_items);
  body.line_items = await applyClientPricingForClient(c.env.DB, body.client_id, body.line_items);

  const client = await c.env.DB.prepare(
    `SELECT id, is_tax_exempt, payment_terms, currency, tax_id FROM clients
     WHERE id = ? AND deleted_at IS NULL AND archived = 0`,
  )
    .bind(body.client_id)
    .first<{ id: string; is_tax_exempt: number; payment_terms: number; currency: string; tax_id: string | null }>();
  if (!client) return fail(422, 'VALIDATION_ERROR', { client_id: 'not_found' });

  const archipelago = await assertArchipelagoEvidence(c, body, client.tax_id);
  if (archipelago) return archipelago;

  const currency = (body.currency || client.currency || company.currency).toUpperCase();
  const fx = await freezeFx(c.env.DB, currency, body.date);
  const toBase = (value: number) => convertToBase(value, fx.currency.decimals, fx.rate);

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
    `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, exchange_rate, currency_decimals,
      subtotal, discount_type, discount_value, discount_total, tax_total, total, subtotal_xpf, tax_total_xpf, total_xpf,
      paid_total, balance, tax_exempt, po_number, line_items, notes, terms, footer,
      archipelago, transport_reference, shipped_by_seller, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, number, body.date, dueDate, currency, fx.rate, fx.currency.decimals,
      totals.subtotal, body.discount_type, body.discount_value, totals.discount_total, totals.tax_total, totals.total,
      toBase(totals.subtotal), toBase(totals.tax_total), toBase(totals.total), toBase(totals.total),
      client.is_tax_exempt, body.po_number ?? null, serialiseLines(body.line_items),
      body.notes ?? null, terms, body.footer || company.invoice_footer,
      body.archipelago ?? null, body.transport_reference ?? null, body.shipped_by_seller ? 1 : 0,
      user.id, nowISO(), nowISO(),
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
    `SELECT i.*, c.is_tax_exempt, c.tax_id AS client_tax_id FROM invoices i JOIN clients c ON c.id = i.client_id
     WHERE i.id = ? AND i.deleted_at IS NULL`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return fail(404, 'NOT_FOUND');
  // A-02: an issued document is immutable. Correcting it means a credit note or
  // a cancellation, never rewriting its lines, amounts, client or dates.
  assertEditable(String(existing.status), 'invoice');
  if ((existing.paid_total as number) > 0) return fail(409, 'INVOICE_HAS_PAYMENTS');
  // Both dates: re-dating must not move a document into or out of a closed month.
  await assertPeriodOpen(c.env.DB, existing.date as string, body.date);
  body.line_items = await enrichLines(c.env.DB, body.line_items);
  // D1: the client grid only fills lines nobody priced yet.
  body.line_items = await applyExpertiseForLines(c.env.DB, body.line_items);
  body.line_items = await applyClientPricingForClient(c.env.DB, body.client_id, body.line_items);

  const patchCheck = await assertArchipelagoEvidence(c, body, (existing.client_tax_id as string | null) ?? null);
  if (patchCheck) return patchCheck;

  // Only a draft reaches this point (A-02): its currency and rate are frozen at
  // its own date, because there is no issued rate to preserve any more.
  const currency = (body.currency || String(existing.currency)).toUpperCase();
  const fx = await freezeFx(c.env.DB, currency, body.date);
  const toBase = (value: number) => convertToBase(value, fx.currency.decimals, fx.rate);

  const totals = computeTotals(
    body.line_items,
    { discount_type: body.discount_type, discount_value: body.discount_value },
    Boolean(existing.is_tax_exempt),
  );

  await c.env.DB.prepare(
    `UPDATE invoices SET client_id = ?, date = ?, due_date = ?, currency = ?, exchange_rate = ?, currency_decimals = ?,
      subtotal = ?, discount_type = ?, discount_value = ?, discount_total = ?, tax_total = ?, total = ?,
      subtotal_xpf = ?, tax_total_xpf = ?, total_xpf = ?, po_number = ?, line_items = ?, notes = ?, terms = ?,
      footer = ?, archipelago = ?, transport_reference = ?, shipped_by_seller = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.client_id, body.date, body.due_date, currency, fx.rate, fx.currency.decimals,
      totals.subtotal, body.discount_type, body.discount_value, totals.discount_total, totals.tax_total, totals.total,
      toBase(totals.subtotal), toBase(totals.tax_total), toBase(totals.total),
      body.po_number ?? null,
      serialiseLines(body.line_items), body.notes ?? null, body.terms || company.invoice_terms,
      body.footer || company.invoice_footer,
      body.archipelago ?? null, body.transport_reference ?? null, body.shipped_by_seller ? 1 : 0,
      nowISO(), id,
    )
    .run();

  await syncInvoiceTaxLines(c.env.DB, id, totals.tax_buckets);
  // A-02: the balance is never assigned by hand; it is rebuilt from the
  // allocations, so a credit already applied to the draft is not erased.
  await recalcInvoice(c.env.DB, id);

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
    `SELECT id, number, status, date, subtotal, discount_type, discount_value, tax_total, total, currency, line_items
     FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{
      id: string; number: string; status: string; date: string; subtotal: number;
      discount_type: string; discount_value: number; tax_total: number;
      total: number; currency: string; line_items: string | null;
    }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (invoice.status !== 'draft') return fail(409, 'INVALID_TRANSITION');

  // T-302: a discount above the configured threshold must be approved before the
  // document leaves the workspace.
  await requireApprovalIfNeeded(c.env.DB, {
    entityType: 'invoice',
    entityId: id,
    amount: invoice.total,
    discountPercent: discountPercentOf(invoice.discount_type, invoice.discount_value, invoice.subtotal),
    requestedBy: user.id,
  });
  await assertPeriodOpen(c.env.DB, invoice.date);

  // Freeze the rate at issue: a later rate change must not rewrite this document.
  const issueFx = await freezeFx(c.env.DB, invoice.currency, invoice.date);
  await c.env.DB.prepare(
    `UPDATE invoices SET exchange_rate = ?, currency_decimals = ?, subtotal_xpf = ?, tax_total_xpf = ?, total_xpf = ?, updated_at = ?
     WHERE id = ?`,
  )
    .bind(
      issueFx.rate, issueFx.currency.decimals,
      convertToBase(invoice.subtotal, issueFx.currency.decimals, issueFx.rate),
      convertToBase(invoice.tax_total, issueFx.currency.decimals, issueFx.rate),
      convertToBase(invoice.total, issueFx.currency.decimals, issueFx.rate),
      nowISO(), id,
    )
    .run();

  // A3: the goods leave the warehouse when the document is issued. The refusal
  // throws before the status changes, so a short order leaves a draft behind.
  const consumed = await consumeInvoiceStock(c.env.DB, {
    reference: invoice.number,
    lines: safeLines(invoice.line_items),
    userId: user.id,
  });

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
    meta: { number: invoice.number, lines: consumed.length },
  });

  return c.json({ ok: true, consumed });
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

  // Cancellation is a financial act, not a physical one: the goods are still at
  // the customer's until someone records a return (see A6). Restocking here would
  // invent an inflow nobody counted.
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
    `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, exchange_rate, currency_decimals,
      subtotal, discount_type, discount_value, discount_total, tax_total, total, subtotal_xpf, tax_total_xpf, total_xpf,
      paid_total, balance, tax_exempt, po_number, line_items, notes, terms, footer, created_by, created_at, updated_at)
     SELECT ?, client_id, ?, 'draft', ?, ?, currency, exchange_rate, currency_decimals, subtotal, discount_type,
            discount_value, discount_total, tax_total, total, subtotal_xpf, tax_total_xpf, total_xpf,
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

/**
 * Customer returns (A6). The credit note reverses the money; this moves the
 * goods. What may come back is what actually left stock for this invoice, minus
 * what already came back — a service or an untracked line never left, so it can
 * never return.
 */
async function invoiceReturnLedger(database: D1Database, reference: string) {
  const soldRows = await database
    .prepare(
      `SELECT product_id, SUM(quantity_milli) AS quantity_milli FROM stock_movements
       WHERE reference = ? AND reason = 'invoice' GROUP BY product_id`,
    )
    .bind(reference)
    .all<StockQuantityRow>();
  const returnedRows = await database
    .prepare(
      `SELECT product_id, SUM(quantity_milli) AS quantity_milli FROM stock_movements
       WHERE reference = ? AND reason = 'customer_return' GROUP BY product_id`,
    )
    .bind(reference)
    .all<StockQuantityRow>();

  const sold = sumByProduct(soldRows.results ?? []);
  const returned = sumByProduct(returnedRows.results ?? []);
  const lines = returnableQuantities(sold, returned);
  if (!lines.length) return { lines: [], names: new Map<string, string>(), remaining: new Map<string, number>() };

  const ids = lines.map((line) => line.product_id);
  const names = new Map<string, string>();
  const products = await database
    .prepare(`SELECT id, name FROM products WHERE id IN (${ids.map(() => '?').join(',')})`)
    .bind(...ids)
    .all<{ id: string; name: string }>();
  for (const product of products.results ?? []) names.set(product.id, product.name);

  return {
    lines,
    names,
    remaining: new Map(lines.map((line) => [line.product_id, line.remaining_milli])),
  };
}

invoiceRoutes.get('/:id/returns', requirePermission('invoices.read'), async (c) => {
  const invoice = await c.env.DB.prepare(
    `SELECT id, number, status FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<{ id: string; number: string; status: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');

  const ledger = await invoiceReturnLedger(c.env.DB, invoice.number);
  return c.json({
    status: invoice.status,
    data: ledger.lines.map((line) => ({
      product_id: line.product_id,
      name: ledger.names.get(line.product_id) ?? null,
      sold: line.sold_milli / 1000,
      returned: line.returned_milli / 1000,
      remaining: line.remaining_milli / 1000,
    })),
  });
});

invoiceRoutes.post('/:id/returns', requirePermission('invoices.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      lines: z.array(z.object({
        product_id: z.string().min(8).max(60),
        quantity: z.coerce.number().min(0).max(1_000_000),
      })).min(1).max(100),
      reason: z.string().trim().max(300).nullish(),
    }),
    await c.req.json().catch(() => ({})),
  );

  const invoice = await c.env.DB.prepare(
    `SELECT id, number, status FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; number: string; status: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  // A draft never took anything out of stock: there is nothing to give back.
  if (!['sent', 'partial', 'paid'].includes(invoice.status)) return fail(409, 'INVALID_TRANSITION');

  const ledger = await invoiceReturnLedger(c.env.DB, invoice.number);
  const requested = body.lines.map((line) => ({
    product_id: line.product_id,
    quantity_milli: Math.round(Number(line.quantity) * 1000),
  }));
  const validation = validateReturn(requested, ledger.remaining);
  if (!validation.ok) {
    return fail(409, 'RETURN_EXCEEDS_SOLD', {
      lines: validation.refusals
        .map((refusal) => {
          const name = ledger.names.get(refusal.product_id) ?? refusal.product_id;
          return `${name}: ${refusal.requested_milli / 1000} > ${refusal.remaining_milli / 1000}`;
        })
        .join(' | '),
    });
  }

  const ids = [...new Set(requested.map((line) => line.product_id))];
  const products = await c.env.DB
    .prepare(
      `SELECT id, name, cost, lot_tracking, warehouse_location FROM products
       WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(...ids)
    .all<{ id: string; name: string; cost: number; lot_tracking: string | null; warehouse_location: string | null }>();
  const byId = new Map((products.results ?? []).map((product) => [product.id, product]));

  // B2: goods come back to the batch they left from. The invoice ledger already
  // says which lot was picked, so the return asks it instead of guessing — and
  // refuses when several batches were shipped on the same line, because picking
  // one of them would be an invention.
  const saleLots = await c.env.DB
    .prepare(
      `SELECT product_id, lot FROM stock_movements
       WHERE reference = ? AND reason = 'invoice' AND lot IS NOT NULL`,
    )
    .bind(invoice.number)
    .all<{ product_id: string; lot: string }>();

  const now = nowISO();
  const statements: D1PreparedStatement[] = [];
  const returned: { product_id: string; quantity: number }[] = [];
  for (const line of requested) {
    if (line.quantity_milli <= 0) continue;
    const product = byId.get(line.product_id);
    let lotCode: string | null = null;
    if (lotTrackingMode(product?.lot_tracking) !== 'none') {
      const shipped = [...new Set(
        (saleLots.results ?? [])
          .filter((row) => row.product_id === line.product_id)
          .map((row) => row.lot),
      )];
      if (shipped.length !== 1) {
        return fail(422, 'VALIDATION_ERROR', { lot: shipped.length ? 'ambiguous' : 'required' });
      }
      [lotCode] = shipped;
    }

    statements.push(
      c.env.DB.prepare(`UPDATE products SET quantity_milli = quantity_milli + ?, updated_at = ? WHERE id = ?`)
        .bind(line.quantity_milli, now, line.product_id),
    );
    if (lotCode) {
      const returnMovementId = crypto.randomUUID();
      const returnLocation = product?.warehouse_location ?? null;
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_lots (id, product_id, lot_code, expiry_date, location, quantity_milli, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
           ON CONFLICT(product_id, lot_code) DO UPDATE SET
             quantity_milli = stock_lots.quantity_milli + excluded.quantity_milli,
             updated_at = excluded.updated_at`,
        ).bind(
          crypto.randomUUID(), line.product_id, lotCode,
          returnLocation, line.quantity_milli, now, now,
        ),
        c.env.DB.prepare(
          `INSERT INTO stock_movements
             (id, product_id, kind, quantity_milli, reason, reference, unit_cost, location, lot, user_id, created_at)
           VALUES (?, ?, 'in', ?, 'customer_return', ?, ?, ?, ?, ?, ?)`,
        ).bind(
          returnMovementId, line.product_id, line.quantity_milli, invoice.number,
          Number(product?.cost ?? 0), returnLocation, lotCode, user.id, now,
        ),
        // A-14: the shelf learns about the return too, on the same lot and
        // location as the pick — otherwise `stock_lots` and `lot_balances`
        // disagree from the first return on.
        c.env.DB.prepare(
          `INSERT INTO lot_balances (lot_id, location, quantity_milli, updated_at)
           SELECT l.id, COALESCE(?, ''), ?, ?
           FROM stock_lots l WHERE l.product_id = ? AND l.lot_code = ?
           ON CONFLICT(lot_id, location) DO UPDATE SET
             quantity_milli = lot_balances.quantity_milli + excluded.quantity_milli,
             updated_at = excluded.updated_at`,
        ).bind(returnLocation, line.quantity_milli, now, line.product_id, lotCode),
        // ...and the valuation records the inflow, like any other receipt.
        c.env.DB.prepare(
          `INSERT INTO stock_valuations
             (id, product_id, movement_id, reason, quantity_before_milli, cost_before,
              inbound_milli, inbound_unit_cost, quantity_after_milli, cost_after, value_after, created_at)
           SELECT ?, p.id, ?, 'customer_return', p.quantity_milli - ?, p.cost, ?, p.cost,
                  p.quantity_milli, p.cost, CAST(ROUND(p.quantity_milli * p.cost / 1000.0) AS INTEGER), ?
           FROM products p WHERE p.id = ?`,
        ).bind(
          crypto.randomUUID(), returnMovementId, line.quantity_milli, line.quantity_milli,
          Number(product?.cost ?? 0), now, line.product_id,
        ),
      );
    } else {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_movements
             (id, product_id, kind, quantity_milli, reason, reference, unit_cost, location, user_id, created_at)
           VALUES (?, ?, 'in', ?, 'customer_return', ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), line.product_id, line.quantity_milli, invoice.number,
          Number(product?.cost ?? 0), product?.warehouse_location ?? null, user.id, now,
        ),
      );
    }
    returned.push({ product_id: line.product_id, quantity: line.quantity_milli / 1000 });
  }

  if (!statements.length) return fail(422, 'VALIDATION_ERROR', { lines: 'empty' });
  await c.env.DB.batch(statements);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'returned',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.customer_return',
    meta: { number: invoice.number, lines: returned.length, reason: body.reason ?? null },
    ip: clientIp(c),
  });

  return c.json({ ok: true, returned });
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
    `SELECT id, client_id, number, status, balance, total, date, created_by, line_items
     FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{
      id: string; client_id: string; number: string; status: string;
      balance: number; total: number; date: string; created_by: string | null;
      line_items: string | null;
    }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (invoice.balance <= 0) return fail(409, 'INVOICE_ALREADY_PAID');
  if (invoice.status === 'cancelled') return fail(409, 'INVOICE_CANCELLED');
  // T-302: when separation of duties is enabled, the creator cannot collect it.
  await assertSeparation(c.env.DB, invoice.created_by, user.id);

  // Collecting a draft issues it: the goods leave stock here too, never on a
  // path that skips the warehouse.
  if (invoice.status === 'draft') {
    await consumeInvoiceStock(c.env.DB, {
      reference: invoice.number,
      lines: safeLines(invoice.line_items),
      userId: user.id,
    });
  }

  const today = todayIn(company.timezone);
  // The payment is dated today: only the payment's own period must be open.
  await assertPeriodOpen(c.env.DB, today);

  // A-01: the same settlement service as `POST /api/payments` — currency, frozen
  // rate, XPF amount, realised difference and allocations, in one batch.
  const settlement = await settleInvoice(c.env.DB, {
    invoiceId: id,
    userId: user.id,
    method: body.method,
    reference: body.reference ?? null,
    date: today,
    numberPattern: company.number_pattern,
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'paid',
    entityType: 'invoice',
    entityId: id,
    summary: 'activity.invoice_marked_paid',
    meta: {
      number: invoice.number,
      payment: settlement.number,
      amount: settlement.amount,
      currency: settlement.currency,
      fx_difference: settlement.fx_difference,
    },
  });

  return c.json({
    ok: true,
    payment_id: settlement.payment_id,
    number: settlement.number,
    currency: settlement.currency,
    amount_xpf: settlement.amount_xpf,
    fx_difference: settlement.fx_difference,
  });
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
  // T-105: a manual reminder also records its level, so the daily pass does not
  // send the same one again the next morning.
  const reminderInterval = Number.parseInt(await getExtra(c.env.DB, 'reminder_interval_days'), 10);
  const level = await recordManualReminder(c.env.DB, invoice, {
    day: today,
    userId: user.id,
    intervalDays: Number.isFinite(reminderInterval) && reminderInterval > 0 ? reminderInterval : undefined,
  });
  return c.json({ ok: true, level });
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
    `SELECT id, client_id, number, status, balance, total, paid_total, currency, exchange_rate,
            currency_decimals, subtotal, discount_type, discount_value, tax_exempt, line_items
     FROM invoices WHERE id = ? AND deleted_at IS NULL AND status IN ('sent','partial','paid')`,
  ).bind(c.req.param('id')).first<{
    id: string; client_id: string; number: string; status: string; balance: number; total: number;
    paid_total: number; currency: string; exchange_rate: number; currency_decimals: number;
    subtotal: number; discount_type: string; discount_value: number; tax_exempt: number;
    line_items: string | null;
  }>();
  if (!invoice) return fail(409, 'INVOICE_NOT_OPEN');

  // Refund ceiling: what was received on a paid invoice, else the open balance.
  const refundable = refundableAmount(invoice.status, invoice.balance, invoice.paid_total);
  if (refundable <= 0) return fail(409, 'INVOICE_NOT_OPEN');
  if (body.amount > refundable) return fail(409, 'AMOUNT_EXCEEDS_BALANCE');
  const amount = body.amount;

  // A-03: the credit note mirrors the invoice — same currency, frozen rate, and
  // the VAT it actually collected on the refunded share. `tax_exempt` follows the
  // invoice instead of forcing a 0 % document.
  const draft = creditNoteFromInvoice({
    number: invoice.number,
    total: invoice.total,
    discount_type: invoice.discount_type,
    discount_value: invoice.discount_value,
    tax_exempt: invoice.tax_exempt,
    line_items: safeLines(invoice.line_items),
  }, amount);
  const rate = Number(invoice.exchange_rate ?? 1);
  const decimals = Number(invoice.currency_decimals ?? 0);
  const toBase = (value: number) => convertToBase(value, decimals, rate);

  const number = await nextNumber(c.env.DB, 'credit', 'AV', company.number_pattern, today);
  const id = crypto.randomUUID();
  const date = today;
  await c.env.DB.prepare(
    `INSERT INTO credits (id, client_id, number, status, date, currency, exchange_rate, currency_decimals,
      subtotal, discount_type, discount_value, discount_total, tax_total, total,
      subtotal_xpf, tax_total_xpf, total_xpf, applied_total, balance, tax_exempt,
      line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, 'percent', 0, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, invoice.client_id, number, date, invoice.currency, rate, decimals,
    draft.totals.subtotal, draft.totals.discount_total, draft.totals.tax_total, draft.totals.total,
    toBase(draft.totals.subtotal), toBase(draft.totals.tax_total), toBase(draft.totals.total),
    draft.totals.total, invoice.tax_exempt, serialiseLines(draft.lines),
    body.notes ?? null, company.invoice_terms, user.id, nowISO(), nowISO(),
  ).run();
  // A-04: the credit's own VAT mirror, from the very buckets its totals use.
  await syncCreditTaxLines(c.env.DB, id, draft.totals.tax_buckets);

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

  // T-108: `?layout=compact` picks the other layout for this one document;
  // otherwise the workspace default applies.
  const layout = resolveLayout(c.req.query('layout'), await getExtra(c.env.DB, 'pdf_layout'));
  const bytes = await buildInvoicePdf(company, invoice, safeLines(invoice.line_items), layout);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${String(invoice.number ?? 'facture')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

export { deriveInvoiceStatus };
