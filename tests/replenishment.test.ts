import { describe, expect, it } from 'vitest';
import {
  expectedDate,
  groupBySupplier,
  proposalFor,
  purchaseUnitPrice,
  type ReplenishProduct,
} from '../server/lib/replenishment';

const product = (overrides: Partial<ReplenishProduct> = {}): ReplenishProduct => ({
  id: 'p1',
  name: 'Article',
  item_type: 'stockable',
  track_quantity: 1,
  replenish_mode: 'mrp',
  supplier_id: 'v1',
  supplier_name: 'Fournisseur',
  quantity_milli: 0,
  reorder_point_milli: 5000,
  safety_stock_milli: 0,
  max_stock_milli: 20_000,
  moq_milli: 0,
  order_multiple_milli: 0,
  lead_time_days: 7,
  purchase_price: 1200,
  cost: 1000,
  tax_rate: 0,
  ...overrides,
});

describe('purchase proposals', () => {
  it('buys up to the maximum once the threshold is reached', () => {
    const proposal = proposalFor(product({ quantity_milli: 5000 }));
    expect(proposal?.to_order_milli).toBe(15_000);
    expect(proposal?.reason).toBe('below_reorder_point');
  });

  it('stays silent while the shelf is above the threshold', () => {
    expect(proposalFor(product({ quantity_milli: 5001 }))).toBeNull();
  });

  it('rounds up to the vendor multiple and respects the minimum order', () => {
    const proposal = proposalFor(product({
      quantity_milli: 5000, max_stock_milli: 20_000, order_multiple_milli: 6000, moq_milli: 12_000,
    }));
    // 15 000 needed, rounded up to 18 000, above the 12 000 minimum.
    expect(proposal?.to_order_milli).toBe(18_000);
  });

  it('never falls below the minimum order quantity', () => {
    const proposal = proposalFor(product({ quantity_milli: 0, max_stock_milli: 4000, moq_milli: 10_000 }));
    expect(proposal?.to_order_milli).toBe(10_000);
  });

  it('names an empty shelf as a stock-out', () => {
    expect(proposalFor(product({ quantity_milli: 0 }))?.reason).toBe('out');
  });

  it('ignores a manual article, a service, an untracked one and one without vendor', () => {
    expect(proposalFor(product({ replenish_mode: 'manual' }))).toBeNull();
    expect(proposalFor(product({ item_type: 'service' }))).toBeNull();
    expect(proposalFor(product({ track_quantity: 0 }))).toBeNull();
    expect(proposalFor(product({ supplier_id: null }))).toBeNull();
  });

  it('does not trip a rule when there is no reorder point to cross', () => {
    expect(proposalFor(product({ reorder_point_milli: 0, quantity_milli: 0, max_stock_milli: 0 }))).toBeNull();
  });
});

describe('back-to-back proposals', () => {
  const backToBack = (overrides: Partial<ReplenishProduct> = {}) => product({
    replenish_mode: 'back_to_back', quantity_milli: 0, reorder_point_milli: 0, ...overrides,
  });

  it('buys only what a customer order needs', () => {
    const proposal = proposalFor(backToBack(), { demand_milli: 3000 });
    expect(proposal?.to_order_milli).toBe(3000);
    expect(proposal?.reason).toBe('customer_order');
  });

  it('subtracts what is already on the shelf', () => {
    expect(proposalFor(backToBack({ quantity_milli: 1000 }), { demand_milli: 3000 })?.to_order_milli).toBe(2000);
  });

  it('proposes nothing without demand, or when the shelf covers it', () => {
    expect(proposalFor(backToBack(), { demand_milli: 0 })).toBeNull();
    expect(proposalFor(backToBack({ quantity_milli: 2000 }), { demand_milli: 2000 })).toBeNull();
  });
});

describe('supplier groups', () => {
  it('groups proposals by vendor, sums quantities and keeps the longest lead time', () => {
    const groups = groupBySupplier([
      { ...proposalFor(product({ lead_time_days: 5, quantity_milli: 5000 }))!, supplier_id: 'v1', supplier_name: 'Bêta' },
      { ...proposalFor(product({ id: 'p2', lead_time_days: 12, quantity_milli: 5000 }))!, supplier_id: 'v1', supplier_name: 'Bêta' },
      { ...proposalFor(product({ id: 'p3', quantity_milli: 5000 }))!, supplier_id: 'v2', supplier_name: 'Alpha' },
    ]);
    expect(groups.map((group) => group.supplier_name)).toEqual(['Alpha', 'Bêta']);
    expect(groups[1].total_milli).toBe(30_000);
    expect(groups[1].lead_time_days).toBe(12);
  });

  it('takes the purchase price when there is one, else the cost', () => {
    expect(purchaseUnitPrice({ purchase_price: 1200, cost: 1000 })).toBe(1200);
    expect(purchaseUnitPrice({ purchase_price: 0, cost: 1000 })).toBe(1000);
  });

  it('dates the delivery from the longest lead time', () => {
    expect(expectedDate('2026-11-02', 7)).toBe('2026-11-09');
    expect(expectedDate('2026-11-02', 0)).toBe('2026-11-02');
  });
});
