import { describe, expect, it } from 'vitest';
import { alertCounts, alertDigest, stockAlertRows, type AlertProduct } from '../server/lib/stock-alerting';

const product = (overrides: Partial<AlertProduct> = {}): AlertProduct => ({
  id: 'p1',
  name: 'Article',
  quantity_milli: 0,
  track_quantity: 1,
  reorder_point_milli: 5000,
  safety_stock_milli: 0,
  max_stock_milli: 20_000,
  moq_milli: 0,
  order_multiple_milli: 0,
  supplier_name: 'Fournisseur',
  ...overrides,
});

describe('stock alerts', () => {
  it('keeps only what is out or low, and orders stock-outs first', () => {
    const rows = stockAlertRows([
      product({ id: 'low', name: 'B', quantity_milli: 2000 }),
      product({ id: 'ok', name: 'C', quantity_milli: 50_000 }),
      product({ id: 'out', name: 'A', quantity_milli: 0 }),
    ]);
    expect(rows.map((row) => row.product_id)).toEqual(['out', 'low']);
    expect(rows[0].level).toBe('out');
  });

  it('reuses the article formula for the suggested quantity', () => {
    const [row] = stockAlertRows([product({ quantity_milli: 3000, max_stock_milli: 20_000, order_multiple_milli: 6000 })]);
    // 17 000 needed, rounded up to the vendor multiple.
    expect(row.suggested_milli).toBe(18_000);
  });

  it('ignores an untracked article and a service', () => {
    expect(stockAlertRows([product({ track_quantity: 0 })])).toEqual([]);
  });

  it('counts stock-outs, low stock and the total to order', () => {
    const rows = stockAlertRows([
      product({ id: 'a', quantity_milli: 0 }),
      product({ id: 'b', quantity_milli: 1000 }),
    ]);
    // 20 000 for the empty shelf + 19 000 for the one sitting at 1 000.
    expect(alertCounts(rows)).toEqual({ out: 1, low: 1, suggested_milli: 39_000 });
  });
});

describe('daily digest', () => {
  it('names the articles instead of only counting them', () => {
    const digest = alertDigest(stockAlertRows([product({ name: 'Vis 30', quantity_milli: 0 })]), 'ManaGest');
    expect(digest?.subject).toContain('1 rupture(s)');
    expect(digest?.text).toContain('Vis 30');
    expect(digest?.text).toContain('RUPTURE');
    expect(digest?.text).toContain('Fournisseur');
  });

  it('says nothing when nothing is wrong', () => {
    expect(alertDigest([], 'ManaGest')).toBeNull();
  });
});
