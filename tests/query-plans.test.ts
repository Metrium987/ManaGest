/**
 * A-11: the audit queries must be served by an index, not a table scan. Plans
 * come from SQLite, which D1 runs underneath.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';

function plan(sql: string): string {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  const rows = raw.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as { detail: string }[];
  return rows.map((row) => row.detail).join(' | ');
}

describe('query plans — A-11', () => {
  it('serves activities by entity from an index', () => {
    const detail = plan(`SELECT * FROM activities WHERE entity_type = 'invoice' AND entity_id = 'x' ORDER BY created_at DESC`);
    expect(detail).not.toContain('SCAN activities');
    expect(detail).toContain('SEARCH activities USING');
    expect(detail).toContain('idx_activities_entity');
  });

  it('serves stock movements by reference from an index', () => {
    const detail = plan(`SELECT * FROM stock_movements WHERE reference = 'BC-1' AND reason = 'purchase_receipt'`);
    expect(detail).not.toContain('SCAN stock_movements');
    expect(detail).toContain('idx_stock_movements_reference');
  });

  it('serves the product catalogue by soft-delete state from an index', () => {
    // `item_type`/`family` are added by the legacy column net, not by the frozen
    // baseline, so the catalogue index is on the soft-delete column it does have.
    const detail = plan(`SELECT id FROM products WHERE deleted_at IS NULL`);
    expect(detail).not.toContain('SCAN products');
    expect(detail).toContain('idx_products_deleted');
  });

  it('serves expired sessions from an index', () => {
    const detail = plan(`SELECT id FROM sessions WHERE expires_at < '2026-01-01'`);
    expect(detail).not.toContain('SCAN sessions');
    expect(detail).toContain('idx_sessions_expiry');
  });
});
