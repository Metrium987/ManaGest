/**
 * A-10: the schema is created and upgraded by frozen, recorded migrations. An old
 * database is upgraded in place without losing a row, the second run does nothing,
 * and a migrated database has exactly the structure the schema declares.
 */
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { appliedVersions, runMigrations } from '../server/db/migrate';
import { MIGRATIONS } from '../server/db/migrations';
import { BASELINE } from '../server/db/migrations/0001_baseline';
import { SCHEMA_STATEMENTS } from '../server/db/schema';

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

const NOW = '2026-05-01T00:00:00.000Z';

function structure(raw: DatabaseSync) {
  const tables = raw
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations' ORDER BY name`)
    .all() as { name: string }[];
  const result: Record<string, unknown> = {};
  for (const table of tables) {
    result[table.name] = {
      columns: raw.prepare(`PRAGMA table_info(${table.name})`).all(),
      indexes: raw.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ? ORDER BY name`).all(table.name),
    };
  }
  return result;
}

async function oldDatabase() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  // A base created by the previous release: baseline only, no migration history.
  for (const statement of BASELINE) raw.exec(statement);
  raw.exec(`INSERT INTO invoices (id, client_id, number, status, date, currency, subtotal, discount_type,
    discount_value, discount_total, tax_total, total, tax_exempt, line_items, created_at, updated_at)
    VALUES ('inv-1', 'cli-1', 'FAC-1', 'sent', '2026-05-02', 'XPF', 100000, 'percent', 0, 0, 13000, 113000, 0, '[]', '${NOW}', '${NOW}')`);
  return { raw, db };
}

describe('versioned migrations — A-10', () => {
  it('ships frozen migrations in order, and the SQL files match them', () => {
    const versions = MIGRATIONS.map((migration) => migration.version);
    expect(versions).toEqual([...versions].sort((a, b) => a - b));
    expect(new Set(versions).size).toBe(versions.length);
    for (const migration of MIGRATIONS) {
      expect(migration.statements.length).toBeGreaterThan(0);
      const sql = readFileSync(`server/db/migrations/${String(migration.version).padStart(4, '0')}_${migration.name}.sql`, 'utf8');
      for (const statement of migration.statements) {
        expect(sql).toContain(statement.split('\n')[0].trim());
      }
    }
  });

  it('upgrades an old database in place, without losing a row', async () => {
    const { raw, db } = await oldDatabase();
    expect(raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'credit_tax_lines'`).get()).toBeUndefined();

    const applied = await runMigrations(db);
    expect(applied).toBe(MIGRATIONS.length);
    expect(await appliedVersions(db)).toEqual(new Set(MIGRATIONS.map((migration) => migration.version)));

    // A-04 table arrived, A-06 revision columns arrived, A-08 currency arrived.
    expect(raw.prepare(`SELECT COUNT(*) AS n FROM credit_tax_lines`).get()).toMatchObject({ n: 0 });
    const approvals = raw.prepare(`PRAGMA table_info(approvals)`).all() as { name: string }[];
    expect(approvals.map((column) => column.name)).toContain('revision');
    expect(approvals.map((column) => column.name)).toContain('controlled_amount');
    const expenses = raw.prepare(`PRAGMA table_info(expenses)`).all() as { name: string }[];
    expect(expenses.map((column) => column.name)).toEqual(expect.arrayContaining(['currency', 'amount_xpf']));

    // The business data is untouched.
    expect(raw.prepare('SELECT total, status FROM invoices WHERE id = ?').get('inv-1'))
      .toMatchObject({ total: 113000, status: 'sent' });

    // Replaying is a no-op: no error, no extra row, no new DDL.
    expect(await runMigrations(db)).toBe(0);
    expect((raw.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get() as Row).n).toBe(MIGRATIONS.length);
  });

  it('produces the same structure as a schema built from SCHEMA_STATEMENTS', async () => {
    const migrated = await oldDatabase();
    await runMigrations(migrated.db);

    const schema = new DatabaseSync(':memory:');
    for (const statement of SCHEMA_STATEMENTS) schema.exec(statement);

    expect(structure(migrated.raw)).toEqual(structure(schema));
  });
});
