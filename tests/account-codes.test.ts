import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCOUNT_CODES,
  accountCodeError,
  accountCodesWith,
  duplicateAccountCode,
  type AccountCodes,
} from '../shared/accounts';
import {
  expenseLines,
  invoiceLines,
  openingLines,
  paymentLines,
  type DocumentAmounts,
} from '../server/lib/accounting';
import { importVatLines } from '../server/lib/import-vat';
import { groupRevenue } from '../server/lib/account-resolution';

const invoice: DocumentAmounts = {
  number: 'FAC-2026-0001',
  date: '2026-11-02',
  subtotal: 100_000,
  discountTotal: 0,
  taxTotal: 16_000,
  total: 116_000,
};

/** A workspace that groups its revenue and settles through its own accounts. */
const custom: AccountCodes = {
  client: '411100',
  supplier: '401100',
  sales: '706100',
  deferred: '487100',
  bank: '512100',
  expense: '606100',
  vatDue: '445711',
  vatDeductible: '445661',
  retainedEarnings: '110100',
};

const codesOf = (lines: { account_code: string }[]) => lines.map((line) => line.account_code);

describe('chart codes are settings, not constants', () => {
  it('defaults follow the shared PCG table', () => {
    expect(DEFAULT_ACCOUNT_CODES.sales).toBe('706000');
    expect(DEFAULT_ACCOUNT_CODES.deferred).toBe('487000');
    expect(new Set(Object.values(DEFAULT_ACCOUNT_CODES)).size).toBe(9);
  });

  it('an invoice posts to the configured receivable, revenue and VAT accounts', () => {
    const lines = invoiceLines(invoice, null, custom);
    expect(codesOf(lines)).toEqual(['411100', '706100', '445711']);
    expect(lines.find((line) => line.account_code === '411100')?.debit).toBe(116_000);
    expect(lines.find((line) => line.account_code === '706100')?.credit).toBe(100_000);
  });

  it('a payment and an expense follow the same settings', () => {
    expect(codesOf(paymentLines(116_000, 'REG-1', custom))).toEqual(['512100', '411100']);
    const expense = expenseLines(11_600, 1_600, 'DEP-1', custom);
    expect(codesOf(expense)).toEqual(['606100', '445661', '401100']);
  });

  it('the opening imbalance is carried to the configured retained earnings', () => {
    const lines = openingLines([{ code: '411000', debit: 50_000, credit: 0 }], custom);
    expect(lines.find((line) => line.account_code === '110100')?.credit).toBe(50_000);
  });

  it('import VAT uses the configured deductible VAT and settlement accounts', () => {
    const lines = importVatLines({
      vat: 16_000,
      recoverable: true,
      settlement: 'supplier',
      productName: 'Perceuse',
      reference: 'LC-1',
      accounts: custom,
    });
    expect(codesOf(lines)).toEqual(['445661', '401100']);
  });

  it('the revenue fallback of the split follows the setting', () => {
    expect(groupRevenue([{ account: '  ', amount: 10 }], custom.sales)).toEqual([
      { account_code: '706100', amount: 10 },
    ]);
  });

  it('rejects a code that is not a PCG account', () => {
    expect(accountCodeError('706100')).toBeNull();
    expect(accountCodeError(' 706100 ')).toBeNull();
    expect(accountCodeError('abc')).toBe('invalid_code');
    expect(accountCodeError('70610O')).toBe('invalid_code');
    expect(accountCodeError('70')).toBe('invalid_code');
  });

  it('refuses two roles sharing one code', () => {
    expect(duplicateAccountCode({ sales: '706000', deferred: '487000' })).toBeNull();
    expect(duplicateAccountCode({ sales: '706000', deferred: ' 706000 ' })).toBe('deferred');
    // A partial batch only compares what it touches.
    expect(duplicateAccountCode({ client: '411000' })).toBeNull();
  });

  it('a stored setting wins over the default and a blank one does not', () => {
    expect(accountCodesWith({ sales: '706300' }).sales).toBe('706300');
    expect(accountCodesWith({ sales: '  ' }).sales).toBe(DEFAULT_ACCOUNT_CODES.sales);
    expect(accountCodesWith({}).bank).toBe(DEFAULT_ACCOUNT_CODES.bank);
  });
});
