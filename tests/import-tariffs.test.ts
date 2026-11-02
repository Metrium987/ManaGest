import { describe, expect, it } from 'vitest';
import { tariffDutyRate, type ImportTaxRule } from '../shared/import-taxes';
import { computeLandedCost } from '../shared/landed-cost';

const tariff = {
  code: '84713000',
  duty_rate_bp: 1_300,
  duty_rate_eu_bp: 0,
  duty_rate_oceania_bp: null,
};

const base = {
  currency: 'XPF',
  exchange_rate_micro: 1_000_000,
  quantity_milli: 100_000,
  goods_amount: 100_000,
  freight: 20_000,
  insurance: 5_000,
  fixed_fees: 0,
  duty_rate_bp: 800,
  port_fee_rate_bp: 125,
  vat_rate_bp: 1_600,
  vat_recoverable: true,
};

const rule = (overrides: Partial<ImportTaxRule>): ImportTaxRule => ({
  code: 'X',
  label: 'Taxe de test',
  base: 'caf',
  rate_bp: 0,
  amount: 0,
  transport: 'any',
  sort_order: 10,
  ...overrides,
});

describe('tariff heading', () => {
  it('uses the standard rate by default', () => {
    expect(tariffDutyRate(tariff, 'standard')).toBe(1_300);
  });

  it('uses the preferential rate when the origin is covered', () => {
    expect(tariffDutyRate(tariff, 'eu')).toBe(0);
  });

  it('falls back to the standard rate when no preferential rate is recorded', () => {
    expect(tariffDutyRate(tariff, 'oceania')).toBe(1_300);
  });

  it('returns nothing without a heading', () => {
    expect(tariffDutyRate(null, 'eu')).toBeNull();
  });
});

describe('landed cost with tax rules', () => {
  const rules = [
    rule({ code: 'TEA', base: 'caf', rate_bp: 200, sort_order: 10 }),
    rule({ code: 'PID', base: 'article', amount: 85, sort_order: 20 }),
    rule({ code: 'PAP', base: 'caf', rate_bp: 125, transport: 'sea', sort_order: 40 }),
  ];

  it('computes each tax on its own base and feeds the VAT base', () => {
    const result = computeLandedCost({
      ...base, duty_rate_bp: 800, tax_rules: rules, units: 3, weight_g: 250_000,
      transport: 'sea', date: '2026-11-02',
    });
    // CAF 125 000, droit 8 % = 10 000, TEA 2 % = 2 500, PID 85 × 3 = 255, PAP 1 563.
    expect(result.tax_lines.map((line) => line.code)).toEqual(['TEA', 'PID', 'PAP']);
    expect(result.taxes_total).toBe(4_318);
    expect(result.vat_base).toBe(125_000 + 10_000 + 4_318);
    expect(result.vat).toBe(Math.round((139_318 * 1_600) / 10_000));
  });

  it('leaves the port toll out of an air shipment', () => {
    const result = computeLandedCost({
      ...base, tax_rules: rules, units: 1, transport: 'air', date: '2026-11-02',
    });
    expect(result.tax_lines.map((line) => line.code)).toEqual(['TEA', 'PID']);
    expect(result.port_fee).toBe(0);
  });

  it('keeps the single port fee when no rules are given (older sheets)', () => {
    const result = computeLandedCost(base);
    expect(result.tax_lines).toEqual([{ code: 'PAP', label: 'Péage portuaire', amount: 1_563 }]);
    expect(result.taxes_total).toBe(1_563);
  });
});
