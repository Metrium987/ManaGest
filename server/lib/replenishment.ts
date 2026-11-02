import { suggestedReorder } from '../../shared/product-erp';

/**
 * Purchase proposals (C1).
 *
 * Odoo's reordering rule is a min/max: when the forecast stock reaches the
 * minimum, replenish up to the maximum, rounding the quantity up to the vendor
 * multiple and never going below the minimum order quantity. That is exactly the
 * arithmetic `suggestedReorder` already performs on the product sheet, so the
 * proposal reuses it instead of inventing a second formula that would disagree
 * with the figure the buyer sees on the article.
 *
 * Two modes differ in what they mean:
 * - `mrp` keeps the shelf above its threshold, whatever the demand;
 * - `back_to_back` buys only what a customer order needs, because the goods are
 *   already sold and nothing should be stored (Odoo's MTO route).
 *
 * A `manual` article is never proposed: the buyer decided to handle it by hand,
 * and a suggestion list that ignores that decision becomes noise.
 */

export interface ReplenishProduct {
  id: string;
  name: string;
  item_type: string;
  track_quantity: number | boolean;
  replenish_mode: string | null;
  supplier_id: string | null;
  supplier_name?: string | null;
  quantity_milli: number;
  reorder_point_milli: number;
  safety_stock_milli: number;
  max_stock_milli: number;
  moq_milli: number;
  order_multiple_milli: number;
  lead_time_days: number;
  purchase_price: number;
  cost: number;
  tax_rate: number;
}

export type ProposalReason = 'out' | 'below_reorder_point' | 'customer_order';

export interface ReplenishProposal {
  product_id: string;
  name: string;
  supplier_id: string;
  supplier_name: string | null;
  on_hand_milli: number;
  to_order_milli: number;
  unit_price: number;
  tax_rate: number;
  lead_time_days: number;
  reorder_point_milli: number;
  max_stock_milli: number;
  reason: ProposalReason;
}

export interface ProposalOptions {
  /** Quantity already sold but not yet delivered, for a back-to-back article. */
  demand_milli?: number;
}

/**
 * Returns the proposal for one article, or null when there is nothing to buy.
 *
 * The trigger is the threshold, not the sign of the stock: an article sitting at
 * zero with a zero reorder point has no rule to trip, and buying it would be an
 * opinion rather than a calculation.
 */
export function proposalFor(
  product: ReplenishProduct,
  options: ProposalOptions = {},
): ReplenishProposal | null {
  if (product.item_type === 'service') return null;
  if (!product.track_quantity) return null;
  if (!product.supplier_id) return null;
  const mode = product.replenish_mode ?? 'manual';
  if (mode === 'manual') return null;

  const onHand = Math.round(Number(product.quantity_milli ?? 0));

  if (mode === 'back_to_back') {
    const demand = Math.max(0, Math.round(Number(options.demand_milli ?? 0)));
    if (demand <= 0) return null;
    // The goods are already sold: buy the gap, not the shelf level.
    const toOrder = Math.max(0, demand - Math.max(0, onHand));
    if (toOrder <= 0) return null;
    return {
      product_id: product.id,
      name: product.name,
      supplier_id: product.supplier_id,
      supplier_name: product.supplier_name ?? null,
      on_hand_milli: onHand,
      to_order_milli: toOrder,
      unit_price: purchaseUnitPrice(product),
      tax_rate: Number(product.tax_rate ?? 0),
      lead_time_days: Number(product.lead_time_days ?? 0),
      reorder_point_milli: Number(product.reorder_point_milli ?? 0),
      max_stock_milli: Number(product.max_stock_milli ?? 0),
      reason: 'customer_order',
    };
  }

  const reorderPoint = Number(product.reorder_point_milli ?? 0);
  if (onHand > reorderPoint) return null;

  const toOrder = suggestedReorder({
    track_quantity: product.track_quantity,
    quantity_milli: onHand,
    reorder_point_milli: reorderPoint,
    safety_stock_milli: Number(product.safety_stock_milli ?? 0),
    max_stock_milli: Number(product.max_stock_milli ?? 0),
    moq_milli: Number(product.moq_milli ?? 0),
    order_multiple_milli: Number(product.order_multiple_milli ?? 0),
  });
  if (toOrder <= 0) return null;

  return {
    product_id: product.id,
    name: product.name,
    supplier_id: product.supplier_id,
    supplier_name: product.supplier_name ?? null,
    on_hand_milli: onHand,
    to_order_milli: toOrder,
    unit_price: purchaseUnitPrice(product),
    tax_rate: Number(product.tax_rate ?? 0),
    lead_time_days: Number(product.lead_time_days ?? 0),
    reorder_point_milli: reorderPoint,
    max_stock_milli: Number(product.max_stock_milli ?? 0),
    reason: onHand <= 0 ? 'out' : 'below_reorder_point',
  };
}

/** What the vendor last charged, else what the goods cost us: never a zero price. */
export function purchaseUnitPrice(product: Pick<ReplenishProduct, 'purchase_price' | 'cost'>): number {
  const purchase = Math.max(0, Math.round(Number(product.purchase_price ?? 0)));
  return purchase > 0 ? purchase : Math.max(0, Math.round(Number(product.cost ?? 0)));
}

export interface SupplierGroup {
  supplier_id: string;
  supplier_name: string | null;
  proposals: ReplenishProposal[];
  total_milli: number;
  lead_time_days: number;
}

/** One draft per vendor, ordered by name, so the buyer works supplier by supplier. */
export function groupBySupplier(proposals: ReplenishProposal[]): SupplierGroup[] {
  const groups = new Map<string, SupplierGroup>();
  for (const proposal of proposals) {
    const group = groups.get(proposal.supplier_id) ?? {
      supplier_id: proposal.supplier_id,
      supplier_name: proposal.supplier_name,
      proposals: [],
      total_milli: 0,
      lead_time_days: 0,
    };
    group.proposals.push(proposal);
    group.total_milli += proposal.to_order_milli;
    group.lead_time_days = Math.max(group.lead_time_days, proposal.lead_time_days);
    groups.set(proposal.supplier_id, group);
  }
  return [...groups.values()].sort((a, b) =>
    (a.supplier_name ?? '').localeCompare(b.supplier_name ?? ''),
  );
}

/** Expected delivery: the longest lead time of the group wins, not the average —
 * a purchase order is only as fast as its slowest line. */
export function expectedDate(today: string, leadTimeDays: number): string {
  const date = new Date(`${today}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.round(Number(leadTimeDays ?? 0))));
  return date.toISOString().slice(0, 10);
}
