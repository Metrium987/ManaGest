/**
 * Accounting core (AUDIT §7 P0.1–P0.2): the chart of accounts, the journals and
 * the double-entry lines derived from the documents.
 *
 * Everything here is pure. The posting service only stores what these functions
 * compute, so the rule « debits equal credits » is proved by test instead of being
 * hoped for in SQL.
 */

import { DEFAULT_ACCOUNT_CODES, type AccountCodes } from '../../shared/accounts';

export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface Account {
  code: string;
  label: string;
  type: AccountType;
}

export interface DraftLine {
  account_code: string;
  label: string;
  debit: number;
  credit: number;
  /** Document currency of the figure behind this line, for the journal view. */
  currency?: string | null;
  /** Amount in the document's own currency (minor units). */
  original_amount?: number | null;
  /** XPF for one unit of the document currency, frozen with the document. */
  exchange_rate?: number | null;
}

export type JournalCode = 'VE' | 'AC' | 'BQ' | 'OD' | 'AN';

export interface DocumentAmounts {
  number: string | null;
  date: string;
  /** Amounts in the document currency; converted when `xpf` is present. */
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  taxExempt?: boolean;
  currency?: string;
  exchangeRate?: number;
  xpf?: { subtotal: number; discountTotal: number; taxTotal: number; total: number };
}

/** The minimal chart the documents need. Codes follow the French PCG; the
 * defaults come from the shared table so the seeds and the settings cannot
 * disagree. */
export const CHART: Account[] = [
  { code: DEFAULT_ACCOUNT_CODES.supplier, label: 'Fournisseurs', type: 'liability' },
  { code: DEFAULT_ACCOUNT_CODES.client, label: 'Clients', type: 'asset' },
  { code: DEFAULT_ACCOUNT_CODES.vatDeductible, label: 'TVA déductible', type: 'asset' },
  { code: DEFAULT_ACCOUNT_CODES.vatDue, label: 'TVA collectée', type: 'liability' },
  { code: DEFAULT_ACCOUNT_CODES.bank, label: 'Banque', type: 'asset' },
  { code: DEFAULT_ACCOUNT_CODES.expense, label: 'Achats et charges externes', type: 'expense' },
  { code: DEFAULT_ACCOUNT_CODES.sales, label: 'Prestations de services', type: 'income' },
  // E3: revenue billed in advance and not earned yet.
  { code: DEFAULT_ACCOUNT_CODES.deferred, label: 'Produits constatés d’avance', type: 'liability' },
  // Multi-currency: realised differences on settlement.
  { code: DEFAULT_ACCOUNT_CODES.fxGain, label: 'Gains de change', type: 'income' },
  { code: DEFAULT_ACCOUNT_CODES.fxLoss, label: 'Pertes de change', type: 'expense' },
];

/** Q2: the account a sale posts its revenue to until the workspace says
 * otherwise. The effective value is a setting, loaded by the posting service. */
export const DEFAULT_SALES_ACCOUNT = DEFAULT_ACCOUNT_CODES.sales;

/** Revenue carried by one account, as computed from the document's lines. */
export interface RevenueSplit {
  account_code: string;
  amount: number;
}

function line(account: string, label: string, debit: number, credit: number): DraftLine {
  return { account_code: account, label, debit: Math.max(0, Math.round(debit)), credit: Math.max(0, Math.round(credit)) };
}

function netRevenue(document: DocumentAmounts): number {
  // Revenue is what remains once the discount is taken off the taxable base.
  return Math.max(0, document.subtotal - document.discountTotal);
}

/**
 * An issued invoice opens a receivable: debit clients, credit revenue, credit
 * the VAT collected. A fully exempt document has no VAT line at all rather than a
 * zero-rate bucket (BK-001), so the journal never invents a 0 % tax.
 */
/**
 * Q2: revenue may post to several accounts (one per article, or per family)
 * instead of a single 706000. The split is computed by the caller, which is the
 * only one that knows the catalogue; here it is scaled to the document's net
 * revenue and the last account absorbs the rounding, so the entry still balances
 * to the franc and the total is exactly the revenue.
 */
