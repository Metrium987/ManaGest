/**
 * Referential integrity (A-12).
 *
 * The audit offers two options: rebuild the core tables with foreign keys, or
 * check the eight relations automatically. The tables involved are financial
 * (allocations, tax lines, ledger lines, stock movements): rebuilding them on a
 * live database is riskier than measuring the gap, and D1 only enforces the
 * foreign keys that are *declared*. The decision taken here is therefore the
 * second one — an explicit report, run by the daily pass and shown on the
 * dashboard, that names any orphan row instead of hoping none exists.
 */

export interface IntegrityGap {
  /** Relation checked, e.g. `payment_allocations.invoice_id`. */
  relation: string;
  table: string;
  column: string;
  parent: string;
  orphans: number;
  samples: string[];
}

export interface IntegrityReport {
  total: number;
  relations: IntegrityGap[];
  checked_at: string;
}

/** The eight relations the audit names — soft-deleted parents still count. */
export const INTEGRITY_RELATIONS: { relation: string; table: string; column: string; parent: string }[] = [
  { relation: 'payment_allocations.invoice_id', table: 'payment_allocations', column: 'invoice_id', parent: 'invoices' },
  { relation: 'credit_allocations.credit_id', table: 'credit_allocations', column: 'credit_id', parent: 'credits' },
  { relation: 'credit_allocations.invoice_id', table: 'credit_allocations', column: 'invoice_id', parent: 'invoices' },
  { relation: 'invoice_tax_lines.invoice_id', table: 'invoice_tax_lines', column: 'invoice_id', parent: 'invoices' },
  { relation: 'journal_lines.entry_id', table: 'journal_lines', column: 'entry_id', parent: 'journal_entries' },
  { relation: 'stock_movements.product_id', table: 'stock_movements', column: 'product_id', parent: 'products' },
  { relation: 'stock_lots.product_id', table: 'stock_lots', column: 'product_id', parent: 'products' },
  { relation: 'sessions.user_id', table: 'sessions', column: 'user_id', parent: 'users' },
];

/** Counts the orphans of one relation and returns a few ids to act on. */
export async function relationGaps(
  database: D1Database,
  relation: { relation: string; table: string; column: string; parent: string },
): Promise<IntegrityGap> {
  const { table, column, parent } = relation;
  const count = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM ${table} child
       WHERE child.${column} IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = child.${column})`,
    )
    .first<{ count: number }>();
  const orphans = Number(count?.count ?? 0);
  let samples: string[] = [];
  if (orphans > 0) {
    const rows = await database
      .prepare(
        `SELECT child.id AS id FROM ${table} child
         WHERE child.${column} IS NOT NULL
           AND NOT EXISTS (SELECT 1 FROM ${parent} p WHERE p.id = child.${column})
         ORDER BY child.id LIMIT 5`,
      )
      .all<{ id: string }>();
    samples = (rows.results ?? []).map((row) => row.id);
  }
  return { ...relation, orphans, samples };
}

/** Full report. `total = 0` means no orphan in any of the eight relations. */
export async function integrityReport(database: D1Database): Promise<IntegrityReport> {
  const relations: IntegrityGap[] = [];
  for (const relation of INTEGRITY_RELATIONS) relations.push(await relationGaps(database, relation));
  return {
    total: relations.reduce((sum, gap) => sum + gap.orphans, 0),
    relations,
    checked_at: new Date().toISOString(),
  };
}
