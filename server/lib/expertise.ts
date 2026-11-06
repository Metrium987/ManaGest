import { selectIn } from './sql';
import { expertisePrice } from '../../shared/product-erp';
import { ApiError } from './errors';

export interface ExpertiseProduct {
  id: string;
  expertise_levels: { level: string; price: number }[] | null;
}

type ExpertiseLine = {
  product_id?: string | null;
  quantity: number;
  unit_price: number;
  expertise_level?: string | null;
};

/** The price attached to a level, or null when the level is not on the sheet. */
export function levelPrice(product: ExpertiseProduct, level: string | null | undefined): number | null {
  return expertisePrice(product.expertise_levels, level);
}

/**
 * D2: the level chosen on the line sets the price of a service.
 *
 * A level that is not on the sheet is refused rather than silently priced at the
 * base rate — a devis that says "Expert" and bills the junior rate is worse than
 * an error. A price already on the line wins, as everywhere else.
 */
export function applyExpertisePricing<T extends ExpertiseLine>(
  lines: T[],
  products: Map<string, ExpertiseProduct>,
): T[] {
  return lines.map((line) => {
    if (!line.product_id || !line.expertise_level) return line;
    const product = products.get(line.product_id);
    if (!product) return line;
    if ((product.expertise_levels ?? []).length === 0) return line;

    const price = levelPrice(product, line.expertise_level);
    if (price === null) {
      throw new ApiError(422, 'VALIDATION_ERROR', { line_items: 'expertise_level_unknown' });
    }
    return line.unit_price > 0 ? line : { ...line, unit_price: price };
  });
}

function parseLevels(raw: string | null): { level: string; price: number }[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function applyExpertiseForLines<T extends ExpertiseLine>(
  db: D1Database,
  lines: T[],
): Promise<T[]> {
  const ids = [...new Set(lines.map((line) => line.product_id).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return lines;

  const rows = await selectIn<ExpertiseProduct & { expertise_levels: string | null }>(ids, (list, chunk) =>
    db.prepare(`SELECT id, expertise_levels FROM products WHERE id IN (${list})`).bind(...chunk),
  );

  const products = new Map<string, ExpertiseProduct>(rows.map((row) => [
    row.id,
    { id: row.id, expertise_levels: parseLevels(row.expertise_levels) },
  ]));
  return applyExpertisePricing(lines, products);
}
