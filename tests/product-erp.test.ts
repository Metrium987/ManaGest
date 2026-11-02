import { describe, expect, it } from 'vitest';
import {
  discountForQuantity,
  kitAvailability,
  landedCost,
  marginRate,
  stockAlert,
  suggestedReorder,
} from '../shared/product-erp';

describe('fiche article ERP', () => {
  it('calcule le taux de marge sur prix de vente', () => {
    expect(marginRate(10_000, 6_000)).toBe(40);
    expect(marginRate(0, 6_000)).toBeNull();
  });

  it('additionne le coût de revient rendu Tahiti', () => {
    expect(landedCost({ purchase: 1000, freight: 250, insurance: 50, duties: 400, fees: 25 })).toBe(1725);
    expect(landedCost({ purchase: 1000 })).toBe(1000);
  });

  it('distingue rupture, stock faible et article suivi ou non', () => {
    expect(stockAlert({ track_quantity: 0, quantity_milli: 0 })).toBe('none');
    expect(stockAlert({ track_quantity: 1, quantity_milli: 0, reorder_point_milli: 5000 })).toBe('out');
    expect(stockAlert({ track_quantity: 1, quantity_milli: 3000, reorder_point_milli: 5000 })).toBe('low');
    expect(stockAlert({ track_quantity: 1, quantity_milli: 9000, reorder_point_milli: 5000 })).toBe('ok');
  });

  it('propose une quantité de réapprovisionnement arrondie au multiple et au MOQ', () => {
    // target = max(20000, 5000+2000) = 20000 ; manque 18000 ; multiple 6000 -> 18000
    expect(suggestedReorder({
      track_quantity: 1, quantity_milli: 2000, reorder_point_milli: 5000,
      safety_stock_milli: 2000, max_stock_milli: 20000, moq_milli: 4000,
      order_multiple_milli: 6000,
    })).toBe(18000);
    // le MOQ relève une commande trop petite
    expect(suggestedReorder({
      track_quantity: 1, quantity_milli: 9000, reorder_point_milli: 5000,
      max_stock_milli: 10000, moq_milli: 6000,
    })).toBe(6000);
    // rien à commander au-dessus du seuil
    expect(suggestedReorder({
      track_quantity: 1, quantity_milli: 30000, reorder_point_milli: 5000, max_stock_milli: 20000,
    })).toBe(0);
    expect(suggestedReorder({ track_quantity: 0, quantity_milli: 0 })).toBe(0);
  });

  it('calcule combien de kits les composants permettent de monter', () => {
    const stock = { a: 10_000, b: 5_000 };
    expect(kitAvailability([{ product_id: 'a', quantity: 2 }, { product_id: 'b', quantity: 1 }], stock)).toBe(5);
    expect(kitAvailability([], stock)).toBeNull();
    expect(kitAvailability([{ product_id: 'absent', quantity: 1 }], stock)).toBe(0);
  });

  it('retient la meilleure remise volumique applicable', () => {
    const rules = [
      { min_quantity: 10, percent: 5 },
      { min_quantity: 50, percent: 12 },
    ];
    expect(discountForQuantity(rules, 1)).toBe(0);
    expect(discountForQuantity(rules, 12)).toBe(5);
    expect(discountForQuantity(rules, 60)).toBe(12);
  });
});
