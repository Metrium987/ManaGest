/**
 * Stock reconciliation (A-14).
 *
 * Three quantities used to live side by side: the product counter, the signed
 * movements, and the batches (with their per-shelf balances). Nothing compared
 * them, so a return that touched `stock_lots` but not `lot_balances` left the
 * book quietly disagreeing with itself.
 *
 * The decision taken here: **the movements are the source of truth**;
 * `products.quantity_milli` is a cache, and the nightly pass *reports* any gap
 * instead of overwriting it. A silent correction would destroy the evidence of
 * the bug that produced it — and a batch ledger that is wrong on purpose is
 * worse than one that is wrong and visible.
 *
 * Two invariants are checked, for every stockable article:
 *   - signed movements = product counter;
 *   - batch balances = batch quantities (both are zero when nothing is tracked).
 */

export interface StockBalanceInput {
  product_id: string;
  name: string;
  item_type?: string | null;
  counter_milli: number;
  movement_milli: number;
  lots_milli: number;
  shelf_milli: number;
}

export interface StockBalanceRow extends StockBalanceInput {
  /** movements − counter: non-zero means the cache drifted from the ledger. */
  counter_gap_milli: number;
  /** shelves − batches: non-zero means a batch moved without its shelf. */
  shelf_gap_milli: number;
  consistent: boolean;
}

export function stockBalanceRows(rows: readonly StockBalanceInput[]): StockBalanceRow[] {
  return rows.map((row) => {
    const counter = Math.round(Number(row.counter_milli ?? 0));
    const movements = Math.round(Number(row.movement_milli ?? 0));
    const lots = Math.round(Number(row.lots_milli ?? 0));
    const shelf = Math.round(Number(row.shelf_milli ?? 0));
    const counterGap = movements - counter;
    const shelfGap = shelf - lots;
    return {
      ...row,
      counter_milli: counter,
      movement_milli: movements,
      lots_milli: lots,
      shelf_milli: shelf,
      counter_gap_milli: counterGap,
      shelf_gap_milli: shelfGap,
      consistent: counterGap === 0 && shelfGap === 0,
    };
  });
}

export interface StockBalanceReport {
  rows: StockBalanceRow[];
  gaps: StockBalanceRow[];
  total: number;
}

/** Products whose cache or shelf ledger disagrees with the movements. */
export function stockBalanceReport(rows: readonly StockBalanceInput[]): StockBalanceReport {
  const all = stockBalanceRows(rows);
  const gaps = all.filter((row) => !row.consistent);
  return { rows: all, gaps, total: gaps.length };
}

/** One query, one row per stockable article, the four quantities side by side. */
export async function stockBalance(database: D1Database): Promise<StockBalanceReport> {
  const result = await database
    .prepare(
      `SELECT p.id AS product_id, p.name, p.item_type,
              p.quantity_milli AS counter_milli,
              COALESCE((SELECT SUM(CASE WHEN m.kind = 'in' THEN m.quantity_milli ELSE -m.quantity_milli END)
                        FROM stock_movements m WHERE m.product_id = p.id), 0) AS movement_milli,
              COALESCE((SELECT SUM(l.quantity_milli) FROM stock_lots l WHERE l.product_id = p.id), 0) AS lots_milli,
              COALESCE((SELECT SUM(b.quantity_milli) FROM lot_balances b
                        JOIN stock_lots l ON l.id = b.lot_id WHERE l.product_id = p.id), 0) AS shelf_milli
       FROM products p
       WHERE p.deleted_at IS NULL AND p.item_type <> 'service'
       ORDER BY p.name ASC`,
    )
    .all<StockBalanceInput>();
  return stockBalanceReport(result.results ?? []);
}
