/**
 * Partial receipts (C3).
 *
 * A supplier rarely ships a whole order at once. Odoo handles this with a
 * backorder: the delivery note carries what actually arrived, and the remaining
 * quantity stays open on the order instead of being silently considered
 * received. The rule that matters is that the stock only ever grows by what was
 * physically received — receiving "the line" because the button says receive is
 * how a warehouse ends up with goods nobody can find.
 *
 * The balances are derived from the receipt history, never from a counter on the
 * line: a counter cannot be audited, and a receipt that is deleted or corrected
 * would leave it wrong for ever.
 */

export interface ReceiptLine {
  /** Document line id, stable for the life of the order. */
  id: string;
  quantity_milli: number;
}

export interface ReceiptRow {
  line_id: string;
  quantity_milli: number;
}

export interface LineBalance {
  line_id: string;
  ordered_milli: number;
  received_milli: number;
  remaining_milli: number;
}

/** What is still due, line by line. A line already over-received shows zero. */
export function lineBalances(lines: ReceiptLine[], receipts: ReceiptRow[]): LineBalance[] {
  const received = new Map<string, number>();
  for (const row of receipts) {
    received.set(row.line_id, (received.get(row.line_id) ?? 0) + Math.round(Number(row.quantity_milli ?? 0)));
  }
  return lines.map((line) => {
    const ordered = Math.max(0, Math.round(Number(line.quantity_milli ?? 0)));
    const taken = Math.max(0, received.get(line.id) ?? 0);
    return {
      line_id: line.id,
      ordered_milli: ordered,
      received_milli: taken,
      remaining_milli: Math.max(0, ordered - taken),
    };
  });
}

export function totalRemaining(balances: LineBalance[]): number {
  return balances.reduce((sum, row) => sum + row.remaining_milli, 0);
}

export type ReceiptCheck =
  | { ok: true; complete: boolean }
  | { ok: false; status: 409 | 422; code: string; details?: Record<string, string> };

/**
 * Checks a receipt against the balances and says whether the order is now
 * complete. A quantity above what is still due is a refusal rather than a
 * silent cap: receiving more than ordered means either a typing error or an
 * unrecorded order change, and both deserve a human look.
 */
export function validateReceipt(
  balances: LineBalance[],
  requested: ReceiptRow[],
): ReceiptCheck {
  const byLine = new Map(balances.map((row) => [row.line_id, row]));
  const accepted: ReceiptRow[] = [];

  for (const row of requested) {
    const balance = byLine.get(row.line_id);
    if (!balance) {
      return { ok: false, status: 422, code: 'VALIDATION_ERROR', details: { line_id: 'unknown' } };
    }
    const quantity = Math.round(Number(row.quantity_milli ?? 0));
    if (!Number.isFinite(quantity) || quantity <= 0) continue;
    if (quantity > balance.remaining_milli) {
      return { ok: false, status: 409, code: 'RECEIPT_EXCEEDS_ORDERED' };
    }
    accepted.push({ line_id: row.line_id, quantity_milli: quantity });
  }

  if (!accepted.length) {
    return { ok: false, status: 422, code: 'VALIDATION_ERROR', details: { lines: 'empty' } };
  }

  const after = lineBalances(
    balances.map((row) => ({ id: row.line_id, quantity_milli: row.ordered_milli })),
    [
      ...balances.map((row) => ({ line_id: row.line_id, quantity_milli: row.received_milli })),
      ...accepted,
    ],
  );
  return { ok: true, complete: totalRemaining(after) === 0 };
}
