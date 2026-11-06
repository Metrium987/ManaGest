/**
 * A-25: business observability. The dashboard shows activity; this module shows
 * whether the data underneath is healthy — stock and referential gaps, the
 * accounting backlog, the last daily pass, the purge state, the schema version
 * and the largest tables. It is read-only and returns no personal data.
 */
import { MIGRATIONS } from '../db/migrations';
import { integrityReport } from './integrity';
import { stockBalance } from './stock-balance';
import { estimateTableSize } from './retention';
import { accountingBacklog } from '../services/accounting';
import { lastDailyRun } from '../services/daily-run';

export interface TableFootprint {
  table: string;
  rows: number;
  bytes: number;
}

export interface ObservabilityReport {
  generated_at: string;
  integrity_gaps: number;
  integrity_relations: { relation: string; orphans: number }[];
  stock_gaps: number;
  accounting: { backlog: number; cursor: string | null };
  runs: {
    last_day: string | null;
    last_status: string | null;
    error_code: string | null;
    failed_recent: number;
  };
  purge: { last_at: string | null; last_total: number };
  schema: { version: number | null; last_migration: string | null };
  largest_tables: TableFootprint[];
}

async function metaNumber(database: D1Database, key: string): Promise<number> {
  const row = await database
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return Number(row?.value ?? 0);
}

async function metaValue(database: D1Database, key: string): Promise<string | null> {
  const row = await database
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/** Migration recorded in the database, or the shipped last one before A-10 runs. */
async function schemaState(database: D1Database): Promise<ObservabilityReport['schema']> {
  const shipped = MIGRATIONS.reduce((last, migration) => (migration.version > last.version ? migration : last));
  try {
    const row = await database
      .prepare(`SELECT MAX(id) AS version FROM d1_migrations`)
      .first<{ version: number | null }>();
    const version = row?.version === null || row?.version === undefined ? null : Number(row.version);
    if (version === null) return { version: null, last_migration: null };
    const named = await database
      .prepare(`SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1`)
      .first<{ name: string }>();
    return { version, last_migration: named?.name ?? null };
  } catch {
    // Fresh database, migrations not applied yet: report the shipped version.
    return { version: null, last_migration: `${shipped.version}:${shipped.name}` };
  }
}

/** The ten largest tables by payload estimate, biggest first. */
export async function largestTables(database: D1Database, limit = 10): Promise<TableFootprint[]> {
  const tables = await database
    .prepare(
      `SELECT name FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'`,
    )
    .all<{ name: string }>();
  const sizes: TableFootprint[] = [];
  for (const table of tables.results ?? []) {
    sizes.push(await estimateTableSize(database, table.name));
  }
  return sizes.sort((a, b) => b.bytes - a.bytes || a.table.localeCompare(b.table)).slice(0, limit);
}

/** Counts for the dashboard card. No names, no ids, no addresses. */
export async function observabilityReport(database: D1Database): Promise<ObservabilityReport> {
  const [integrity, stock, backlog, run, purgeAt, purgeTotal, schema, largest] = await Promise.all([
    integrityReport(database),
    stockBalance(database),
    accountingBacklog(database),
    lastDailyRun(database),
    metaValue(database, 'retention_last_purged_at'),
    metaNumber(database, 'retention_last_purged_total'),
    schemaState(database),
    largestTables(database, 10),
  ]);

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const failed = await database
    .prepare(
      `SELECT COUNT(*) AS count FROM daily_runs
        WHERE status IN ('failed', 'partial') AND started_at >= ?`,
    )
    .bind(since)
    .first<{ count: number }>();

  return {
    generated_at: new Date().toISOString(),
    integrity_gaps: integrity.total,
    integrity_relations: integrity.relations
      .filter((relation) => relation.orphans > 0)
      .map((relation) => ({ relation: relation.relation, orphans: relation.orphans })),
    stock_gaps: stock.total,
    accounting: { backlog: backlog.backlog, cursor: backlog.cursor },
    runs: {
      last_day: run?.day ?? null,
      last_status: run?.status ?? null,
      error_code: run?.error_code ?? null,
      failed_recent: Number(failed?.count ?? 0),
    },
    purge: { last_at: purgeAt, last_total: purgeTotal },
    schema,
    largest_tables: largest,
  };
}

/**
 * A-25: the public health answer. Only aggregates and versions cross this
 * boundary — never an address, an identifier, a path or a row sample.
 */
export async function healthReport(database: D1Database): Promise<Record<string, unknown>> {
  const report = await observabilityReport(database);
  return {
    status: report.integrity_gaps === 0 && report.stock_gaps === 0 ? 'ok' : 'degraded',
    schema_version: report.schema.version,
    last_migration: report.schema.last_migration,
    integrity_gaps: report.integrity_gaps,
    stock_gaps: report.stock_gaps,
    accounting_backlog: report.accounting.backlog,
    last_run_status: report.runs.last_status,
    failed_runs_recent: report.runs.failed_recent,
    purged_at: report.purge.last_at,
    purged_total: report.purge.last_total,
    generated_at: report.generated_at,
  };
}
