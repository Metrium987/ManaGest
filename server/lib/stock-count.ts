/**
 * Cycle counting, pure side (B1).
 *
 * A counting sheet is a photograph, not a live view: the quantity expected when
 * the sheet is opened is frozen on the line, the person writes what is really
 * on the shelf, and only the difference becomes a stock movement. Freezing the
 * expectation is what makes the count auditable — and what lets us detect that
 * a sale happened while the sheet was open instead of silently overwriting it.
 */

export const COUNT_STATUSES = ['open', 'validated', 'cancelled'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const COUNT_SCOPES = ['all', 'location', 'family'] as const;
export type CountScope = (typeof COUNT_SCOPES)[number];

export interface CountLine {
  product_id: string;
  expected_milli: number;
  counted_milli: number | null;
}

/** The movement a count produces: physical minus book. Zero means "nothing to
 * write", which is the common case on a healthy shelf. */
export function countDelta(countedMilli: number | null, expectedMilli: number): number {
  if (countedMilli === null || !Number.isFinite(Number(countedMilli))) return 0;
  return Math.round(Number(countedMilli)) - Math.round(Number(expectedMilli));
}

export function isCounted(line: CountLine): boolean {
  return line.counted_milli !== null && Number.isFinite(Number(line.counted_milli));
}

/** Lines nobody has looked at yet. A sheet is only valid once this is empty:
 * validating a half-counted sheet would zero every forgotten line. */
export function pendingLines(lines: readonly CountLine[]): CountLine[] {
  return lines.filter((line) => !isCounted(line));
}

export interface CountSummary {
  total: number;
  counted: number;
  pending: number;
  shortages: number;
  surpluses: number;
  net_delta_milli: number;
}

export function countSummary(lines: readonly CountLine[]): CountSummary {
  let counted = 0;
  let shortages = 0;
  let surpluses = 0;
  let net = 0;
  for (const line of lines) {
    if (!isCounted(line)) continue;
    counted += 1;
    const delta = countDelta(line.counted_milli, line.expected_milli);
    net += delta;
    if (delta < 0) shortages += 1;
    if (delta > 0) surpluses += 1;
  }
  return {
    total: lines.length,
    counted,
    pending: lines.length - counted,
    shortages,
    surpluses,
    net_delta_milli: net,
  };
}

export interface StaleLine {
  product_id: string;
  expected_milli: number;
  current_milli: number;
}

/**
 * Lines whose frozen expectation no longer matches the ledger: an invoice, a
 * reception, a return or an assembly moved the item after the sheet was opened.
 * Such a line must not be applied — the physical count the person saw is no
 * longer comparable to the book figure, so the count has to be restarted for
 * that item.
 */
export function staleLines(
  lines: readonly CountLine[],
  current: ReadonlyMap<string, number>,
): StaleLine[] {
  const stale: StaleLine[] = [];
  for (const line of lines) {
    const now = current.get(line.product_id);
    if (now === undefined) {
      // The product disappeared from the catalogue after the sheet was opened.
      stale.push({ product_id: line.product_id, expected_milli: line.expected_milli, current_milli: 0 });
      continue;
    }
    if (Math.round(Number(now)) !== Math.round(Number(line.expected_milli))) {
      stale.push({
        product_id: line.product_id,
        expected_milli: Math.round(Number(line.expected_milli)),
        current_milli: Math.round(Number(now)),
      });
    }
  }
  return stale;
}

/** What the count will write, in the shape the movement writer expects. */
export interface CountAdjustment {
  product_id: string;
  delta_milli: number;
}

export function adjustmentsOf(lines: readonly CountLine[]): CountAdjustment[] {
  return lines
    .map((line) => ({
      product_id: line.product_id,
      delta_milli: countDelta(line.counted_milli, line.expected_milli),
    }))
    .filter((row) => row.delta_milli !== 0)
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
}
