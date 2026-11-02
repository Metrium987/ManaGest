import { DEFAULT_LOCALE } from '../../shared/domain';
import { stockAlert, suggestedReorder } from '../../shared/product-erp';

/**
 * Stock alerts (C4).
 *
 * An alert is not a new rule: it is the threshold already written on the article
 * — reorder point, safety stock, maximum — read back. ERPNext and Odoo both
 * trigger their replenishment on the reorder level, and the useful alert says
 * three things: what is missing, how much to order, and who sells it.
 *
 * The list is ordered by urgency rather than alphabetically: an empty shelf
 * comes before a low one, because the two trigger different actions.
 */

export interface AlertProduct {
  id: string;
  name: string;
  quantity_milli: number;
  track_quantity: number | boolean;
  reorder_point_milli: number;
  safety_stock_milli: number;
  max_stock_milli: number;
  moq_milli: number;
  order_multiple_milli: number;
  supplier_name?: string | null;
}

export type AlertLevel = 'out' | 'low';

export interface StockAlertRow {
  product_id: string;
  name: string;
  level: AlertLevel;
  quantity_milli: number;
  reorder_point_milli: number;
  safety_stock_milli: number;
  suggested_milli: number;
  supplier_name: string | null;
}

/** Only the articles that need attention, most urgent first. */
export function stockAlertRows(products: AlertProduct[]): StockAlertRow[] {
  const rows: StockAlertRow[] = [];
  for (const product of products) {
    const level = stockAlert(product);
    if (level !== 'out' && level !== 'low') continue;
    rows.push({
      product_id: product.id,
      name: product.name,
      level,
      quantity_milli: Math.round(Number(product.quantity_milli ?? 0)),
      reorder_point_milli: Math.round(Number(product.reorder_point_milli ?? 0)),
      safety_stock_milli: Math.round(Number(product.safety_stock_milli ?? 0)),
      // Same arithmetic as the article sheet and the purchase proposals: one
      // formula, otherwise the alert and the order would disagree again.
      suggested_milli: suggestedReorder(product),
      supplier_name: product.supplier_name ?? null,
    });
  }
  return rows.sort((a, b) => {
    if (a.level !== b.level) return a.level === 'out' ? -1 : 1;
    if (a.suggested_milli !== b.suggested_milli) return b.suggested_milli - a.suggested_milli;
    return a.name.localeCompare(b.name);
  });
}

export function alertCounts(rows: StockAlertRow[]): { out: number; low: number; suggested_milli: number } {
  return {
    out: rows.filter((row) => row.level === 'out').length,
    low: rows.filter((row) => row.level === 'low').length,
    suggested_milli: rows.reduce((sum, row) => sum + row.suggested_milli, 0),
  };
}

const units = (milli: number, locale: string) => (Math.round(Number(milli ?? 0)) / 1000).toLocaleString(locale);

/**
 * The daily digest, in plain text: a mail that says "12 articles" without saying
 * which ones forces the reader to open the app to learn anything.
 */
export function alertDigest(
  rows: StockAlertRow[],
  companyName: string,
  locale: string = DEFAULT_LOCALE,
): { subject: string; text: string } | null {
  if (!rows.length) return null;
  const { out, low } = alertCounts(rows);
  const lines = rows.slice(0, 50).map((row) => {
    const label = row.level === 'out' ? 'RUPTURE' : 'stock faible';
    const supplier = row.supplier_name ? ` — ${row.supplier_name}` : '';
    return `- ${row.name} : ${label}, ${units(row.quantity_milli, locale)} en stock (seuil ${units(row.reorder_point_milli, locale)}), à commander ${units(row.suggested_milli, locale)}${supplier}`;
  });
  const more = rows.length > 50 ? `\n… et ${rows.length - 50} autre(s).` : '';
  return {
    subject: `[${companyName}] Alertes de stock : ${out} rupture(s), ${low} stock(s) faible(s)`,
    text: [
      `Bonjour,`,
      ``,
      `${rows.length} article(s) demandent une commande :`,
      ...lines,
      more,
      ``,
      `Le détail et les propositions d'achat sont dans ManaGest, page Produits & services.`,
    ].join('\n'),
  };
}
