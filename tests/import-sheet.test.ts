import { describe, expect, it } from 'vitest';
import { allocate, computeImportSheet } from '../shared/import-sheet';
import type { ImportTaxRule } from '../shared/import-taxes';

describe('largest remainder split', () => {
  it('adds up to the total it was given', () => {
    for (const total of [100, 101, 999, 12_345, 4_443]) {
      const parts = allocate(total, [1, 1, 1]);
      expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
    }
  });

  it('splits by weight: 1000 in two thirds / one third', () => {
    expect(allocate(1000, [2, 1])).toEqual([667, 333]);
  });

  it('gives the leftover unit to the biggest fraction, not the biggest line', () => {
    // 100 / 3 = 33,33 each; the 100th unit goes to the first of the equal fractions.
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // Shares 25,5 / 25,5 / 49 -> floors 25/25/49 = 99, the extra unit goes to the
    // first line, whose fraction ties with the second.
    expect(allocate(100, [51, 51, 98])).toEqual([26, 25, 49]);
  });

  it('splits evenly when nothing can be weighted', () => {
    expect(allocate(10, [0, 0])).toEqual([5, 5]);
    expect(allocate(0, [3, 1])).toEqual([0, 0]);
    expect(allocate(50, [])).toEqual([]);
  });
});

const rules: ImportTaxRule[] = [
  { code: 'TEA', label: 'TEA', base: 'caf', rate_bp: 200, amount: 0, transport: 'any', sort_order: 10 },
  { code: 'PID', label: 'PID', base: 'article', rate_bp: 0, amount: 85, transport: 'any', sort_order: 20 },
];

const sheet = {
  currency: 'XPF',
  exchange_rate_micro: 1_000_000,
  key: 'value' as const,
  freight: 30_000,
  insurance: 6_000,
  fixed_fees: 9_000,
  vat_rate_bp: 1_600,
  vat_recoverable: true,
  transport: 'sea' as const,
  date: '2026-11-02',
  tax_rules: rules,
  lines: [
    {
      product_id: 'p1', product_name: 'Articles A', quantity_milli: 100_000,
      goods_amount: 200_000, duty_rate_bp: 800, weight_g: 100_000, units: 2,
    },
    {
      product_id: 'p2', product_name: 'Articles B', quantity_milli: 50_000,
      goods_amount: 100_000, duty_rate_bp: 1_300, weight_g: 300_000, units: 1,
    },
  ],
};

describe('import sheet', () => {
  it('splits the shared costs by value and keeps the total exact', () => {
    const result = computeImportSheet(sheet);
    // Goods 200 000 / 100 000 -> two thirds and one third.
    expect(result.lines.map((line) => line.freight)).toEqual([20_000, 10_000]);
    expect(result.lines.map((line) => line.insurance)).toEqual([4_000, 2_000]);
    expect(result.lines.map((line) => line.fixed_fees)).toEqual([6_000, 3_000]);
    expect(result.totals.freight).toBe(30_000);
    expect(result.totals.insurance).toBe(6_000);
    expect(result.totals.fixed_fees).toBe(9_000);
  });

  it('gives each line its own customs value, duty and taxes', () => {
    const result = computeImportSheet(sheet);
    const [first, second] = result.lines;
    // CAF: 200 000 + 20 000 + 4 000 = 224 000 ; duty 8 % = 17 920.
    expect(first.customs_value).toBe(224_000);
    expect(first.duty).toBe(17_920);
    // CAF: 100 000 + 10 000 + 2 000 = 112 000 ; duty 13 % = 14 560.
    expect(second.customs_value).toBe(112_000);
    expect(second.duty).toBe(14_560);
    // TEA 2 % of CAF, PID 85 per unit of the line.
    expect(first.tax_lines.find((line) => line.code === 'TEA')!.amount).toBe(4_480);
    expect(first.tax_lines.find((line) => line.code === 'PID')!.amount).toBe(170);
    expect(second.tax_lines.find((line) => line.code === 'PID')!.amount).toBe(85);
    expect(result.totals.taxes_total).toBe(4_480 + 170 + 2_240 + 85);
  });

  it('charges VAT per line on CAF + duty + taxes, and leaves it out of a deductible cost', () => {
    const result = computeImportSheet(sheet);
    const first = result.lines[0];
    expect(first.vat_base).toBe(224_000 + 17_920 + 4_650);
    expect(first.vat).toBe(Math.round((246_570 * 1_600) / 10_000));
    // Deductible VAT leaves the cost but leaves the bank: cash > cost.
    expect(result.totals.total_cash).toBe(result.totals.total_in_cost + result.totals.vat);
    const franchise = computeImportSheet({ ...sheet, vat_recoverable: false });
    expect(franchise.totals.total_cash).toBe(franchise.totals.total_in_cost);
  });

  it('keeps the unit cost and the value share per line', () => {
    const result = computeImportSheet(sheet);
    const first = result.lines[0];
    expect(first.unit_cost).toBe(Math.round((first.total_in_cost * 1000) / 100_000));
    expect(result.lines.map((line) => line.share_bp)).toEqual([6_667, 3_333]);
  });

  it('splits by weight when the shipment is billed by weight', () => {
    const result = computeImportSheet({ ...sheet, key: 'weight' });
    // 100 kg and 300 kg: a quarter / three quarters of the shared costs.
    expect(result.lines.map((line) => line.freight)).toEqual([7_500, 22_500]);
    expect(result.totals.freight).toBe(30_000);
  });
});
