/**
 * Multiple locations (B4).
 *
 * Odoo keeps a quantity per location ("quant") and moves it with an internal
 * transfer, which leaves the total and the valuation untouched. ManaGest already
 * writes the location on every stock movement, so the per-location balance is a
 * reading of the ledger rather than a second counter to keep in sync — the same
 * reasoning that made the on-hand figure auditable.
 *
 * The one trap is the sign. A sale is stored as a positive quantity with kind
 * 'out', while an adjustment stores its own sign; the balance must apply that
 * rule in exactly one place, here, or a location would appear to fill up when it
 * empties.
 */

export interface MovementRow {
  location: string | null;
  kind: string;
  quantity_milli: number;
}

export interface LocationBalance {
  location: string | null;
  quantity_milli: number;
}

export function signedQuantity(row: { kind: string; quantity_milli: number }): number {
  const quantity = Math.round(Number(row.quantity_milli ?? 0));
  if (row.kind === 'out') return -Math.abs(quantity);
  if (row.kind === 'in') return Math.abs(quantity);
  return quantity;
}

const keyOf = (location: string | null | undefined): string | null => {
  const code = typeof location === 'string' ? location.trim() : '';
  return code ? code : null;
};

/** Signed balance per location; `null` collects what was moved without one. */
export function locationBalances(rows: MovementRow[]): LocationBalance[] {
  const totals = new Map<string | null, number>();
  for (const row of rows) {
    const key = keyOf(row.location);
    totals.set(key, (totals.get(key) ?? 0) + signedQuantity(row));
  }
  return [...totals.entries()]
    .map(([location, quantity_milli]) => ({ location, quantity_milli }))
    .sort((a, b) => {
      if (a.location === b.location) return 0;
      // The unassigned bucket is a leftover, not a shelf: it goes last.
      if (a.location === null) return 1;
      if (b.location === null) return -1;
      return a.location.localeCompare(b.location);
    });
}

export function locationTotal(balances: LocationBalance[]): number {
  return balances.reduce((sum, row) => sum + row.quantity_milli, 0);
}

export function availableAt(balances: LocationBalance[], location: string | null): number {
  const key = keyOf(location);
  return balances.find((row) => row.location === key)?.quantity_milli ?? 0;
}

export type TransferCheck =
  | { ok: true }
  | { ok: false; status: 409 | 422; code: string; details?: Record<string, string> };

/**
 * A transfer is a physical act between two shelves: it needs two different
 * locations and stock at the source. Refusing an empty source is the point —
 * otherwise a transfer would create goods out of a typo.
 */
export function validateTransfer(input: {
  from: string | null;
  to: string | null;
  quantity_milli: number;
  available_milli: number;
  allow_negative?: boolean;
}): TransferCheck {
  const from = keyOf(input.from);
  const to = keyOf(input.to);
  if (!from) return { ok: false, status: 422, code: 'VALIDATION_ERROR', details: { from_location: 'required' } };
  if (!to) return { ok: false, status: 422, code: 'VALIDATION_ERROR', details: { to_location: 'required' } };
  if (from === to) return { ok: false, status: 422, code: 'VALIDATION_ERROR', details: { to_location: 'same_as_source' } };

  const quantity = Math.round(Number(input.quantity_milli));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', details: { quantity: 'positive' } };
  }
  if (quantity > Math.max(0, Math.round(Number(input.available_milli ?? 0))) && !input.allow_negative) {
    return { ok: false, status: 409, code: 'INSUFFICIENT_LOCATION_STOCK' };
  }
  return { ok: true };
}
