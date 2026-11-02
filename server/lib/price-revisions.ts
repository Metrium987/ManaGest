export interface RevisionLine {
  unit_price: number;
  quantity: number;
}

/**
 * E2: a revision raises unit prices by a rate in basis points (250 = 2,5 %).
 *
 * Prices are minor units, so the rounding happens per line and the same way every
 * time — a revision that adds or loses a franc at random would make the history
 * impossible to reconcile.
 */
export function reviseLines<T extends RevisionLine>(lines: T[], percentBp: number): T[] {
  const rate = Number(percentBp);
  if (!Number.isFinite(rate) || rate === 0) return lines;
  return lines.map((line) => ({
    ...line,
    unit_price: Math.max(0, Math.round((Number(line.unit_price ?? 0) * (10000 + rate)) / 10000)),
  }));
}

export function lineTotal(lines: RevisionLine[]): number {
  return lines.reduce((sum, line) => sum + Math.round(Number(line.unit_price ?? 0) * Number(line.quantity ?? 0)), 0);
}

/** The rate actually applied, so a history row never claims a rate it did not use. */
export function effectiveRate(oldTotal: number, newTotal: number): number {
  if (!Number.isFinite(oldTotal) || oldTotal <= 0) return 0;
  return Math.round(((newTotal - oldTotal) * 10000) / oldTotal);
}
