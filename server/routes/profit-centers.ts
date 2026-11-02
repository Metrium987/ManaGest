import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { isoDate, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { aggregateProfitCenters, isValidProfitCenter, normaliseProfitCenter } from '../../shared/profit-centers';
import type { AppEnv } from '../types';

/**
 * Q11 — profit centres as data.
 *
 * The centre is stored **on the invoice line**, as a snapshot: archiving a centre or
 * renaming it never changes an issued document. The report therefore reads the
 * documents themselves, not a join that a later edit could silently move.
 */
export const profitCenterRoutes = new Hono<AppEnv>();
profitCenterRoutes.use('*', requireAuth);

profitCenterRoutes.get('/', requirePermission('invoices.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT * FROM profit_centers ORDER BY archived ASC, code ASC`,
  ).all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, archived: Boolean(row.archived) })),
  });
});

const centreSchema = z.object({
  name: z.string().trim().min(1).max(80),
  is_active: z.boolean().default(true),
});

profitCenterRoutes.put('/:code', requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  const code = normaliseProfitCenter(c.req.param('code'));
  if (!code || !isValidProfitCenter(code)) return fail(422, 'VALIDATION_ERROR', { code: 'invalid' });
  const body = parseInput(centreSchema, await c.req.json().catch(() => ({})));
  const now = nowISO();

  await c.env.DB.prepare(
    `INSERT INTO profit_centers (code, name, archived, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET name = excluded.name, archived = excluded.archived, updated_at = excluded.updated_at`,
  ).bind(code, body.name, body.is_active ? 0 : 1, now, now).run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'profit_center',
    entityId: code,
    summary: 'activity.profit_center_updated',
    meta: { name: body.name, active: body.is_active },
  });

  return c.json({ ok: true, code });
});

/** Archiving keeps the row: invoice lines still carry its code. */
profitCenterRoutes.delete('/:code', requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  const code = normaliseProfitCenter(c.req.param('code'));
  if (!code) return fail(422, 'VALIDATION_ERROR', { code: 'invalid' });
  const result = await c.env.DB.prepare(
    `UPDATE profit_centers SET archived = 1, updated_at = ? WHERE code = ?`,
  ).bind(nowISO(), code).run();
  if (!result.meta.changes) return fail(404, 'NOT_FOUND');
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'profit_center',
    entityId: code,
    summary: 'activity.profit_center_archived',
    meta: { code },
  });
  return c.json({ ok: true });
});

const summaryQuery = z.object({
  from: isoDate,
  to: isoDate,
});

/**
 * Turnover and VAT per centre over a period, read from the invoice lines. Draft
 * invoices are left out: turnover is what was actually issued.
 *
 * Credit notes are subtracted, not ignored: a credit note is a sale that did not
 * happen, and a report that counted only the invoices would overstate every centre
 * it touched. The deduction follows the same rule as the document — the centre
 * carried by the credit line, which is the centre of what was refunded.
 */
profitCenterRoutes.get('/summary', requirePermission('invoices.read'), async (c) => {
  const range = parseInput(summaryQuery, c.req.query());
  const [invoices, credits] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, line_items, tax_exempt FROM invoices
        WHERE deleted_at IS NULL AND status <> 'draft' AND date >= ? AND date <= ?`,
    ).bind(range.from, range.to).all<{ id: string; line_items: string; tax_exempt: number }>(),
    c.env.DB.prepare(
      `SELECT id, number, line_items, tax_exempt FROM credits
        WHERE deleted_at IS NULL AND status <> 'draft' AND date >= ? AND date <= ?`,
    ).bind(range.from, range.to).all<{ id: string; number: string | null; line_items: string; tax_exempt: number }>(),
  ]);

  const sales: { code: string | null; base: number; tax: number; total: number; document_id: string }[] = [];

  const collect = (
    documents: { id: string; line_items: string; tax_exempt: number }[],
    sign: 1 | -1,
  ) => {
    for (const document of documents) {
      let lines: Record<string, unknown>[] = [];
      try {
        const parsed = JSON.parse(String(document.line_items ?? '[]'));
        lines = Array.isArray(parsed) ? parsed : [];
      } catch {
        lines = [];
      }
      for (const line of lines) {
        const quantity = Number(line.quantity) || 0;
        const unit = Math.round(Number(line.unit_price) || 0);
        const base = sign * Math.round(unit * quantity);
        const rate = Number(line.tax_rate) || 0;
        const tax = Number(document.tax_exempt) || line.tax_status === 'exempt'
          ? 0
          : sign * Math.round((Math.abs(base) * rate) / 100);
        sales.push({
          code: normaliseProfitCenter(line.profit_center),
          base,
          tax,
          total: base + tax,
          document_id: document.id,
        });
      }
    }
  };
  collect(invoices.results ?? [], 1);
  collect(credits.results ?? [], -1);

  const centres = (await c.env.DB.prepare(`SELECT code, name, archived FROM profit_centers`).all<{
    code: string; name: string; archived: number;
  }>()).results ?? [];

  return c.json({
    from: range.from,
    to: range.to,
    data: aggregateProfitCenters(sales, centres),
    totals: {
      base: sales.reduce((sum, sale) => sum + sale.base, 0),
      tax: sales.reduce((sum, sale) => sum + sale.tax, 0),
      total: sales.reduce((sum, sale) => sum + sale.total, 0),
      invoices: new Set(sales.map((sale) => sale.document_id)).size,
      credits: (credits.results ?? []).length,
    },
  });
});
