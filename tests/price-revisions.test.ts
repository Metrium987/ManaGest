import { describe, expect, it } from 'vitest';
import { effectiveRate, lineTotal, reviseLines } from '../server/lib/price-revisions';

describe('price revisions', () => {
  it('raises every line by the rate', () => {
    const lines = reviseLines([{ unit_price: 120000, quantity: 1 }, { unit_price: 5000, quantity: 3 }], 250);
    expect(lines.map((line) => line.unit_price)).toEqual([123000, 5125]);
  });

  it('rounds to the nearest franc, not down', () => {
    expect(reviseLines([{ unit_price: 1001, quantity: 1 }], 250)[0].unit_price).toBe(1026);
  });

  it('leaves prices alone for a zero rate', () => {
    expect(reviseLines([{ unit_price: 1000, quantity: 1 }], 0)[0].unit_price).toBe(1000);
  });

  it('totals the document at the new prices', () => {
    expect(lineTotal([{ unit_price: 123000, quantity: 1 }, { unit_price: 5125, quantity: 2 }])).toBe(133250);
  });

  it('reports the rate it really applied, after rounding', () => {
    expect(effectiveRate(120000, 123000)).toBe(250);
    expect(effectiveRate(0, 5000)).toBe(0);
  });
});
