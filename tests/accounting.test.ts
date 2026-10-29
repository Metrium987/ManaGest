import { describe, expect, it } from 'vitest';
import {
  CHART,
  creditLines,
  expenseLines,
  incomeStatement,
  invoiceLines,
  isBalanced,
  paymentLines,
  reversalLines,
  trialBalance,
  type DocumentAmounts,
} from '../server/lib/accounting';

const invoice: DocumentAmounts = {
  number: 'FAC-2026-0001',
  date: '2026-10-01',
  subtotal: 25_000,
  discountTotal: 0,
  taxTotal: 3_450,
  total: 28_450,
};

describe('double entry is built, not hoped for', () => {
  it('an invoice debits the client and credits revenue plus VAT', () => {
    const lines = invoiceLines(invoice);
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((line) => line.account_code === '411000')?.debit).toBe(28_450);
    expect(lines.find((line) => line.account_code === '706000')?.credit).toBe(25_000);
    expect(lines.find((line) => line.account_code === '445710')?.credit).toBe(3_450);
  });

  it('an exempt invoice carries no VAT line at all', () => {
    const lines = invoiceLines({ ...invoice, taxTotal: 0, total: 25_000, taxExempt: true });
    expect(lines.some((line) => line.account_code === '445710')).toBe(false);
    expect(isBalanced(lines)).toBe(true);
  });

  it('a discount reduces revenue, not the receivable', () => {
    const lines = invoiceLines({ ...invoice, discountTotal: 5_000, taxTotal: 3_200, total: 23_200 });
    expect(lines.find((line) => line.account_code === '706000')?.credit).toBe(20_000);
    expect(lines.find((line) => line.account_code === '411000')?.debit).toBe(23_200);
    expect(isBalanced(lines)).toBe(true);
  });

  it('a credit note is the exact reversal of the invoice', () => {
    const lines = creditLines(invoice);
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((line) => line.account_code === '411000')).toMatchObject({ debit: 0, credit: 28_450 });
    expect(reversalLines(invoice)).toEqual(lines);
  });

  it('a payment moves the bank and clears the client', () => {
    const lines = paymentLines(28_450, 'REG-1');
    expect(isBalanced(lines)).toBe(true);
    expect(lines[0]).toMatchObject({ account_code: '512000', debit: 28_450 });
    expect(lines[1]).toMatchObject({ account_code: '411000', credit: 28_450 });
  });

  it('an expense splits the pre-tax amount and the deductible VAT', () => {
    const lines = expenseLines(11_600, 1_600, 'DEP-1');
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((line) => line.account_code === '606000')?.debit).toBe(10_000);
    expect(lines.find((line) => line.account_code === '445660')?.debit).toBe(1_600);
    expect(lines.find((line) => line.account_code === '401000')?.credit).toBe(11_600);
  });
});

describe('statements', () => {
  const accounts = CHART;
  const posted = [
    ...invoiceLines(invoice),
    ...paymentLines(28_450, 'REG-1'),
    ...expenseLines(11_600, 1_600, 'DEP-1'),
  ].map((line) => ({ account_code: line.account_code, debit: line.debit, credit: line.credit }));

  it('the trial balance totals are equal', () => {
    const balance = trialBalance(posted, accounts);
    expect(balance.total_debit).toBe(balance.total_credit);
    expect(balance.rows.length).toBeGreaterThan(0);
  });

  it('the income statement nets revenue against expenses', () => {
    const statement = incomeStatement(posted, accounts);
    expect(statement.income).toBe(25_000);
    expect(statement.expense).toBe(10_000);
    expect(statement.result).toBe(15_000);
  });

  it('an empty journal produces a zero result rather than an error', () => {
    expect(incomeStatement([], accounts).result).toBe(0);
    expect(trialBalance([], accounts).rows).toEqual([]);
  });
});
