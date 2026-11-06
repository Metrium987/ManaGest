/**
 * A-12: the chosen option is an explicit integrity report rather than rebuilding
 * the financial tables. A healthy book reports zero; a grafted orphan is named.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { INTEGRITY_RELATIONS, integrityReport } from '../server/lib/integrity';

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

function database() {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return { raw, db: asD1(raw) };
}

const NOW = '2026-01-01T00:00:00.000Z';

describe('referential integrity — A-12', () => {
  it('checks the eight relations the audit names', () => {
    expect(INTEGRITY_RELATIONS).toHaveLength(8);
    expect(INTEGRITY_RELATIONS.map((relation) => relation.relation)).toContain('journal_lines.entry_id');
  });

  it('reports no gap on a healthy book', async () => {
    const { db } = await database();
    const report = await integrityReport(db);
    expect(report.total).toBe(0);
    expect(report.relations.every((gap) => gap.orphans === 0)).toBe(true);
  });

  it('names an allocation that points at a missing invoice', async () => {
    const { raw, db } = await database();
    // The payment exists (its own FK is declared); the invoice does not.
    raw.exec(`INSERT INTO payments (id, client_id, date, amount, created_at, updated_at)
              VALUES ('p1', 'c1', '2026-01-10', 1000, '${NOW}', '${NOW}')`);
    raw.exec(`INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at)
              VALUES ('a1', 'p1', 'missing-invoice', 1000, '${NOW}')`);
    const report = await integrityReport(db);
    expect(report.total).toBe(1);
    const gap = report.relations.find((row) => row.relation === 'payment_allocations.invoice_id');
    expect(gap).toMatchObject({ orphans: 1, samples: ['a1'] });
  });

  it('does not treat a soft-deleted client as an orphan', async () => {
    const { raw, db } = await database();
    raw.exec(`INSERT INTO clients (id, display_name, created_at, updated_at, deleted_at)
              VALUES ('c1', 'Client', '${NOW}', '${NOW}', '${NOW}')`);
    raw.exec(`INSERT INTO invoices (id, client_id, number, date, total, balance, created_at, updated_at, deleted_at)
              VALUES ('i1', 'c1', 'F-1', '2026-01-10', 1000, 0, '${NOW}', '${NOW}', '${NOW}')`);
    const report = await integrityReport(db);
    expect(report.total).toBe(0);
  });
});