function revenueLines(
  document: DocumentAmounts,
  reference: string,
  split?: RevenueSplit[] | null,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  const revenue = netRevenue(document);
  const useful = (split ?? []).filter((entry) => Math.round(Number(entry.amount) || 0) !== 0);
  if (!useful.length) return [line(accounts.sales, `Facture ${reference}`, 0, revenue)];

  const weight = useful.reduce((sum, entry) => sum + Math.round(entry.amount), 0);
  let allocated = 0;
  return useful.map((entry, index) => {
    const amount = index === useful.length - 1
      ? revenue - allocated
      : Math.round(weight ? (revenue * Math.round(entry.amount)) / weight : 0);
    allocated += amount;
    return line(entry.account_code, `Facture ${reference}`, 0, amount);
  });
}

export function invoiceLines(
  document: DocumentAmounts,
  split?: RevenueSplit[] | null,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  const reference = document.number ?? '—';
  const base = document.xpf;
  const currency = document.currency ?? 'XPF';
  const rate = currency === 'XPF' ? 1 : document.exchangeRate ?? 1;
  const receivable = base ? base.total : document.total;
  const tax = base ? base.taxTotal : document.taxTotal;
  const netBase = base ? Math.max(0, base.subtotal - base.discountTotal) : netRevenue(document);
  const netOriginal = netRevenue(document);
  // Revenue lines are computed in base currency; their original equivalent is
  // apportioned from the same split, so the journal shows both without inventing
  // a second breakdown.
  const revenueDocument = base
    ? { ...document, subtotal: base.subtotal, discountTotal: base.discountTotal, taxTotal: base.taxTotal, total: base.total }
    : document;
  const revenue = revenueLines(revenueDocument, reference, split, accounts).map((entry) => ({
    ...entry,
    currency,
    exchange_rate: rate,
    original_amount: netBase > 0 ? Math.round(entry.credit * (netOriginal / netBase)) : 0,
  }));
  const lines: DraftLine[] = [
    { ...line(accounts.client, `Facture ${reference}`, receivable, 0), currency, exchange_rate: rate, original_amount: document.total },
    ...revenue,
  ];
  if (!document.taxExempt && tax > 0) {
    lines.push({
      ...line(accounts.vatDue, `TVA collectée ${reference}`, 0, tax),
      currency, exchange_rate: rate, original_amount: document.taxTotal,
    });
  }
  return lines;
}

/** A credit note reverses exactly what the invoice posted, same accounts. */
export function creditLines(
  document: DocumentAmounts,
  split?: RevenueSplit[] | null,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  return invoiceLines(document, split, accounts).map((entry) => ({
    ...entry,
    debit: entry.credit,
    credit: entry.debit,
  }));
}

/** An invoice cancelled after issue is reversed, never deleted from the journal. */
export function reversalLines(
  document: DocumentAmounts,
  split?: RevenueSplit[] | null,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  return creditLines(document, split, accounts);
}

export function paymentLines(
  amount: number,
  reference: string,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
  settlement?: {
    currency?: string;
    exchangeRate?: number;
    originalAmount?: number;
    /** Receivable relieved at the invoice's frozen rate. Defaults to `amount`. */
    receivable?: number;
    /** Positive = gain (766), negative = loss (666). */
    difference?: number;
  },
): DraftLine[] {
  const receivable = settlement?.receivable ?? amount;
  const difference = settlement?.difference ?? 0;
  const currency = settlement?.currency ?? 'XPF';
  const rate = currency === 'XPF' ? 1 : settlement?.exchangeRate ?? 1;
  const annotate = (entry: DraftLine, original: number): DraftLine => ({
    ...entry, currency, exchange_rate: rate, original_amount: original,
  });
  const lines: DraftLine[] = [
    annotate(line(accounts.bank, `Encaissement ${reference}`, amount, 0), settlement?.originalAmount ?? amount),
    annotate(line(accounts.client, `Encaissement ${reference}`, 0, receivable), settlement?.originalAmount ?? amount),
  ];
  if (difference > 0) {
    lines.push(line(accounts.fxGain, `Écart de change ${reference}`, 0, difference));
  } else if (difference < 0) {
    lines.push(line(accounts.fxLoss, `Écart de change ${reference}`, -difference, 0));
  }
  return lines;
}

