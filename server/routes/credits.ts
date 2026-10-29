import { requireApprovalIfNeeded } from '../services/approvals';
import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { todayIn } from '../lib/dates';
import { logActivity } from '../lib/audit';
import { retentionElapsed, DEFAULT_RETENTION_YEARS } from '../lib/retention';
import { fail } from '../lib/errors';
import { nextNumber, recordNumberGap } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import { lineItemsSchema, offsetOf, paginationSchema, parseInput } from '../lib/validation';
import { assertPeriodOpen } from '../lib/locks';
import { requireAuth, requirePermission } from '../middleware';
import { recalcCredit, recalcInvoice, safeLines, serialiseLines } from '../services/documents';
import { buildDocumentPdf } from '../services/pdf-documents';
import { resolveLayout } from '../services/pdf-style';
import { getExtra } from '../lib/settings-extra';
import type { AppEnv } from '../types';

const creditSchema = z.object({
  client_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: z.string().max(4000).nullish(),
  terms: z.string().max(2000).nullish(),
});

export const creditRoutes = new Hono<AppEnv>();
creditRoutes.use('*', requireAuth);

creditRoutes.get('/', requirePermission('credits.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const filters = ['cr.deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  const status = c.req.query('status') ?? '';
  if (status) {
    filters.push('cr.status = ?');
    bindings.push(status);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM credits cr ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT cr.*, c.display_name AS client_name FROM credits cr JOIN clients c ON c.id = cr.client_id
     ${where} ORDER BY cr.date DESC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all();

  const total = count?.count ?? 0;
  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, line_items: safeLines(row.line_items) })),
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

creditRoutes.get('/:id', requirePermission('credits.read'), async (c) => {
  const credit = await c.env.DB.prepare(
    `SELECT cr.*, c.display_name AS client_name FROM credits cr JOIN clients c ON c.id = cr.client_id
     WHERE cr.id = ? AND cr.deleted_at IS NULL`,
  )
    .bind(c.req.param('id'))
    .first<Record<string, unknown>>();
  if (!credit) return fail(404, 'NOT_FOUND');
  return c.json({ ...credit, line_items: safeLines(credit.line_items) });
});

creditRoutes.get('/:id/pdf', requirePermission('credits.read'), async (c) => {
  const company = c.get('company')!;
  const credit = await c.env.DB.prepare(
    `SELECT cr.*, c.display_name AS client_name, c.address1 AS client_address1, c.address2 AS client_address2,
            c.city AS client_city, c.postal_code AS client_postal_code, c.country AS client_country,
            c.tax_id AS client_tax_id
     FROM credits cr JOIN clients c ON c.id = cr.client_id
     WHERE cr.id = ? AND cr.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!credit) return fail(404, 'NOT_FOUND');

  // T-108a/T-108: the avoir prints with a positive total, labelled "Total avoir".
  const statusLabels: Record<string, string> = { draft: 'Brouillon', sent: 'Envoyé', partial: 'Partiellement utilisé', applied: 'Utilisé' };
  const layout = resolveLayout(c.req.query('layout'), await getExtra(c.env.DB, 'pdf_layout'));
  const bytes = await buildDocumentPdf('credit', company, {
    number: credit.number as string | null,
    date: String(credit.date),
    secondary: statusLabels[String(credit.status)] ?? String(credit.status),
    currency: String(credit.currency ?? company.currency),
    line_items: safeLines(credit.line_items),
    discount_type: String(credit.discount_type ?? 'percent'),
    discount_value: Number(credit.discount_value ?? 0),
    discount_total: Number(credit.discount_total ?? 0),
    subtotal: Number(credit.subtotal ?? 0),
    tax_total: Number(credit.tax_total ?? 0),
    total: Number(credit.total ?? 0),
    tax_exempt: Number(credit.tax_exempt ?? 0),
    notes: (credit.notes as string | null) ?? null,
    terms: (credit.terms as string | null) ?? null,
    client: {
      name: String(credit.client_name ?? ''),
      address1: (credit.client_address1 as string | null) ?? null,
      address2: (credit.client_address2 as string | null) ?? null,
      city: (credit.client_city as string | null) ?? null,
      postal_code: (credit.client_postal_code as string | null) ?? null,
      country: (credit.client_country as string | null) ?? null,
      tax_id: (credit.client_tax_id as string | null) ?? null,
    },
  }, layout);
  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${String(credit.number ?? 'avoir')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

creditRoutes.post('/', requirePermission('credits.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(creditSchema, await c.req.json().catch(() => ({})));
  await assertPeriodOpen(c.env.DB, body.date);

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
  const number = await nextNumber(c.env.DB, 'credit', 'AV', company.number_pattern, body.date);

  await c.env.DB.prepare(
    `INSERT INTO credits (id, client_id, number, status, date, currency, subtotal, discount_type, discount_value,
      discount_total, tax_total, total, applied_total, balance, tax_exempt, line_items, notes, terms, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.client_id, number, body.date, client.currency || company.currency, totals.subtotal,
      body.discount_type, body.discount_value, totals.discount_total, totals.tax_total, totals.total,
      totals.total, client.is_tax_exempt, serialiseLines(body.line_items), body.notes ?? null,
      body.terms || company.invoice_terms, user.id, nowISO(), nowISO(),
    )
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'credit',
    entityId: id,
    summary: 'activity.credit_created',
    meta: { number, total: totals.total },
  });

  return c.json({ id, number }, 201);
});

