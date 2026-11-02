import { describe, expect, it } from 'vitest';
import {
  billableQuantity,
  cpsAmount,
  nextBillingDate,
} from '../shared/service';

describe('fiche service', () => {
  it('calcule la contribution pour la solidarité', () => {
    expect(cpsAmount(100_000)).toBe(1_000);
    expect(cpsAmount(100_000, 1)).toBe(1_000);
    expect(cpsAmount(0)).toBe(0);
    expect(cpsAmount(123_456, 1)).toBe(1_235);
  });

  it('applique la quantité minimale facturable', () => {
    expect(billableQuantity(0.5, 2)).toBe(2);
    expect(billableQuantity(3, 2)).toBe(3);
    expect(billableQuantity(0, 2)).toBe(0);
  });

  it('projette la prochaine échéance en gardant le jour du mois', () => {
    expect(nextBillingDate('2026-01-15', 'monthly')).toBe('2026-02-15');
    expect(nextBillingDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextBillingDate('2026-01-10', 'quarterly')).toBe('2026-04-10');
    expect(nextBillingDate('2026-06-01', 'semiannual')).toBe('2026-12-01');
    expect(nextBillingDate('2026-03-01', 'yearly')).toBe('2027-03-01');
    expect(nextBillingDate('2026-03-01', 'weekly')).toBe('2026-03-08');
  });
});
