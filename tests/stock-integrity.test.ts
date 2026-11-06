/**
 * A-14: the four quantities (movements, product cache, batches, shelf balances)
 * must agree, and a kit whose component disappeared must be refused. Remove the
 * reconciliation or the kit check and these assertions fail.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { stockBalance, stockBalanceReport } from '../server/lib/stock-balance';
import { unresolvedReferences } from '../server/lib/product-links';
import { assembleKit, consumeInvoiceStock, disassembleKit, receivePurchaseOrder } from '../server/services/stock';

type Row = Record<string, unknown>;

function asD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => ({ results: database.prepare(sql).all(...(params as never[])) as Row[] }),
      first: async () => (database.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null,
      run: async () => {
        database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: {} };
      },
    });
    return bind([]);
  };
  return {
    prepare,
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

const NOW = '2026-01-01T00:00:00.000Z';

const PRODUCT_COLUMNS = [
  "lot_tracking TEXT NOT NULL DEFAULT 'none'",
  "item_type TEXT NOT NULL DEFAULT 'stockable'",
  "family TEXT",
  "subfamily TEXT",
  "lifecycle_status TEXT NOT NULL DEFAULT 'active'",
  "buyer TEXT",
  "supplier_id TEXT",
  "supplier_name TEXT",
  "supplier_ref TEXT",
  "purchase_price INTEGER NOT NULL DEFAULT 0",
  "purchase_currency TEXT NOT NULL DEFAULT 'XPF'",
  "moq_milli INTEGER NOT NULL DEFAULT 0",
  "order_multiple_milli INTEGER NOT NULL DEFAULT 0",
  "lead_time_days INTEGER NOT NULL DEFAULT 0",
  "stock_mode TEXT NOT NULL DEFAULT 'simple'",
  "weight_gross_g INTEGER NOT NULL DEFAULT 0",
  "weight_net_g INTEGER NOT NULL DEFAULT 0",
  "volume_cm3 INTEGER NOT NULL DEFAULT 0",
  "warehouse_location TEXT",
  "customs_code TEXT",
  "valuation_method TEXT NOT NULL DEFAULT 'cmp'",
  "landed_cost INTEGER NOT NULL DEFAULT 0",
  "purchase_account TEXT",
  "sales_account TEXT",
  "stock_account TEXT",
  "analytic_axis TEXT",
  "price_pro INTEGER NOT NULL DEFAULT 0",
  "price_member INTEGER NOT NULL DEFAULT 0",
  "margin_target_bp INTEGER NOT NULL DEFAULT 0",
  "volume_discounts TEXT NOT NULL DEFAULT '[]'",
  "bom_mode TEXT NOT NULL DEFAULT 'on_order'",
  "bom TEXT NOT NULL DEFAULT '[]'",
  "substitutes TEXT NOT NULL DEFAULT '[]'",
  "accessories TEXT NOT NULL DEFAULT '[]'",
  "reorder_point_milli INTEGER NOT NULL DEFAULT 0",
  "safety_stock_milli INTEGER NOT NULL DEFAULT 0",
  "max_stock_milli INTEGER NOT NULL DEFAULT 0",
  "replenish_mode TEXT NOT NULL DEFAULT 'manual'",
  "created_by TEXT",
  "updated_by TEXT",
  "revision INTEGER NOT NULL DEFAULT 1",
  "invoice_label TEXT",
  "service_type TEXT NOT NULL DEFAULT 'one_off'",
  "billing_unit TEXT NOT NULL DEFAULT 'hour'",
  "billing_trigger TEXT NOT NULL DEFAULT 'order'",
  "min_billable_milli INTEGER NOT NULL DEFAULT 0",
  "overtime_rules TEXT NOT NULL DEFAULT '[]'",
  "expertise_levels TEXT NOT NULL DEFAULT '[]'",
  "cps_rate INTEGER NOT NULL DEFAULT 1",
  "tax_exemption_note TEXT",
  "skills TEXT",
  "estimated_hours_milli INTEGER NOT NULL DEFAULT 0",
  "project_template TEXT",
  "sla_response_hours INTEGER NOT NULL DEFAULT 0",
  "sla_resolution_hours INTEGER NOT NULL DEFAULT 0",
  "billing_frequency TEXT NOT NULL DEFAULT 'monthly'",
  "renewal_mode TEXT NOT NULL DEFAULT 'tacit'",
  "notice_days INTEGER NOT NULL DEFAULT 0",
  "price_revision_index TEXT",
  "expense_mode TEXT NOT NULL DEFAULT 'included'",
  "travel_zone TEXT",
  "deliverables TEXT",
  "client_prerequisites TEXT",
  "subcontract_account TEXT",
  "revenue_recognition TEXT NOT NULL DEFAULT 'advance'",
  "allow_negative_stock INTEGER NOT NULL DEFAULT 0",
];

function database() {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  // The baseline predates the article sheet; production adds these columns
  // with the column net, so the test applies the same net before using them.
  for (const column of PRODUCT_COLUMNS) {
    try { raw.exec(`ALTER TABLE products ADD COLUMN ${column}`); } catch { /* present */ }
  }
  return { raw, db: asD1(raw) };
}

