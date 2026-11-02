import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { diffSnapshot, logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { addDays, todayIn } from '../lib/dates';
import { assertPeriodOpen } from '../lib/locks';
import { nextNumber, nextSimpleNumber } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import { invoiceClientOf, timesheetLines, type LinePricing } from '../lib/task-billing';
import { enrichLines } from '../lib/catalogue';
import { receivePurchaseOrder } from '../services/stock';
import {
  expectedDate, groupBySupplier, proposalFor,
  type ReplenishProduct, type ReplenishProposal,
} from '../lib/replenishment';
import { applyVendorPrices, productIdsOf, type VendorLink } from '../lib/vendor-links';
import { lineBalances, totalRemaining, validateReceipt } from '../lib/receipts';
import {
  lineItemsSchema, offsetOf, optionalIsoDate, optionalText, paginationSchema, parseInput, percentRate,
} from '../lib/validation';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import { DEFAULT_TIMEZONE } from '../../shared/domain';
import { safeLines, serialiseLines, syncInvoiceFromRow } from '../services/documents';
import type { AppEnv } from '../types';

/* ------------------------------------------------------------------ expenses */

const expenseSchema = z.object({
  vendor_id: z.string().max(60).nullish(),
  client_id: z.string().max(60).nullish(),
  // T-107: the list is editable, so the value is checked against the table below.
  category: z.string().trim().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().int().min(0).max(9_999_999_999),
  tax_amount: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
  payment_method: z.enum(['transfer', 'cash', 'cheque', 'card', 'direct_debit', 'credit', 'other']).default('transfer'),
  reference: optionalText(160),
  notes: optionalText(2000),
  is_billable: z.boolean().default(false),
});

export const expenseRoutes = new Hono<AppEnv>();
expenseRoutes.use('*', requireAuth);

expenseRoutes.get('/', requirePermission('expenses.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const category = c.req.query('category') ?? '';

  const filters = ['e.deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (from) { filters.push('e.date >= ?'); bindings.push(from); }
  if (to) { filters.push('e.date <= ?'); bindings.push(to); }
  if (category) { filters.push('e.category = ?'); bindings.push(category); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM expenses e ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT e.*, v.name AS vendor_name, c.display_name AS client_name
     FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN clients c ON c.id = e.client_id
     ${where} ORDER BY e.date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;

  return c.json({
    data: rows.results ?? [],
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

expenseRoutes.post('/', requirePermission('expenses.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(expenseSchema, await c.req.json().catch(() => ({})));
  const knownCategory = await c.env.DB
    .prepare(`SELECT key FROM expense_categories WHERE key = ? AND archived = 0`)
    .bind(body.category).first();
  if (!knownCategory) return fail(422, 'VALIDATION_ERROR', { category: 'unknown' });
  await assertPeriodOpen(c.env.DB, body.date);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO expenses (id, vendor_id, client_id, category, date, amount, tax_amount, payment_method, reference, notes,
      is_billable, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.vendor_id || null, body.client_id || null, body.category, body.date, body.amount, body.tax_amount,
    body.payment_method, body.reference, body.notes, body.is_billable ? 1 : 0, user.id, nowISO(), nowISO(),
  ).run();
  await logActivity(c.env.DB, {
    userId: user.id, action: 'created', entityType: 'expense', entityId: id,
    summary: 'activity.expense_created', meta: { amount: body.amount, category: body.category },
  });
  return c.json({ id }, 201);
});

expenseRoutes.patch('/:id', requirePermission('expenses.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(expenseSchema, await c.req.json().catch(() => ({})));
  const knownCategory = await c.env.DB
    .prepare(`SELECT key FROM expense_categories WHERE key = ? AND archived = 0`)
    .bind(body.category).first();
  if (!knownCategory) return fail(422, 'VALIDATION_ERROR', { category: 'unknown' });
  const existing = await c.env.DB.prepare(
    `SELECT id, vendor_id, client_id, category, date, amount, tax_amount, payment_method, reference, notes, is_billable
     FROM expenses WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return fail(404, 'NOT_FOUND');
  await assertPeriodOpen(c.env.DB, existing.date as string, body.date);
  await c.env.DB.prepare(
    `UPDATE expenses SET vendor_id = ?, client_id = ?, category = ?, date = ?, amount = ?, tax_amount = ?,
      payment_method = ?, reference = ?, notes = ?, is_billable = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    body.vendor_id || null, body.client_id || null, body.category, body.date, body.amount, body.tax_amount,
    body.payment_method, body.reference, body.notes, body.is_billable ? 1 : 0, nowISO(), id,
  ).run();

  const changes = diffSnapshot(existing, {
    ...body,
    vendor_id: body.vendor_id || null,
    client_id: body.client_id || null,
    is_billable: body.is_billable ? 1 : 0,
  }, ['vendor_id', 'client_id', 'category', 'date', 'amount', 'tax_amount', 'reference', 'is_billable']);
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id, action: 'updated', entityType: 'expense', entityId: id,
    summary: 'activity.expense_updated',
    before: changes?.before ?? null, after: changes?.after ?? null, ip: clientIp(c),
  });
  return c.json({ ok: true });
});

expenseRoutes.delete('/:id', requirePermission('expenses.delete'), async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, date, amount, category FROM expenses WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; date: string; amount: number; category: string }>();
  if (!existing) return fail(404, 'NOT_FOUND');
  await assertPeriodOpen(c.env.DB, existing.date);
  await c.env.DB.prepare(`UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id).run();
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id, action: 'deleted', entityType: 'expense', entityId: id,
    summary: 'activity.expense_deleted',
    before: { date: existing.date, amount: existing.amount, category: existing.category },
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------- vendors */

const vendorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.union([z.string().trim().email().max(190), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  phone: optionalText(40),
  address1: optionalText(160),
  city: optionalText(80),
  postal_code: optionalText(20),
  country: z.string().trim().max(80).default('Polynésie française'),
  tax_id: optionalText(20),
  notes: optionalText(2000),
});

export const vendorRoutes = new Hono<AppEnv>();
vendorRoutes.use('*', requireAuth);

vendorRoutes.get('/', requirePermission('vendors.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const filters = ['v.deleted_at IS NULL'];
  const bindings: string[] = [];
  if (search) { filters.push('(v.name LIKE ? OR v.email LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM vendors v ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT v.*, (SELECT COUNT(*) FROM purchase_orders po WHERE po.vendor_id = v.id AND po.deleted_at IS NULL) AS po_count,
      (SELECT COALESCE(SUM(po.total), 0) FROM purchase_orders po WHERE po.vendor_id = v.id AND po.deleted_at IS NULL) AS po_total
     FROM vendors v ${where} ORDER BY v.name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;

  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

vendorRoutes.post('/', requirePermission('vendors.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(vendorSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  const number = await nextSimpleNumber(c.env.DB, 'vendor', 'FOU');
  await c.env.DB.prepare(
    `INSERT INTO vendors (id, number, name, email, phone, address1, city, postal_code, country, tax_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, number, body.name, body.email, body.phone, body.address1, body.city, body.postal_code, body.country, body.tax_id, body.notes, nowISO(), nowISO()).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'vendor', entityId: id, summary: 'activity.vendor_created', meta: { name: body.name } });
  return c.json({ id, number }, 201);
});

vendorRoutes.patch('/:id', requirePermission('vendors.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(vendorSchema, await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(`SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
  if (!existing) return fail(404, 'NOT_FOUND');
  await c.env.DB.prepare(
    `UPDATE vendors SET name = ?, email = ?, phone = ?, address1 = ?, city = ?, postal_code = ?, country = ?, tax_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.name, body.email, body.phone, body.address1, body.city, body.postal_code, body.country, body.tax_id, body.notes, nowISO(), id).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'updated', entityType: 'vendor', entityId: id, summary: 'activity.vendor_updated', meta: { name: body.name } });
  return c.json({ ok: true });
});

vendorRoutes.delete('/:id', requirePermission('vendors.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE vendors SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'deleted', entityType: 'vendor', entityId: id, summary: 'activity.vendor_deleted' });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------ purchase orders */

const purchaseOrderSchema = z.object({
  vendor_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_date: optionalIsoDate,
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: optionalText(2000),
});

export const purchaseOrderRoutes = new Hono<AppEnv>();
purchaseOrderRoutes.use('*', requireAuth);

const milliOf = (value: unknown) => Math.round(Number(value ?? 0) * 1000);

/** What has already been received on an order, line by line (C3). */
async function receiptRows(database: D1Database, purchaseOrderId: string) {
  const rows = await database
    .prepare(
      `SELECT line_id, quantity_milli, unit_price, cost_before, price_gap, created_at
       FROM purchase_order_receipts WHERE purchase_order_id = ? ORDER BY created_at ASC`,
    )
    .bind(purchaseOrderId)
    .all<{
      line_id: string; quantity_milli: number; unit_price: number;
      cost_before: number; price_gap: number; created_at: string;
    }>();
  return rows.results ?? [];
}

/**
 * Receives what was actually delivered and records it.
 *
 * Stock only grows by the quantities checked here, and the order closes itself
 * when nothing is left due — the backorder is the remaining balance, not a second
 * document to maintain. Odoo asks whether to create a backorder at validation;
 * keeping the balance on the same order reaches the same result with one less
 * object to reconcile.
 */
async function receiveAgainstBalance(
  database: D1Database,
  po: { id: string; number: string | null; line_items: string | null },
  requested: { line_id: string; quantity_milli: number }[],
  userId: string,
): Promise<
  | { ok: false; status: 409 | 422; code: string; details?: Record<string, string> }
  | { ok: true; complete: boolean; received: { product_id: string; quantity: number }[]; gaps: { line_id: string; price_gap: number }[] }
> {
  const lines = safeLines(po.line_items);
  const balances = lineBalances(
    lines.map((line) => ({ id: line.id, quantity_milli: milliOf(line.quantity) })),
    await receiptRows(database, po.id),
  );
  const check = validateReceipt(balances, requested);
  if (!check.ok) return check;

  const byId = new Map(lines.map((line) => [line.id, line]));
  const wanted = requested.filter((row) => row.quantity_milli > 0);
  const productIds = productIdsOf(wanted.map((row) => byId.get(row.line_id) ?? {}));

  // The worth of the goods before they enter: the gap to what was paid is the
  // valuation variance, and it is worth saying out loud at reception time.
  const costs = new Map<string, number>();
  if (productIds.length) {
    const rows = await database
      .prepare(`SELECT id, cost FROM products WHERE id IN (${productIds.map(() => '?').join(', ')})`)
      .bind(...productIds)
      .all<{ id: string; cost: number }>();
    for (const row of rows.results ?? []) costs.set(row.id, Number(row.cost ?? 0));
  }

  const received = await receivePurchaseOrder(database, {
    reference: po.number,
    lines: wanted.map((row) => ({ ...byId.get(row.line_id)!, quantity: row.quantity_milli / 1000 })),
    userId,
  });

  const now = nowISO();
  const gaps: { line_id: string; price_gap: number }[] = [];
  const statements: D1PreparedStatement[] = [];
  for (const row of wanted) {
    const line = byId.get(row.line_id)!;
    const unitPrice = Math.round(Number(line.unit_price ?? 0));
    const costBefore = line.product_id ? (costs.get(line.product_id) ?? 0) : 0;
    const gap = line.product_id
      ? Math.round((unitPrice - costBefore) * (row.quantity_milli / 1000))
      : 0;
    gaps.push({ line_id: row.line_id, price_gap: gap });
    statements.push(
      database
        .prepare(
          `INSERT INTO purchase_order_receipts
             (id, purchase_order_id, line_id, quantity_milli, unit_price, cost_before, price_gap, user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), po.id, row.line_id, row.quantity_milli, unitPrice, costBefore, gap, userId, now),
    );
  }
  statements.push(
    database
      .prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`)
      .bind(check.complete ? 'received' : 'partially_received', now, po.id),
  );
  await database.batch(statements);
  return { ok: true, complete: check.complete, received, gaps };
}

purchaseOrderRoutes.get('/', requirePermission('purchase_orders.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const status = c.req.query('status') ?? '';
  const filters = ['po.deleted_at IS NULL'];
  const bindings: string[] = [];
  if (status) { filters.push('po.status = ?'); bindings.push(status); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM purchase_orders po ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT po.*, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
     ${where} ORDER BY po.date DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;

  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, line_items: safeLines(row.line_items) })),
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

/* -------------------------------------------------- purchase proposals (C1) */

/**
 * Demand already sold but not yet delivered: quotes sent or accepted and not
 * converted. It is the only demand a back-to-back article should answer —
 * stocking it as well would buy the same goods twice for one sale.
 */
async function pendingDemand(database: D1Database): Promise<Map<string, number>> {
  const demand = new Map<string, number>();
  const rows = await database
    .prepare(
      `SELECT line_items FROM quotes
       WHERE status IN ('sent', 'accepted') AND converted_invoice_id IS NULL`,
    )
    .all<{ line_items: string | null }>();
  for (const row of rows.results ?? []) {
    for (const line of safeLines(row.line_items)) {
      if (!line.product_id) continue;
      demand.set(
        line.product_id,
        (demand.get(line.product_id) ?? 0) + Math.round(Number(line.quantity) * 1000),
      );
    }
  }
  return demand;
}

/** The pricelist of the vendor chosen for this order, limited to its lines. */
async function vendorLinksFor(
  database: D1Database,
  vendorId: string,
  productIds: string[],
): Promise<VendorLink[]> {
  if (!productIds.length) return [];
  const rows = await database
    .prepare(
      `SELECT product_id, vendor_id, price, currency, moq_milli, lead_time_days, vendor_ref, is_preferred
       FROM product_vendors
       WHERE vendor_id = ? AND product_id IN (${productIds.map(() => '?').join(', ')})`,
    )
    .bind(vendorId, ...productIds)
    .all<VendorLink>();
  return rows.results ?? [];
}

const replenishSelect = `SELECT p.id, p.name, p.item_type, p.track_quantity, p.replenish_mode, p.supplier_id,
       v.name AS supplier_name, p.quantity_milli, p.reorder_point_milli, p.safety_stock_milli,
       p.max_stock_milli, p.moq_milli, p.order_multiple_milli, p.lead_time_days,
       p.purchase_price, p.cost, p.tax_rate
  FROM products p JOIN vendors v ON v.id = p.supplier_id
  WHERE p.deleted_at IS NULL AND v.deleted_at IS NULL
    AND p.item_type <> 'service' AND p.track_quantity = 1 AND p.replenish_mode <> 'manual'`;

purchaseOrderRoutes.get('/suggestions', requirePermission('purchase_orders.read'), async (c) => {
  const rows = await c.env.DB.prepare(replenishSelect).all<ReplenishProduct>();
  const demand = await pendingDemand(c.env.DB);
  const proposals = (rows.results ?? [])
    .map((row) => proposalFor(row, { demand_milli: demand.get(row.id) ?? 0 }))
    .filter((proposal): proposal is ReplenishProposal => proposal !== null);
  return c.json({ data: proposals, groups: groupBySupplier(proposals) });
});

purchaseOrderRoutes.post('/from-suggestions', requirePermission('purchase_orders.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      vendor_id: z.string().min(1).max(60),
      product_ids: z.array(z.string().min(1).max(60)).min(1).max(200),
    }),
    await c.req.json().catch(() => ({})),
  );

  const vendor = await c.env.DB
    .prepare(`SELECT id, name FROM vendors WHERE id = ? AND deleted_at IS NULL`)
    .bind(body.vendor_id)
    .first<{ id: string; name: string }>();
  if (!vendor) return fail(422, 'VALIDATION_ERROR', { vendor_id: 'not_found' });

  const rows = await c.env.DB
    .prepare(
      `${replenishSelect} AND p.supplier_id = ? AND p.id IN (${body.product_ids.map(() => '?').join(', ')})`,
    )
    .bind(body.vendor_id, ...body.product_ids)
    .all<ReplenishProduct>();
  const demand = await pendingDemand(c.env.DB);
  // The quantities are recomputed here, never read from the request: a draft can
  // only contain numbers the server derived from the sheet it just read.
  const proposals = (rows.results ?? [])
    .map((row) => proposalFor(row, { demand_milli: demand.get(row.id) ?? 0 }))
    .filter((proposal): proposal is ReplenishProposal => proposal !== null);
  if (!proposals.length) return fail(422, 'NO_PROPOSAL', { vendor_id: vendor.name });

  const lines = proposals.map((proposal) => ({
    id: crypto.randomUUID(),
    product_id: proposal.product_id,
    description: proposal.name,
    quantity: proposal.to_order_milli / 1000,
    unit_price: proposal.unit_price,
    tax_rate: proposal.tax_rate,
  }));
  const enriched = applyVendorPrices(
    await enrichLines(c.env.DB, lines),
    await vendorLinksFor(c.env.DB, body.vendor_id, proposals.map((proposal) => proposal.product_id)),
    body.vendor_id,
  );
  const totals = computeTotals(enriched, { discount_type: 'percent', discount_value: 0 }, false);
  const leadTime = proposals.reduce((max, proposal) => Math.max(max, proposal.lead_time_days), 0);
  const date = todayIn((company as { timezone?: string }).timezone ?? DEFAULT_TIMEZONE);
  const expected = expectedDate(date, leadTime);
  const id = crypto.randomUUID();
  const number = await nextSimpleNumber(c.env.DB, 'purchase_order', 'BC');

  await c.env.DB.prepare(
    `INSERT INTO purchase_orders (id, vendor_id, number, status, date, expected_date, currency, subtotal, discount_type,
      discount_value, discount_total, tax_total, total, line_items, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, 'percent', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.vendor_id, number, date, expected, company.currency, totals.subtotal,
    totals.discount_total, totals.tax_total, totals.total, serialiseLines(enriched),
    'Propositions d\'achat', user.id, nowISO(), nowISO(),
  ).run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'purchase_order',
    entityId: id,
    summary: 'activity.po_created',
    meta: { number, total: totals.total, source: 'replenishment', lines: proposals.length },
  });

  return c.json({ id, number, lines: proposals.length, expected_date: expected }, 201);
});

