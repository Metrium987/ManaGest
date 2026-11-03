import { describe, expect, it } from 'vitest';
import { buildVatReturn } from '../server/lib/vat-return';
import { ROLE_PERMISSIONS } from '../shared/domain';

describe('VAT recap for the 1010 form', () => {
  it('aggregates the same rate across invoices and keeps the rates apart', () => {
    const result = buildVatReturn({
      invoices: [
        [{ rate: 13, base: 100_000, amount: 13_000 }],
        [{ rate: 13, base: 50_000, amount: 6_500 }, { rate: 5, base: 20_000, amount: 1_000 }],
      ],
      credits: [],
    });
    expect(result.rows).toEqual([
      { rate: 5, base: 20_000, tax: 1_000 },
      { rate: 13, base: 150_000, tax: 19_500 },
    ]);
    expect(result.total_base).toBe(170_000);
    expect(result.total_tax).toBe(20_500);
    expect(result.documents).toBe(2);
  });

  it('deducts a credit note from the rate of the line it refunds', () => {
    const result = buildVatReturn({
      invoices: [[{ rate: 13, base: 100_000, amount: 13_000 }]],
      credits: [[{ rate: 13, base: 40_000, amount: 5_200 }]],
    });
    expect(result.rows).toEqual([{ rate: 13, base: 60_000, tax: 7_800 }]);
    expect(result.credits).toBe(1);
  });

  it('drops a rate that a credit note fully cancels', () => {
    const result = buildVatReturn({
      invoices: [[{ rate: 16, base: 10_000, amount: 1_600 }]],
      credits: [[{ rate: 16, base: 10_000, amount: 1_600 }]],
    });
    expect(result.rows).toEqual([]);
    expect(result.total_tax).toBe(0);
  });

  it('reports exempt turnover separately, without adding it to the taxable base', () => {
    const result = buildVatReturn({
      invoices: [[{ rate: 13, base: 10_000, amount: 1_300 }]],
      credits: [],
      exemptBase: 50_000,
    });
    expect(result.total_base).toBe(10_000);
    expect(result.exempt_base).toBe(50_000);
  });
});

describe('accountant access', () => {
  it('opens the books and the reports, and cannot administer the workspace', () => {
    const permissions = ROLE_PERMISSIONS.accountant;
    for (const allowed of ['accounting.read', 'accounting.write', 'reports.read', 'bank.read', 'periods.write', 'approvals.read', 'activity.read']) {
      expect(permissions).toContain(allowed);
    }
    for (const denied of ['users.read', 'settings.write', 'clients.delete', 'invoices.delete']) {
      expect(permissions).not.toContain(denied);
    }
  });
});