/**
 * A-05: a voided payment is reversed, never erased — the journal is append-only.
 * The mirror also flips the realised difference, so the gain or loss it booked is
 * extinguished in the same move.
 */
export function paymentReversalLines(
  amount: number,
  reference: string,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
  settlement?: Parameters<typeof paymentLines>[3],
): DraftLine[] {
  return paymentLines(amount, reference, accounts, settlement).map((entry) => ({
    ...entry,
    debit: entry.credit,
    credit: entry.debit,
  }));
}

/** A-05: a deleted expense gives back the charge and the deductible VAT. */
export function expenseReversalLines(
  amount: number,
  taxAmount: number,
  reference: string,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  return expenseLines(amount, taxAmount, reference, accounts).map((entry) => ({
    ...entry,
    debit: entry.credit,
    credit: entry.debit,
  }));
}

/** An expense is recorded at its pre-tax amount plus deductible VAT. */
export function expenseLines(
  amount: number,
  taxAmount: number,
  reference: string,
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  const lines = [line(accounts.expense, `Dépense ${reference}`, Math.max(0, amount - taxAmount), 0)];
  if (taxAmount > 0) lines.push(line(accounts.vatDeductible, `TVA déductible ${reference}`, taxAmount, 0));
  lines.push(line(accounts.supplier, `Dépense ${reference}`, 0, amount));
  return lines;
}

export function isBalanced(lines: readonly DraftLine[]): boolean {
  return lines.reduce((sum, entry) => sum + entry.debit, 0)
    === lines.reduce((sum, entry) => sum + entry.credit, 0);
}

export function totalsOf(lines: readonly DraftLine[]): { debit: number; credit: number } {
  return {
    debit: lines.reduce((sum, entry) => sum + entry.debit, 0),
    credit: lines.reduce((sum, entry) => sum + entry.credit, 0),
  };
}

export interface BalanceRow {
  account_code: string;
  label: string;
  type: AccountType | null;
  debit: number;
  credit: number;
  balance: number;
}

/** Trial balance: one row per account that moved, and a zero grand total. */
export function trialBalance(
  lines: readonly { account_code: string; debit: number; credit: number }[],
  accounts: readonly Account[],
): { rows: BalanceRow[]; total_debit: number; total_credit: number } {
  const byCode = new Map<string, { debit: number; credit: number }>();
  for (const entry of lines) {
    const current = byCode.get(entry.account_code) ?? { debit: 0, credit: 0 };
    current.debit += entry.debit;
    current.credit += entry.credit;
    byCode.set(entry.account_code, current);
  }
  const rows: BalanceRow[] = [...byCode.entries()]
    .map(([code, sums]) => {
      const account = accounts.find((item) => item.code === code);
      return {
        account_code: code,
        label: account?.label ?? code,
        type: account?.type ?? null,
        debit: sums.debit,
        credit: sums.credit,
        balance: sums.debit - sums.credit,
      };
    })
    .sort((a, b) => a.account_code.localeCompare(b.account_code));
  return {
    rows,
    total_debit: rows.reduce((sum, row) => sum + row.debit, 0),
    total_credit: rows.reduce((sum, row) => sum + row.credit, 0),
  };
}

export interface IncomeStatement {
  income: number;
  expense: number;
  result: number;
  rows: { account_code: string; label: string; type: AccountType; amount: number }[];
}

/** Journal of the opening balances (à-nouveaux). */
export const OPENING_JOURNAL: JournalCode = 'AN';

export const OPENING_SOURCE_ID = 'balances';

/** Where an imbalance of the opening trial balance is carried. */
export const RETAINED_EARNINGS = DEFAULT_ACCOUNT_CODES.retainedEarnings;

/**
 * Accounting class from the PCG code. Class 4 and 5 accounts sit on either side
 * of the balance, so their type follows the side of the imported balance rather
 * than the code alone.
 */
