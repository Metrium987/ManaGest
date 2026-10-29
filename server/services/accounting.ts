import { nowISO } from '../db';
import {
  CHART,
  creditLines,
  expenseLines,
  invoiceLines,
  paymentLines,
  reversalLines,
  type Account,
  type DraftLine,
  type JournalCode,
} from '../lib/accounting';

/**
 * Posting service (AUDIT §7 P0.1–P0.2).
 *
 * The journal is **derived from the documents**, never entered a second time: a
 * sync pass looks at what exists and posts what is missing. The unique key
 * `(source_type, source_id, event)` makes the pass idempotent, so it can run on
 * every accounting read without duplicating a single line.
 */

let chartReady = false;

export async function ensureChart(database: D1Database): Promise<void> {
  if (chartReady) return;
  const now = nowISO();
  await database.batch(
    CHART.map((account) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO accounts (code, label, type, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(account.code, account.label, account.type, now, now),
    ),
  );
  chartReady = true;
}

interface PostingContext {
  id: string;
  source_type: string;
  source_id: string;
  event: string;
  date: string;
  reference: string;
  label: string;
  journal: JournalCode;
  lines: DraftLine[];
}

async function post(database: D1Database, context: PostingContext): Promise<boolean> {
  const existing = await database
    .prepare(`SELECT id FROM journal_entries WHERE source_type = ? AND source_id = ? AND event = ?`)
    .bind(context.source_type, context.source_id, context.event)
    .first<{ id: string }>();
  if (existing) return false;

  const entryId = crypto.randomUUID();
  const now = nowISO();
  await database.batch([
    database
      .prepare(
        `INSERT INTO journal_entries (id, date, journal, reference, label, source_type, source_id, event, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(entryId, context.date, context.journal, context.reference, context.label, context.source_type, context.source_id, context.event, now),
    ...context.lines.map((line) =>
      database
        .prepare(
          `INSERT INTO journal_lines (id, entry_id, account_code, label, debit, credit, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), entryId, line.account_code, line.label, line.debit, line.credit, now),
    ),
  ]);
  return true;
}

interface DocumentRow {
  id: string;
  number: string | null;
  date: string;
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  tax_exempt: number;
  status: string;
}

function amounts(row: DocumentRow) {
  return {
    number: row.number,
    date: row.date,
    subtotal: row.subtotal,
    discountTotal: row.discount_total,
    taxTotal: row.tax_total,
    total: row.total,
    taxExempt: Boolean(row.tax_exempt),
  };
}

/** Posts everything that is missing. Returns how many entries were created. */
export async function syncAccounting(database: D1Database): Promise<number> {
  await ensureChart(database);
  let created = 0;

  const invoices = await database
    .prepare(
      `SELECT id, number, date, subtotal, discount_total, tax_total, total, tax_exempt, status
       FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial','paid','cancelled')`,
    )
    .all<DocumentRow>();
  for (const row of invoices.results ?? []) {
    const reference = row.number ?? '—';
    const lines = row.status === 'cancelled' ? reversalLines(amounts(row)) : invoiceLines(amounts(row));
    if (!lines.length) continue;
    if (await post(database, {
      id: row.id, source_type: 'invoice', source_id: row.id,
      event: row.status === 'cancelled' ? 'cancelled' : 'issued',
      date: row.date, reference, label: `Facture ${reference}`, journal: 'VE', lines,
    })) created += 1;
  }

  const credits = await database
    .prepare(
      `SELECT id, number, date, subtotal, discount_total, tax_total, total, tax_exempt, status
       FROM credits WHERE deleted_at IS NULL AND status IN ('sent','partial','applied')`,
    )
    .all<DocumentRow>();
  for (const row of credits.results ?? []) {
    const reference = row.number ?? '—';
    const lines = creditLines(amounts(row));
    if (await post(database, {
      id: row.id, source_type: 'credit', source_id: row.id, event: 'issued',
      date: row.date, reference, label: `Avoir ${reference}`, journal: 'VE', lines,
    })) created += 1;
  }

  const payments = await database
    .prepare(
      `SELECT id, number, date, amount FROM payments WHERE status = 'completed'`,
    )
    .all<{ id: string; number: string | null; date: string; amount: number }>();
  for (const row of payments.results ?? []) {
    const reference = row.number ?? '—';
    if (await post(database, {
      id: row.id, source_type: 'payment', source_id: row.id, event: 'completed',
      date: row.date, reference, label: `Règlement ${reference}`, journal: 'BQ',
      lines: paymentLines(row.amount, reference),
    })) created += 1;
  }

  const expenses = await database
    .prepare(
      `SELECT id, date, amount, tax_amount, COALESCE(reference, category) AS reference
       FROM expenses WHERE deleted_at IS NULL`,
    )
    .all<{ id: string; date: string; amount: number; tax_amount: number; reference: string }>();
  for (const row of expenses.results ?? []) {
    if (await post(database, {
      id: row.id, source_type: 'expense', source_id: row.id, event: 'posted',
      date: row.date, reference: row.reference, label: `Dépense ${row.reference}`, journal: 'AC',
      lines: expenseLines(row.amount, row.tax_amount, row.reference),
    })) created += 1;
  }

  return created;
}

export interface JournalRow {
  id: string;
  date: string;
  journal: string;
  reference: string;
  label: string;
  source_type: string;
  source_id: string;
  event: string;
}

export async function journalEntries(
  database: D1Database,
  filters: { from?: string; to?: string; limit?: number } = {},
): Promise<{ entries: JournalRow[]; lines: unknown[] }> {
  const clauses: string[] = [];
  const bindings: (string | number)[] = [];
  if (filters.from) { clauses.push('e.date >= ?'); bindings.push(filters.from); }
  if (filters.to) { clauses.push('e.date <= ?'); bindings.push(filters.to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const entries = await database
    .prepare(`SELECT e.* FROM journal_entries e ${where} ORDER BY e.date DESC, e.created_at DESC LIMIT ?`)
    .bind(...bindings, filters.limit ?? 200)
    .all<JournalRow>();
  const ids = (entries.results ?? []).map((entry) => entry.id);
  const lines = ids.length
    ? await database
        .prepare(`SELECT entry_id, account_code, label, debit, credit FROM journal_lines WHERE entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY account_code ASC`)
        .bind(...ids)
        .all()
    : { results: [] };
  return { entries: entries.results ?? [], lines: lines.results ?? [] };
}

export async function allLines(
  database: D1Database,
  filters: { from?: string; to?: string } = {},
): Promise<{ account_code: string; debit: number; credit: number }[]> {
  const clauses: string[] = [];
  const bindings: string[] = [];
  if (filters.from) { clauses.push('e.date >= ?'); bindings.push(filters.from); }
  if (filters.to) { clauses.push('e.date <= ?'); bindings.push(filters.to); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = await database
    .prepare(
      `SELECT l.account_code, SUM(l.debit) AS debit, SUM(l.credit) AS credit
       FROM journal_lines l JOIN journal_entries e ON e.id = l.entry_id
       ${where} GROUP BY l.account_code`,
    )
    .bind(...bindings)
    .all<{ account_code: string; debit: number; credit: number }>();
  return rows.results ?? [];
}

export async function chart(
  database: D1Database,
): Promise<(Account & { is_active: number })[]> {
  await ensureChart(database);
  const rows = await database
    .prepare(`SELECT code, label, type, is_active FROM accounts ORDER BY code ASC`)
    .all<Account & { is_active: number }>();
  return rows.results ?? [];
}