purchaseOrderRoutes.get('/:id', requirePermission('purchase_orders.read'), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT po.*, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
     WHERE po.id = ? AND po.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return fail(404, 'NOT_FOUND');
  const lines = safeLines(row.line_items);
  const receipts = await receiptRows(c.env.DB, String(row.id));
  const balances = lineBalances(
    lines.map((line) => ({ id: line.id, quantity_milli: milliOf(line.quantity) })),
    receipts,
  );
  return c.json({
    ...row,
    line_items: lines,
    receipts,
    balances,
    remaining_milli: totalRemaining(balances),
  });
});

/** Reception of what actually arrived (C3): the backorder stays on the order. */
purchaseOrderRoutes.post('/:id/receive', requirePermission('purchase_orders.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      lines: z.array(z.object({
        line_id: z.string().min(1).max(60),
        quantity: z.coerce.number().min(0).max(1_000_000),
      })).min(1).max(200),
    }),
    await c.req.json().catch(() => ({})),
  );

  const po = await c.env.DB
    .prepare(`SELECT id, number, status, line_items FROM purchase_orders WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string; number: string | null; status: string; line_items: string | null }>();
  if (!po) return fail(404, 'NOT_FOUND');
  if (po.status === 'cancelled') return fail(409, 'INVALID_TRANSITION');

  const result = await receiveAgainstBalance(
    c.env.DB,
    po,
    body.lines.map((line) => ({ line_id: line.line_id, quantity_milli: milliOf(line.quantity) })),
    user.id,
  );
  if (!result.ok) return fail(result.status, result.code, result.details);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'received',
    entityType: 'purchase_order',
    entityId: id,
    summary: 'activity.po_received',
    meta: { number: po.number, lines: result.received.length, complete: result.complete },
  });

  return c.json({
    ok: true,
    status: result.complete ? 'received' : 'partially_received',
    received: result.received,
    gaps: result.gaps,
  });
});

purchaseOrderRoutes.post('/', requirePermission('purchase_orders.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(purchaseOrderSchema, await c.req.json().catch(() => ({})));
  const vendor = await c.env.DB.prepare(`SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL`).bind(body.vendor_id).first();
  if (!vendor) return fail(422, 'VALIDATION_ERROR', { vendor_id: 'not_found' });

  // C2: the chosen vendor's pricelist fills the lines that carry no price, so the
  // buyer never retypes what the supplier already quoted — and a negotiated price
  // typed on the line always wins.
  body.line_items = applyVendorPrices(
    await enrichLines(c.env.DB, body.line_items),
    await vendorLinksFor(c.env.DB, body.vendor_id, productIdsOf(body.line_items)),
    body.vendor_id,
  );

  const totals = computeTotals(body.line_items, { discount_type: body.discount_type, discount_value: body.discount_value }, false);
  const id = crypto.randomUUID();
  const number = await nextSimpleNumber(c.env.DB, 'purchase_order', 'BC');
  await c.env.DB.prepare(
    `INSERT INTO purchase_orders (id, vendor_id, number, status, date, expected_date, currency, subtotal, discount_type,
      discount_value, discount_total, tax_total, total, line_items, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.vendor_id, number, body.date, body.expected_date, company.currency, totals.subtotal, body.discount_type,
    body.discount_value, totals.discount_total, totals.tax_total, totals.total, serialiseLines(body.line_items),
    body.notes, user.id, nowISO(), nowISO(),
  ).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'purchase_order', entityId: id, summary: 'activity.po_created', meta: { number, total: totals.total } });
  return c.json({ id, number }, 201);
});

