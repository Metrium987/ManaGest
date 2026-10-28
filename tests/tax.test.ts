import { describe, expect, it } from 'vitest';
import { computeTotals, type LineItem } from '../shared/tax';
import { currencyDecimals, toMinor, fromMinor, roundMinor } from '../shared/money';

const line = (overrides: Partial<LineItem> = {}): LineItem => ({
  id: 'line-1',
  description: 'Prestation',
  quantity: 1,
  unit_price: 100_000,
  tax_rate: 16,
  ...overrides,
});

describe('computeTotals', () => {
  it('applies TVA 16% on a single line', () => {
    const totals = computeTotals([line()], { discount_type: 'percent', discount_value: 0 }, false);
    expect(totals.subtotal).toBe(100_000);
    expect(totals.tax_total).toBe(16_000);
    expect(totals.total).toBe(116_000);
    expect(totals.tax_buckets).toEqual([{ rate: 16, base: 100_000, amount: 16_000 }]);
  });

  it('spreads a percentage discount before tax', () => {
    const totals = computeTotals(
      [line({ quantity: 2, unit_price: 85_000 })],
      { discount_type: 'percent', discount_value: 500 },
      false,
    );
    expect(totals.subtotal).toBe(170_000);
    expect(totals.discount_total).toBe(8_500);
    expect(totals.tax_total).toBe(25_840);
    expect(totals.total).toBe(187_340);
  });

  it('splits a fixed discount proportionally across tax buckets', () => {
    const totals = computeTotals(
      [
        line({ id: 'a', quantity: 1, unit_price: 100_000, tax_rate: 16 }),
        line({ id: 'b', quantity: 1, unit_price: 100_000, tax_rate: 5 }),
      ],
      { discount_type: 'amount', discount_value: 20_000 },
      false,
    );
    expect(totals.discount_total).toBe(20_000);
    const buckets = Object.fromEntries(totals.tax_buckets.map((b) => [b.rate, b]));
    expect(buckets[16].base).toBe(90_000);
    expect(buckets[16].amount).toBe(14_400);
    expect(buckets[5].base).toBe(90_000);
    expect(buckets[5].amount).toBe(4_500);
    expect(totals.total).toBe(198_900);
  });

  it('never allocates more discount than the subtotal', () => {
    const totals = computeTotals(
      [line({ unit_price: 10_000 })],
      { discount_type: 'amount', discount_value: 99_000 },
      false,
    );
    expect(totals.discount_total).toBe(10_000);
    expect(totals.tax_total).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('zeroes tax for exempt clients', () => {
    const totals = computeTotals([line()], { discount_type: 'percent', discount_value: 0 }, true);
    expect(totals.tax_total).toBe(0);
    expect(totals.total).toBe(100_000);
    expect(totals.tax_buckets.every((bucket) => bucket.amount === 0)).toBe(true);
  });

  it('ignores negative quantities and prices defensively', () => {
    const totals = computeTotals(
      [line({ quantity: -3, unit_price: -500 })],
      { discount_type: 'percent', discount_value: 0 },
      false,
    );
    expect(totals.subtotal).toBe(0);
    expect(totals.total).toBe(0);
  });

  it('keeps the total consistent when rounding thirds', () => {
    const totals = computeTotals(
      [line({ quantity: 1, unit_price: 33_333 }), line({ id: 'b', quantity: 1, unit_price: 33_333 })],
      { discount_type: 'percent', discount_value: 3333 },
      false,
    );
    expect(Number.isInteger(totals.total)).toBe(true);
    expect(totals.discount_total).toBeLessThanOrEqual(totals.subtotal);
  });
});

describe('money helpers', () => {
  it('uses zero decimals for XPF', () => {
    expect(currencyDecimals('XPF')).toBe(0);
    expect(toMinor(1500, 'XPF')).toBe(1500);
    expect(fromMinor(1500, 'XPF')).toBe(1500);
  });

  it('uses two decimals for EUR', () => {
    expect(currencyDecimals('EUR')).toBe(2);
    expect(toMinor(12.345, 'EUR')).toBe(1235);
    expect(fromMinor(1235, 'EUR')).toBe(12.35);
  });

  it('rounds half away from zero', () => {
    expect(roundMinor(2.5)).toBe(3);
    expect(roundMinor(-2.5)).toBe(-3);
  });
});