creditRoutes.post('/:id/send', requirePermission('credits.write'), async (c) => {
  // T-302: an amount above the configured threshold must be approved first.
  const creditForApproval = await c.env.DB.prepare(
    `SELECT id, total FROM credits WHERE id = ? AND deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<{ id: string; total: number }>();
  if (!creditForApproval) return fail(404, 'NOT_FOUND');
  await requireApprovalIfNeeded(c.env.DB, {
    entityType: 'credit',
    entityId: creditForApproval.id,
    amount: creditForApproval.total,
    requestedBy: c.get('user')!.id,
  });
  const id = c.req.param('id');
  const credit = await c.env.DB.prepare(`SELECT status, date FROM credits WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ status: string; date: string }>();
  if (!credit) return fail(404, 'NOT_FOUND');
  if (credit.status !== 'draft') return fail(409, 'INVALID_TRANSITION');
  await assertPeriodOpen(c.env.DB, credit.date);
  await c.env.DB.prepare(`UPDATE credits SET status = 'sent', updated_at = ? WHERE id = ?`)
    .bind(nowISO(), id)
    .run();
  return c.json({ ok: true });
});

creditRoutes.post('/:id/apply', requirePermission('credits.write'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ invoice_id: z.string().min(8).max(60), amount: z.coerce.number().int().positive() }),
    await c.req.json().catch(() => ({})),
  );

  const credit = await c.env.DB.prepare(
    `SELECT id, client_id, balance, number FROM credits WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; client_id: string; balance: number; number: string }>();
  if (!credit) return fail(404, 'NOT_FOUND');
  if (body.amount > credit.balance) return fail(409, 'CREDIT_INSUFFICIENT_BALANCE');

  const invoice = await c.env.DB.prepare(
    `SELECT id, client_id, balance FROM invoices WHERE id = ? AND deleted_at IS NULL AND status IN ('sent','partial')`,
  )
    .bind(body.invoice_id)
    .first<{ id: string; client_id: string; balance: number }>();
  if (!invoice) return fail(409, 'INVOICE_NOT_OPEN');
  if (invoice.client_id !== credit.client_id) return fail(409, 'CLIENT_MISMATCH');
  if (body.amount > invoice.balance) return fail(409, 'AMOUNT_EXCEEDS_BALANCE');

  await c.env.DB.prepare(
    `INSERT INTO credit_allocations (id, credit_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), id, invoice.id, body.amount, nowISO())
    .run();

  await recalcCredit(c.env.DB, id);
  await recalcInvoice(c.env.DB, invoice.id);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'applied',
    entityType: 'credit',
    entityId: id,
    summary: 'activity.credit_applied_invoice',
    meta: { number: credit.number, amount: body.amount },
  });

  return c.json({ ok: true });
});

creditRoutes.delete('/:id', requirePermission('credits.delete'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const credit = await c.env.DB.prepare(
    `SELECT applied_total, date, status, number FROM credits WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ applied_total: number; date: string; status: string; number: string | null }>();
  if (!credit) return fail(404, 'NOT_FOUND');
  if (credit.applied_total > 0) return fail(409, 'CREDIT_ALREADY_APPLIED');
  await assertPeriodOpen(c.env.DB, credit.date);

  // Retention guard (OQ-006, [VALIDATE LOCALLY]): issued credits are locked
  // from deletion until the retention window elapses (default 10 years).
  if (credit.status !== 'draft') {
    const retentionYears = Number(
      (await c.env.DB.prepare(`SELECT value FROM settings_extra WHERE key = 'retention_years'`).first())?.value
        ?? DEFAULT_RETENTION_YEARS,
    );
    const today = todayIn(c.get('company')!.timezone);
    if (!retentionElapsed(credit.date, retentionYears, today)) {
      return fail(409, 'RETENTION_LOCKED');
    }
  }

  await recordNumberGap(c.env.DB, 'credit', credit.number ? credit.number : null, user.id);
  await c.env.DB.prepare(`UPDATE credits SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  return c.json({ ok: true });
});
