import { describe, expect, it } from 'vitest';
import { familyAccountMap, resolveFamilyAccounts } from '../server/lib/family-accounts';

const mapping = familyAccountMap([{
  family: 'Maintenance', sales_account: '706100', purchase_account: '606100', stock_account: null,
}]);

interface Sheet {
  id: string;
  family: string | null;
  sales_account: string | null;
  purchase_account: string | null;
  stock_account: string | null;
}

/** A sheet is always complete on the wire: every account column exists, null
 * when empty. Typing the fixture that way keeps the test honest instead of
 * proving only the two fields it happened to pass. */
function sheet(overrides: Partial<Sheet>): Sheet {
  return {
    id: 'p1',
    family: null,
    sales_account: null,
    purchase_account: null,
    stock_account: null,
    ...overrides,
  };
}

describe('family account defaults', () => {
  it('fills the accounts an article left empty', () => {
    const resolved = resolveFamilyAccounts(sheet({ family: 'Maintenance' }), mapping);
    expect(resolved.sales_account).toBe('706100');
    expect(resolved.purchase_account).toBe('606100');
  });

  it('never overrides an account set on the article', () => {
    const resolved = resolveFamilyAccounts(sheet({ family: 'Maintenance', sales_account: '706900' }), mapping);
    expect(resolved.sales_account).toBe('706900');
  });

  it('leaves an article without a family untouched', () => {
    const resolved = resolveFamilyAccounts(sheet({ family: null }), mapping);
    expect(resolved.sales_account).toBeNull();
  });

  it('leaves an article in an unmapped family untouched', () => {
    const resolved = resolveFamilyAccounts(sheet({ family: 'Divers' }), mapping);
    expect(resolved.sales_account).toBeNull();
  });

  it('does not invent an account the family does not carry', () => {
    const resolved = resolveFamilyAccounts(sheet({ family: 'Maintenance' }), mapping);
    expect(resolved.stock_account).toBeNull();
  });

  it('keeps the rest of the sheet, id included', () => {
    const resolved = resolveFamilyAccounts(sheet({ family: 'Maintenance' }), mapping);
    expect(resolved.id).toBe('p1');
  });
});
