/**
 * Customer returns, pure side (A6).
 *
 * A return is a physical event, not a financial one: the credit note reverses
 * the money, this decides what may come back into stock. What may come back is
 * bounded by what actually left — never by what was invoiced, since an
 * untracked or service line never moved stock.
 */

export interface ReturnableQuantity {
  product_id: string;
  sold_milli: number;
  returned_milli: number;
  remaining_milli: number;
}

export type StockQuantityRow = { product_id: string; quantity_milli: number };

/** Sums the quantities per product of a set of stock movements. */
export function sumByProduct(rows: readonly StockQuantityRow[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const quantity = Number(row.quantity_milli);
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    totals.set(row.product_id, (totals.get(row.product_id) ?? 0) + quantity);
  }
  return totals;
}

/** What is still returnable: sold minus already returned, never negative. */
export function returnableQuantities(
  sold: ReadonlyMap<string, number>,
  returned: ReadonlyMap<string, number>,
): ReturnableQuantity[] {
  return [...sold.entries()]
    .map(([product_id, soldMilli]) => {
      const alreadyReturned = Math.min(returned.get(product_id) ?? 0, soldMilli);
      return {
        product_id,
        sold_milli: soldMilli,
        returned_milli: alreadyReturned,
        remaining_milli: Math.max(0, soldMilli - alreadyReturned),
      };
    })
    .sort((a, b) => a.product_id.localeCompare(b.product_id));
}

export interface ReturnRequest {
  product_id: string;
  quantity_milli: number;
}

export interface ReturnRefusal {
  product_id: string;
  requested_milli: number;
  remaining_milli: number;
  reason: 'not_sold' | 'exceeds_sold' | 'not_positive';
}

export type ReturnValidation =
  | { ok: true }
  | { ok: false; refusals: ReturnRefusal[] };

/**
 * Checks a return request line by line. Every refusal is reported rather than
 * stopping at the first one: a user filling a return form needs to see all the
 * lines that cannot pass, not discover them one at a time.
 */
export function validateReturn(
  requested: readonly ReturnRequest[],
  remaining: ReadonlyMap<string, number>,
): ReturnValidation {
  const refusals: ReturnRefusal[] = [];
  const seen = new Map<string, number>();

  for (const line of requested) {
    const quantity = Math.round(Number(line.quantity_milli));
    if (!Number.isFinite(quantity) || quantity <= 0) {
      refusals.push({
        product_id: line.product_id,
        requested_milli: quantity,
        remaining_milli: remaining.get(line.product_id) ?? 0,
        reason: 'not_positive',
      });
      continue;
    }
    if (!remaining.has(line.product_id)) {
      refusals.push({
        product_id: line.product_id,
        requested_milli: quantity,
        remaining_milli: 0,
        reason: 'not_sold',
      });
      continue;
    }
    // Two lines for the same product add up: the cap applies to the request,
    // not to each row of the form.
    const already = seen.get(line.product_id) ?? 0;
    seen.set(line.product_id, already + quantity);
    const available = remaining.get(line.product_id) ?? 0;
    if (already + quantity > available) {
      refusals.push({
        product_id: line.product_id,
        requested_milli: already + quantity,
        remaining_milli: available,
        reason: 'exceeds_sold',
      });
    }
  }

  return refusals.length ? { ok: false, refusals } : { ok: true };
}
