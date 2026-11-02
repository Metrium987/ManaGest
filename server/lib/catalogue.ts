import { ApiError } from './errors';
import type { LineItem } from './tax';

/**
 * Identity a document line keeps for ever: the catalogue entry it was sold from,
 * plus the wording and family at that moment. A later rename or reclassification
 * must not rewrite an issued quote or invoice, so the snapshot is written once,
 * with the line, and never resolved again at read time.
 */
export interface CatalogueLine extends LineItem {
  product_key?: string | null;
  product_name?: string;
  product_family?: string | null;
  product_type?: string;
  /** Billing unit for a service (hour, day…), 'unit' for a stockable article. */
  product_unit?: string;
}

interface CatalogueRow {
  id: string;
  product_key: string | null;
  name: string;
  item_type: string;
  family: string | null;
  billing_unit: string | null;
}

/**
 * Freezes the catalogue identity onto each line that carries a `product_id`.
 *
 * An unknown or deleted reference is a client error (422), not a silently
 * dropped line: a line that pretends to be a catalogue item but is not would
 * quietly break the sales statistics and the stock movements.
 */
export async function enrichLines(
  database: D1Database,
  lines: LineItem[],
): Promise<CatalogueLine[]> {
  const ids = [...new Set(
    lines.map((line) => line.product_id).filter((id): id is string => Boolean(id)),
  )];
  if (!ids.length) return lines;

  const placeholders = ids.map(() => '?').join(', ');
  const rows = await database
    .prepare(
      `SELECT id, product_key, name, item_type, family, billing_unit
       FROM products WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
    )
    .bind(...ids)
    .all<CatalogueRow>();

  const byId = new Map((rows.results ?? []).map((row) => [row.id, row]));
  const missing = ids.filter((id) => !byId.has(id));
  if (missing.length) {
    throw new ApiError(422, 'VALIDATION_ERROR', { line_items: 'product_not_found' });
  }

  return lines.map((line) => {
    if (!line.product_id) return line;
    const product = byId.get(line.product_id)!;
    return {
      ...line,
      product_key: product.product_key,
      product_name: product.name,
      product_family: product.family,
      product_type: product.item_type,
      product_unit: product.item_type === 'service' ? (product.billing_unit ?? 'hour') : 'unit',
    };
  });
}
