import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VAT_RATE_BP,
  PORT_FEE_RATE_BP,
  XPF_PER_EUR,
  computeLandedCost,
  toXpf,
} from '../shared/landed-cost';

const base = {
  currency: 'XPF',
  exchange_rate_micro: 1_000_000,
  quantity_milli: 100_000,
  goods_amount: 100_000,
  freight: 20_000,
  insurance: 5_000,
  fixed_fees: 0,
  duty_rate_bp: 800,
  port_fee_rate_bp: PORT_FEE_RATE_BP,
  vat_rate_bp: DEFAULT_VAT_RATE_BP,
  vat_recoverable: true,
};

describe('landed cost', () => {
  it('builds the customs value from goods, freight and insurance', () => {
    const result = computeLandedCost(base);
    expect(result.customs_value).toBe(125_000);
  });

  it('charges duty on the customs value, not on the invoice alone', () => {
    const result = computeLandedCost(base);
    expect(result.duty).toBe(10_000); // 8 % de 125 000
  });

  it('charges the port toll at 1,25 % of the customs value', () => {
    const result = computeLandedCost(base);
    expect(result.port_fee).toBe(1_563); // 1 562,5 arrondi
  });

  it('puts duty in the VAT base, which itself excludes the clearance invoice', () => {
    const result = computeLandedCost({ ...base, fixed_fees: 85 });
    expect(result.vat_base).toBe(136_563);
    expect(result.vat).toBe(21_850); // 16 % de 136 563
  });

  it('keeps recoverable VAT out of the cost but in the cash out', () => {
    const result = computeLandedCost(base);
    expect(result.total_in_cost).toBe(136_563);
    expect(result.total_cash).toBe(136_563 + 21_850);
  });

  it('adds non-recoverable VAT to the cost (franchise en base)', () => {
    const result = computeLandedCost({ ...base, vat_recoverable: false });
    expect(result.total_in_cost).toBe(136_563 + 21_850);
    expect(result.total_cash).toBe(result.total_in_cost);
  });

  it('gives a unit cost that multiplies back to the total', () => {
    const result = computeLandedCost(base);
    expect(result.unit_cost).toBe(1_366); // 136 563 / 100, arrondi au franc
    // L'arrondi unitaire ne peut pas dépasser un demi-franc par unité.
    expect(Math.abs(result.unit_cost * 100 - result.total_in_cost)).toBeLessThanOrEqual(50);
  });

  it('adds clearance fees to the cost without adding them to the VAT base', () => {
    const withoutFee = computeLandedCost(base);
    const withFee = computeLandedCost({ ...base, fixed_fees: 12_000 });
    expect(withFee.vat).toBe(withoutFee.vat);
    expect(withFee.total_in_cost).toBe(withoutFee.total_in_cost + 12_000);
  });

  it('converts a euro invoice at the peg', () => {
    // 10,00 € saisis en centimes.
    expect(toXpf(1_000, 'EUR', 119_331_700)).toBe(1_193);
    expect(Math.round(10 * XPF_PER_EUR)).toBe(1_193);
  });

  it('converts the euro goods amount before building the customs value', () => {
    const result = computeLandedCost({
      ...base,
      currency: 'EUR',
      exchange_rate_micro: 119_331_700,
      goods_amount: 100_000, // 1 000,00 €
      freight: 0,
      insurance: 0,
      duty_rate_bp: 0,
      port_fee_rate_bp: 0,
      vat_rate_bp: 0,
    });
    expect(result.goods).toBe(119_332); // 1 000 × 119,3317
    expect(result.customs_value).toBe(119_332);
  });

  it('ignores a rate when the invoice is already in XPF', () => {
    const result = computeLandedCost({ ...base, exchange_rate_micro: 5 });
    expect(result.goods).toBe(100_000);
  });

  it('returns no unit cost when the quantity is unknown', () => {
    const result = computeLandedCost({ ...base, quantity_milli: 0 });
    expect(result.unit_cost).toBe(0);
    expect(result.total_in_cost).toBe(136_563);
  });
});
