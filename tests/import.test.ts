import { describe, expect, it } from 'vitest';
import { detectDelimiter, parseCsv, templateCsv, toBoolean, validateImport } from '../server/lib/import';

describe('CSV parsing (T-102a)', () => {
  it('auto-detects the delimiter from the header row', () => {
    expect(detectDelimiter('nom;courriel;commune')).toBe(';');
    expect(detectDelimiter('nom,courriel,commune')).toBe(',');
  });

  it('parses quoted cells, doubled quotes and CRLF', () => {
    const parsed = parseCsv('\uFEFFnom;notes\r\n"Hôtel ""Manava""";Papeete\r\n');
    expect(parsed.header).toEqual(['nom', 'notes']);
    expect(parsed.rows).toEqual([['Hôtel "Manava"', 'Papeete']]);
  });

  it('keeps a quoted cell containing the delimiter whole', () => {
    const parsed = parseCsv('nom;notes\n"Dupont, Jean";ok\n');
    expect(parsed.rows[0]).toEqual(['Dupont, Jean', 'ok']);
  });

  it('drops blank trailing lines', () => {
    expect(parseCsv('a;b\n1;2\n\n').rows).toHaveLength(1);
  });
});

describe('import templates and validation (T-102a / OQ-015)', () => {
  it('a downloaded template round-trips: annotation row skipped, example row valid', () => {
    const csv = templateCsv('clients');
    const result = validateImport('clients', parseCsv(csv));
    expect(result.missingColumns).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.validCount).toBe(1);
  });

  it('product template example also passes validation', () => {
    const result = validateImport('products', parseCsv(templateCsv('products')));
    expect(result.validCount).toBe(1);
    expect(result.invalidCount).toBe(0);
  });

  it('GIVEN a missing required name WHEN previewed THEN the row is invalid and names the field', () => {
    const result = validateImport('clients', parseCsv('nom;courriel\n;Billy@example.pf\n'));
    expect(result.invalidCount).toBe(1);
    expect(result.errors[0]).toMatchObject({ row: 2, field: 'nom', code: 'required' });
  });

  it('GIVEN a duplicate unique key in one file WHEN previewed THEN both rows are flagged', () => {
    const result = validateImport('clients', parseCsv('nom;courriel\nA;a@x.pf\nB;a@x.pf\n'));
    expect(result.invalidCount).toBe(2);
    expect(result.errors.filter((issue) => issue.code === 'duplicate_in_file')).toHaveLength(2);
  });

  it('GIVEN a missing required column WHEN previewed THEN the column is named', () => {
    const result = validateImport('products', parseCsv('description;prix unitaire\nDesc;100\n'));
    expect(result.missingColumns).toEqual(['nom']);
  });

  it('optional columns may be omitted and take their defaults', () => {
    const result = validateImport('products', parseCsv('nom\nProduit\n'));
    expect(result.missingColumns).toEqual([]);
    expect(result.validCount).toBe(1);
  });

  it('GIVEN a boolean or integer field with free text WHEN previewed THEN it is refused', () => {
    const result = validateImport('products', parseCsv('référence;nom;description;prix unitaire;coût;stock (millièmes);suivi stock;tva\nP1;Nom;D;10;0;0;peut-être;16\n'));
    expect(result.invalidCount).toBe(1);
    expect(result.errors[0].code).toBe('expected_boolean');
  });

  it('reads French yes/no as booleans', () => {
    expect(toBoolean('oui')).toBe(1);
    expect(toBoolean('0')).toBe(0);
    expect(toBoolean('false')).toBe(0);
  });
});
