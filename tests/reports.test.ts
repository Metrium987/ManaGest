import { describe, expect, it } from 'vitest';
import {
  mergeRevenue,
  mergeTvaRecap,
  revenueCsv,
  tvaRecapCsv,
  tvaRecapTotals,
} from '../server/lib/reports';

const taxRows = [
  { period: '2026-08', rate: 16, base: 100000, tax: 16000, documents: 3 },
  { period: '2026-08', rate: 13, base: 20000, tax: 2600, documents: 1 },
  { period: '2026-09', rate: 16, base: 50000, tax: 8000, documents: 2 },
  { period: '2026-09', rate: 0, base: 9999, tax: 0, documents: 1 },
];

const exemptRows = [
  { period: '2026-08', exempt_base: 15000, documents: 1 },
  { period: '2026-09', exempt_base: 0, documents: 0 },
];

describe('local reports (T-207)', () => {
  it('merges the monthly VAT recap and keeps a 0 % line out of the taxable base', () => {
    const periods = mergeTvaRecap(taxRows, exemptRows);
    expect(periods.map((p) => p.period)).toEqual(['2026-08', '2026-09']);

    const august = periods[0];
    expect(august.base).toBe(120000);
    expect(august.tax).toBe(18600);
    expect(august.exempt_base).toBe(15000);
    expect(august.rates.map((r) => r.rate)).toEqual([16, 13]);

    const september = periods[1];
    expect(september.base).toBe(50000);
    expect(september.tax).toBe(8000);
    expect(september.rates.some((r) => r.rate === 0)).toBe(false);
  });

  it('totals the recap without counting a document twice', () => {
    const totals = tvaRecapTotals(mergeTvaRecap(taxRows, exemptRows));
    expect(totals.base).toBe(170000);
    expect(totals.tax).toBe(26600);
    expect(totals.exempt_base).toBe(15000);
  });

  it('writes the exempt base once per month so a column sums correctly', () => {
    const csv = tvaRecapCsv(mergeTvaRecap(taxRows, exemptRows));
    const lines = csv.replace(/^\uFEFF/, '').trim().split('\r\n');
    expect(lines[0]).toBe('période;taux;base HT imposable;TVA collectée;base exonérée / hors champ;documents');
    const august = lines.filter((line) => line.startsWith('2026-08'));
    expect(august).toHaveLength(2);
    const exemptSum = august.reduce((sum, line) => sum + Number(line.split(';')[4]), 0);
    expect(exemptSum).toBe(15000);
  });

  it('merges turnover with the money actually collected', () => {
    const periods = mergeRevenue(
      [
        { period: '2026-08', taxable: 120000, exempt: 15000, total: 135000, documents: 4 },
        { period: '2026-09', taxable: 50000, exempt: 0, total: 50000, documents: 2 },
      ],
      [
        { period: '2026-08', collected: 90000 },
        { period: '2026-09', collected: 0 },
      ],
    );
    expect(periods[0]).toMatchObject({ period: '2026-08', total: 135000, collected: 90000 });
    expect(periods[1]).toMatchObject({ period: '2026-09', total: 50000, collected: 0 });
    expect(periods[1].taxable + periods[1].exempt).toBe(periods[1].total);
  });

  it('labels every turnover column in French', () => {
    const csv = revenueCsv([]);
    expect(csv.replace(/^\uFEFF/, '').trim()).toBe(
      'période;CA taxable (TTC);CA exonéré (TTC);CA total (TTC);encaissé;documents',
    );
  });
});
