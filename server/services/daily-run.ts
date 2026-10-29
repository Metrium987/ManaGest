import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { assertPeriodOpen } from '../lib/locks';
import { advanceRunDate, generateRecurringInvoice } from './recurring';
import type { CompanyRow } from '../types';

/**
 * The daily pass (T-104a/b). One run per Tahiti business day, claimed
 * atomically: a scheduler that calls twice — or two schedulers that call at the
 * same instant — must not produce a second set of invoices.
 */

export const RUN_ATTEMPT_LIMIT = 10;
export const RUN_ATTEMPT_WINDOW_MINUTES = 60;
/** A template that owes months of catch-up is generated at most this many times per pass. */
export const MAX_CATCH_UP_CYCLES = 12;
export const MAX_TEMPLATES_PER_RUN = 50;

export type RunStatus = 'running' | 'success' | 'partial' | 'failed' | 'skipped';

export interface RunSummary {
  day: string;
  generated: string[];
  failed: { id: string; code: string }[];
  templates: number;
  skipped_reason?: string;
  /** True when more templates were due than this pass was allowed to touch. */
  truncated: boolean;
}

/** A pass is only successful when every template it touched produced an invoice. */
export function runStatusFor(generated: number, failed: number, skippedReason?: string | null): RunStatus {
  if (skippedReason) return 'skipped';
  if (failed === 0) return 'success';
  return generated === 0 ? 'failed' : 'partial';
}

/** A failed or skipped day may be retried; a finished or running one may not. */
export function canRetryPrevious(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'skipped';
}

/**
 * Seconds to wait before another attempt, or 0 when the window still has room.
 * The oldest attempt in the window decides, so the limit is a sliding window
 * rather than a fixed hour bucket.
 */
export function retryAfterSeconds(
  attempts: string[],
  now: Date,
  limit = RUN_ATTEMPT_LIMIT,
  windowMinutes = RUN_ATTEMPT_WINDOW_MINUTES,
): number {
  const cutoff = now.getTime() - windowMinutes * 60_000;
  const recent = attempts
    .map((iso) => new Date(iso).getTime())
    .filter((time) => Number.isFinite(time) && time > cutoff)
    .sort((a, b) => a - b);
  if (recent.length < limit) return 0;
  return Math.max(1, Math.ceil((recent[0] + windowMinutes * 60_000 - now.getTime()) / 1000));
}

/**
 * How many cycles a template owes for `today`, capped. The advance follows the
 * engine's own rule (month-by-month from the current date), so catch-up can
 * drift on a month-end start date exactly as the manual run always has.
 */
export function pendingCycles(
  nextRunDate: string,
  frequency: string,
  interval: number,
  today: string,
  max = MAX_CATCH_UP_CYCLES,
): number {
  let cursor = nextRunDate;
  let cycles = 0;
  while (cursor <= today && cycles < max) {
    cursor = advanceRunDate(cursor, frequency, interval);
    cycles += 1;
  }
  return cycles;
}

export async function claimDailyRun(
  database: D1Database,
  day: string,
  triggerIp: string | null,
): Promise<{ claimed: boolean; run: Record<string, unknown> | null }> {
  const claimed = await database
    .prepare(`INSERT INTO daily_runs (day, status, started_at, trigger_ip) VALUES (?, 'running', ?, ?) ON CONFLICT(day) DO NOTHING`)
    .bind(day, nowISO(), triggerIp)
    .run();
  if (Number(claimed.meta?.changes ?? 0) > 0) return { claimed: true, run: null };

  const existing = await database.prepare(`SELECT * FROM daily_runs WHERE day = ?`).bind(day).first<Record<string, unknown>>();
  if (existing && canRetryPrevious(String(existing.status))) {
    // A failed day is retryable, but only one caller wins the retry.
    const retry = await database
      .prepare(
        `UPDATE daily_runs SET status = 'running', started_at = ?, finished_at = NULL, error_code = NULL, trigger_ip = ?
         WHERE day = ? AND status = ?`,
      )
      .bind(nowISO(), triggerIp, day, String(existing.status))
      .run();
    if (Number(retry.meta?.changes ?? 0) > 0) return { claimed: true, run: null };
  }
  return { claimed: false, run: existing ?? null };
}

