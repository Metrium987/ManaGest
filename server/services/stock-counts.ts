import { firstIn } from '../lib/sql';
/**
 * The one thing other modules need to know about a count (B1): which products
 * are currently frozen. Manual quantity edits are refused on those items so the
 * sheet stays comparable to the ledger; automatic movements (a sale, a
 * reception) are not blocked — the count detects them and refuses to apply a
 * stale line instead of swallowing the movement.
 */
export async function openCountReference(
  database: D1Database,
  productIds: string[],
): Promise<string | null> {
  const ids = [...new Set(productIds.filter(Boolean))];
  if (!ids.length) return null;
  const row = await firstIn<{ reference: string }>(ids, (list, chunk) =>
    database
      .prepare(
        `SELECT sc.reference FROM stock_count_lines l
       JOIN stock_counts sc ON sc.id = l.count_id
       WHERE sc.status = 'open' AND l.product_id IN (${list})
       LIMIT 1`,
      )
      .bind(...chunk),
  );
  return row?.reference ?? null;
}
