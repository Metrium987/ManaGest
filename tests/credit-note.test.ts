/**
 * A-03 / A-02: a credit note mirrors the invoice — same rates, same VAT,
 * proportional on a partial refund — and an issued document is not editable.
 */
import { describe, expect, it } from 'vitest';
import { creditNoteFromInvoice } from '../server/lib/credit-note';
import { isEditable } from '../server/services/status';

const line = (unitPrice: number, rate: number) => ({
  id: `l-${rate}`, description: `Ligne ${rate}`, quantity: 1, unit_price: unitPrice, tax_rate: rate,
});

const source = (over: Record<string, unknown> = {}) => ({
  number: 'FAC-2026-0001',
  total: 113000,
  discount_type: 'percent',
  discount_value: 0,
  tax_exempt: 0,
  line_items: [line(100000, 13)],
  ...over,
});

describe('creditNoteFromInvoice — A-03', () => {
  it('reverses the VAT of a full credit on a taxed invoice', () => {
    const draft = creditNoteFromInvoice(source(), 113000);
    expect(draft.totals).toMatchObject({ subtotal: 100000, tax_total: 13000, total: 113000 });
    expect(draft.totals.tax_buckets).toEqual([{ rate: 13, base: 100000, amount: 13000 }]);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0]).toMatchObject({ unit_price: 100000, tax_rate: 13, tax_status: 'taxable' });
  });

  it('reverses the same proportion on a partial credit', () => {
    const draft = creditNoteFromInvoice(source(), 56500);
    expect(draft.totals.subtotal).toBe(50000);
    expect(draft.totals.tax_total).toBe(6500);
    expect(draft.totals.total).toBe(56500);
  });

  it('keeps every rate of a multi-rate invoice', () => {
    const draft = creditNoteFromInvoice(source({
      total: 28450,
      line_items: [line(20000, 16), line(5000, 5)],
    }), 28450);
    expect(draft.totals.subtotal).toBe(25000);
    expect(draft.totals.tax_total).toBe(3450);
    expect(draft.totals.total).toBe(28450);
    expect(draft.totals.tax_buckets.map((bucket) => bucket.rate)).toEqual([16, 5]);
    expect(draft.totals.tax_buckets.reduce((sum, bucket) => sum + bucket.base, 0)).toBe(25000);
  });

  it('splits a partial multi-rate credit without losing a franc of VAT', () => {
    const draft = creditNoteFromInvoice(source({
      total: 28450,
      line_items: [line(20000, 16), line(5000, 5)],
    }), 14225);
    expect(draft.totals.total).toBe(14225);
    expect(draft.totals.subtotal + draft.totals.tax_total).toBe(14225);
  });

  it('produces an exempt credit for an exempt invoice', () => {
    const draft = creditNoteFromInvoice(source({ total: 50000, tax_exempt: 1, line_items: [line(50000, 0)] }), 20000);
    expect(draft.totals).toMatchObject({ subtotal: 20000, tax_total: 0, total: 20000 });
    expect(draft.totals.tax_buckets).toEqual([]);
    expect(draft.lines[0].tax_status).toBe('exempt');
  });

  it('refuses an amount above the invoice or a non-positive one', () => {
    expect(() => creditNoteFromInvoice(source(), 120000)).toThrowError(/AMOUNT_EXCEEDS_BALANCE/);
    expect(() => creditNoteFromInvoice(source(), 0)).toThrowError(/VALIDATION_ERROR/);
  });
});

describe('isEditable — A-02', () => {
  it('only lets a draft be rewritten', () => {
    expect(isEditable('draft')).toBe(true);
    for (const status of ['sent', 'partial', 'paid', 'cancelled']) {
      expect(isEditable(status)).toBe(false);
    }
  });
});
