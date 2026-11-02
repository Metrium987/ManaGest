import { linePriceFor } from '../../shared/product-erp';

export interface PricedProduct {
  id: string;
  unit_price: number;
  price_pro: number | null;
  price_member: number | null;
  volume_discounts: { min_quantity: number; percent: number }[] | null;
}

type PricedLine = { product_id?: string | null; quantity: number; unit_price: number };

/**
 * D1: fills the lines that carry no price with the client's grid price.
 *
 * A line with a price already on it is a price someone agreed to, so it is never
 * overwritten — the grid proposes, the person decides. Lines without a product
 * (free text) stay untouched for the same reason.
 */
export function applyClientPricing<T extends PricedLine>(
  lines: T[],
  products: Map<string, PricedProduct>,
  tier: string | null | undefined,
): T[] {
  return lines.map((line) => {
    if (line.unit_price > 0 || !line.product_id) return line;
    const product = products.get(line.product_id);
    if (!product) return line;
    const price = linePriceFor(product, tier, line.quantity);
    return price > 0 ? { ...line, unit_price: price } : line;
  });
}

function parseSteps(raw: string | null): { min_quantity: number; percent: number }[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Server-side counterpart used when a document is created without the UI. */
export async function applyClientPricingForClient<T extends PricedLine>(
  db: D1Database,
  clientId: string,
  lines: T[],
): Promise<T[]> {
  const ids = [...new Set(lines.map((line) => line.product_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return lines;

  const client = await db
    .prepare('SELECT price_tier FROM clients WHERE id = ?')
    .bind(clientId)
    .first<{ price_tier: string | null }>();
  if (!client) return lines;

  const rows = await db
    .prepare(
      `SELECT id, unit_price, price_pro, price_member, volume_discounts FROM products
       WHERE id IN (${ids.map(() => '?').join(',')})`,
    )
    .bind(...ids)
    .all<PricedProduct & { volume_discounts: string | null }>();

  const products = new Map<string, PricedProduct>((rows.results ?? []).map((row) => [
    row.id,
    { ...row, volume_discounts: parseSteps(row.volume_discounts) },
  ]));
  return applyClientPricing(lines, products, client.price_tier);
}
