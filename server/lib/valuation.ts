/**
 * Stock valuation, pure side (B3).
 *
 * The weighted average cost (CMP) is recalculated on every inbound movement
 * that carries a known unit cost — the classic "prix moyen pondéré après
 * chaque entrée" used by French accounting practice (PCG art. 213-3 allows it
 * for interchangeable items). An outbound movement never changes the average:
 * it leaves at the cost the stock already had. That is what makes the stock
 * value and the margin consistent with each other.
 *
 * Quantities are thousandths and costs are minor currency units, as everywhere
 * in the app, so the product of the two is scaled by 1000 and must be divided
 * back before being written anywhere.
 */

export interface AverageCostInput {
  /** Book quantity before the movement, in thousandths. */
  quantity_milli: number;
  /** Current weighted average, in minor currency units per unit. */
  cost: number;
  /** Quantity entering, in thousandths. */
  inbound_milli: number;
  /** Unit cost of the entering goods, in minor currency units. */
  inbound_unit_cost: number;
}

export interface AverageCostResult {
  quantity_after_milli: number;
  cost: number;
  /** Stock value after the movement, in minor currency units. */
  value_after: number;
}

/** Value of a quantity at a unit cost, rounded to the minor unit. */
export function stockValue(quantityMilli: number, unitCost: number): number {
  const quantity = Number(quantityMilli) || 0;
  const cost = Number(unitCost) || 0;
  return Math.round((quantity * cost) / 1000);
}

/**
 * Weighted average after an inbound movement.
 *
 * Two edge cases matter: a movement with no quantity or no cost must not move
 * the average (a zero-priced receipt would otherwise crush the valuation), and
 * a product whose book quantity is zero or negative restarts its average from
 * the incoming cost instead of averaging against a phantom stock.
 */
export function weightedAverageCost(input: AverageCostInput): AverageCostResult {
  const quantity = Math.round(Number(input.quantity_milli) || 0);
  const cost = Math.round(Number(input.cost) || 0);
  const inbound = Math.round(Number(input.inbound_milli) || 0);
  const inboundCost = Math.round(Number(input.inbound_unit_cost) || 0);

  if (inbound <= 0 || inboundCost <= 0) {
    return {
      quantity_after_milli: quantity,
      cost,
      value_after: stockValue(quantity, cost),
    };
  }

  const quantityAfter = quantity + inbound;
  if (quantity <= 0) {
    return { quantity_after_milli: quantityAfter, cost: inboundCost, value_after: stockValue(quantityAfter, inboundCost) };
  }

  const valueBefore = stockValue(quantity, cost);
  const valueIn = stockValue(inbound, inboundCost);
  const nextCost = Math.round((valueBefore + valueIn) / (quantityAfter / 1000));
  return { quantity_after_milli: quantityAfter, cost: nextCost, value_after: stockValue(quantityAfter, nextCost) };
}

/**
 * Unit cost used when goods enter stock. The landed cost typed on the sheet
 * wins over the purchase price: freight, insurance, customs and handling are
 * part of what the goods cost. Itemising them (and computing them) is F4; until
 * then the sheet carries a single landed figure.
 */
export function landedUnitCost(input: { landed_cost?: number | null; unit_price?: number | null }): number {
  const landed = Math.round(Number(input.landed_cost) || 0);
  if (landed > 0) return landed;
  return Math.round(Number(input.unit_price) || 0);
}

/** Difference between what the books say the stock is worth and what a physical
 * count says it is worth. Positive means the shelf is worth more than the books. */
export function valuationVariance(bookValue: number, physicalValue: number): number {
  return Math.round(Number(physicalValue) || 0) - Math.round(Number(bookValue) || 0);
}
