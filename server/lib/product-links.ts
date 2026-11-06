export interface LinkedProduct {
  id: string;
  name: string;
  product_key: string | null;
  unit_price: number;
  quantity_milli: number;
  in_stock: boolean;
}

export interface ProductLinks {
  substitutes: LinkedProduct[];
  accessories: LinkedProduct[];
}

export interface LinkedRow {
  product_id: string;
  kind: string;
  id: string;
  name: string;
  product_key: string | null;
  unit_price: number;
  quantity_milli: number;
  track_quantity: number;
}

const empty = (): ProductLinks => ({ substitutes: [], accessories: [] });

function toLinked(row: LinkedRow): LinkedProduct {
  return {
    id: row.id,
    name: row.name,
    product_key: row.product_key,
    unit_price: Number(row.unit_price ?? 0),
    quantity_milli: Number(row.quantity_milli ?? 0),
    in_stock: Number(row.track_quantity ?? 0) === 0 || Number(row.quantity_milli ?? 0) > 0,
  };
}

/** Groups the link rows of one product by kind. */
export function groupProductLinks(rows: LinkedRow[]): ProductLinks {
  const grouped = empty();
  for (const row of rows) {
    if (row.kind === 'substitute') grouped.substitutes.push(toLinked(row));
    else if (row.kind === 'accessory') grouped.accessories.push(toLinked(row));
  }
  return grouped;
}

/**
 * D3: the quote editor needs to know what replaces an out-of-stock article and
 * what goes with it, so the links travel with the product list instead of costing
 * one request per line.
 */
export async function attachProductLinks<T extends { id: string; links?: ProductLinks }>(
  db: D1Database,
  products: T[],
): Promise<T[]> {
  const ids = products.map((product) => product.id);
  if (ids.length === 0) return products;

  const rows = await db
    .prepare(
      `SELECT pl.product_id, pl.kind, p.id, p.name, p.product_key, p.unit_price, p.quantity_milli, p.track_quantity
         FROM product_links pl JOIN products p ON p.id = pl.linked_id
        WHERE pl.product_id IN (${ids.map(() => '?').join(',')}) AND p.deleted_at IS NULL
        ORDER BY p.name COLLATE NOCASE`,
    )
    .bind(...ids)
    .all<LinkedRow>();

  const byProduct = new Map<string, ProductLinks>();
  for (const row of rows.results ?? []) {
    const bucket = byProduct.get(row.product_id) ?? empty();
    if (row.kind === 'substitute') bucket.substitutes.push(toLinked(row));
    else if (row.kind === 'accessory') bucket.accessories.push(toLinked(row));
    byProduct.set(row.product_id, bucket);
  }

  for (const product of products) {
    product.links = byProduct.get(product.id) ?? empty();
  }
  return products;
}

/**
 * A-14: names every product reference a sheet keeps while the product is gone.
 * A nomenclature, a substitute or an accessory pointing at a deleted (or
 * unknown) article would explode later, inside a sale, far from its cause.
 */
export function unresolvedReferences(
  links: {
    bom?: { product_id?: string | null }[] | null;
    substitutes?: (string | null)[] | null;
    accessories?: (string | null)[] | null;
  },
  existing: Iterable<string>,
): string[] {
  const known = new Set(existing);
  const ids = [
    ...(links.bom ?? []).map((line) => line?.product_id),
    ...(links.substitutes ?? []),
    ...(links.accessories ?? []),
  ].filter((id): id is string => typeof id === 'string' && id.length > 0);
  return [...new Set(ids.filter((id) => !known.has(id)))];
}
