import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { addDays, addMonths } from '../lib/dates';
import { assertPeriodOpen } from '../lib/locks';
import { nextNumber } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import { safeLines, syncInvoiceFromRow } from './documents';
import type { CompanyRow } from '../types';

/**
 * The recurring engine, in one place. The manual run and the daily pipeline
 * (T-104a/b) must produce exactly the same invoice — a difference between the
 * two would be a money bug — so both call this function.
 */

const FREQUENCY_MONTHS: Record<string, number> = {
  weekly: 0,
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

export function advanceRunDate(date: string, frequency: string, interval: number): string {
  if (frequency === 'weekly') return addDays(date, 7 * interval);
  return addMonths(date, (FREQUENCY_MONTHS[frequency] ?? 1) * interval);
}

export interface RecurringSource {
  [key: string]: unknown;
}

export interface GeneratedInvoice {
  invoiceId: string;
  number: string;
  total: number;
  nextRunDate: string;
  /** Cycles still allowed after this one, or null when the template is open-ended. */
  remainingCycles: number | null;
  finished: boolean;
}

export async function generateRecurringInvoice(
  database: D1Database,
  company: CompanyRow,
  recurring: RecurringSource,
  options: { today: string; userId: string | null },
): Promise<GeneratedInvoice> {
  const today = options.today;
  await assertPeriodOpen(database, today);

  const lines = safeLines(recurring.line_items);
  const totals = computeTotals(
    lines,
    {
      discount_type: recurring.discount_type as 'percent' | 'amount',
      discount_value: recurring.discount_value as number,
    },
    Boolean(recurring.tax_exempt),
  );

  const invoiceId = crypto.randomUUID();
  const number = await nextNumber(database, 'invoice', 'FAC', company.number_pattern, today);
  const dueDate = addDays(today, Number(recurring.payment_terms ?? company.payment_terms));
  const status = recurring.auto_send ? 'sent' : 'draft';

  const remaining =
    recurring.remaining_cycles === null || recurring.remaining_cycles === undefined
      ? null
      : Math.max(0, Number(recurring.remaining_cycles) - 1);
  const completed = remaining === 0;
  const nextRunDate = advanceRunDate(
    String(recurring.next_run_date),
    String(recurring.frequency),
    Number(recurring.interval_count),
  );
  const endDate = recurring.end_date ? String(recurring.end_date) : null;
  const finished = completed || (endDate !== null && nextRunDate > endDate);

  await database.batch([
    database
      .prepare(
        `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
          discount_total, tax_total, total, paid_total, balance, tax_exempt, line_items, notes, terms, recurring_id, created_by,
          created_at, updated_at, sent_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        invoiceId, recurring.client_id, number, status, today, dueDate, recurring.currency, totals.subtotal,
        recurring.discount_type, recurring.discount_value, totals.discount_total, totals.tax_total, totals.total,
        totals.total, recurring.tax_exempt, recurring.line_items, recurring.notes, recurring.terms, recurring.id,
        options.userId, nowISO(), nowISO(), status === 'sent' ? nowISO() : null,
      ),
    database
      .prepare(
        `UPDATE recurring_invoices SET status = ?, remaining_cycles = ?, next_run_date = ?, last_generated_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(finished ? 'completed' : 'active', remaining, nextRunDate, nowISO(), nowISO(), recurring.id),
  ]);

  await syncInvoiceFromRow(database, {
    id: invoiceId,
    line_items: recurring.line_items,
    discount_type: String(recurring.discount_type),
    discount_value: Number(recurring.discount_value),
    tax_exempt: Number(recurring.tax_exempt),
  });

  await logActivity(database, {
    userId: options.userId,
    action: 'generated',
    entityType: 'recurring_invoice',
    entityId: String(recurring.id),
    summary: 'activity.recurring_generated',
    meta: { invoice: number, total: totals.total },
  });

  return { invoiceId, number, total: totals.total, nextRunDate, remainingCycles: remaining, finished };
}
