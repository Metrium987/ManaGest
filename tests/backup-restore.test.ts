/**
 * P-03 — proves backup → full export → restore into a brand-new database.
 *
 * The test runs real SQLite (`node:sqlite`) with the application's own schema
 * statements and its own demo seed, so the rows are the ones the product
 * creates: invoices with JSON line items, payments with allocations, projects,
 * tasks, the activity hash chain. A second, empty database receives the dump and
 * every table is compared row for row.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from '../server/db/schema';
import {
  BACKUP_FORMAT,
  BackupError,
  dumpChecksum,
  exportDatabase,
  restoreDatabase,
  type BackupDump,
  type BackupSource,
} from '../server/lib/backup';
import { seedDemoData } from '../server/services/seed';

const NOW = '2026-11-02T09:00:00.000Z';
const COMPANY_ID = 'company-test';
const USER_ID = 'user-test';

/** Tables the demo seed fills; the round trip must preserve each one. */
const SEEDED_TABLES = [
  'activities', 'bank_accounts', 'clients', 'company', 'expenses', 'invoices',
  'payment_allocations', 'payments', 'products', 'projects', 'quotes',
  'recurring_invoices', 'tasks', 'users', 'vendors',
];

function createDatabase(): DatabaseSync {
  const database = new DatabaseSync(':memory:');
  database.exec('PRAGMA foreign_keys = ON');
  for (const statement of SCHEMA_STATEMENTS) database.exec(statement);
  return database;
}

type Row = Record<string, unknown>;

/** Row reader that returns plain objects, like the JSON dump does. */
function rows(database: DatabaseSync, sql: string): Row[] {
  return JSON.parse(JSON.stringify(database.prepare(sql).all())) as Row[];
}

function count(database: DatabaseSync, table: string): number {
  const row = database.prepare(`SELECT COUNT(*) AS count FROM "${table}"`).get() as { count: number };
  return Number(row.count);
}

