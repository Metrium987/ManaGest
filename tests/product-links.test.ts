import { describe, expect, it } from 'vitest';
import { groupProductLinks } from '../server/lib/product-links';

const row = (kind: string, id: string, name: string, quantity: number, track = 1) => ({
  product_id: 'a', kind, id, name, product_key: null, unit_price: 1000, quantity_milli: quantity, track_quantity: track,
});

describe('product links', () => {
  it('separates substitutes from accessories', () => {
    const grouped = groupProductLinks([row('substitute', 'b', 'Pain', 4000), row('accessory', 'c', 'Beurre', 0)]);
    expect(grouped.substitutes.map((item) => item.name)).toEqual(['Pain']);
    expect(grouped.accessories.map((item) => item.name)).toEqual(['Beurre']);
  });

  it('knows whether a linked article is available', () => {
    const grouped = groupProductLinks([row('substitute', 'b', 'Pain', 0), row('substitute', 'c', 'Farine', 5000)]);
    expect(grouped.substitutes.map((item) => item.in_stock)).toEqual([false, true]);
  });

  it('treats an untracked article as available, not as missing', () => {
    const grouped = groupProductLinks([row('substitute', 'd', 'Conseil', 0, 0)]);
    expect(grouped.substitutes[0].in_stock).toBe(true);
  });

  it('returns empty buckets when an article has no links', () => {
    expect(groupProductLinks([])).toEqual({ substitutes: [], accessories: [] });
  });
});
