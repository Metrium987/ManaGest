import { MIGRATIONS } from './migrations';

export const MIGRATIONS_TABLE = 'd1_migrations';

async function tableExists(database: D1Database): Promise<boolean> {
  const row = await database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .bind(MIGRATIONS_TABLE)
    .first<{ name: string }>();
  return Boolean(row);
}

export async function appliedVersions(database: D1Database): Promise<Set<number>> {
  if (!(await tableExists(database))) return new Set();
  const rows = await database.prepare(`SELECT id FROM ${MIGRATIONS_TABLE}`).all<{ id: number }>();
  return new Set((rows.results ?? []).map((row) => Number(row.id)));
}

/**
 * A-10: applies every migration the database has not seen, in version order, and
 * records it. On an up-to-date database this is one existence probe and one
 * SELECT — no DDL, no PRAGMA, nothing written on a user request.
 */
export async function runMigrations(database: D1Database): Promise<number> {
  const exists = await tableExists(database);
  const applied = exists ? await appliedVersions(database) : new Set<number>();
  const pending = MIGRATIONS
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version);
  if (!pending.length) return 0;

  if (!exists) {
    await database
      .prepare(
        `CREATE TABLE IF NOT EXISTS ${MIGRATIONS_TABLE} (
          id INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TEXT NOT NULL
        )`,
      )
      .run();
  }

  let appliedCount = 0;
  for (const migration of pending) {
    const now = new Date().toISOString();
    const statements = [
      ...migration.statements,
      `INSERT INTO ${MIGRATIONS_TABLE} (id, name, applied_at)
       VALUES (${migration.version}, '${migration.name.replace(/'/g, "''")}', '${now}')`,
    ];
    await database.batch(statements.map((statement) => database.prepare(statement)));
    appliedCount += 1;
  }
  return appliedCount;
}