function source(database: DatabaseSync): BackupSource {
  return {
    all: async (sql, bindings = []) => database.prepare(sql).all(...(bindings as never[])) as Row[],
    run: async (sql, bindings = []) => {
      database.prepare(sql).run(...(bindings as never[]));
    },
    batch: async (statements) => {
      database.exec('BEGIN');
      try {
        for (const statement of statements) {
          database.prepare(statement.sql).run(...(statement.bindings as never[]));
        }
        database.exec('COMMIT');
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

/** Minimal D1 surface for the demo seed: prepare/bind/all/first/run. */
function asD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => ({ results: database.prepare(sql).all(...(params as never[])) }),
      first: async () => database.prepare(sql).get(...(params as never[])) ?? null,
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

async function seed(database: DatabaseSync): Promise<void> {
  database
    .prepare(`INSERT INTO company (id, name, currency, timezone, created_at, updated_at)
              VALUES (?, 'ManaGest Test', 'XPF', 'Pacific/Tahiti', ?, ?)`)
    .run(COMPANY_ID, NOW, NOW);
  database
    .prepare(`INSERT INTO users (id, email, password_hash, first_name, last_name, role, created_at, updated_at)
              VALUES (?, 'owner@example.test', 'hash', 'Test', 'Owner', 'owner', ?, ?)`)
    .run(USER_ID, NOW, NOW);
  database
    .prepare(`INSERT INTO app_meta (key, value) VALUES ('schema_version', ?), ('seeded_at', ?)`)
    .run(String(SCHEMA_VERSION), NOW);
  database
    .prepare(`INSERT INTO settings_extra (key, value, updated_at) VALUES ('price_history_months', '36', ?)`)
    .run(NOW);

  await seedDemoData({
    db: asD1(database),
    companyId: COMPANY_ID,
    userId: USER_ID,
    currency: 'XPF',
    timezone: 'Pacific/Tahiti',
    taxRate: 16,
  });
}

async function seededDatabase(): Promise<DatabaseSync> {
  const database = createDatabase();
  await seed(database);
  return database;
}

async function expectBackupError(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(BackupError);
  await expect(promise).rejects.toMatchObject({ code });
}

/** Recompute the checksum after a deliberate edit, so only the edit is tested. */
async function reseal(dump: BackupDump): Promise<BackupDump> {
  const body = {
    format: dump.format,
    format_version: dump.format_version,
    schema_version: dump.schema_version,
    tables: dump.tables,
  };
  return { ...body, exported_at: dump.exported_at, checksum: await dumpChecksum(body) };
}

describe('P-03 backup export and restore', () => {
  it('exports every workspace table with the schema version and a checksum', async () => {
    const database = await seededDatabase();
    const dump = await exportDatabase(source(database), { now: NOW });

    expect(dump.format).toBe(BACKUP_FORMAT);
    expect(dump.format_version).toBe(1);
    expect(dump.schema_version).toBe(SCHEMA_VERSION);
    expect(dump.exported_at).toBe(NOW);
    expect(dump.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(dump.tables.length).toBeGreaterThanOrEqual(70);

    const names = dump.tables.map((table) => table.name);
    for (const name of SEEDED_TABLES) expect(names).toContain(name);
    for (const table of dump.tables) expect(table.row_count).toBe(table.rows.length);

    const invoices = dump.tables.find((table) => table.name === 'invoices')!;
    expect(invoices.row_count).toBeGreaterThan(0);
    expect(dump.tables.reduce((sum, table) => sum + table.row_count, 0)).toBeGreaterThan(50);
  });

  it('restores a new database row for row, then re-exports the same checksum', async () => {
    const origin = await seededDatabase();
    const dump = await exportDatabase(source(origin), { now: NOW });

    const restored = createDatabase();
    const report = await restoreDatabase(source(restored), dump);

    expect(report.schema_version).toBe(SCHEMA_VERSION);
    expect(report.source_schema_version).toBe(SCHEMA_VERSION);
    expect(report.replaced).toBe(false);

    for (const table of dump.tables) {
      expect(count(restored, table.name), `lignes de ${table.name}`).toBe(table.row_count);
    }
    for (const name of SEEDED_TABLES) expect(count(restored, name), `${name} vide`).toBeGreaterThan(0);

    const reexport = await exportDatabase(source(restored), { now: 'later' });
    expect(reexport.checksum).toBe(dump.checksum);
    expect(reexport.tables).toEqual(dump.tables);
  });

  it('keeps identifiers, amounts, dates and the links between entities', async () => {
    const origin = await seededDatabase();
    const dump = await exportDatabase(source(origin), { now: NOW });
    const restored = createDatabase();
    await restoreDatabase(source(restored), dump);

    for (const table of ['invoices', 'payments', 'payment_allocations', 'clients', 'products', 'quotes', 'activities']) {
      expect(rows(restored, `SELECT * FROM "${table}" ORDER BY id`), table)
        .toEqual(rows(origin, `SELECT * FROM "${table}" ORDER BY id`));
    }

    const invoices = rows(restored, `SELECT id, client_id, total, paid_total, balance, date, due_date, line_items FROM invoices`);
    const clientIds = new Set(rows(restored, `SELECT id FROM clients`).map((row) => row.id));
    for (const invoice of invoices) {
      expect(clientIds.has(invoice.client_id), `client de ${invoice.id}`).toBe(true);
      expect(Number(invoice.paid_total) + Number(invoice.balance)).toBe(Number(invoice.total));
      expect(String(invoice.date)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(JSON.parse(String(invoice.line_items)).length).toBeGreaterThan(0);
    }

    const allocations = rows(restored, `SELECT payment_id, invoice_id, amount FROM payment_allocations`);
    const paymentIds = new Set(rows(restored, `SELECT id FROM payments`).map((row) => row.id));
    const invoiceIds = new Set(invoices.map((row) => row.id));
    expect(allocations.length).toBeGreaterThan(0);
    for (const allocation of allocations) {
      expect(paymentIds.has(allocation.payment_id)).toBe(true);
      expect(invoiceIds.has(allocation.invoice_id)).toBe(true);
      expect(Number(allocation.amount)).toBeGreaterThan(0);
    }

    const meta = rows(restored, `SELECT value FROM app_meta WHERE key = 'schema_version'`);
    expect(meta[0]?.value).toBe(String(SCHEMA_VERSION));
    expect(rows(restored, `SELECT value FROM settings_extra WHERE key = 'price_history_months'`)[0]?.value).toBe('36');

    // The activity chain is part of the data: restoring it must not reset it.
    const chain = rows(restored, `SELECT hash, prev_hash FROM activities ORDER BY created_at, rowid`);
    expect(chain.at(-1)?.hash).toBe(rows(origin, `SELECT hash FROM activities ORDER BY created_at, rowid`).at(-1)?.hash);
  });

  it('refuses a dump produced by a newer schema', async () => {
    const database = await seededDatabase();
    const dump = await exportDatabase(source(database), { now: NOW });
    const future = await reseal({ ...dump, schema_version: SCHEMA_VERSION + 1 });
    const target = createDatabase();

    await expectBackupError(restoreDatabase(source(target), future), 'BACKUP_SCHEMA_NEWER');
    expect(count(target, 'invoices')).toBe(0);
  });

  it('accepts an older dump and stamps the schema this code created', async () => {
    const database = await seededDatabase();
    const dump = await exportDatabase(source(database), { now: NOW });
    const older = await reseal({ ...dump, schema_version: SCHEMA_VERSION - 1 });
    const target = createDatabase();

    const report = await restoreDatabase(source(target), older);
    expect(report.source_schema_version).toBe(SCHEMA_VERSION - 1);
    expect(report.schema_version).toBe(SCHEMA_VERSION);
    expect(rows(target, `SELECT value FROM app_meta WHERE key = 'schema_version'`)[0]?.value)
      .toBe(String(SCHEMA_VERSION));
    expect(count(target, 'invoices')).toBe(count(database, 'invoices'));
  });

  it('refuses to overwrite a non-empty workspace unless asked, then does not duplicate rows', async () => {
    const origin = await seededDatabase();
    const dump = await exportDatabase(source(origin), { now: NOW });
    const target = await seededDatabase();
    const before = count(target, 'invoices');

    await expectBackupError(restoreDatabase(source(target), dump), 'TARGET_NOT_EMPTY');
    expect(count(target, 'invoices')).toBe(before);

    const report = await restoreDatabase(source(target), dump, { allow_overwrite: true });
    expect(report.replaced).toBe(true);
    expect(count(target, 'invoices')).toBe(before);
    expect(count(target, 'payment_allocations')).toBe(count(origin, 'payment_allocations'));
    await expect(restoreDatabase(source(target), dump)).rejects.toMatchObject({ code: 'TARGET_NOT_EMPTY' });
  });

  it('refuses a dump whose checksum does not match its content', async () => {
    const database = await seededDatabase();
    const dump = await exportDatabase(source(database), { now: NOW });
    const tampered: BackupDump = structuredClone(dump);
    const invoices = tampered.tables.find((table) => table.name === 'invoices')!;
    invoices.rows[0].total = Number(invoices.rows[0].total) + 1;

    await expectBackupError(restoreDatabase(source(createDatabase()), tampered), 'BACKUP_CHECKSUM_MISMATCH');
  });

  it('refuses a table the target schema does not know', async () => {
    const database = await seededDatabase();
    const dump = await exportDatabase(source(database), { now: NOW });
    const unknown = await reseal({
      ...dump,
      tables: [...dump.tables, { name: 'ghost_table', row_count: 0, rows: [] }],
    });

    await expectBackupError(restoreDatabase(source(createDatabase()), unknown), 'BACKUP_UNKNOWN_TABLE');

    const hostile = await reseal({
      ...dump,
      tables: [...dump.tables, { name: 'clients"; DROP TABLE invoices; --', row_count: 0, rows: [] }],
    });
    await expectBackupError(restoreDatabase(source(createDatabase()), hostile), 'BACKUP_BAD_TABLE');
  });
});
