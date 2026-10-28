import { fail } from './errors';

/**
 * Accounting period close. A period is a calendar month ('YYYY-MM'); once
 * closed, no document dated in that month may be created or modified, which is
 * what makes a monthly report auditable after the fact. Reopening is an
 * explicit administrative action recorded in the audit journal.
 */

export function periodOf(date: string | null | undefined): string | null {
  if (!date) return null;
  const period = date.slice(0, 7);
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(period) ? period : null;
}

export async function isPeriodLocked(database: D1Database, period: string): Promise<boolean> {
  const row = await database
    .prepare(`SELECT 1 AS locked FROM period_locks WHERE period = ?`)
    .bind(period)
    .first<{ locked: number }>();
  return Boolean(row);
}

/**
 * Rejects a write when any of the given document dates falls inside a closed
 * period. Call it with every date the write touches (the stored date and the
 * new one, for instance) so a document cannot escape its closed period by
 * being re-dated.
 */
export async function assertPeriodOpen(
  database: D1Database,
  ...dates: (string | null | undefined)[]
): Promise<void> {
  const periods = new Set<string>();
  for (const date of dates) {
    const period = periodOf(date);
    if (period) periods.add(period);
  }
  for (const period of periods) {
    if (await isPeriodLocked(database, period)) {
      fail(409, 'PERIOD_LOCKED', { period });
    }
  }
}
