export interface FamilyAccountRow {
  family: string;
  sales_account: string | null;
  purchase_account: string | null;
  stock_account: string | null;
}

/** The three account columns a sheet carries. They arrive from a row whose
 * columns are typed loosely, so this helper reads them defensively. */
export interface AccountedProduct {
  sales_account?: string | null;
  purchase_account?: string | null;
  stock_account?: string | null;
}

const text = (value: unknown): string | null =>
  (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * F2: an article's accounts default to its family's mapping.
 *
 * The article's own value always wins — a specific product may need a different
 * account than its family, and silently overriding a deliberate choice is how an
 * ERP loses its users' trust. The mapping only fills what was left empty, which is
 * exactly what "compte par défaut" means.
 */
export function resolveFamilyAccounts<T extends { family?: unknown }>(
  product: T,
  mapping: Map<string, FamilyAccountRow>,
): T & Required<AccountedProduct> {
  // The sheet type is only known through its `family` column here, so the three
  // account columns are read as the loose shape they are; the result is handed
  // back in the caller's own type, which is what keeps `id` and every other
  // column on the objects returned by the product list.
  const sheet = product as T & AccountedProduct;
  const family = typeof sheet.family === 'string' ? sheet.family.trim() : '';
  const row = family ? mapping.get(family) : undefined;

  return {
    ...sheet,
    sales_account: text(sheet.sales_account) ?? row?.sales_account ?? null,
    purchase_account: text(sheet.purchase_account) ?? row?.purchase_account ?? null,
    stock_account: text(sheet.stock_account) ?? row?.stock_account ?? null,
  } as T & Required<AccountedProduct>;
}

export function familyAccountMap(rows: FamilyAccountRow[]): Map<string, FamilyAccountRow> {
  return new Map(rows.map((row) => [row.family, row]));
}
