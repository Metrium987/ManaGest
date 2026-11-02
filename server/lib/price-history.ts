/**
 * Purchase price history (C2 / owner decision 2026-11-02).
 *
 * A purchase price is a fact with a date, a supplier and a source. The ledger
 * therefore stores *events*, never one "current" number that overwrites the
 * past, and every rule below is a pure function so the arithmetic can be
 * tested without a database:
 *
 * - a change is measured against the price recorded just before it, in basis
 *   points (1000 bp = 10 %), rounded once;
 * - the alert threshold is a setting (`price_alert_percent`, default 10 %) and
 *   `0` turns it off — the same convention as every other threshold here;
 * - the average is taken over the last `price_alert_days` (default 90 days),
 *   the window purchasing managers watch, not over the whole file;
 * - a missing or zero previous price never produces a percentage: the figure
 *   would be meaningless, and a false alert is worse than no alert.
 */

export interface PricePoint {
  price: number;
  currency: string;
  recorded_at: string;
  source?: string | null;
  source_ref?: string | null;
}

export interface PriceHistorySettings {
  /** How far back the screen looks, in months. */
  months: number;
  /** Alert threshold in percent; 0 disables the alert. */
  alert_percent: number;
  /** Window used for the average, in days. */
  window_days: number;
}

export const PRICE_HISTORY_DEFAULTS: PriceHistorySettings = {
  months: 36,
  alert_percent: 10,
  window_days: 90,
};

/** Variation in basis points between two prices; 0 when the base is unusable. */
export function changeBp(previous: number, next: number): number {
  const before = Number(previous);
  const after = Number(next);
  if (!Number.isFinite(before) || !Number.isFinite(after) || before <= 0) return 0;
  return Math.round(((after - before) * 10000) / before);
}

/**
 * Whether a price belongs in the ledger. Re-saving the same price is not an
 * event; a first price is, and so is a currency change with the same figure.
 */
export function shouldRecordPrice(
  previous: number | null | undefined,
  next: number,
  previousCurrency?: string | null,
  currency?: string,
): boolean {
  const value = Number(next);
  if (!Number.isFinite(value) || value <= 0) return false;
  if (previous === null || previous === undefined) return true;
  return Number(previous) !== value || (previousCurrency ?? '') !== (currency ?? '');
}

/** Oldest date the screen may read, from the retention setting. */
export function priceCutoff(months: number, now: Date = new Date()): string {
  const asked = Number(months);
  const safe = Number.isFinite(asked) && asked > 0 ? asked : PRICE_HISTORY_DEFAULTS.months;
  const date = new Date(now.getTime());
  date.setUTCMonth(date.getUTCMonth() - safe);
  return date.toISOString();
}

export interface PriceStats {
  count: number;
  last: PricePoint | null;
  previous: PricePoint | null;
  average: number | null;
  change_bp: number;
  alert: boolean;
  months: number;
  window_days: number;
  alert_percent: number;
}

export function priceStats(
  points: PricePoint[],
  settings: Partial<PriceHistorySettings> = {},
  now: Date = new Date(),
): PriceStats {
  const months = settings.months ?? PRICE_HISTORY_DEFAULTS.months;
  const alertPercent = settings.alert_percent ?? PRICE_HISTORY_DEFAULTS.alert_percent;
  const windowDays = settings.window_days ?? PRICE_HISTORY_DEFAULTS.window_days;

  const sorted = [...points]
    .filter((point) => Number.isFinite(Number(point.price)) && Number(point.price) > 0)
    .sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));

  const last = sorted.at(-1) ?? null;
  const previous = sorted.at(-2) ?? null;

  const windowStart = new Date(
    now.getTime() - Math.max(1, windowDays) * 86_400_000,
  ).toISOString();
  const inWindow = sorted.filter((point) => String(point.recorded_at) >= windowStart);
  const basis = inWindow.length > 0 ? inWindow : sorted;
  const average = basis.length > 0
    ? Math.round(basis.reduce((sum, point) => sum + Number(point.price), 0) / basis.length)
    : null;

  const change = last && previous ? changeBp(Number(previous.price), Number(last.price)) : 0;
  // `alert_percent` is a percentage; the comparison is made in basis points.
  const alert = alertPercent > 0 && change >= alertPercent * 100;

  return {
    count: sorted.length,
    last,
    previous,
    average,
    change_bp: change,
    alert,
    months,
    window_days: Math.max(1, windowDays),
    alert_percent: alertPercent,
  };
}
