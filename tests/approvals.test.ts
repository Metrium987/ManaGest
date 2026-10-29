import { describe, expect, it } from 'vitest';
import {
  discountPercentOf,
  parseThresholds,
  ruleFor,
  violatesSeparation,
} from '../server/lib/approvals';

const thresholds = parseThresholds({
  approval_credit_amount: '100000',
  approval_expense_amount: '250000',
  approval_discount_percent: '20',
  separation_of_duties: '1',
});

describe('approval rules come from settings, not constants', () => {
  it('reads and clamps the configured thresholds', () => {
    expect(thresholds).toEqual({
      creditAmount: 100_000,
      expenseAmount: 250_000,
      discountPercent: 20,
      separation: true,
    });
    expect(parseThresholds({ approval_discount_percent: '250' }).discountPercent).toBe(100);
    expect(parseThresholds({ approval_credit_amount: '-5' }).creditAmount).toBe(0);
    expect(parseThresholds({ approval_expense_amount: 'nonsense' }).expenseAmount).toBe(0);
  });

  it('treats a zero threshold as « rule off », never as « everything blocked »', () => {
    const off = parseThresholds({});
    expect(ruleFor('credit', { amount: 9_999_999 }, off)).toBeNull();
    expect(ruleFor('expense', { amount: 9_999_999 }, off)).toBeNull();
    expect(ruleFor('invoice', { amount: 9_999_999, discountPercent: 90 }, off)).toBeNull();
  });

  it('applies a threshold at the boundary, inclusive', () => {
    expect(ruleFor('credit', { amount: 99_999 }, thresholds)).toBeNull();
    expect(ruleFor('credit', { amount: 100_000 }, thresholds)).toBe('credit_amount');
    expect(ruleFor('expense', { amount: 249_999 }, thresholds)).toBeNull();
    expect(ruleFor('expense', { amount: 250_000 }, thresholds)).toBe('expense_amount');
  });

  it('judges an invoice on its discount, in percent or in amount', () => {
    expect(ruleFor('invoice', { amount: 1, discountPercent: 19 }, thresholds)).toBeNull();
    expect(ruleFor('invoice', { amount: 1, discountPercent: 20 }, thresholds)).toBe('invoice_discount');
    expect(discountPercentOf('percent', 25, 100_000)).toBe(25);
    expect(discountPercentOf('amount', 20_000, 100_000)).toBe(20);
    expect(discountPercentOf('amount', 20_000, 0)).toBe(0);
  });

  it('ignores the invoice rule for other entities', () => {
    expect(ruleFor('credit', { amount: 1, discountPercent: 90 }, thresholds)).toBeNull();
  });
});

describe('separation of duties', () => {
  it('only bites when enabled and the actor is the creator', () => {
    expect(violatesSeparation(true, 'u1', 'u1')).toBe(true);
    expect(violatesSeparation(true, 'u1', 'u2')).toBe(false);
    expect(violatesSeparation(false, 'u1', 'u1')).toBe(false);
    expect(violatesSeparation(true, null, 'u1')).toBe(false);
  });
});
