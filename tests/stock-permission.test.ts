import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../shared/domain';

/**
 * H1: adjusting a quantity is separated from editing the article sheet. The
 * default matrix is unchanged — only the roles that could already write products
 * hold the new right — so the split opens the door without silently closing it
 * on anyone.
 */
describe('stock adjustment permission (H1)', () => {
  it('is declared as its own permission', () => {
    expect((PERMISSIONS as readonly string[]).includes('stock.adjust')).toBe(true);
  });

  it('is held by the roles that already moved stock', () => {
    expect(ROLE_PERMISSIONS.owner).toContain('stock.adjust');
    expect(ROLE_PERMISSIONS.admin).toContain('stock.adjust');
  });

  it('is not handed out with sales, accounting or read-only access', () => {
    for (const role of ['sales', 'accountant', 'viewer'] as const) {
      expect(ROLE_PERMISSIONS[role]).not.toContain('stock.adjust');
    }
  });

  it('does not come with the right to rewrite the sheet', () => {
    // The two are independent: holding stock.adjust says nothing about prices.
    expect(ROLE_PERMISSIONS.sales).not.toContain('products.write');
    expect(ROLE_PERMISSIONS.viewer).not.toContain('products.write');
  });

  it('guards every route that changes a quantity', () => {
    const products = readFileSync(join('server/routes', 'products.ts'), 'utf8');
    // The write registration itself is asserted, not any line mentioning the
    // path: the same path also has a GET route that only reads.
    for (const route of [
      '/:id/adjust-stock',
      '/:id/transfer',
      '/:id/lots',
      '/:id/lots/:lotId/transfer',
      '/:id/lots/balances/rebuild',
      '/:id/assemble',
      '/:id/disassemble',
    ]) {
      expect(products, route).toContain(
        `productRoutes.post('${route}', requirePermission('stock.adjust')`,
      );
    }
    const counts = readFileSync(join('server/routes', 'stock-counts.ts'), 'utf8');
    expect(counts).toContain(
      "stockCountRoutes.post('/:id/validate', requirePermission('stock.adjust')",
    );
  });
});
