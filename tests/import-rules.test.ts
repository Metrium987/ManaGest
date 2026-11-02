import { describe, expect, it } from 'vitest';
import { LOCAL_TAX_RATES, parseCsv, validateImport } from '../server/lib/import';

const header = 'référence;nom;prix unitaire;tva;suivi stock';

function row(reference: string, name: string, tva: string): string {
  return `${reference};${name};1500;${tva};0`;
}

describe('import rules agreed with the owner (H4)', () => {
  it('only the local VAT rates are declared', () => {
    expect([...LOCAL_TAX_RATES]).toEqual([0, 1, 5, 13, 16]);
  });

  it('accepts a local rate', () => {
    const parsed = parseCsv(`\uFEFF${header}\n${row('PREST-1', 'Conseil', '16')}\n`);
    const result = validateImport('products', parsed);
    expect(result.invalidCount).toBe(0);
    expect(result.rows[0].valid).toBe(true);
  });

  it('refuses a row whose VAT rate is not a local rate, line by line (H4.4)', () => {
    const parsed = parseCsv(`\uFEFF${header}\n${row('PREST-1', 'Conseil', '8')}\n${row('PREST-2', 'Support', '5')}\n`);
    const result = validateImport('products', parsed);
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].issues).toEqual([
      { row: 2, field: 'tva', code: 'unknown_tax_rate' },
    ]);
    // The valid row beside it is untouched: the refusal is per line, not per file.
    expect(result.rows[1].valid).toBe(true);
    expect(result.invalidCount).toBe(1);
    expect(result.validCount).toBe(1);
  });

  it('still detects a duplicate inside the same file (H4.5)', () => {
    const parsed = parseCsv(`\uFEFF${header}\n${row('PREST-1', 'Conseil', '16')}\n${row('PREST-1', 'Conseil bis', '16')}\n`);
    const result = validateImport('products', parsed);
    const codes = result.rows.flatMap((entry) => entry.issues.map((issue) => issue.code));
    expect(codes).toContain('duplicate_in_file');
    expect(result.invalidCount).toBe(2);
  });
});
