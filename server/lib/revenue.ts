/**
 * E3: revenue recognition by percentage of completion.
 *
 * The rate is computed from the calendar, in basis points, so a contract billed
 * in advance is recognised exactly as far as its period has run — no rounding
 * accumulated day after day, and no recognition before the work starts.
 */
export function completionRateBp(periodStart: string, periodEnd: string, today: string): number {
  const start = Date.parse(`${periodStart.slice(0, 10)}T00:00:00Z`);
  const end = Date.parse(`${periodEnd.slice(0, 10)}T00:00:00Z`);
  const now = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || Number.isNaN(now)) return 0;
  if (end <= start) return 10_000;
  if (now <= start) return 0;
  if (now >= end) return 10_000;
  return Math.round(((now - start) * 10_000) / (end - start));
}

export function recognizedAmount(total: number, rateBp: number): number {
  const amount = Math.round((Math.max(0, Number(total)) * Math.min(10_000, Math.max(0, rateBp))) / 10_000);
  return Math.min(Math.max(0, Number(total)), amount);
}

/** What is left to recognise between the rate already booked and the new one. */
export function recognitionDelta(total: number, previousRateBp: number, newRateBp: number): number {
  if (newRateBp <= previousRateBp) return 0;
  return recognizedAmount(total, newRateBp) - recognizedAmount(total, previousRateBp);
}

/** The part of the revenue that is still deferred at a given rate. */
export function deferredAmount(total: number, rateBp: number): number {
  return Math.max(0, Math.round(Number(total)) - recognizedAmount(total, rateBp));
}
