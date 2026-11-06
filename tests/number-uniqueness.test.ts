/**
 * A-11: a document number is unique where it exists, and a NULL number stays
 * allowed several times (SQLite unique indexes ignore NULLs).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';

function database() {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return raw;
}

const NOW = '2026-01-01T00:00:00.000Z';

function payment(raw: DatabaseSync, id: string, number: string | null) {
  raw.prepare(`INSERT INTO payments (id, client_id, number, date, amount, created_at, updated_at)
               VALUES (?, 'c1', ?, '2026-01-10', 1000, ?, ?)`).run(id, number, NOW, NOW);
}
function order(raw: DatabaseSync, id: string, number: string | null) {
  raw.prepare(`INSERT INTO purchase_orders (id, vendor_id, number, date, created_at, updated_at)
               VALUES (?, 'v1', ?, '2026-01-10', ?, ?)`).run(id, number, NOW, NOW);
}
function recurring(raw: DatabaseSync, id: string, number: string | null) {
  raw.prepare(`INSERT INTO recurring_invoices (id, client_id, number, next_run_date, created_at, updated_at)
               VALUES (?, 'c1', ?, '2026-02-01', ?, ?)`).run(id, number, NOW, NOW);
}

describe('document number uniqueness — A-11', () => {
  it('refuses a duplicate payment number and allows several NULLs', () => {
    const raw = database();
    payment(raw, 'p1', 'PAY-1');
    expect(() => payment(raw, 'p2', 'PAY-1')).toThrow(/UNIQUE/);
    payment(raw, 'p3', null);
    payment(raw, 'p4', null);
    expect((raw.prepare(`SELECT COUNT(*) AS n FROM payments`).get() as { n: number }).n).toBe(3);
  });

  it('refuses a duplicate purchase order number', () => {
    const raw = database();
    order(raw, 'o1', 'BC-1');
    expect(() => order(raw, 'o2', 'BC-1')).toThrow(/UNIQUE/);
  });

  it('refuses a duplicate recurring contract number', () => {
    const raw = database();
    recurring(raw, 'r1', 'REC-1');
    expect(() => recurring(raw, 'r2', 'REC-1')).toThrow(/UNIQUE/);
  });
});
