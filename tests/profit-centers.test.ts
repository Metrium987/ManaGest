import { describe, expect, it } from 'vitest';
import {
  aggregateProfitCenters,
  isValidProfitCenter,
  normaliseProfitCenter,
} from '../shared/profit-centers';

describe('profit centre codes', () => {
  it('upper-cases and trims what it is given', () => {
    expect(normaliseProfitCenter('  atelier ')).toBe('ATELIER');
    expect(normaliseProfitCenter('vente en ligne')).toBe('VENTE-EN-LIGNE');
    expect(normaliseProfitCenter('')).toBeNull();
    expect(normaliseProfitCenter(null)).toBeNull();
  });

  it('accepts short alphanumeric codes only', () => {
    expect(isValidProfitCenter('ATELIER')).toBe(true);
    expect(isValidProfitCenter('MAG-1')).toBe(true);
    expect(isValidProfitCenter('-MAG')).toBe(false);
    expect(isValidProfitCenter('magasin')).toBe(false);
  });
});

describe('profit centre report', () => {
  const centres = [
    { code: 'ATELIER', name: 'Atelier', archived: 0 },
    { code: 'BOUTIQUE', name: 'Boutique', archived: 1 },
  ];

  it('groups the turnover by centre, keeping the lines sold without one', () => {
    const rows = aggregateProfitCenters([
      { code: 'ATELIER', base: 100_000, tax: 16_000, total: 116_000, document_id: 'i1' },
      { code: 'atelier', base: 50_000, tax: 8_000, total: 58_000, document_id: 'i2' },
      { code: null, base: 20_000, tax: 3_200, total: 23_200, document_id: 'i1' },
    ], centres);

    expect(rows.map((row) => row.code)).toEqual(['ATELIER', null]);
    const atelier = rows[0];
    expect(atelier.name).toBe('Atelier');
    expect(atelier.base).toBe(150_000);
    expect(atelier.total).toBe(174_000);
    expect(atelier.lines).toBe(2);
    expect(atelier.documents).toBe(2);
    expect(rows[1].name).toBeNull();
  });

  it('flags an archived centre without hiding its history', () => {
    const [row] = aggregateProfitCenters([
      { code: 'BOUTIQUE', base: 1_000, tax: 160, total: 1_160, document_id: 'i1' },
    ], centres);
    expect(row.archived).toBe(true);
    expect(row.total).toBe(1_160);
  });

  it('deducts a credit note from the centre that was refunded', () => {
    const rows = aggregateProfitCenters([
      { code: 'ATELIER', base: 100_000, tax: 16_000, total: 116_000, document_id: 'i1' },
      { code: 'ATELIER', base: -40_000, tax: -6_400, total: -46_400, document_id: 'c1' },
    ], centres);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'ATELIER', base: 60_000, tax: 9_600, total: 69_600 });
  });

  it('drops a centre whose invoice and credit cancel out', () => {
    const rows = aggregateProfitCenters([
      { code: 'A', base: 1_000, tax: 160, total: 1_160, document_id: 'i1' },
      { code: 'A', base: -1_000, tax: -160, total: -1_160, document_id: 'c1' },
    ], [{ code: 'A', name: 'A' }]);
    expect(rows).toEqual([]);
  });

  it('sorts by turnover', () => {
    const rows = aggregateProfitCenters([
      { code: 'A', base: 10, tax: 0, total: 10, document_id: 'i1' },
      { code: 'B', base: 90, tax: 0, total: 90, document_id: 'i1' },
    ], [{ code: 'A', name: 'A' }, { code: 'B', name: 'B' }]);
    expect(rows.map((row) => row.code)).toEqual(['B', 'A']);
  });
});