export function typeFromCode(code: string, balance = 0): AccountType {
  switch (code.charAt(0)) {
    case '1': return 'equity';
    case '2':
    case '3': return 'asset';
    case '4':
    case '5': return balance < 0 ? 'liability' : 'asset';
    case '6': return 'expense';
    case '7': return 'income';
    default: return 'asset';
  }
}

export interface OpeningRow {
  code: string;
  label?: string;
  debit: number;
  credit: number;
}

/**
 * Opening balances as a **balanced** entry. A trial balance rarely adds up on
 * its own — the prior year's result has not been allocated yet — so the
 * difference is carried to report à nouveau instead of being refused or, worse,
 * silently rounded into an account.
 */
export function openingLines(
  rows: readonly OpeningRow[],
  accounts: AccountCodes = DEFAULT_ACCOUNT_CODES,
): DraftLine[] {
  const lines = rows
    .filter((row) => Math.round(row.debit) > 0 || Math.round(row.credit) > 0)
    .map((row) => line(row.code, row.label || `Reprise ${row.code}`, row.debit, row.credit));
  const totals = totalsOf(lines);
  const difference = totals.debit - totals.credit;
  if (difference > 0) lines.push(line(accounts.retainedEarnings, 'Report à nouveau', 0, difference));
  if (difference < 0) lines.push(line(accounts.retainedEarnings, 'Report à nouveau', -difference, 0));
  return lines;
}

export interface BalanceSheet {
  assets: BalanceRow[];
  liabilities: BalanceRow[];
  equity: BalanceRow[];
  result: number;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  balanced: boolean;
}

/**
 * Simplified balance sheet: classes 2–5 by side, plus the year's result from the
 * income statement. It is only meaningful once opening balances exist, which is
 * why it is derived here and not invented from what the documents happen to say.
 */
export function balanceSheet(
  lines: readonly { account_code: string; debit: number; credit: number }[],
  accounts: readonly Account[],
): BalanceSheet {
  const balance = trialBalance(lines, accounts);
  const assets: BalanceRow[] = [];
  const liabilities: BalanceRow[] = [];
  const equity: BalanceRow[] = [];
  for (const row of balance.rows) {
    if (row.balance === 0) continue;
    if (row.type === 'asset') assets.push(row);
    else if (row.type === 'liability') liabilities.push({ ...row, balance: -row.balance });
    else if (row.type === 'equity') equity.push({ ...row, balance: -row.balance });
  }
  const result = incomeStatement(lines, accounts).result;
  const total_assets = assets.reduce((sum, row) => sum + row.balance, 0);
  const total_liabilities = liabilities.reduce((sum, row) => sum + row.balance, 0);
  const total_equity = equity.reduce((sum, row) => sum + row.balance, 0) + result;
  return {
    assets, liabilities, equity, result, total_assets, total_liabilities, total_equity,
    balanced: total_assets === total_liabilities + total_equity,
  };
}

/**
 * Simplified income statement: income accounts (7) are credited, expense accounts
 * (6) are debited, and the difference is the result.
 */
export function incomeStatement(
  lines: readonly { account_code: string; debit: number; credit: number }[],
  accounts: readonly Account[],
): IncomeStatement {
  const rows: IncomeStatement['rows'] = [];
  for (const account of accounts) {
    if (account.type !== 'income' && account.type !== 'expense') continue;
    const own = lines.filter((entry) => entry.account_code === account.code);
    if (!own.length) continue;
    const debit = own.reduce((sum, entry) => sum + entry.debit, 0);
    const credit = own.reduce((sum, entry) => sum + entry.credit, 0);
    const amount = account.type === 'income' ? credit - debit : debit - credit;
    rows.push({ account_code: account.code, label: account.label, type: account.type, amount });
  }
  const income = rows.filter((row) => row.type === 'income').reduce((sum, row) => sum + row.amount, 0);
  const expense = rows.filter((row) => row.type === 'expense').reduce((sum, row) => sum + row.amount, 0);
  return { income, expense, result: income - expense, rows };
}