purchaseOrderRoutes.post('/:id/status', requirePermission('purchase_orders.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ status: z.enum(['sent', 'approved', 'received', 'cancelled']) }),
    await c.req.json().catch(() => ({})),
  );
  const po = await c.env.DB.prepare(
    `SELECT id, number, status, line_items FROM purchase_orders WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; number: string | null; status: string; line_items: string }>();
  if (!po) return fail(404, 'NOT_FOUND');
  // A reception is final: receiving twice would double the stock. Going back to
  // another status is allowed (correction), receiving again is refused loudly
  // rather than silently accepted, so a double click cannot look like a success.
  if (body.status === 'received' && po.status === 'received') return fail(409, 'INVALID_TRANSITION');
  if (po.status === body.status) return c.json({ ok: true, received: [] });

  // Receiving "the order" now means receiving what is still due: after a partial
  // reception, taking the full ordered quantity again would stock the goods twice.
  let received: { product_id: string; quantity: number }[] = [];
  if (body.status === 'received') {
    const balances = lineBalances(
      safeLines(po.line_items).map((line) => ({ id: line.id, quantity_milli: milliOf(line.quantity) })),
      await receiptRows(c.env.DB, id),
    );
    const remaining = balances
      .filter((row) => row.remaining_milli > 0)
      .map((row) => ({ line_id: row.line_id, quantity_milli: row.remaining_milli }));
    if (remaining.length) {
      const result = await receiveAgainstBalance(c.env.DB, po, remaining, user.id);
      if (!result.ok) return fail(result.status, result.code, result.details);
      received = result.received;
    }
  }

  await c.env.DB.prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(body.status, nowISO(), id)
    .run();

  if (body.status === 'received') {
    await logActivity(c.env.DB, {
      userId: user.id,
      action: 'received',
      entityType: 'purchase_order',
      entityId: id,
      summary: 'activity.po_received',
      meta: { number: po.number, lines: received.length },
    });
  }

  return c.json({ ok: true, received });
});

purchaseOrderRoutes.delete('/:id', requirePermission('purchase_orders.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE purchase_orders SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'deleted', entityType: 'purchase_order', entityId: id, summary: 'activity.po_deleted' });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ projects */

const projectSchema = z.object({
  client_id: z.string().max(60).nullish(),
  name: z.string().trim().min(1).max(160),
  description: optionalText(2000),
  status: z.enum(['planned', 'active', 'completed', 'archived']).default('active'),
  budget: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
  start_date: optionalIsoDate,
  deadline: optionalIsoDate,
});

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use('*', requireAuth);

projectRoutes.get('/', requirePermission('projects.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL`).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.display_name AS client_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS task_count,
      (SELECT COALESCE(SUM(t.minutes), 0) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS total_minutes
     FROM projects p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;
  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

projectRoutes.get('/:id', requirePermission('projects.read'), async (c) => {
  const project = await c.env.DB.prepare(
    `SELECT p.*, c.display_name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first();
  if (!project) return fail(404, 'NOT_FOUND');
  const tasks = await c.env.DB.prepare(
    `SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
  ).bind(c.req.param('id')).all();
  return c.json({ ...project, tasks: tasks.results ?? [] });
});

projectRoutes.post('/', requirePermission('projects.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(projectSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, client_id, name, description, status, budget, start_date, deadline, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.client_id || null, body.name, body.description, body.status, body.budget, body.start_date, body.deadline, user.id, nowISO(), nowISO()).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'project', entityId: id, summary: 'activity.project_created', meta: { name: body.name } });
  return c.json({ id }, 201);
});

projectRoutes.patch('/:id', requirePermission('projects.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(projectSchema, await c.req.json().catch(() => ({})));
  await c.env.DB.prepare(
    `UPDATE projects SET client_id = ?, name = ?, description = ?, status = ?, budget = ?, start_date = ?, deadline = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.client_id || null, body.name, body.description, body.status, body.budget, body.start_date, body.deadline, nowISO(), id).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'updated', entityType: 'project', entityId: id, summary: 'activity.project_updated', meta: { name: body.name } });
  return c.json({ ok: true });
});

projectRoutes.delete('/:id', requirePermission('projects.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'deleted', entityType: 'project', entityId: id, summary: 'activity.project_deleted' });
  return c.json({ ok: true });
});

/* --------------------------------------------------------------------- tasks */

function parseJsonArray<T>(value: unknown, fallback: T[]): T[] {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : fallback;
  } catch {
    return fallback;
  }
}

/** A time entry is billed against a service, never against a stockable item: the
 * catalogue entry supplies the rate, the minimum and the invoice wording. */
async function assertServiceProduct(database: D1Database, productId: string | null | undefined) {
  if (!productId) return;
  const row = await database
    .prepare(`SELECT id, item_type FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(productId)
    .first<{ id: string; item_type: string }>();
  if (!row) return fail(422, 'VALIDATION_ERROR', { product_id: 'not_found' });
  if (row.item_type !== 'service') return fail(422, 'VALIDATION_ERROR', { product_id: 'not_a_service' });
}

const taskSchema = z.object({
  project_id: z.string().max(60).nullish(),
  client_id: z.string().max(60).nullish(),
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  minutes: z.coerce.number().int().min(0).max(100_000).default(0),
  hourly_rate: z.coerce.number().int().min(0).max(9_999_999).default(0),
  billable: z.boolean().default(true),
  // A5 : relevé de temps rattaché au service, au niveau et à la journée.
  product_id: z.string().max(60).nullish(),
  service_level: optionalText(60),
  work_date: optionalIsoDate,
  premium_label: optionalText(60),
  premium_percent: z.coerce.number().int().min(0).max(300).default(0),
});

export const taskRoutes = new Hono<AppEnv>();
taskRoutes.use('*', requireAuth);

taskRoutes.get('/', requirePermission('tasks.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const projectId = c.req.query('project_id') ?? '';
  const filters = ['t.deleted_at IS NULL'];
  const bindings: string[] = [];
  if (projectId) { filters.push('t.project_id = ?'); bindings.push(projectId); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t ${where}`).bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT t.*, p.name AS project_name, c.display_name AS client_name FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = t.client_id
     ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;
  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

taskRoutes.post('/', requirePermission('tasks.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(taskSchema, await c.req.json().catch(() => ({})));
  await assertServiceProduct(c.env.DB, body.product_id);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, project_id, client_id, title, description, status, minutes, hourly_rate, billable,
       product_id, service_level, work_date, premium_label, premium_percent, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.project_id || null, body.client_id || null, body.title, body.description, body.status,
    body.minutes, body.hourly_rate, body.billable ? 1 : 0, body.product_id || null, body.service_level,
    body.work_date ?? null, body.premium_label, body.premium_percent, user.id, nowISO(), nowISO(),
  ).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'task', entityId: id, summary: 'activity.task_created', meta: { title: body.title } });
  return c.json({ id }, 201);
});

taskRoutes.patch('/:id', requirePermission('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(taskSchema, await c.req.json().catch(() => ({})));
  await assertServiceProduct(c.env.DB, body.product_id);
  const existing = await c.env.DB.prepare(
    `SELECT id, minutes, hourly_rate, billable, premium_percent, invoice_id
     FROM tasks WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{
      id: string; minutes: number; hourly_rate: number; billable: number;
      premium_percent: number; invoice_id: string | null;
    }>();
  if (!existing) return fail(404, 'NOT_FOUND');

  // Hours, rate and premium are locked once invoiced: the document keeps what it
  // charged, and a correction goes through a credit note, never a silent edit.
  if (existing.invoice_id) {
    const changed = existing.minutes !== body.minutes
      || existing.hourly_rate !== body.hourly_rate
      || Boolean(existing.billable) !== body.billable
      || Number(existing.premium_percent ?? 0) !== body.premium_percent;
    if (changed) return fail(409, 'TASK_ALREADY_BILLED');
  }

  await c.env.DB.prepare(
    `UPDATE tasks SET project_id = ?, client_id = ?, title = ?, description = ?, status = ?, minutes = ?,
       hourly_rate = ?, billable = ?, product_id = ?, service_level = ?, work_date = ?, premium_label = ?,
       premium_percent = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    body.project_id || null, body.client_id || null, body.title, body.description, body.status, body.minutes,
    body.hourly_rate, body.billable ? 1 : 0, body.product_id || null, body.service_level, body.work_date ?? null,
    body.premium_label, body.premium_percent, nowISO(), id,
  ).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'updated', entityType: 'task', entityId: id, summary: 'activity.task_updated', meta: { title: body.title } });
  return c.json({ ok: true });
});

/**
 * Billable tasks → one draft invoice (T-205). The client is derived from the
 * tasks: mixing clients is refused rather than silently billed to the first one,
 * and each task is stamped with the invoice that paid it so a second pass cannot
 * bill the same hours twice.
 */
taskRoutes.post('/invoice', requirePermission('invoices.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      task_ids: z.array(z.string().min(8).max(60)).min(1).max(200),
      date: optionalIsoDate,
      tax_rate: percentRate.optional(),
    }),
    await c.req.json().catch(() => ({})),
  );

  const placeholders = body.task_ids.map(() => '?').join(',');
  const rows = await c.env.DB.prepare(
    `SELECT id, title, client_id, minutes, hourly_rate, billable, invoice_id, status,
            product_id, service_level, premium_label, premium_percent
     FROM tasks WHERE deleted_at IS NULL AND id IN (${placeholders})`,
  ).bind(...body.task_ids).all<{
    id: string; title: string; client_id: string | null; minutes: number;
    hourly_rate: number; billable: number; invoice_id: string | null; status: string;
    product_id: string | null; service_level: string | null;
    premium_label: string | null; premium_percent: number;
  }>();
  const tasks = rows.results ?? [];

  // The catalogue supplies the rate: the expertise level's TJM wins, then the
  // entry's own rate, then the service price. The minimum billable quantity is
  // the service's, applied to the intervention as a whole.
  const productIds = [...new Set(tasks.map((task) => task.product_id).filter(Boolean))] as string[];
  const products = new Map<string, {
    id: string; name: string; unit_price: number; min_billable_milli: number;
    expertise_levels: string | null; invoice_label: string | null;
  }>();
  if (productIds.length) {
    const productRows = await c.env.DB.prepare(
      `SELECT id, name, unit_price, min_billable_milli, expertise_levels, invoice_label
       FROM products WHERE deleted_at IS NULL AND id IN (${productIds.map(() => '?').join(',')})`,
    ).bind(...productIds).all<{
      id: string; name: string; unit_price: number; min_billable_milli: number;
      expertise_levels: string | null; invoice_label: string | null;
    }>();
    for (const product of productRows.results ?? []) products.set(product.id, product);
  }

  const pricing = new Map<string, LinePricing>();
  for (const task of tasks) {
    const product = task.product_id ? products.get(task.product_id) : undefined;
    const levels = parseJsonArray<{ level: string; price: number }>(product?.expertise_levels, []);
    const levelPrice = Number(
      levels.find((level) => level.level === task.service_level)?.price ?? 0,
    );
    const rate = levelPrice > 0
      ? levelPrice
      : (Number(task.hourly_rate) > 0 ? Number(task.hourly_rate) : Number(product?.unit_price ?? 0));
    const description = product
      ? `${product.invoice_label || product.name}${task.service_level ? ` — ${task.service_level}` : ''}`
      : task.title;
    pricing.set(task.id, {
      rate,
      minimum: Number(product?.min_billable_milli ?? 0) / 1000,
      description,
    });
  }
  if (tasks.length !== new Set(body.task_ids).size) return fail(404, 'NOT_FOUND');

  const clientId = invoiceClientOf(tasks);
  if (clientId === 'NO_TASKS') return fail(409, 'NO_BILLABLE_TASKS');
  if (clientId === 'MIXED_CLIENTS') return fail(409, 'MIXED_CLIENTS');
  if (clientId === 'NO_CLIENT') return fail(409, 'CLIENT_REQUIRED');

  const client = await c.env.DB.prepare(
    `SELECT id, currency, is_tax_exempt FROM clients WHERE id = ? AND deleted_at IS NULL`,
  ).bind(clientId).first<{ id: string; currency: string | null; is_tax_exempt: number }>();
  if (!client) return fail(404, 'NOT_FOUND');

  const date = body.date ?? todayIn(company.timezone);
  await assertPeriodOpen(c.env.DB, date);

  const lines = timesheetLines(tasks, body.tax_rate ?? company.default_tax_rate, pricing);
  if (!lines.length) return fail(409, 'NO_BILLABLE_TASKS');
  const totals = computeTotals(lines, { discount_type: 'percent', discount_value: 0 }, Boolean(client.is_tax_exempt));
  const id = crypto.randomUUID();
  const number = await nextNumber(c.env.DB, 'invoice', 'FAC', company.number_pattern, date);

  await c.env.DB.prepare(
    `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
      discount_total, tax_total, total, paid_total, balance, tax_exempt, po_number, line_items, notes, terms, footer, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, 'percent', 0, ?, ?, ?, 0, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, clientId, number, date, addDays(date, company.payment_terms), client.currency || company.currency,
    totals.subtotal, totals.discount_total, totals.tax_total, totals.total, totals.total,
    client.is_tax_exempt, serialiseLines(lines), null, company.invoice_terms, company.invoice_footer,
    user.id, nowISO(), nowISO(),
  ).run();

  // Billed minutes are frozen with the invoice: an entry edited afterwards must
  // not change what the customer was charged.
  await c.env.DB.prepare(
    `UPDATE tasks SET invoice_id = ?, billed_minutes = minutes, updated_at = ? WHERE id IN (${placeholders})`,
  ).bind(id, nowISO(), ...body.task_ids).run();

  // The VAT mirror is rebuilt from the stored lines, so it cannot disagree with
  // what the invoice actually carries.
  await syncInvoiceFromRow(c.env.DB, {
    id,
    line_items: serialiseLines(lines),
    discount_type: 'percent',
    discount_value: 0,
    tax_exempt: client.is_tax_exempt,
  });
  await logActivity(c.env.DB, {
    userId: user.id, action: 'created', entityType: 'invoice', entityId: id,
    summary: 'activity.invoice_from_tasks',
    meta: { number, tasks: lines.length, total: totals.total }, ip: clientIp(c),
  });

  return c.json({ id, number, total: totals.total, tasks: lines.length }, 201);
});

/** Kanban drag (T-205): moving a card changes the status only. */
taskRoutes.patch('/:id/status', requirePermission('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(
    z.object({ status: z.enum(['todo', 'in_progress', 'done']) }),
    await c.req.json().catch(() => ({})),
  );
  const existing = await c.env.DB.prepare(
    `SELECT id, status, invoice_id FROM tasks WHERE id = ? AND deleted_at IS NULL`,
  ).bind(id).first<{ id: string; status: string; invoice_id: string | null }>();
  if (!existing) return fail(404, 'NOT_FOUND');
  await c.env.DB.prepare(`UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(body.status, nowISO(), id).run();
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id, action: 'updated', entityType: 'task', entityId: id,
    summary: 'activity.task_status_changed',
    before: { status: existing.status }, after: { status: body.status }, ip: clientIp(c),
  });
  return c.json({ ok: true });
});

taskRoutes.delete('/:id', requirePermission('tasks.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'deleted', entityType: 'task', entityId: id, summary: 'activity.task_deleted' });
  return c.json({ ok: true });
});
