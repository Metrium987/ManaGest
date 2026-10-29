/**
 * Accounting core (AUDIT §7 P0.1–P0.2): the chart of accounts, the journals and
 * the double-entry lines derived from the documents.
 *
 * Everything here is pure. The posting service only stores what these functions
 * compute, so the rule « debits equal credits » is proved by test instead of being
 * hoped for in SQL.
 */

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
}

export type JournalCode = 'VE' | 'AC' | 'BQ' | 'OD';

export interface DocumentAmounts {
  number: string | null;
  date: string;
  subtotal: number;
  discountTotal: number;
  taxTotal: number;
  total: number;
  taxExempt?: boolean;
}

/** The minimal chart the documents need. Codes follow the French PCG. */
export const CHART: Account[] = [
  { code: '401000', label: 'Fournisseurs', type: 'liability' },
  { code: '411000', label: 'Clients', type: 'asset' },
  { code: '445660', label: 'TVA déductible', type: 'asset' },
  { code: '445710', label: 'TVA collectée', type: 'liability' },
  { code: '512000', label: 'Banque', type: 'asset' },
  { code: '606000', label: 'Achats et charges externes', type: 'expense' },
  { code: '706000', label: 'Prestations de services', type: 'income' },
];

const CLIENT = '411000';
const SUPPLIER = '401000';
const VAT_DUE = '445710';
const VAT_DEDUCTIBLE = '445660';
const BANK = '512000';
const SALES = '706000';
const EXPENSE = '606000';

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
export function invoiceLines(document: DocumentAmounts): DraftLine[] {
  const reference = document.number ?? '—';
  const lines = [
    line(CLIENT, `Facture ${reference}`, document.total, 0),
    line(SALES, `Facture ${reference}`, 0, netRevenue(document)),
  ];
  if (!document.taxExempt && document.taxTotal > 0) {
    lines.push(line(VAT_DUE, `TVA collectée ${reference}`, 0, document.taxTotal));
  }
  return lines;
}

/** A credit note reverses exactly what the invoice posted, same accounts. */
export function creditLines(document: DocumentAmounts): DraftLine[] {
  return invoiceLines(document).map((entry) => ({
    ...entry,
    debit: entry.credit,
    credit: entry.debit,
  }));
}

/** An invoice cancelled after issue is reversed, never deleted from the journal. */
export function reversalLines(document: DocumentAmounts): DraftLine[] {
  return creditLines(document);
}

export function paymentLines(amount: number, reference: string): DraftLine[] {
  return [
    line(BANK, `Encaissement ${reference}`, amount, 0),
    line(CLIENT, `Encaissement ${reference}`, 0, amount),
  ];
}

/** An expense is recorded at its pre-tax amount plus deductible VAT. */
export function expenseLines(amount: number, taxAmount: number, reference: string): DraftLine[] {
  const lines = [line(EXPENSE, `Dépense ${reference}`, Math.max(0, amount - taxAmount), 0)];
  if (taxAmount > 0) lines.push(line(VAT_DEDUCTIBLE, `TVA déductible ${reference}`, taxAmount, 0));
  lines.push(line(SUPPLIER, `Dépense ${reference}`, 0, amount));
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

/**
 * Simplified income statement: income accounts (7) are credited, expense accounts
 * (6) are debited, and the difference is the result. The balance sheet is not
 * derived here — assets and liabilities need opening balances that this module
 * does not invent.
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
