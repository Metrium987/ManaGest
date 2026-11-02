import { describe, expect, it } from 'vitest';
import { usesArchipelagoRate, validateArchipelagoVat } from '../shared/archipelago';

const evidence = {
  client_tax_id: '1234567',
  archipelago: 'tuamotu',
  transport_reference: 'BL-2026-0042',
  shipped_by_seller: true,
};

const line = (overrides: Partial<{ tax_rate: number; tax_status: string | null; product_family: string | null }> = {}) => ({
  tax_rate: 1,
  tax_status: 'taxable',
  product_family: 'Matériel',
  ...overrides,
});

const check = (lines = [line()], extra = {}, families = ['Alcools', 'Tabacs']) =>
  validateArchipelagoVat({ lines, evidence: { ...evidence, ...extra }, excluded_families: families });

describe('archipelago 1 % VAT', () => {
  it('accepts a complete file', () => {
    expect(check()).toEqual({ ok: true });
  });

  it('does nothing when no line carries the 1 % rate', () => {
    expect(validateArchipelagoVat({
      lines: [line({ tax_rate: 16 })],
      evidence: {},
      excluded_families: [],
    })).toEqual({ ok: true });
  });

  it('ignores an exempt line even at 1 %', () => {
    expect(usesArchipelagoRate([line({ tax_status: 'exempt' })])).toBe(false);
  });

  it('requires the customer Tahiti number', () => {
    const result = check([line()], { client_tax_id: '' });
    expect(result).toMatchObject({ ok: false, code: 'ARCHIPELAGO_VAT_EVIDENCE' });
    expect(result.ok === false && result.details.missing).toContain('client_tax_id');
  });

  it('requires a known archipelago', () => {
    const result = check([line()], { archipelago: 'societe' });
    expect(result.ok === false && result.details.missing).toContain('archipelago');
  });

  it('requires the transport reference', () => {
    const result = check([line()], { transport_reference: '   ' });
    expect(result.ok === false && result.details.missing).toContain('transport_reference');
  });

  it('requires the seller to ship the goods himself', () => {
    const result = check([line()], { shipped_by_seller: false });
    expect(result.ok === false && result.details.missing).toContain('shipped_by_seller');
  });

  it('names every missing piece at once', () => {
    const result = check([line()], { client_tax_id: '', transport_reference: '', shipped_by_seller: false });
    expect(result.ok === false && result.details.missing.split(',')).toHaveLength(3);
  });

  it('refuses an excluded family, whatever its capitalisation', () => {
    const result = check([line({ product_family: 'alcools' })]);
    expect(result).toEqual({ ok: false, code: 'ARCHIPELAGO_VAT_EXCLUDED', details: { family: 'alcools' } });
  });

  it('lets a family that merely contains an excluded word through', () => {
    expect(check([line({ product_family: 'Alcools et tabacs (accessoires)' })])).toEqual({ ok: true });
  });

  it('keeps working when no family is excluded', () => {
    expect(check([line({ product_family: 'Alcools' })], {}, [])).toEqual({ ok: true });
  });
});
