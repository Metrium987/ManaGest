import { nowISO } from '../db';
import { groupRevenue, resolveAccount } from '../lib/account-resolution';
import { lineNetAmounts } from '../lib/margin';
import { getAccountCodes } from '../lib/settings-extra';
import { convertToBase } from '../lib/fx';
import type { AccountCodes } from '../../shared/accounts';
import {
  CHART,
  OPENING_JOURNAL,
  OPENING_SOURCE_ID,
  creditLines,
  expenseLines,
  expenseReversalLines,
  invoiceLines,
  openingLines,
  paymentLines,
  paymentReversalLines,
  reversalLines,
  typeFromCode,
  type Account,
  type DraftLine,
  type JournalCode,
  type OpeningRow,
  type RevenueSplit,
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
let chartSignature = '';

/**
 * Seeds the chart with the shared accounts **and** the codes the workspace has
 * configured, so a custom account still has a label and a type in the trial
 * balance. Settings are re-read whenever their signature changes: that is what
 * makes a code change effective without a redeploy.
 */
export async function ensureChart(database: D1Database, provided?: AccountCodes): Promise<void> {
  const codes = provided ?? await getAccountCodes(database);
  const signature = Object.values(codes).join(',');
  if (chartReady && signature === chartSignature) return;
  const now = nowISO();
  const known = new Set(CHART.map((account) => account.code));
  const configured = [...new Set(Object.values(codes))]
    .filter((code) => !known.has(code))
    .map<Account>((code) => ({ code, label: `Compte ${code}`, type: typeFromCode(code) }));
  await database.batch(
    [...CHART, ...configured].map((account) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO accounts (code, label, type, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(account.code, account.label, account.type, now, now),
    ),
  );
  chartReady = true;
  chartSignature = signature;
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

/** Generic posting entry point for derived documents (E3 revenue recognition). */
export async function postJournalEntry(
  database: D1Database,
  entry: {
    sourceType: string; sourceId: string; event: string; date: string;
    reference: string; label: string; journal: JournalCode; lines: DraftLine[];
  },
): Promise<boolean> {
  return post(database, {
    id: crypto.randomUUID(),
    source_type: entry.sourceType,
    source_id: entry.sourceId,
    event: entry.event,
    date: entry.date,
    reference: entry.reference,
    label: entry.label,
    journal: entry.journal,
    lines: entry.lines,
  });
}

interface DocumentRow {
  id: string;
  number: string | null;
  date: string;
  subtotal: number;
  discount_total: number;
  discount_type: string;
  discount_value: number;
  tax_total: number;
  total: number;
  tax_exempt: number;
  status: string;
  line_items: string | null;
  currency: string;
  exchange_rate: number;
  currency_decimals: number;
  subtotal_xpf: number;
  tax_total_xpf: number;
  total_xpf: number;
}

interface SplitLine {
  product_id?: string | null;
  product_family?: string | null;
  quantity?: number;
  unit_price?: number;
}

/**
 * Q2: which account each line's revenue belongs to. The article's own account
 * wins, then its family's mapping, then the chart default. Amounts follow the
 * document discount, spread over the lines exactly like the margin report does.
 */
async function revenueSplit(
  row: DocumentRow,
  catalogue: () => Promise<{ products: Map<string, { account: string | null; family: string | null }>; families: Map<string, string | null> }>,
  codes: AccountCodes,
  fx: { decimals: number; rate: number },
): Promise<RevenueSplit[] | null> {
  let lines: SplitLine[];
  try {
    lines = JSON.parse(row.line_items || '[]') as SplitLine[];
  } catch {
    return null;
  }
  if (!lines.length) return null;

  const { products, families } = await catalogue();
  const net = lineNetAmounts({
    id: row.id,
    date: row.date,
    kind: 'invoice',
    discount_type: row.discount_type === 'amount' ? 'amount' : 'percent',
    discount_value: Number(row.discount_value ?? 0),
    lines: lines.map((line) => ({
      product_id: line.product_id ?? null,
      product_family: line.product_family ?? null,
      quantity: Number(line.quantity ?? 0),
      unit_price: Number(line.unit_price ?? 0),
    })),
  });

  return groupRevenue(lines.map((line, index) => {
    const product = line.product_id ? products.get(line.product_id) : undefined;
    const family = product?.family ?? line.product_family ?? null;
    return {
      account: resolveAccount({
        product: product?.account ?? null,
        family: family ? families.get(family) ?? null : null,
        fallback: codes.sales,
      }),
      amount: convertToBase(net[index] ?? 0, fx.decimals, fx.rate),
    };
  }));
}

function amounts(row: DocumentRow) {
  const currency = row.currency || 'XPF';
  const rate = Number(row.exchange_rate ?? 1);
  // `??` is not enough: a migrated row may carry 0 while its total is not zero.
  const pick = (xpf: number, own: number) => (Number(xpf) > 0 || own === 0 ? Number(xpf) : Number(own));
  return {
    number: row.number,
    date: row.date,
    subtotal: Number(row.subtotal),
    discountTotal: Number(row.discount_total),
    taxTotal: Number(row.tax_total),
    total: Number(row.total),
    taxExempt: Boolean(row.tax_exempt),
    currency,
    exchangeRate: rate,
    xpf: {
      subtotal: pick(row.subtotal_xpf, row.subtotal),
      discountTotal: convertToBase(row.discount_total, Number(row.currency_decimals ?? 0), rate),
      taxTotal: pick(row.tax_total_xpf, row.tax_total),
      total: pick(row.total_xpf, row.total),
    },
  };
}

function fxOf(row: { currency_decimals?: number; exchange_rate?: number }) {
  return { decimals: Number(row.currency_decimals ?? 0), rate: Number(row.exchange_rate ?? 1) };
}

/** The accounts resolution needs: what each article says, and what its family
 * gives as a default. Loaded once per sync pass, and only when asked for. */
async function loadCatalogue(database: D1Database) {
  const [products, families] = await Promise.all([
    database
      .prepare(`SELECT id, sales_account, family FROM products WHERE deleted_at IS NULL`)
      .all<{ id: string; sales_account: string | null; family: string | null }>(),
    database
      .prepare(`SELECT family, sales_account FROM family_accounts`)
      .all<{ family: string; sales_account: string | null }>(),
  ]);
  return {
    products: new Map((products.results ?? []).map((row) => [row.id, { account: row.sales_account, family: row.family }])),
    families: new Map((families.results ?? []).map((row) => [row.family, row.sales_account])),
  };
}

/** Posts everything that is missing. Returns how many entries were created. */
export async function syncAccounting(database: D1Database): Promise<number> {
  const codes = await getAccountCodes(database);
  await ensureChart(database, codes);
  let created = 0;

  // Q2: posting revenue to the article's or family's account stays behind a
  // workspace setting, so turning it on cannot rewrite how past entries read.
  const flag = await database
    .prepare(`SELECT value FROM settings_extra WHERE key = 'item_accounts'`)
    .first<{ value: string }>();
  const byItemAccount = ['1', 'true'].includes(String(flag?.value ?? '0'));
  let cataloguePromise: ReturnType<typeof loadCatalogue> | null = null;
  const catalogue = () => {
    cataloguePromise ??= loadCatalogue(database);
    return cataloguePromise;
  };

  const invoices = await database
    .prepare(
      `SELECT id, number, date, subtotal, discount_total, discount_type, discount_value, tax_total,
              total, tax_exempt, status, line_items, currency, exchange_rate, currency_decimals,
              subtotal_xpf, tax_total_xpf, total_xpf
       FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial','paid','cancelled')`,
    )
    .all<DocumentRow>();
  for (const row of invoices.results ?? []) {
    const reference = row.number ?? '—';
    const split = byItemAccount ? await revenueSplit(row, catalogue, codes, fxOf(row)) : null;
    const lines = row.status === 'cancelled'
      ? reversalLines(amounts(row), split, codes)
      : invoiceLines(amounts(row), split, codes);
    if (!lines.length) continue;
    if (await post(database, {
      id: row.id, source_type: 'invoice', source_id: row.id,
      event: row.status === 'cancelled' ? 'cancelled' : 'issued',
      date: row.date, reference, label: `Facture ${reference}`, journal: 'VE', lines,
    })) created += 1;
  }

  const credits = await database
    .prepare(
      `SELECT id, number, date, subtotal, discount_total, discount_type, discount_value, tax_total,
              total, tax_exempt, status, line_items, currency, exchange_rate, currency_decimals,
              subtotal_xpf, tax_total_xpf, total_xpf
       FROM credits WHERE deleted_at IS NULL AND status IN ('sent','partial','applied')`,
    )
    .all<DocumentRow>();
  for (const row of credits.results ?? []) {
    const reference = row.number ?? '—';
    const split = byItemAccount ? await revenueSplit(row, catalogue, codes, fxOf(row)) : null;
    const lines = creditLines(amounts(row), split, codes);
    if (await post(database, {
      id: row.id, source_type: 'credit', source_id: row.id, event: 'issued',
      date: row.date, reference, label: `Avoir ${reference}`, journal: 'VE', lines,
    })) created += 1;
  }

  const payments = await database
    .prepare(
      `SELECT id, number, date, amount, currency, exchange_rate, amount_xpf, fx_difference
       FROM payments WHERE status = 'completed'`,
    )
    .all<{ id: string; number: string | null; date: string; amount: number; currency: string; exchange_rate: number; amount_xpf: number; fx_difference: number }>();
  for (const row of payments.results ?? []) {
    const reference = row.number ?? '—';
    if (await post(database, {
      id: row.id, source_type: 'payment', source_id: row.id, event: 'completed',
      date: row.date, reference, label: `Règlement ${reference}`, journal: 'BQ',
      lines: paymentLines(
        row.amount_xpf || row.amount,
        reference,
        codes,
        {
          currency: row.currency,
          exchangeRate: row.exchange_rate,
          originalAmount: row.amount,
          receivable: (row.amount_xpf || row.amount) - (row.fx_difference ?? 0),
          difference: row.fx_difference ?? 0,
        },
      ),
    })) created += 1;
  }

  // A-05: a voided payment keeps its original entry and gains its mirror. The
  // event key differs ('voided'), so a second pass never posts it twice.
  const voided = await database
    .prepare(
      `SELECT id, number, date, amount, currency, exchange_rate, amount_xpf, fx_difference
       FROM payments WHERE status = 'void' OR deleted_at IS NOT NULL`,
    )
    .all<{ id: string; number: string | null; date: string; amount: number; currency: string; exchange_rate: number; amount_xpf: number; fx_difference: number }>();
  for (const row of voided.results ?? []) {
    const reference = row.number ?? '—';
    const cash = row.amount_xpf || row.amount;
    if (await post(database, {
      id: row.id, source_type: 'payment', source_id: row.id, event: 'voided',
      date: row.date, reference, label: `Extourne règlement ${reference}`, journal: 'BQ',
      lines: paymentReversalLines(cash, reference, codes, {
        currency: row.currency,
        exchangeRate: row.exchange_rate,
        originalAmount: row.amount,
        receivable: cash - (row.fx_difference ?? 0),
        difference: row.fx_difference ?? 0,
      }),
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
      lines: expenseLines(row.amount, row.tax_amount, row.reference, codes),
    })) created += 1;
  }

  // A-05: a deleted expense gives back the charge and the deductible VAT, again as
  // a mirror with its own key rather than a deletion of the original entry.
  const removed = await database
    .prepare(
      `SELECT id, date, amount, tax_amount, COALESCE(reference, category) AS reference
       FROM expenses WHERE deleted_at IS NOT NULL`,
    )
    .all<{ id: string; date: string; amount: number; tax_amount: number; reference: string }>();
  for (const row of removed.results ?? []) {
    if (await post(database, {
      id: row.id, source_type: 'expense', source_id: row.id, event: 'reversed',
      date: row.date, reference: row.reference, label: `Extourne dépense ${row.reference}`, journal: 'AC',
      lines: expenseReversalLines(row.amount, row.tax_amount, row.reference, codes),
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
        .prepare(`SELECT entry_id, account_code, label, debit, credit, currency, original_amount, exchange_rate FROM journal_lines WHERE entry_id IN (${ids.map(() => '?').join(',')}) ORDER BY account_code ASC`)
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

export interface OpeningBalanceRow {
  code: string;
  label: string;
  debit: number;
  credit: number;
}

/** The opening trial balance as imported, or an empty set. */
export async function openingBalances(
  database: D1Database,
): Promise<{ date: string | null; rows: OpeningBalanceRow[] }> {
  const entry = await database
    .prepare(`SELECT id, date FROM journal_entries WHERE source_type = 'opening' AND source_id = ? AND event = 'imported'`)
    .bind(OPENING_SOURCE_ID)
    .first<{ id: string; date: string }>();
  if (!entry) return { date: null, rows: [] };
  const rows = await database
    .prepare(
      `SELECT l.account_code AS code, COALESCE(a.label, l.label) AS label, l.debit, l.credit
       FROM journal_lines l LEFT JOIN accounts a ON a.code = l.account_code
       WHERE l.entry_id = ? ORDER BY l.account_code`,
    )
    .bind(entry.id)
    .all<OpeningBalanceRow>();
  return { date: entry.date, rows: rows.results ?? [] };
}

/**
 * Replaces the opening balances (T-304). The entry is keyed like every other
 * one, so a second import **replaces** the first instead of stacking: opening
 * balances are corrected until the books start, then they are frozen.
 */
export async function saveOpeningBalances(
  database: D1Database,
  input: { date: string; rows: readonly OpeningRow[] },
): Promise<{ lines: number; difference: number }> {
  const codes = await getAccountCodes(database);
  await ensureChart(database, codes);
  const now = nowISO();
  const totals = input.rows.reduce(
    (sum, row) => ({ debit: sum.debit + Math.round(row.debit), credit: sum.credit + Math.round(row.credit) }),
    { debit: 0, credit: 0 },
  );

  // Every code the trial balance mentions becomes an account, so the journal can
  // join it and the balance sheet can classify it. An account that already
  // exists keeps its label and type: an import never rewrites the chart.
  const accountCodes = [...new Set([...input.rows.map((row) => row.code), codes.retainedEarnings])];
  await database.batch(
    accountCodes.map((code) => {
      const row = input.rows.find((item) => item.code === code);
      const balance = row ? Math.round(row.debit) - Math.round(row.credit) : 0;
      return database
        .prepare(
          `INSERT OR IGNORE INTO accounts (code, label, type, is_active, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(code, row?.label || (code === codes.retainedEarnings ? 'Report à nouveau' : `Compte ${code}`), typeFromCode(code, balance), now, now);
    }),
  );

  const existing = await database
    .prepare(`SELECT id FROM journal_entries WHERE source_type = 'opening' AND source_id = ? AND event = 'imported'`)
    .bind(OPENING_SOURCE_ID)
    .first<{ id: string }>();
  if (existing) {
    await database.batch([
      database.prepare(`DELETE FROM journal_lines WHERE entry_id = ?`).bind(existing.id),
      database.prepare(`DELETE FROM journal_entries WHERE id = ?`).bind(existing.id),
    ]);
  }

  await post(database, {
    id: OPENING_SOURCE_ID,
    source_type: 'opening',
    source_id: OPENING_SOURCE_ID,
    event: 'imported',
    date: input.date,
    reference: 'AN',
    label: 'Reprise de balance',
    journal: OPENING_JOURNAL,
    lines: openingLines(input.rows, codes),
  });

  return { lines: input.rows.filter((row) => row.debit > 0 || row.credit > 0).length, difference: totals.debit - totals.credit };
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
