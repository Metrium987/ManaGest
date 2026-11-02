/**
 * ERP item sheet vocabulary and pure calculations, shared by the API and the UI.
 *
 * The fiche article is the same object everywhere: a catalogue entry for sales,
 * a stockable row for the WMS, a valuation object for accounting. Keeping the
 * enums and the derived numbers here means the screen, the API and the tests
 * cannot drift apart.
 */

import { localised } from './labels-locale';

export const ITEM_TYPES = ['stockable', 'consumable', 'service', 'kit'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export const ITEM_TYPE_LABELS: Record<ItemType, string> = localised({
  stockable: 'Marchandise / produit fini',
  consumable: 'Consommable',
  service: 'Service',
  kit: 'Kit / assemblage',
}, {
  stockable: 'Goods / finished product',
  consumable: 'Consumable',
  service: 'Service',
  kit: 'Kit / assembly',
});

export const LIFECYCLE_STATUSES = [
  'active', 'inactive', 'end_of_life', 'blocked_purchase', 'obsolete',
] as const;
export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];
export const LIFECYCLE_LABELS: Record<LifecycleStatus, string> = localised({
  active: 'Actif',
  inactive: 'Inactif',
  end_of_life: 'Fin de vie',
  blocked_purchase: 'Bloqué à l’achat',
  obsolete: 'Obsolète',
}, {
  active: 'Active',
  inactive: 'Inactive',
  end_of_life: 'End of life',
  blocked_purchase: 'Blocked for purchase',
  obsolete: 'Obsolete',
});

/** How the quantity is followed: simple count, lot or serial traceability, and
 * the rotation rule the warehouse must apply when picking. */
export const STOCK_MODES = ['simple', 'lot', 'serial', 'fifo', 'lifo', 'fefo'] as const;
export type StockMode = (typeof STOCK_MODES)[number];
export const STOCK_MODE_LABELS: Record<StockMode, string> = localised({
  simple: 'À la pièce (quantité simple)',
  lot: 'Par numéro de lot',
  serial: 'Par numéro de série',
  fifo: 'FIFO (premier entré, premier sorti)',
  lifo: 'LIFO (dernier entré, premier sorti)',
  fefo: 'FEFO (premier expiré, premier sorti)',
}, {
  simple: 'Per unit (simple quantity)',
  lot: 'By lot number',
  serial: 'By serial number',
  fifo: 'FIFO (first in, first out)',
  lifo: 'LIFO (last in, first out)',
  fefo: 'FEFO (first expired, first out)',
});

/** Stock valuation. `landed` is the Tahiti landed cost: purchase + freight +
 * insurance + customs duties + approach fees. */
export const VALUATION_METHODS = ['cmp', 'standard', 'last_purchase', 'landed'] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];
export const VALUATION_METHOD_LABELS: Record<ValuationMethod, string> = localised({
  cmp: 'Coût moyen pondéré (CMP)',
  standard: 'Coût standard / théorique',
  last_purchase: 'Dernier prix d’achat (DPA)',
  landed: 'Coût de revient rendu Tahiti',
}, {
  cmp: 'Weighted average cost (WAC)',
  standard: 'Standard / theoretical cost',
  last_purchase: 'Last purchase price',
  landed: 'Landed cost in Tahiti',
});

// D1: a customer buys at one of three published prices. Odoo models this with a
// pricelist per customer; the tier is the same idea reduced to the three prices
// the article sheet already carries.
export const PRICE_TIERS = ['public', 'pro', 'member'] as const;
export type PriceTier = (typeof PRICE_TIERS)[number];
export const PRICE_TIER_LABELS: Record<PriceTier, string> = localised({
  public: 'Prix public',
  pro: 'Prix professionnel',
  member: 'Prix adhérent',
}, {
  public: 'Retail price',
  pro: 'Trade price',
  member: 'Member price',
});

/** The price of the tier, falling back to the public price when it is unset. */
export function tierPrice(
  product: { unit_price: number; price_pro?: number | null; price_member?: number | null },
  tier: string | null | undefined,
): number {
  const base = Math.max(0, Math.round(Number(product.unit_price ?? 0)));
  const pro = Math.max(0, Math.round(Number(product.price_pro ?? 0)));
  const member = Math.max(0, Math.round(Number(product.price_member ?? 0)));
  if (tier === 'pro') return pro > 0 ? pro : base;
  if (tier === 'member') return member > 0 ? member : base;
  return base;
}

/**
 * The line price: the tier price, then the volume step for the quantity, so a
 * professional buying ten gets both the professional price and the palier —
 * applying only one of the two would quietly overcharge the best customers.
 */
export function linePriceFor(
  product: {
    unit_price: number; price_pro?: number | null; price_member?: number | null;
    volume_discounts?: { min_quantity: number; percent: number }[] | null;
  },
  tier: string | null | undefined,
  quantity: number,
): number {
  const base = tierPrice(product, tier);
  const percent = Math.min(100, Math.max(0, discountForQuantity(product.volume_discounts ?? [], quantity)));
  return Math.round(base * (1 - percent / 100));
}

/** D2: the price of an expertise level, or null when the sheet has no such level. */
export function expertisePrice(
  levels: { level: string; price: number }[] | null | undefined,
  level: string | null | undefined,
): number | null {
  if (!level) return null;
  const match = (levels ?? []).find((entry) => entry.level === level);
  if (!match) return null;
  const price = Math.round(Number(match.price ?? 0));
  return price > 0 ? price : null;
}

