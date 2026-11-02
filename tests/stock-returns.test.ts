import { describe, expect, it } from 'vitest';
import {
  returnableQuantities,
  sumByProduct,
  validateReturn,
} from '../server/lib/stock-returns';

const map = (entries: [string, number][]) => new Map(entries);

describe('customer returns (A6)', () => {
  it('sums movements per product and ignores empty or negative rows', () => {
    const totals = sumByProduct([
      { product_id: 'a', quantity_milli: 2000 },
      { product_id: 'a', quantity_milli: 1000 },
      { product_id: 'b', quantity_milli: 0 },
    ]);
    expect(totals.get('a')).toBe(3000);
    expect(totals.has('b')).toBe(false);
  });

  it('computes what is still returnable', () => {
    const rows = returnableQuantities(map([['a', 3000]]), map([['a', 1000]]));
    expect(rows).toEqual([{
      product_id: 'a', sold_milli: 3000, returned_milli: 1000, remaining_milli: 2000,
    }]);
  });

  it('never lets the returned quantity exceed what was sold', () => {
    const [row] = returnableQuantities(map([['a', 1000]]), map([['a', 5000]]));
    expect(row.returned_milli).toBe(1000);
    expect(row.remaining_milli).toBe(0);
  });

  it('accepts a return within the sold quantity', () => {
    expect(validateReturn([{ product_id: 'a', quantity_milli: 2000 }], map([['a', 2000]])).ok).toBe(true);
  });

  it('refuses more than was sold, naming the line', () => {
    const result = validateReturn([{ product_id: 'a', quantity_milli: 3000 }], map([['a', 2000]]));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.refusals).toEqual([{
        product_id: 'a', requested_milli: 3000, remaining_milli: 2000, reason: 'exceeds_sold',
      }]);
    }
  });

  it('refuses a product that never left stock', () => {
    const result = validateReturn([{ product_id: 'z', quantity_milli: 1000 }], map([['a', 2000]]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals[0].reason).toBe('not_sold');
  });

  it('refuses a zero or negative quantity', () => {
    const result = validateReturn([{ product_id: 'a', quantity_milli: 0 }], map([['a', 2000]]));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals[0].reason).toBe('not_positive');
  });

  it('adds up two rows for the same product before applying the cap', () => {
    const result = validateReturn(
      [{ product_id: 'a', quantity_milli: 1500 }, { product_id: 'a', quantity_milli: 1000 }],
      map([['a', 2000]]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals[0].requested_milli).toBe(2500);
  });

  it('reports every refusal, not just the first', () => {
    const result = validateReturn(
      [
        { product_id: 'a', quantity_milli: 5000 },
        { product_id: 'z', quantity_milli: 1000 },
      ],
      map([['a', 2000]]),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refusals).toHaveLength(2);
  });
});
