import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { lineItemsSchema, offsetOf, optionalIsoDate, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { DEFAULT_NOTICE_LEAD_DAYS } from '../../shared/company-defaults';
import { safeLines, serialiseLines } from '../services/documents';
import { generateRecurringInvoice } from '../services/recurring';
import { RENEWAL_MODES, contractDraft, contractNotices, type ContractService, type NoticeContract } from '../lib/contracts';
import { effectiveRate, lineTotal, reviseLines } from '../lib/price-revisions';
import type { AppEnv } from '../types';

const recurringSchema = z.object({
  client_id: z.string().min(8).max(60),
  frequency: z.enum(['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']).default('monthly'),
  interval_count: z.coerce.number().int().min(1).max(12).default(1),
  next_run_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: optionalIsoDate,
  remaining_cycles: z.coerce.number().int().min(0).max(999).nullish(),
  auto_send: z.boolean().default(false),
  service_id: z.string().min(8).max(60).nullish().transform((value) => value ?? null),
  notice_days: z.coerce.number().int().min(0).max(365).default(0),
  renewal_mode: z.enum(RENEWAL_MODES).default('tacit'),
  contract_start: optionalIsoDate,
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(2000).nullish(),
});

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

/**
 * E1: creates a contract from a service sheet. The frequency, notice period and
 * renewal mode come from the offer, so a contract cannot be sold with a notice
 * period and billed without one.
 */
recurringRoutes.post('/from-service', requirePermission('recurring.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      service_id: z.string().min(8).max(60),
      client_id: z.string().min(8).max(60),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      end_date: optionalIsoDate,
      auto_send: z.boolean().default(false),
    }),
    await c.req.json().catch(() => ({})),
  );

  const service = await c.env.DB.prepare(
    `SELECT id, name, item_type, unit_price, tax_rate, billing_frequency, renewal_mode, notice_days, service_type, price_revision_index
       FROM products WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.service_id)
    .first<ContractService>();
  if (!service) return fail(422, 'VALIDATION_ERROR', { service_id: 'not_found' });
  if (service.item_type !== 'service') return fail(422, 'VALIDATION_ERROR', { service_id: 'not_a_service' });

  const client = await c.env.DB.prepare(
    `SELECT id, is_tax_exempt, currency FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.client_id)
    .first<{ id: string; is_tax_exempt: number; currency: string }>();
  if (!client) return fail(422, 'VALIDATION_ERROR', { client_id: 'not_found' });

  const draft = contractDraft(service, body.start_date);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO recurring_invoices (id, client_id, number, status, frequency, interval_count, next_run_date, end_date,
      remaining_cycles, auto_send, service_id, notice_days, renewal_mode, contract_start, revision_index,
      currency, discount_type, discount_value, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, NULL, 'active', ?, 1, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, 'percent', 0, ?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, draft.frequency, draft.contract_start, body.end_date ?? null,
      body.auto_send ? 1 : 0, service.id, draft.notice_days, draft.renewal_mode, draft.contract_start,
      draft.revision_index, client.currency, client.is_tax_exempt, serialiseLines([draft.line] as never), null,
      user.id, nowISO(), nowISO(),
    )
    .run();

  return c.json({ id, frequency: draft.frequency, notice_days: draft.notice_days, renewal_mode: draft.renewal_mode }, 201);
});

/**
 * E2: applies an index revision to a contract and records it. The old and new
 * totals are stored on the revision, so a client question months later is answered
 * by the history rather than by recomputing an index nobody remembers.
 */
recurringRoutes.post('/:id/revision', requirePermission('recurring.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      percent_bp: z.coerce.number().int().min(1).max(10000),
      effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      reason: z.string().trim().max(300).nullish(),
    }),
    await c.req.json().catch(() => ({})),
  );

  const contract = await c.env.DB.prepare(
    `SELECT id, line_items, revision_index FROM recurring_invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; line_items: string; revision_index: string | null }>();
  if (!contract) return fail(404, 'NOT_FOUND');

  const lines = safeLines(contract.line_items);
  if (lines.length === 0) return fail(422, 'VALIDATION_ERROR', { line_items: 'empty' });

  const revised = reviseLines(lines, body.percent_bp);
  const oldTotal = lineTotal(lines);
  const newTotal = lineTotal(revised);

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE recurring_invoices SET line_items = ?, updated_at = ? WHERE id = ?`)
      .bind(serialiseLines(revised as never), nowISO(), id),
    c.env.DB.prepare(
      `INSERT INTO contract_revisions
         (id, recurring_id, effective_date, percent_bp, index_label, old_total, new_total, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), id, body.effective_date, body.percent_bp, contract.revision_index,
      oldTotal, newTotal, body.reason ?? null, user.id, nowISO(),
    ),
  ]);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'recurring_invoice',
    entityId: id,
    summary: 'activity.contract_revised',
    meta: { percent_bp: body.percent_bp, old_total: oldTotal, new_total: newTotal },
  });

  return c.json({ old_total: oldTotal, new_total: newTotal, applied_bp: effectiveRate(oldTotal, newTotal) }, 201);
});

recurringRoutes.get('/:id/revisions', requirePermission('recurring.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM contract_revisions WHERE recurring_id = ? ORDER BY effective_date DESC, created_at DESC`,
  )
    .bind(c.req.param('id'))
    .all();
  return c.json({ data: rows.results ?? [] });
});

/** E4: contracts whose notice period is closing in, or already missed. */
recurringRoutes.get('/notices', requirePermission('recurring.read'), async (c) => {
  const company = c.get('company')!;
  const lead = Math.min(120, Math.max(0, Number(c.req.query('lead') ?? DEFAULT_NOTICE_LEAD_DAYS)));
  const rows = await c.env.DB.prepare(
    `SELECT r.id, c.display_name AS client_name, r.end_date, r.notice_days, r.renewal_mode, r.status
       FROM recurring_invoices r JOIN clients c ON c.id = r.client_id
      WHERE r.deleted_at IS NULL AND r.end_date IS NOT NULL`,
  ).all<NoticeContract>();
  const today = todayIn(company.timezone);
  return c.json({ data: contractNotices(rows.results ?? [], today, lead), today, lead });
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
      remaining_cycles, auto_send, service_id, notice_days, renewal_mode, contract_start,
      currency, discount_type, discount_value, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, NULL, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, body.frequency, body.interval_count, body.next_run_date, body.end_date,
      body.remaining_cycles ?? null, body.auto_send ? 1 : 0, body.service_id, body.notice_days,
      body.renewal_mode, body.contract_start, client.currency, body.discount_type,
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
      remaining_cycles = ?, auto_send = ?, service_id = ?, notice_days = ?, renewal_mode = ?, contract_start = ?,
      discount_type = ?, discount_value = ?, line_items = ?, notes = ?, terms = ?,
      updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.client_id, body.frequency, body.interval_count, body.next_run_date, body.end_date,
      body.remaining_cycles ?? null, body.auto_send ? 1 : 0, body.service_id, body.notice_days,
      body.renewal_mode, body.contract_start, body.discount_type, body.discount_value,
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
  const result = await generateRecurringInvoice(c.env.DB, company, recurring, { today, userId: user.id });
  return c.json({ id: result.invoiceId, number: result.number, next_run_date: result.nextRunDate, completed: result.finished });
});

recurringRoutes.delete('/:id', requirePermission('recurring.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE recurring_invoices SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  return c.json({ ok: true });
});
