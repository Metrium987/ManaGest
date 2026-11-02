import { describe, expect, it } from 'vitest';
import { isBalanced } from '../server/lib/accounting';
import { creditLines, invoiceLines } from '../server/lib/accounting';
import { groupRevenue, resolveAccount } from '../server/lib/account-resolution';

const document = {
  number: 'FA-2026-0001',
  date: '2026-11-02',
  subtotal: 100_000,
  discountTotal: 0,
  taxTotal: 16_000,
  total: 116_000,
  taxExempt: false,
};

describe('account cascade (Q2)', () => {
  it('lets the line win over the article, the family and the chart', () => {
    expect(resolveAccount({ line: '706500', product: '706400', family: '706100', fallback: '706000' }))
      .toBe('706500');
  });

  it('lets the article win over its family', () => {
    expect(resolveAccount({ product: '706400', family: '706100', fallback: '706000' })).toBe('706400');
  });

  it('falls back to the family mapping', () => {
    expect(resolveAccount({ family: '706100', fallback: '706000' })).toBe('706100');
  });

  it('falls back to the chart when nothing is set', () => {
    expect(resolveAccount({ fallback: '706000' })).toBe('706000');
    expect(resolveAccount({ product: '  ', family: '', fallback: '706000' })).toBe('706000');
  });
});

describe('revenue split on the journal', () => {
  it('posts one revenue line per account when nothing is asked', () => {
    const lines = invoiceLines(document);
    expect(lines.filter((entry) => entry.credit > 0 && entry.account_code !== '445710')).toHaveLength(1);
  });

  it('splits the revenue across the accounts given', () => {
    const lines = invoiceLines(document, [
      { account_code: '706100', amount: 60_000 },
      { account_code: '706200', amount: 40_000 },
    ]);
    const revenue = lines.filter((entry) => entry.account_code.startsWith('706'));
    expect(revenue.map((entry) => entry.account_code)).toEqual(['706100', '706200']);
    expect(revenue.map((entry) => entry.credit)).toEqual([60_000, 40_000]);
    expect(isBalanced(lines)).toBe(true);
  });

  it('keeps the total exactly equal to the net revenue when the split does not add up', () => {
    const lines = invoiceLines(document, [
      { account_code: '706100', amount: 33_333 },
      { account_code: '706200', amount: 66_667 },
    ]);
    const revenue = lines.filter((entry) => entry.account_code.startsWith('706'));
    expect(revenue.reduce((sum, entry) => sum + entry.credit, 0)).toBe(100_000);
    expect(isBalanced(lines)).toBe(true);
  });

  it('ignores an empty split and posts the chart default', () => {
    const lines = invoiceLines(document, []);
    expect(lines.some((entry) => entry.account_code === '706000' && entry.credit === 100_000)).toBe(true);
  });

  it('reverses the same accounts on a credit note', () => {
    const split = [
      { account_code: '706100', amount: 60_000 },
      { account_code: '706200', amount: 40_000 },
    ];
    const lines = creditLines(document, split);
    const revenue = lines.filter((entry) => entry.account_code.startsWith('706'));
    expect(revenue.map((entry) => entry.debit)).toEqual([60_000, 40_000]);
    expect(revenue.every((entry) => entry.credit === 0)).toBe(true);
    expect(isBalanced(lines)).toBe(true);
  });

  it('groups the same account once, in first-seen order', () => {
    expect(groupRevenue([
      { account: '706200', amount: 10 },
      { account: '706100', amount: 5 },
      { account: '706200', amount: 7.4 },
    ])).toEqual([
      { account_code: '706200', amount: 17 },
      { account_code: '706100', amount: 5 },
    ]);
  });
});