export const REPLENISH_MODES = ['manual', 'mrp', 'back_to_back'] as const;
export type ReplenishMode = (typeof REPLENISH_MODES)[number];
export const REPLENISH_MODE_LABELS: Record<ReplenishMode, string> = localised({
  manual: 'Manuel',
  mrp: 'Règles automatisées (MRP)',
  back_to_back: 'Sur commande client (back-to-back)',
}, {
  manual: 'Manual',
  mrp: 'Automated rules (MRP)',
  back_to_back: 'On customer order (back-to-back)',
});

export const BOM_MODES = ['on_order', 'in_stock'] as const;
export type BomMode = (typeof BOM_MODES)[number];
export const BOM_MODE_LABELS: Record<BomMode, string> = localised({
  on_order: 'Assemblage à la commande',
  in_stock: 'Assemblage en stock (fabrication préalable)',
}, {
  on_order: 'Assemble to order',
  in_stock: 'Assemble to stock (pre-built)',
});

export type StockAlert = 'out' | 'low' | 'ok' | 'none';

/**
 * Margin as a percentage of the selling price (taux de marge sur prix de vente),
 * rounded to one decimal. Returns null when there is no selling price, so the UI
 * can show a dash instead of an infinite number.
 */
export function marginRate(priceMinor: number, costMinor: number): number | null {
  if (!Number.isFinite(priceMinor) || priceMinor <= 0) return null;
  return Math.round(((priceMinor - costMinor) / priceMinor) * 1000) / 10;
}

/** Landed cost in minor units: every import cost lands in the stock value. */
export function landedCost(input: {
  purchase: number;
  freight?: number;
  insurance?: number;
  duties?: number;
  fees?: number;
}): number {
  const total = input.purchase
    + (input.freight ?? 0)
    + (input.insurance ?? 0)
    + (input.duties ?? 0)
    + (input.fees ?? 0);
  return Math.max(0, Math.round(total));
}

type StockRow = {
  track_quantity: number | boolean;
  quantity_milli: number;
  reorder_point_milli?: number;
};

/** Out of stock wins over low stock: they trigger different actions. */
export function stockAlert(product: StockRow): StockAlert {
  if (!product.track_quantity) return 'none';
  if (product.quantity_milli <= 0) return 'out';
  if (product.quantity_milli <= (product.reorder_point_milli ?? 0)) return 'low';
  return 'ok';
}

/**
 * Quantity to order, in milli-units: enough to reach the maximum stock, at least
 * the reorder point plus safety stock, rounded up to the supplier multiple and
 * never below the minimum order quantity.
 */
export function suggestedReorder(product: {
  track_quantity: number | boolean;
  quantity_milli: number;
  reorder_point_milli?: number;
  safety_stock_milli?: number;
  max_stock_milli?: number;
  moq_milli?: number;
  order_multiple_milli?: number;
}): number {
  if (!product.track_quantity) return 0;
  const reorder = product.reorder_point_milli ?? 0;
  const safety = product.safety_stock_milli ?? 0;
  const target = Math.max(product.max_stock_milli ?? 0, reorder + safety);
  let missing = target - product.quantity_milli;
  if (missing <= 0) return 0;
  const multiple = product.order_multiple_milli ?? 0;
  if (multiple > 0) missing = Math.ceil(missing / multiple) * multiple;
  return Math.max(missing, product.moq_milli ?? 0);
}

/**
 * How many kits the components can actually build, given current stock. Returns
 * null when the item has no bill of materials (nothing to assemble).
 */
export function kitAvailability(
  bom: { product_id: string; quantity: number }[],
  stockMilli: Record<string, number>,
): number | null {
  if (!bom.length) return null;
  let lowest = Number.POSITIVE_INFINITY;
  for (const component of bom) {
    const perKit = Math.max(1, Math.round(component.quantity * 1000));
    const buildable = Math.floor((stockMilli[component.product_id] ?? 0) / perKit);
    lowest = Math.min(lowest, buildable);
  }
  return Number.isFinite(lowest) ? Math.max(0, lowest) : null;
}

/**
 * Components needed to build a quantity of kits, in milli-units.
 *
 * A kit assembled to order is never stocked: what leaves the warehouse is this
 * explosion, which is why the same calculation serves both the sale and the
 * assembly. Empty lines are dropped so a zero component never writes a movement.
 */
export function explodeKit(
  bom: { product_id: string; quantity: number }[],
  quantityMilli: number,
): { product_id: string; quantity_milli: number }[] {
  const kitUnits = quantityMilli / 1000;
  return bom
    .map((line) => ({
      product_id: line.product_id,
      quantity_milli: Math.round(line.quantity * kitUnits * 1000),
    }))
    .filter((line) => line.quantity_milli > 0);
}

/** Best volume discount for a given quantity; 0 when no rule applies. */
export function discountForQuantity(
  rules: { min_quantity: number; percent: number }[],
  quantity: number,
): number {
  let best = 0;
  for (const rule of rules) {
    if (quantity >= rule.min_quantity && rule.percent > best) best = rule.percent;
  }
  return best;
}
