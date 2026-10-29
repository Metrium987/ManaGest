import { logActivity } from '../lib/audit';
import { daysBetween } from '../lib/dates';
import { nowISO } from '../db';

/**
 * Payment reminders (T-105). The manual action already recorded a reminder in
 * the journal; what was missing is a memory of *which* level was sent, so that
 * a daily pass does not nag the same client every morning. The unique pair
 * (invoice, level) is that memory.
 */

export const REMINDER_MAX_LEVEL = 3;
export const DEFAULT_REMINDER_INTERVAL_DAYS = 7;
/** One pass will not remind more invoices than this; the rest waits for tomorrow. */
export const MAX_REMINDERS_PER_PASS = 200;

/**
 * The level a given lateness warrants: the first reminder the day after the due
 * date, then one per interval, capped. `0` means nothing is due yet.
 */
export function reminderLevelDue(
  daysOverdue: number,
  intervalDays = DEFAULT_REMINDER_INTERVAL_DAYS,
  maxLevel = REMINDER_MAX_LEVEL,
): number {
  if (!Number.isFinite(daysOverdue) || daysOverdue < 1) return 0;
  const interval = Math.max(1, Math.floor(intervalDays));
  const level = Math.floor((daysOverdue - 1) / interval) + 1;
  return Math.min(level, maxLevel);
}

/**
 * Every level still owed for this invoice. A client who fell three levels
 * behind while the scheduler was off gets the three entries once, not a single
 * muddled one — and never a repeat of a level already recorded.
 */
export function levelsToRecord(dueLevel: number, recordedLevels: number[]): number[] {
  if (dueLevel <= 0) return [];
  const recorded = new Set(recordedLevels);
  const missing: number[] = [];
  for (let level = 1; level <= dueLevel; level += 1) {
    if (!recorded.has(level)) missing.push(level);
  }
  return missing;
}

export interface ReminderPassResult {
  invoices: number;
  recorded: number;
  reasons: string[];
}

interface OverdueRow {
  id: string;
  number: string | null;
  due_date: string;
  balance: number;
}

export async function runReminderPass(
  database: D1Database,
  options: { day: string; intervalDays?: number },
): Promise<ReminderPassResult> {
  const intervalDays = options.intervalDays ?? DEFAULT_REMINDER_INTERVAL_DAYS;
  const result: ReminderPassResult = { invoices: 0, recorded: 0, reasons: [] };

  const overdue = await database
    .prepare(
      `SELECT id, number, due_date, balance FROM invoices
        WHERE deleted_at IS NULL AND status IN ('sent','partial') AND balance > 0
          AND due_date IS NOT NULL AND due_date < ?
        ORDER BY due_date ASC
        LIMIT ?`,
    )
    .bind(options.day, MAX_REMINDERS_PER_PASS)
    .all<OverdueRow>();

  const rows = overdue.results ?? [];
  result.invoices = rows.length;

  for (const row of rows) {
    const daysOverdue = daysBetween(row.due_date, options.day);
    const dueLevel = reminderLevelDue(daysOverdue, intervalDays);
    if (dueLevel === 0) continue;

    const recordedRows = await database
      .prepare(`SELECT level FROM invoice_reminders WHERE invoice_id = ?`)
      .bind(row.id)
      .all<{ level: number }>();
    const missing = levelsToRecord(dueLevel, (recordedRows.results ?? []).map((entry) => entry.level));
    if (missing.length === 0) continue;

    for (const level of missing) {
      const inserted = await database
        .prepare(
          `INSERT OR IGNORE INTO invoice_reminders (id, invoice_id, level, channel, days_overdue, created_by, created_at)
           VALUES (?, ?, ?, 'automatic', ?, NULL, ?)`,
        )
        .bind(crypto.randomUUID(), row.id, level, daysOverdue, nowISO())
        .run();
      if (Number(inserted.meta?.changes ?? 0) === 0) continue;

      result.recorded += 1;
      await logActivity(database, {
        userId: null,
        action: 'reminded',
        entityType: 'invoice',
        entityId: row.id,
        summary: 'activity.reminder_automatic',
        meta: { number: row.number, level, days_overdue: daysOverdue },
      });
    }
  }

  return result;
}

/** Records the manual reminder a person just sent, at the level lateness warrants. */
export async function recordManualReminder(
  database: D1Database,
  invoice: { id: string; due_date: string | null },
  options: { day: string; userId: string | null; intervalDays?: number },
): Promise<number | null> {
  if (!invoice.due_date) return null;
  const daysOverdue = Math.max(0, daysBetween(invoice.due_date, options.day));
  const dueLevel = Math.max(1, reminderLevelDue(daysOverdue, options.intervalDays ?? DEFAULT_REMINDER_INTERVAL_DAYS));
  const recorded = await database
    .prepare(`SELECT level FROM invoice_reminders WHERE invoice_id = ?`)
    .bind(invoice.id)
    .all<{ level: number }>();
  const missing = levelsToRecord(dueLevel, (recorded.results ?? []).map((entry) => entry.level));
  const level = missing.length > 0 ? missing[0] : dueLevel;
  await database
    .prepare(
      `INSERT OR IGNORE INTO invoice_reminders (id, invoice_id, level, channel, days_overdue, created_by, created_at)
       VALUES (?, ?, ?, 'manual', ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), invoice.id, level, daysOverdue, options.userId, nowISO())
    .run();
  return level;
}
