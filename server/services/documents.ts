import { scalar } from '../db';
import { nowISO } from '../db';
import { deriveInvoiceStatus } from './status';
import { computeTotals, type LineItem, type TaxBucket } from '../lib/tax';

export function safeLines(value: unknown): LineItem[] {
  if (Array.isArray(value)) return value as LineItem[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as LineItem[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export function serialiseLines(value: unknown): string {
  return JSON.stringify(safeLines(value));
}

/** Recomputes an invoice from its allocations, the single source of payment truth. */
export async function recalcInvoice(database: D1Database, invoiceId: string): Promise<void> {
  const invoice = await database
    .prepare(`SELECT total, status, paid_at FROM invoices WHERE id = ?`)
    .bind(invoiceId)
    .first<{ total: number; status: string; paid_at: string | null }>();
  if (!invoice) return;

  const paymentTotal = await scalar(
    database
      .prepare(
        `SELECT COALESCE(SUM(pa.amount), 0) AS value
         FROM payment_allocations pa
         JOIN payments p ON p.id = pa.payment_id
         WHERE pa.invoice_id = ? AND p.deleted_at IS NULL AND p.status = 'completed'`,
      )
      .bind(invoiceId),
  );

  const creditTotal = await scalar(
    database
      .prepare(`SELECT COALESCE(SUM(amount), 0) AS value FROM credit_allocations WHERE invoice_id = ?`)
      .bind(invoiceId),
  );

  const paidTotal = Math.min(invoice.total, paymentTotal + creditTotal);
  const balance = Math.max(0, invoice.total - paidTotal);
  const status = deriveInvoiceStatus(invoice.status, balance, paidTotal);
  const paidAt = balance === 0 ? (invoice.paid_at ?? nowISO()) : null;

  await database
    .prepare(
      `UPDATE invoices SET paid_total = ?, balance = ?, status = ?, paid_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(paidTotal, balance, status, paidAt, nowISO(), invoiceId)
    .run();
}

export async function recalcCredit(database: D1Database, creditId: string): Promise<void> {
  const credit = await database
    .prepare(`SELECT total, status FROM credits WHERE id = ?`)
    .bind(creditId)
    .first<{ total: number; status: string }>();
  if (!credit) return;

  const applied = Math.min(
    credit.total,
    await scalar(
      database
        .prepare(`SELECT COALESCE(SUM(amount), 0) AS value FROM credit_allocations WHERE credit_id = ?`)
        .bind(creditId),
    ),
  );
  const balance = Math.max(0, credit.total - applied);
  const status =
    balance === 0 ? 'applied' : applied > 0 ? 'partial' : credit.status === 'applied' ? 'sent' : credit.status;

  await database
    .prepare(`UPDATE credits SET applied_total = ?, balance = ?, status = ?, updated_at = ? WHERE id = ?`)
    .bind(applied, balance, status, nowISO(), creditId)
    .run();
}

/** SQL fragment computing client receivables without denormalised counters. */
export const CLIENT_STATS_SQL = `
  (SELECT COALESCE(SUM(i.balance), 0) FROM invoices i
    WHERE i.client_id = c.id AND i.deleted_at IS NULL AND i.status IN ('sent', 'partial')) AS balance,
  (SELECT COALESCE(SUM(i.paid_total), 0) FROM invoices i
    WHERE i.client_id = c.id AND i.deleted_at IS NULL AND i.status IN ('partial', 'paid')) AS paid_to_date,
  (SELECT COUNT(*) FROM invoices i WHERE i.client_id = c.id AND i.deleted_at IS NULL) AS invoice_count,
  (SELECT COALESCE(SUM(cr.balance), 0) FROM credits cr
    WHERE cr.client_id = c.id AND cr.deleted_at IS NULL AND cr.status IN ('sent', 'partial')) AS credit_balance
`;

/**
 * Mirrors an invoice's tax buckets into invoice_tax_lines so the VAT return can
 * aggregate with a GROUP BY instead of reloading and recomputing every JSON
 * line item. It is written from the very same computeTotals output as the
 * stored totals, so the two can never disagree.
 */
export async function syncInvoiceTaxLines(
  database: D1Database,
  invoiceId: string,
  buckets: TaxBucket[],
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    database.prepare(`DELETE FROM invoice_tax_lines WHERE invoice_id = ?`).bind(invoiceId),
  ];
  const now = nowISO();
  for (const bucket of buckets) {
    statements.push(
      database
        .prepare(
          `INSERT INTO invoice_tax_lines (id, invoice_id, rate, base, amount, created_at)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(invoice_id, rate) DO UPDATE SET base = excluded.base, amount = excluded.amount`,
        )
        .bind(crypto.randomUUID(), invoiceId, bucket.rate, bucket.base, bucket.amount, now),
    );
  }
  await database.batch(statements);
}

/** Rebuilds the mirror for one invoice from its stored lines. */
export async function syncInvoiceFromRow(
  database: D1Database,
  row: { id: string; line_items: unknown; discount_type: string; discount_value: number; tax_exempt: number },
): Promise<void> {
  const totals = computeTotals(safeLines(row.line_items), {
    discount_type: row.discount_type === 'amount' ? 'amount' : 'percent',
    discount_value: row.discount_value,
  }, Boolean(row.tax_exempt));
  await syncInvoiceTaxLines(database, row.id, totals.tax_buckets);
}

/**
 * Repairs the mirror for invoices in a date range that are missing rows —
 * invoices written before the mirror existed, or after a restored backup.
 * Returns the number of invoices healed.
 */
export async function ensureInvoiceTaxLines(
  database: D1Database,
  from: string,
  to: string,
): Promise<number> {
  const rows = await database
    .prepare(
      `SELECT i.id, i.line_items, i.discount_type, i.discount_value, i.tax_exempt
       FROM invoices i
       WHERE i.deleted_at IS NULL AND i.status <> 'cancelled'
         AND i.date >= ? AND i.date <= ? AND (i.subtotal - i.discount_total) > 0
         AND NOT EXISTS (SELECT 1 FROM invoice_tax_lines l WHERE l.invoice_id = i.id)`,
    )
    .bind(from, to)
    .all<{ id: string; line_items: unknown; discount_type: string; discount_value: number; tax_exempt: number }>();

  for (const row of rows.results ?? []) {
    await syncInvoiceFromRow(database, row);
  }
  return (rows.results ?? []).length;
}

/** Full rebuild after an import or restore; used by the maintenance route. */
export async function rebuildAllInvoiceTaxLines(database: D1Database): Promise<number> {
  const rows = await database
    .prepare(
      `SELECT id, line_items, discount_type, discount_value, tax_exempt FROM invoices
       WHERE deleted_at IS NULL AND status <> 'cancelled'`,
    )
    .all<{ id: string; line_items: unknown; discount_type: string; discount_value: number; tax_exempt: number }>();

  for (const row of rows.results ?? []) {
    await syncInvoiceFromRow(database, row);
  }
  return (rows.results ?? []).length;
}
