import { describe, expect, it } from 'vitest';
import { linePriceFor, tierPrice } from '../shared/product-erp';
import { applyClientPricing } from '../server/lib/client-pricing';

const article = {
  id: 'p1',
  unit_price: 1000,
  price_pro: 850,
  price_member: 700,
  volume_discounts: [{ min_quantity: 10, percent: 5 }],
};

describe('tier prices', () => {
  it('gives each tier its own price', () => {
    expect(tierPrice(article, 'public')).toBe(1000);
    expect(tierPrice(article, 'pro')).toBe(850);
    expect(tierPrice(article, 'member')).toBe(700);
  });

  it('falls back to the public price when a tier is unset', () => {
    expect(tierPrice({ unit_price: 1000, price_pro: 0, price_member: null }, 'pro')).toBe(1000);
    expect(tierPrice({ unit_price: 1000 }, null)).toBe(1000);
  });

  it('applies the volume step on top of the tier price', () => {
    expect(linePriceFor(article, 'pro', 10)).toBe(808); // 850 − 5 %
    expect(linePriceFor(article, 'pro', 9)).toBe(850);
    expect(linePriceFor(article, 'member', 1)).toBe(700);
  });
});

describe('applying a client grid to document lines', () => {
  const products = new Map([['p1', article]]);

  it('fills the price of a line that has none', () => {
    const [line] = applyClientPricing(
      [{ product_id: 'p1', quantity: 1, unit_price: 0 }],
      products,
      'pro',
    );
    expect(line.unit_price).toBe(850);
  });

  it('never overwrites a price already agreed on the line', () => {
    const [line] = applyClientPricing(
      [{ product_id: 'p1', quantity: 1, unit_price: 640 }],
      products,
      'member',
    );
    expect(line.unit_price).toBe(640);
  });

  it('leaves a free-text line and an unknown product alone', () => {
    const lines = applyClientPricing(
      [{ product_id: null, quantity: 1, unit_price: 0 }, { product_id: 'ghost', quantity: 1, unit_price: 0 }],
      products,
      'pro',
    );
    expect(lines.map((line) => line.unit_price)).toEqual([0, 0]);
  });
});
