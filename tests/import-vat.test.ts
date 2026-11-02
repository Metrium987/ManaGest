import { describe, expect, it } from 'vitest';
import { isBalanced, totalsOf } from '../server/lib/accounting';
import { VAT_ON_IMPORTS, importVatLines } from '../server/lib/import-vat';

const base = {
  vat: 21_850,
  recoverable: true,
  settlement: 'supplier' as const,
  productName: 'Perceuse',
  reference: 'LC-ABCD1234',
};

describe('import VAT entry', () => {
  it('debits deductible VAT and credits the transitaire who advanced it', () => {
    const lines = importVatLines(base);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ account_code: VAT_ON_IMPORTS, debit: 21_850, credit: 0 });
    expect(lines[1]).toMatchObject({ account_code: '401000', debit: 0, credit: 21_850 });
    expect(isBalanced(lines)).toBe(true);
  });

  it('credits the bank when the customs office is paid directly', () => {
    const lines = importVatLines({ ...base, settlement: 'bank' });
    expect(lines[1].account_code).toBe('512000');
    expect(isBalanced(lines)).toBe(true);
  });

  it('posts nothing under the franchise en base', () => {
    expect(importVatLines({ ...base, recoverable: false })).toEqual([]);
  });

  it('posts nothing when no VAT was paid', () => {
    expect(importVatLines({ ...base, vat: 0 })).toEqual([]);
  });

  it('never invents a negative or fractional amount', () => {
    const lines = importVatLines({ ...base, vat: 1_000.6 });
    const totals = totalsOf(lines);
    expect(totals.debit).toBe(1_001);
    expect(totals.credit).toBe(1_001);
  });
});
