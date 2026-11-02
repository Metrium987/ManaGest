import { describe, expect, it } from 'vitest';
import {
  landedUnitCost,
  stockValue,
  valuationVariance,
  weightedAverageCost,
} from '../server/lib/valuation';

describe('stock valuation (B3)', () => {
  it('values a quantity at its unit cost in minor units', () => {
    expect(stockValue(10_000, 150)).toBe(1500);
    expect(stockValue(2_500, 99)).toBe(248);
  });

  it('averages a second receipt into the existing cost', () => {
    // 10 units at 100 then 10 units at 200 => 150.
    const result = weightedAverageCost({
      quantity_milli: 10_000, cost: 100, inbound_milli: 10_000, inbound_unit_cost: 200,
    });
    expect(result.cost).toBe(150);
    expect(result.quantity_after_milli).toBe(20_000);
    expect(result.value_after).toBe(3000);
  });

  it('weights by quantity, not by number of receipts', () => {
    // 30 units at 100 plus 10 units at 200 => 125.
    const result = weightedAverageCost({
      quantity_milli: 30_000, cost: 100, inbound_milli: 10_000, inbound_unit_cost: 200,
    });
    expect(result.cost).toBe(125);
  });

  it('restarts the average when the book quantity is zero', () => {
    const result = weightedAverageCost({
      quantity_milli: 0, cost: 900, inbound_milli: 5_000, inbound_unit_cost: 200,
    });
    expect(result.cost).toBe(200);
  });

  it('ignores a movement without quantity or without cost', () => {
    const empty = weightedAverageCost({ quantity_milli: 10_000, cost: 100, inbound_milli: 0, inbound_unit_cost: 500 });
    expect(empty.cost).toBe(100);
    const free = weightedAverageCost({ quantity_milli: 10_000, cost: 100, inbound_milli: 5_000, inbound_unit_cost: 0 });
    expect(free.cost).toBe(100);
    expect(free.quantity_after_milli).toBe(10_000);
  });

  it('prefers the landed cost over the purchase price', () => {
    expect(landedUnitCost({ landed_cost: 250, unit_price: 100 })).toBe(250);
    expect(landedUnitCost({ landed_cost: 0, unit_price: 100 })).toBe(100);
    expect(landedUnitCost({})).toBe(0);
  });

  it('reports the gap between book value and physical value', () => {
    expect(valuationVariance(1500, 1200)).toBe(-300);
    expect(valuationVariance(1500, 1500)).toBe(0);
  });
});
