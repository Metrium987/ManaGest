/**
 * Lot tracking (B2).
 *
 * A lot is a physical batch of one article: same article, same supplier
 * delivery, same expiry. Odoo distinguishes "by lots" (a quantity per batch) from
 * "by unique serial number" (one unit per batch); both end up as a code plus a
 * quantity, which is why one table serves the two modes.
 *
 * The rule that actually matters at the shelf is FEFO — first expired, first out.
 * Odoo's documentation is explicit: the product with the nearest removal date is
 * picked first, and an undated lot is only reached once every dated lot is gone.
 * FIFO would ship fresh goods while last month's batch expires behind them, which
 * is why the sort is by expiry and not by arrival. Undated lots keep a stable
 * order among themselves (arrival, then code) so two identical pick lists never
 * disagree.
 */

export type LotTrackingMode = 'none' | 'lot' | 'serial';

export interface StockLot {
  id: string;
  lot_code: string;
  expiry_date: string | null;
  quantity_milli: number;
  created_at: string;
}

export interface LotPick {
  lot_id: string;
  lot_code: string;
  quantity_milli: number;
}

/** Anything unknown or empty means "no lot tracking": stock keeps working as before. */
export function lotTrackingMode(value: unknown): LotTrackingMode {
  return value === 'lot' || value === 'serial' ? value : 'none';
}

export function tracksLots(value: unknown): boolean {
  return lotTrackingMode(value) !== 'none';
}

/** Trimmed lot code, or null when there is nothing usable to store. */
export function normaliseLotCode(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const code = value.trim().slice(0, 60);
  return code.length ? code : null;
}

/** ISO dates only: a lot with a malformed expiry would silently sort first. */
export function normaliseExpiryDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const date = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  // JavaScript rolls 2026-02-31 over to March instead of rejecting it; a lot must
  // not carry a date the warehouse never wrote.
  return parsed.toISOString().slice(0, 10) === date ? date : null;
}

export function isExpired(lot: { expiry_date: string | null }, today: string): boolean {
  return Boolean(lot.expiry_date && lot.expiry_date < today);
}

export function fefoCompare(a: StockLot, b: StockLot): number {
  const left = a.expiry_date ?? null;
  const right = b.expiry_date ?? null;
  if (left && right && left !== right) return left < right ? -1 : 1;
  // An undated lot never jumps ahead of a dated one: the shelf has no reason to
  // guess, and a dated lot is the one at risk.
  if (left && !right) return -1;
  if (!left && right) return 1;
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1;
  return a.lot_code.localeCompare(b.lot_code);
}

/**
 * Splits a requested quantity over the lots, soonest expiry first.
 *
 * Returns the picks and what could not be covered, instead of throwing: the
 * caller decides whether a missing quantity is a refusal (a sale) or a zero
 * (an availability preview), and it needs the number either way.
 */
export function pickFefo(
  lots: StockLot[],
  wantedMilli: number,
): { picks: LotPick[]; missing_milli: number } {
  const wanted = Math.round(Number(wantedMilli));
  if (!Number.isFinite(wanted) || wanted <= 0) return { picks: [], missing_milli: 0 };

  const picks: LotPick[] = [];
  let remaining = wanted;
  for (const lot of [...lots].sort(fefoCompare)) {
    if (remaining <= 0) break;
    const available = Math.max(0, Math.round(Number(lot.quantity_milli ?? 0)));
    if (available <= 0) continue;
    const take = Math.min(remaining, available);
    picks.push({ lot_id: lot.id, lot_code: lot.lot_code, quantity_milli: take });
    remaining -= take;
  }
  return { picks, missing_milli: remaining };
}
