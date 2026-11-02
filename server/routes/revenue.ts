import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { logActivity } from '../lib/audit';
import { completionRateBp, recognitionDelta } from '../lib/revenue';
import { getAccountCodes } from '../lib/settings-extra';
import { ensureChart, postJournalEntry } from '../services/accounting';
import { requireAuth, requirePermission } from '../middleware';
import type { AppEnv } from '../types';

/**
 * E3: an invoice billed in advance is not revenue yet.
 *
 * Creating a schedule moves the billed amount out of sales into deferred revenue
 * (706 → 487); each recognition run books the part the period has earned back
 * (487 → 706). Both postings are idempotent, so running the pass twice on the same
 * day cannot double the revenue.
 */
export const revenueRoutes = new Hono<AppEnv>();
revenueRoutes.use('*', requireAuth);

const scheduleSchema = z.object({
  invoice_id: z.string().min(8).max(60),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

revenueRoutes.get('/schedules', requirePermission('accounting.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT s.*, i.number AS invoice_number, i.date AS invoice_date, cl.display_name AS client_name
       FROM revenue_schedules s
       JOIN invoices i ON i.id = s.invoice_id
       LEFT JOIN clients cl ON cl.id = i.client_id
      WHERE i.deleted_at IS NULL
      ORDER BY s.period_end ASC`,
  ).all();
  return c.json({ data: rows.results ?? [] });
});

revenueRoutes.post('/schedules', requirePermission('accounting.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInputSafe(scheduleSchema, await c.req.json().catch(() => ({})));
  if (!body) return fail(422, 'VALIDATION_ERROR', { body: 'invalid' });
  if (body.period_end < body.period_start) return fail(422, 'VALIDATION_ERROR', { period_end: 'before_start' });

  const invoice = await c.env.DB.prepare(
    `SELECT id, number, subtotal, discount_total, status FROM invoices WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.invoice_id)
    .first<{ id: string; number: string | null; subtotal: number; discount_total: number; status: string }>();
  if (!invoice) return fail(404, 'NOT_FOUND');
  if (!['sent', 'partial', 'paid'].includes(invoice.status)) {
    return fail(422, 'VALIDATION_ERROR', { invoice_id: 'not_issued' });
  }

  const existing = await c.env.DB.prepare(`SELECT id FROM revenue_schedules WHERE invoice_id = ?`)
    .bind(body.invoice_id)
    .first();
  if (existing) return fail(409, 'ALREADY_SCHEDULED');

  const total = Math.max(0, Number(invoice.subtotal ?? 0) - Number(invoice.discount_total ?? 0));
  const id = crypto.randomUUID();
  const codes = await getAccountCodes(c.env.DB);
  await ensureChart(c.env.DB, codes);
  await c.env.DB.prepare(
    `INSERT INTO revenue_schedules
       (id, invoice_id, period_start, period_end, total, recognized_total, last_rate_bp, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`,
  )
    .bind(id, body.invoice_id, body.period_start, body.period_end, total, user.id, nowISO(), nowISO())
    .run();

  await postJournalEntry(c.env.DB, {
    sourceType: 'revenue_schedule',
    sourceId: id,
    event: 'deferred',
    date: body.period_start,
    reference: invoice.number ?? '—',
    label: `Produits constatés d’avance ${invoice.number ?? ''}`.trim(),
    journal: 'OD',
    lines: [
      { account_code: codes.sales, label: `Mise en attente ${invoice.number ?? ''}`, debit: total, credit: 0 },
      { account_code: codes.deferred, label: `Mise en attente ${invoice.number ?? ''}`, debit: 0, credit: total },
    ],
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'revenue_schedule',
    entityId: id,
    summary: 'activity.revenue_scheduled',
    meta: { invoice: invoice.number, total },
  });

  return c.json({ id, total }, 201);
});

revenueRoutes.post('/recognize', requirePermission('accounting.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInputSafe(
    z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }),
    await c.req.json().catch(() => ({})),
  );
  const date = body?.date ?? todayIn(company.timezone);

  const schedules = await c.env.DB.prepare(
    `SELECT s.*, i.number AS invoice_number FROM revenue_schedules s
       JOIN invoices i ON i.id = s.invoice_id AND i.deleted_at IS NULL`,
  ).all<{
    id: string; invoice_id: string; invoice_number: string | null;
    period_start: string; period_end: string; total: number;
    recognized_total: number; last_rate_bp: number;
  }>();

  const codes = await getAccountCodes(c.env.DB);
  await ensureChart(c.env.DB, codes);
  let booked = 0;
  let count = 0;
  for (const schedule of schedules.results ?? []) {
    const rate = completionRateBp(schedule.period_start, schedule.period_end, date);
    const delta = recognitionDelta(Number(schedule.total), Number(schedule.last_rate_bp), rate);
    if (delta <= 0) continue;

    await c.env.DB.batch([
      c.env.DB.prepare(
        `INSERT OR IGNORE INTO revenue_recognitions (id, schedule_id, date, amount, rate_bp, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), schedule.id, date, delta, rate, nowISO()),
      c.env.DB.prepare(
        `UPDATE revenue_schedules SET recognized_total = recognized_total + ?, last_rate_bp = ?, updated_at = ? WHERE id = ?`,
      ).bind(delta, rate, nowISO(), schedule.id),
    ]);

    await postJournalEntry(c.env.DB, {
      sourceType: 'revenue_schedule',
      sourceId: schedule.id,
      event: `recognized:${date}`,
      date,
      reference: schedule.invoice_number ?? '—',
      label: `Constatation du chiffre d’affaires ${schedule.invoice_number ?? ''}`.trim(),
      journal: 'OD',
      lines: [
        { account_code: codes.deferred, label: `Constatation ${schedule.invoice_number ?? ''}`, debit: delta, credit: 0 },
        { account_code: codes.sales, label: `Constatation ${schedule.invoice_number ?? ''}`, debit: 0, credit: delta },
      ],
    });
    booked += delta;
    count += 1;
  }

  if (count > 0) {
    await logActivity(c.env.DB, {
      userId: user.id,
      action: 'updated',
      entityType: 'revenue_schedule',
      entityId: date,
      summary: 'activity.revenue_recognized',
      meta: { date, count, booked },
    });
  }

  return c.json({ date, count, booked });
});

function parseInputSafe<T>(schema: z.ZodType<T>, input: unknown): T | null {
  const result = schema.safeParse(input);
  return result.success ? result.data : null;
}
