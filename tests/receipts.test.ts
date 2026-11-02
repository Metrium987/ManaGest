import { describe, expect, it } from 'vitest';
import { lineBalances, totalRemaining, validateReceipt } from '../server/lib/receipts';

const lines = [
  { id: 'l1', quantity_milli: 10_000 },
  { id: 'l2', quantity_milli: 5000 },
];

describe('receipt balances', () => {
  it('shows nothing received on a fresh order', () => {
    expect(lineBalances(lines, [])).toEqual([
      { line_id: 'l1', ordered_milli: 10_000, received_milli: 0, remaining_milli: 10_000 },
      { line_id: 'l2', ordered_milli: 5000, received_milli: 0, remaining_milli: 5000 },
    ]);
  });

  it('sums several receipts on the same line', () => {
    const balances = lineBalances(lines, [
      { line_id: 'l1', quantity_milli: 4000 },
      { line_id: 'l1', quantity_milli: 1000 },
    ]);
    expect(balances[0].received_milli).toBe(5000);
    expect(balances[0].remaining_milli).toBe(5000);
    expect(totalRemaining(balances)).toBe(10_000);
  });

  it('never shows a negative remaining, even if over-received', () => {
    const balances = lineBalances(lines, [{ line_id: 'l2', quantity_milli: 9000 }]);
    expect(balances[1].remaining_milli).toBe(0);
  });
});

describe('receipt validation', () => {
  it('accepts a partial receipt and keeps the order open', () => {
    const check = validateReceipt(lineBalances(lines, []), [{ line_id: 'l1', quantity_milli: 4000 }]);
    expect(check).toEqual({ ok: true, complete: false });
  });

  it('accepts a receipt that completes the order', () => {
    const check = validateReceipt(
      lineBalances(lines, [{ line_id: 'l1', quantity_milli: 10_000 }]),
      [{ line_id: 'l2', quantity_milli: 5000 }],
    );
    expect(check).toEqual({ ok: true, complete: true });
  });

  it('refuses more than what is still due', () => {
    const check = validateReceipt(
      lineBalances(lines, [{ line_id: 'l1', quantity_milli: 8000 }]),
      [{ line_id: 'l1', quantity_milli: 3000 }],
    );
    expect(check).toMatchObject({ ok: false, status: 409, code: 'RECEIPT_EXCEEDS_ORDERED' });
  });

  it('refuses an unknown line, an empty receipt and a zero quantity', () => {
    const balances = lineBalances(lines, []);
    expect(validateReceipt(balances, [{ line_id: 'ghost', quantity_milli: 1 }]))
      .toMatchObject({ ok: false, details: { line_id: 'unknown' } });
    expect(validateReceipt(balances, [{ line_id: 'l1', quantity_milli: 0 }]))
      .toMatchObject({ ok: false, details: { lines: 'empty' } });
  });
});