export async function finishDailyRun(
  database: D1Database,
  day: string,
  status: RunStatus,
  summary: RunSummary,
): Promise<void> {
  await database
    .prepare(`UPDATE daily_runs SET status = ?, finished_at = ?, summary_json = ?, error_code = ? WHERE day = ?`)
    .bind(status, nowISO(), JSON.stringify(summary), status === 'failed' ? 'INTERNAL_ERROR' : null, day)
    .run();
}

/** Records an attempt and returns the wait in seconds (0 when allowed). */
export async function registerRunAttempt(database: D1Database, ip: string): Promise<number> {
  const cutoff = new Date(Date.now() - RUN_ATTEMPT_WINDOW_MINUTES * 60_000).toISOString();
  const attempts = await database
    .prepare(`SELECT created_at FROM daily_run_attempts WHERE ip = ? AND created_at > ? ORDER BY created_at ASC`)
    .bind(ip, cutoff)
    .all<{ created_at: string }>();

  const retryAfter = retryAfterSeconds((attempts.results ?? []).map((row) => row.created_at), new Date());
  if (retryAfter > 0) return retryAfter;

  await database.batch([
    database
      .prepare(`INSERT INTO daily_run_attempts (id, ip, created_at) VALUES (?, ?, ?)`)
      .bind(crypto.randomUUID(), ip, nowISO()),
    // Opportunistic prune: the table must not grow with every scheduler call.
    database
      .prepare(`DELETE FROM daily_run_attempts WHERE created_at < ?`)
      .bind(new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()),
  ]);
  return 0;
}

async function periodOpen(database: D1Database, day: string): Promise<boolean> {
  try {
    await assertPeriodOpen(database, day);
    return true;
  } catch {
    return false;
  }
}

export async function runDailyPipeline(
  database: D1Database,
  company: CompanyRow,
  options: { day: string; triggerIp: string | null },
): Promise<RunSummary> {
  const { day } = options;
  const summary: RunSummary = { day, generated: [], failed: [], templates: 0, truncated: false };

  if (!(await periodOpen(database, day))) {
    summary.skipped_reason = 'PERIOD_LOCKED';
    return summary;
  }

  const due = await database
    .prepare(
      `SELECT r.*, c.payment_terms
         FROM recurring_invoices r JOIN clients c ON c.id = r.client_id
        WHERE r.status = 'active' AND r.deleted_at IS NULL AND r.next_run_date <= ?
        ORDER BY r.next_run_date ASC, r.created_at ASC
        LIMIT ?`,
    )
    .bind(day, MAX_TEMPLATES_PER_RUN + 1)
    .all<Record<string, unknown>>();

  const rows = due.results ?? [];
  summary.truncated = rows.length > MAX_TEMPLATES_PER_RUN;
  summary.templates = Math.min(rows.length, MAX_TEMPLATES_PER_RUN);

  for (const row of rows.slice(0, MAX_TEMPLATES_PER_RUN)) {
    const cycles = pendingCycles(
      String(row.next_run_date),
      String(row.frequency),
      Number(row.interval_count),
      day,
    );
    let current = row;
    for (let cycle = 0; cycle < cycles; cycle += 1) {
      try {
        const result = await generateRecurringInvoice(database, company, current, {
          today: day,
          userId: null,
        });
        summary.generated.push(result.number);
        current = {
          ...current,
          next_run_date: result.nextRunDate,
          remaining_cycles: result.remainingCycles,
        };
        if (result.finished) break;
      } catch (error) {
        const code = error instanceof Error && 'code' in error ? String((error as { code: unknown }).code) : 'INTERNAL_ERROR';
        summary.failed.push({ id: String(row.id), code });
        break;
      }
    }
  }

  await logActivity(database, {
    userId: null,
    action: 'ran',
    entityType: 'daily_run',
    entityId: day,
    summary: 'activity.daily_run_completed',
    meta: {
      generated: summary.generated.length,
      failed: summary.failed.length,
      templates: summary.templates,
      truncated: summary.truncated,
    },
    ip: options.triggerIp,
  });

  return summary;
}
