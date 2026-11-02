/**
 * Q12 — where each batch actually sits.
 *
 * `stock_lots` used to carry one location, which is enough until half a batch is
 * moved to the shop while the rest stays in the warehouse. A balance per
 * (lot, location) answers that, and it is derived with the same sign rule the
 * location balances already use: a movement of kind `out` subtracts, `in` adds, an
 * adjustment keeps its own sign. Written once, here, so a batch can never appear to
 * grow when it leaves a shelf.
 */

export interface LotMovement {
  lot: string | null;
  location: string | null;
  kind: string;
  quantity_milli: number;
}

export interface LotBalanceRow {
  lot_code: string;
  location: string | null;
  quantity_milli: number;
}

const locationKey = (location: string | null | undefined): string => {
  const code = typeof location === 'string' ? location.trim() : '';
  return code;
};

export function signedLotQuantity(movement: { kind: string; quantity_milli: number }): number {
  const quantity = Math.round(Number(movement.quantity_milli ?? 0));
  if (movement.kind === 'out') return -Math.abs(quantity);
  if (movement.kind === 'in') return Math.abs(quantity);
  return quantity;
}

/** Per lot and location, zeros dropped: an empty shelf is not a shelf. */
export function lotBalancesFromMovements(movements: LotMovement[]): LotBalanceRow[] {
  const totals = new Map<string, { lot_code: string; location: string; quantity_milli: number }>();
  for (const movement of movements) {
    const lot = typeof movement.lot === 'string' ? movement.lot.trim() : '';
    if (!lot) continue; // a movement without a batch says nothing about a batch
    const location = locationKey(movement.location);
    const key = `${lot}\u0000${location}`;
    const row = totals.get(key) ?? { lot_code: lot, location, quantity_milli: 0 };
    row.quantity_milli += signedLotQuantity(movement);
    totals.set(key, row);
  }
  return [...totals.values()]
    .filter((row) => row.quantity_milli !== 0)
    .map((row) => ({
      lot_code: row.lot_code,
      location: row.location === '' ? null : row.location,
      quantity_milli: row.quantity_milli,
    }))
    .sort((a, b) => a.lot_code.localeCompare(b.lot_code) || String(a.location ?? '').localeCompare(String(b.location ?? '')));
}

/**
 * A transfer is two movements for the same quantity in the same breath: leaving one
 * shelf and entering another. Writing a single movement with a new location would
 * leave the shelf it left still full.
 */
export function transferMovements(input: {
  product_id: string;
  lot: string;
  from: string;
  to: string;
  quantity_milli: number;
  reference: string | null;
  user_id: string;
  now: string;
}): { id: string; kind: 'out' | 'in'; location: string; quantity_milli: number; reason: string }[] {
  const quantity = Math.abs(Math.round(Number(input.quantity_milli) || 0));
  return [
    { id: crypto.randomUUID(), kind: 'out', location: input.from, quantity_milli: quantity, reason: 'lot_transfer' },
    { id: crypto.randomUUID(), kind: 'in', location: input.to, quantity_milli: quantity, reason: 'lot_transfer' },
  ];
}
