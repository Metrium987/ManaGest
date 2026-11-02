import { describe, expect, it } from 'vitest';
import { explodeKit } from '../shared/product-erp';

describe('explodeKit', () => {
  const bom = [
    { product_id: 'A', quantity: 2 },
    { product_id: 'B', quantity: 0.5 },
  ];

  it('multiplies every component by the number of kits', () => {
    expect(explodeKit(bom, 3000)).toEqual([
      { product_id: 'A', quantity_milli: 6000 },
      { product_id: 'B', quantity_milli: 1500 },
    ]);
  });

  it('keeps thousandths exact on a fractional kit quantity', () => {
    expect(explodeKit([{ product_id: 'B', quantity: 0.5 }], 500)).toEqual([
      { product_id: 'B', quantity_milli: 250 },
    ]);
  });

  it('drops zero lines so no empty movement is written', () => {
    expect(explodeKit(bom, 0)).toEqual([]);
    expect(explodeKit([{ product_id: 'C', quantity: 0 }], 5000)).toEqual([]);
  });

  it('returns nothing for a kit without components', () => {
    expect(explodeKit([], 1000)).toEqual([]);
  });
});
