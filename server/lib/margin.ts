/**
 * Margin reporting, pure side (F3).
 *
 * Revenue is exclusive of VAT and recorded when the invoice is issued, not when
 * it is paid: a margin that moved with the cash would describe the bank, not the
 * business. A credit note reverses both sides — the revenue it cancels and the
 * cost of the goods it takes back — which is why it is aggregated with a
 * negative sign instead of being ignored until next period.
 *
 * Costs come from the product's current average (B3). Sales of a product whose
 * cost is unknown are reported with a null margin rather than a flattering 100 %:
 * a missing cost is an accounting gap, not a gift.
 */

export interface MarginSourceLine {
  product_id?: string | null;
  product_family?: string | null;
  product_name?: string | null;
  description?: string | null;
  quantity: number;
  unit_price: number;
  product_type?: string | null;
}

export interface MarginDocument {
  id: string;
  date: string;
  /** `invoice` adds to the period, `credit` subtracts from it. */
  kind: 'invoice' | 'credit';
  discount_type: 'percent' | 'amount';
  discount_value: number;
  lines: MarginSourceLine[];
}

export interface CostLookup {
  /** Unit cost in minor units, or null when the product cannot be costed. */
  cost: number | null;
  axis?: string | null;
  /** Current family, used when the document line carries no snapshot (credits,
   * imported or older documents). */
  family?: string | null;
}

export interface MarginRow {
  key: string;
  revenue: number;
  cost: number;
  margin: number | null;
  margin_bp: number | null;
  quantity_milli: number;
  documents: number;
  uncosted_lines: number;
}

export type MarginGroup = 'family' | 'axis' | 'product';

const UNGROUPED = '__none__';

/** Line amounts before tax, with the document discount spread over the lines in
 * proportion to their weight. A discount typed at the bottom of a document still
 * belongs to the lines that earned it. */
export function lineNetAmounts(document: MarginDocument): number[] {
  const gross = document.lines.map((line) => Math.round(Number(line.quantity || 0) * Number(line.unit_price || 0)));
  const total = gross.reduce((sum, value) => sum + value, 0);
  if (!total) return gross;

  const discount = document.discount_type === 'percent'
    ? Math.round((total * Math.min(100, Math.max(0, Number(document.discount_value || 0)))) / 100)
    : Math.min(total, Math.round(Number(document.discount_value || 0)));

  // Whole minor units: the last line absorbs the rounding so the document keeps
  // its exact total instead of losing a franc in the split.
  let allocated = 0;
  return gross.map((value, index) => {
    if (index === gross.length - 1) return value - (discount - allocated);
    const share = total ? Math.round((discount * value) / total) : 0;
    allocated += share;
    return value - share;
  });
}

export function groupKeyOf(line: MarginSourceLine, group: MarginGroup, costs: Map<string, CostLookup>): string {
  if (group === 'product') return line.product_id ?? UNGROUPED;
  if (group === 'axis') {
    const axis = line.product_id ? costs.get(line.product_id)?.axis : null;
    return axis && String(axis).trim() ? String(axis).trim() : UNGROUPED;
  }
  // The snapshot wins (it is what the document said at the time); the sheet is
  // the fallback, because a credit note has no snapshot to group by.
  const snapshot = line.product_family && String(line.product_family).trim();
  if (snapshot) return String(snapshot);
  const family = line.product_id ? costs.get(line.product_id)?.family : null;
  return family && String(family).trim() ? String(family).trim() : UNGROUPED;
}

/**
 * Aggregates documents into margin rows.
 *
 * A line is costed only when its product is known and has a cost. A free-text
 * line (no catalogue reference) has no cost to look up, so it contributes its
 * revenue and is counted as uncosted — the row's margin is then partial, and
 * `uncosted_lines` says so instead of hiding it behind a number.
 */
export function aggregateMargin(
  documents: readonly MarginDocument[],
  costs: ReadonlyMap<string, CostLookup>,
  group: MarginGroup,
): MarginRow[] {
  const rows = new Map<string, MarginRow & { hasNullMargin: boolean }>();

  for (const document of documents) {
    const sign = document.kind === 'credit' ? -1 : 1;
    const nets = lineNetAmounts(document);
    document.lines.forEach((line, index) => {
      const key = groupKeyOf(line, group, costs as Map<string, CostLookup>);
      const row = rows.get(key) ?? {
        key, revenue: 0, cost: 0, margin: 0, margin_bp: null, quantity_milli: 0,
        documents: 0, uncosted_lines: 0, hasNullMargin: false,
      };

      const revenue = sign * (nets[index] ?? 0);
      const quantityMilli = Math.round(Number(line.quantity || 0) * 1000);
      const lookup = line.product_id ? costs.get(line.product_id) : undefined;
      const unitCost = lookup?.cost ?? null;

      row.revenue += revenue;
      row.quantity_milli += sign * quantityMilli;
      if (unitCost === null) {
        row.uncosted_lines += 1;
        row.hasNullMargin = true;
      } else {
        row.cost += sign * Math.round((Number(line.quantity || 0) * unitCost));
      }
      rows.set(key, row);
    });
    // Count each document once per group it touched.
    for (const [key, row] of rows) {
      const touched = document.lines.some((line) => groupKeyOf(line, group, costs as Map<string, CostLookup>) === key);
      if (touched) row.documents += 1;
    }
  }

  return [...rows.values()]
    .map(({ hasNullMargin, ...row }) => {
      const margin = hasNullMargin ? null : row.revenue - row.cost;
      return {
        ...row,
        margin,
        // Only a zero revenue makes the rate meaningless; a net credit has a
        // negative revenue and a perfectly readable rate.
        margin_bp: margin === null || row.revenue === 0
          ? null
          : Math.round((margin / row.revenue) * 10_000),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);
}

export function marginSummary(rows: readonly MarginRow[]): {
  revenue: number;
  cost: number;
  margin: number | null;
  margin_bp: number | null;
  uncosted_lines: number;
} {
  const revenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const cost = rows.reduce((sum, row) => sum + row.cost, 0);
  const uncosted = rows.reduce((sum, row) => sum + row.uncosted_lines, 0);
  const margin = uncosted > 0 ? null : revenue - cost;
  return {
    revenue,
    cost,
    margin,
    margin_bp: margin === null || revenue === 0 ? null : Math.round((margin / revenue) * 10_000),
    uncosted_lines: uncosted,
  };
}