function product(raw: DatabaseSync, id: string, over: Record<string, unknown> = {}) {
  const row = {
    id, name: id, item_type: 'product', quantity_milli: 0, track_quantity: 1,
    lot_tracking: 'none', bom: '[]', bom_mode: 'on_order', cost: 1000,
    created_at: NOW, updated_at: NOW, deleted_at: null, ...over,
  };
  raw.prepare(`INSERT INTO products (id, name, item_type, quantity_milli, track_quantity, lot_tracking,
    bom, bom_mode, cost, created_at, updated_at, deleted_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    row.id, row.name, row.item_type, row.quantity_milli, row.track_quantity, row.lot_tracking,
    row.bom, row.bom_mode, row.cost, row.created_at, row.updated_at, row.deleted_at,
  );
}

async function gaps(db: D1Database) {
  return (await stockBalance(db)).total;
}

describe('stock integrity — A-14', () => {
  it('keeps movements and the cache equal after receipt, assembly and sale', async () => {
    const { raw, db } = await database();
    product(raw, 'comp', { cost: 1000 });
    product(raw, 'kit', {
      item_type: 'kit', bom_mode: 'in_stock', cost: 0,
      bom: JSON.stringify([{ product_id: 'comp', quantity: 2 }]),
    });
    await receivePurchaseOrder(db, {
      reference: 'BR-1',
      lines: [{ product_id: 'comp', quantity: 10, unit_price: 1000 }] as never,
      userId: 'u1',
    });
    expect(await gaps(db)).toBe(0);

    await assembleKit(db, { productId: 'kit', quantityMilli: 2000, userId: 'u1' });
    expect(await gaps(db)).toBe(0);
    const afterAssembly = await stockBalance(db);
    const comp = afterAssembly.rows.find((row) => row.product_id === 'comp');
    expect(comp).toMatchObject({ counter_milli: 6000, movement_milli: 6000, consistent: true });

    await consumeInvoiceStock(db, {
      reference: 'F-1',
      lines: [{ product_id: 'kit', quantity: 1 }] as never,
      userId: 'u1',
    });
    expect(await gaps(db)).toBe(0);
    const afterSale = await stockBalance(db);
    expect(afterSale.rows.find((row) => row.product_id === 'kit'))
      .toMatchObject({ counter_milli: 1000, movement_milli: 1000 });

    await disassembleKit(db, { productId: 'kit', quantityMilli: 1000, userId: 'u1' });
    expect(await gaps(db)).toBe(0);
    const afterDisassembly = await stockBalance(db);
    expect(afterDisassembly.rows.find((row) => row.product_id === 'comp'))
      .toMatchObject({ counter_milli: 8000, movement_milli: 8000 });
  });

  it('reports a cache that drifted instead of overwriting it', async () => {
    const { raw, db } = await database();
    product(raw, 'comp', { quantity_milli: 5000 });
    raw.exec(`INSERT INTO stock_movements (id, product_id, kind, quantity_milli, reason, created_at)
              VALUES ('m1', 'comp', 'in', 5000, 'purchase_receipt', '${NOW}')`);
    expect(await gaps(db)).toBe(0);

    raw.exec(`UPDATE products SET quantity_milli = 4999 WHERE id = 'comp'`);
    const report = await stockBalance(db);
    expect(report.total).toBe(1);
    expect(report.gaps[0]).toMatchObject({ product_id: 'comp', counter_gap_milli: 1 });
    // The bad counter is still there: the pass reports, it never rewrites.
    expect(report.gaps[0].counter_milli).toBe(4999);
  });

  it('reports a shelf that disagrees with its batch', () => {
    const report = stockBalanceReport([
      { product_id: 'p', name: 'P', counter_milli: 5000, movement_milli: 5000, lots_milli: 5000, shelf_milli: 4000 },
    ]);
    expect(report.total).toBe(1);
    expect(report.gaps[0].shelf_gap_milli).toBe(-1000);
  });

  it('refuses to sell a kit whose component was deleted', async () => {
    const { raw, db } = await database();
    product(raw, 'comp', { quantity_milli: 10_000 });
    product(raw, 'kit', {
      item_type: 'kit', bom_mode: 'on_order',
      bom: JSON.stringify([{ product_id: 'comp', quantity: 1 }]),
    });
    raw.exec(`UPDATE products SET deleted_at = '${NOW}' WHERE id = 'comp'`);
    await expect(consumeInvoiceStock(db, {
      reference: 'F-2',
      lines: [{ product_id: 'kit', quantity: 1 }] as never,
      userId: 'u1',
    })).rejects.toMatchObject({ code: 'KIT_COMPONENT_MISSING' });
  });

  it('names the references a product may not keep', () => {
    const missing = unresolvedReferences(
      { bom: [{ product_id: 'a' }, { product_id: 'gone' }], substitutes: ['gone'], accessories: ['b'] },
      ['a', 'b'],
    );
    expect(missing).toEqual(['gone']);
    expect(unresolvedReferences({ bom: [{ product_id: 'a' }] }, ['a'])).toEqual([]);
  });
});
