import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IMPORT_TAX_RULES,
  applicableRules,
  computeImportTaxes,
  taxAmount,
  type ImportTaxRule,
} from '../shared/import-taxes';

const context = {
  customs_value: 125_000,
  duty: 10_000,
  weight_g: 250_000, // 250 kg, soit 2,5 quintaux
  units: 3,
  transport: 'sea' as const,
  date: '2026-11-02',
};

const rule = (overrides: Partial<ImportTaxRule>): ImportTaxRule => ({
  code: 'X',
  label: 'Taxe de test',
  base: 'caf',
  rate_bp: 125,
  amount: 0,
  transport: 'any',
  sort_order: 10,
  ...overrides,
});

describe('import tax rules', () => {
  it('defaults follow the customs FAQ', () => {
    const lines = computeImportTaxes(context, DEFAULT_IMPORT_TAX_RULES);
    expect(lines.map((line) => line.code)).toEqual(['TEA', 'PID', 'STAT', 'PAP']);
    expect(lines.find((line) => line.code === 'TEA')?.amount).toBe(2_500); // 2 % de 125 000
    expect(lines.find((line) => line.code === 'PID')?.amount).toBe(255); // 85 × 3 articles
    expect(lines.find((line) => line.code === 'STAT')?.amount).toBe(125); // 50 × 2,5 quintaux
    expect(lines.find((line) => line.code === 'PAP')?.amount).toBe(1_563); // 1,25 %
  });

  it('applies the port toll only to sea freight', () => {
    const lines = computeImportTaxes({ ...context, transport: 'air' }, DEFAULT_IMPORT_TAX_RULES);
    expect(lines.map((line) => line.code)).toEqual(['TEA', 'PID', 'STAT']);
  });

  it('evaluates a rule on CAF plus duty when it says so', () => {
    expect(taxAmount(rule({ base: 'caf_duty', rate_bp: 1_000 }), context)).toBe(13_500);
  });

  it('computes a weight base in kilograms and in quintals', () => {
    expect(taxAmount(rule({ base: 'kg', amount: 4 }), context)).toBe(1_000);
    expect(taxAmount(rule({ base: 'quintal', amount: 50 }), context)).toBe(125);
  });

  it('skips an inactive rule', () => {
    const lines = computeImportTaxes(context, [rule({ is_active: false })]);
    expect(lines).toEqual([]);
  });

  it('skips a rule SQLite returns as 0', () => {
    expect(computeImportTaxes(context, [rule({ is_active: 0 })])).toEqual([]);
    expect(applicableRules([rule({ is_active: 0 })], context)).toEqual([]);
  });

  it('respects a validity window so an old sheet stays explainable', () => {
    const expired = rule({ code: 'OLD', valid_to: '2026-01-01' });
    const future = rule({ code: 'NEW', valid_from: '2027-01-01' });
    expect(applicableRules([expired, future], context)).toEqual([]);
    expect(applicableRules([expired, future], { ...context, date: '2026-06-01' })).toEqual([]);
  });

  it('orders the rules explicitly, whatever the input order', () => {
    const first = rule({ code: 'B', sort_order: 20 });
    const second = rule({ code: 'A', sort_order: 10 });
    expect(applicableRules([first, second], context).map((item) => item.code)).toEqual(['A', 'B']);
  });

  it('drops a rule that produces nothing', () => {
    expect(computeImportTaxes(context, [rule({ base: 'kg', amount: 0 })])).toEqual([]);
  });
});
