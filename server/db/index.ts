import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

export type SqlValue = string | number | null;

/** Cached per isolate so a warm Worker never re-runs DDL. */
let schemaReady: Promise<void> | null = null;

export function ensureSchema(database: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = provision(database).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

async function provision(database: D1Database): Promise<void> {
  const existing = await database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'`)
    .first<{ name: string }>();

  if (existing) {
    const version = await database
      .prepare(`SELECT value FROM app_meta WHERE key = 'schema_version'`)
      .first<{ value: string }>();
    if (version?.value === String(SCHEMA_VERSION)) return;
  }

  await database.batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)));
  await applyColumnMigrations(database);

  await database
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(String(SCHEMA_VERSION))
    .run();
}

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so columns added to pre-existing
 * tables are checked against PRAGMA table_info first. Fresh installs already
 * carry them in CREATE TABLE, which makes these a no-op there.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; definition: string }[] = [
  { table: 'users', column: 'mfa_secret', definition: 'TEXT' },
  { table: 'users', column: 'mfa_enabled', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'mfa_codes', definition: 'TEXT' },
  // T-202b: a custom role is stored here; `role` keeps one of the five fixed
  // keys because SQLite cannot widen a CHECK constraint without rebuilding the
  // table — which is not a migration worth running on a user table.
  { table: 'users', column: 'role_key', definition: 'TEXT' },
  { table: 'activities', column: 'before_json', definition: 'TEXT' },
  { table: 'activities', column: 'after_json', definition: 'TEXT' },
  { table: 'activities', column: 'ip', definition: 'TEXT' },
  { table: 'activities', column: 'prev_hash', definition: 'TEXT' },
  { table: 'activities', column: 'hash', definition: 'TEXT' },
];

async function applyColumnMigrations(database: D1Database): Promise<void> {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = await database.prepare(`PRAGMA table_info(${migration.table})`).all<{ name: string }>();
    if (!(columns.results ?? []).some((column) => column.name === migration.column)) {
      await database
        .prepare(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`)
        .run();
    }
  }
}

export async function one<T>(statement: D1PreparedStatement): Promise<T | null> {
  return (await statement.first<T>()) ?? null;
}

export async function many<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function scalar(statement: D1PreparedStatement): Promise<number> {
  const row = await statement.first<Record<string, number>>();
  if (!row) return 0;
  const value = Object.values(row)[0];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function nowISO(): string {
  return new Date().toISOString();
}
