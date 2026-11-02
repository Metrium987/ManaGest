import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../shared/domain';

describe('cost permission (D4)', () => {
  it('is declared as its own permission', () => {
    expect((PERMISSIONS as readonly string[]).includes('products.cost.read')).toBe(true);
  });

  it('is not handed out with ordinary operational reading', () => {
    expect(ROLE_PERMISSIONS.viewer).not.toContain('products.cost.read');
    expect(ROLE_PERMISSIONS.sales).not.toContain('products.cost.read');
  });

  it('is held by the roles that price and buy', () => {
    expect(ROLE_PERMISSIONS.owner).toContain('products.cost.read');
    expect(ROLE_PERMISSIONS.admin).toContain('products.cost.read');
    expect(ROLE_PERMISSIONS.accountant).toContain('products.cost.read');
  });

  it('does not imply reading the ledger', () => {
    expect(ROLE_PERMISSIONS.sales).not.toContain('accounting.read');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('accounting.read');
  });
});
