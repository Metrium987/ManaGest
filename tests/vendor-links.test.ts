import { describe, expect, it } from 'vitest';
import {
  applyVendorPrices,
  moqShortfall,
  preferredLink,
  productIdsOf,
  unitPriceFor,
  type VendorLink,
} from '../server/lib/vendor-links';

const link = (overrides: Partial<VendorLink> = {}): VendorLink => ({
  product_id: 'p1',
  vendor_id: 'v1',
  price: 1000,
  currency: 'XPF',
  moq_milli: 0,
  lead_time_days: 7,
  vendor_ref: null,
  is_preferred: 0,
  ...overrides,
});

describe('vendor prices', () => {
  it('fills an empty price from the chosen vendor', () => {
    const [line] = applyVendorPrices([{ product_id: 'p1', unit_price: 0 }], [link()], 'v1');
    expect(line.unit_price).toBe(1000);
  });

  it('never overwrites a price already stated on the line', () => {
    const [line] = applyVendorPrices([{ product_id: 'p1', unit_price: 850 }], [link()], 'v1');
    expect(line.unit_price).toBe(850);
  });

  it('ignores a link belonging to another vendor', () => {
    const [line] = applyVendorPrices([{ product_id: 'p1', unit_price: 0 }], [link({ vendor_id: 'v2' })], 'v1');
    expect(line.unit_price).toBe(0);
  });

  it('leaves a free-text line alone', () => {
    const [line] = applyVendorPrices([{ product_id: null, unit_price: 0 }], [link()], 'v1');
    expect(line.unit_price).toBe(0);
  });

  it('falls back when the vendor quoted nothing usable', () => {
    expect(unitPriceFor(link({ price: 0 }), 900)).toBe(900);
    expect(unitPriceFor(undefined, 900)).toBe(900);
  });

  it('collects the product ids of the lines once', () => {
    expect(productIdsOf([{ product_id: 'a' }, { product_id: 'a' }, { product_id: null }, { product_id: 'b' }]))
      .toEqual(['a', 'b']);
  });
});

describe('preferred vendor', () => {
  it('asks the flagged vendor first, even when dearer', () => {
    const chosen = preferredLink([
      link({ vendor_id: 'cheap', price: 800 }),
      link({ vendor_id: 'trusted', price: 1200, is_preferred: 1 }),
    ]);
    expect(chosen?.vendor_id).toBe('trusted');
  });

  it('falls back to the cheapest, then the fastest', () => {
    expect(preferredLink([
      link({ vendor_id: 'a', price: 1000, lead_time_days: 5 }),
      link({ vendor_id: 'b', price: 800, lead_time_days: 20 }),
    ])?.vendor_id).toBe('b');
    expect(preferredLink([
      link({ vendor_id: 'a', price: 1000, lead_time_days: 12 }),
      link({ vendor_id: 'b', price: 1000, lead_time_days: 4 }),
    ])?.vendor_id).toBe('b');
  });

  it('returns null when no vendor is linked', () => {
    expect(preferredLink([])).toBeNull();
  });
});

describe('minimum order quantity', () => {
  it('reports the shortfall below the vendor minimum', () => {
    expect(moqShortfall(link({ moq_milli: 5000 }), 2000)).toBe(3000);
    expect(moqShortfall(link({ moq_milli: 5000 }), 5000)).toBe(0);
    expect(moqShortfall(link({ moq_milli: 5000 }), 9000)).toBe(0);
  });

  it('has no opinion without a minimum', () => {
    expect(moqShortfall(undefined, 1000)).toBe(0);
    expect(moqShortfall(link({ moq_milli: 0 }), 1)).toBe(0);
  });
});
