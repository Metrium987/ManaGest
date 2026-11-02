/**
 * P-03 — full workspace export and restore.
 *
 * The backup is one JSON document: every table, every row, plus the schema
 * version it was taken from and a SHA-256 checksum over its canonical form. The
 * restore writes those rows into an empty (or explicitly replaced) workspace and
 * refuses anything it cannot prove: a newer schema, a checksum that does not
 * match, a table the target does not know, a value that is not JSON-safe.
 *
 * Why not `sqlite3 .dump`: the worker has no shell and no file system. Reading
 * the tables through the same D1 API the application uses keeps the backup in
 * one format that a browser download, a test and a restore route can all handle.
 *
 * The schema belongs to the running code, never to the dump: restoring an older
 * backup into the current schema leaves `app_meta.schema_version` at the current
 * version, so the next request does not replay migrations on a schema that is
 * already there.
 */
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from '../db/schema';

export const BACKUP_FORMAT = 'managest-backup';
export const BACKUP_FORMAT_VERSION = 1;

export type BackupValue = string | number | null;

export interface BackupTable {
  name: string;
  row_count: number;
  rows: Record<string, BackupValue>[];
}

export interface BackupDump {
  format: typeof BACKUP_FORMAT;
  format_version: number;
  schema_version: number;
  exported_at: string;
  checksum: string;
  tables: BackupTable[];
}

/** The narrow surface the export and restore need, so a test can use SQLite. */
export interface BackupSource {
  all(sql: string, bindings?: BackupValue[]): Promise<Record<string, unknown>[]>;
  run(sql: string, bindings?: BackupValue[]): Promise<void>;
  batch(statements: { sql: string; bindings: BackupValue[] }[]): Promise<void>;
}

export class BackupError extends Error {
  constructor(readonly code: string, readonly detail?: string) {
    super(code);
    this.name = 'BackupError';
  }
}

/** Tables in creation order: parents before children, which restore relies on. */
export const SCHEMA_TABLE_ORDER: string[] = SCHEMA_STATEMENTS
  .map((statement) => /CREATE TABLE IF NOT EXISTS (\w+)/.exec(statement)?.[1])
  .filter((name): name is string => Boolean(name));

const INTERNAL_TABLE = /^(_cf_|_d1_|sqlite_)/;
const TABLE_NAME = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * Tables only real usage fills. The schema itself seeds reference rows
 * (`expense_categories`, `import_tax_rules`), so they cannot prove that a
 * workspace holds data worth protecting from an accidental restore.
 */
export const WORKSPACE_DATA_TABLES = new Set([
  'activities', 'api_tokens', 'attachments', 'bank_accounts', 'clients', 'company',
  'credits', 'client_documents', 'client_contacts', 'expenses', 'invoices',
  'journal_entries', 'number_sequences', 'payments', 'products', 'projects',
  'purchase_orders', 'quotes', 'recurring_invoices', 'settings_extra',
  'stock_movements', 'tasks', 'users', 'vendors',
]);

function assertTableName(name: string): void {
  if (!TABLE_NAME.test(name)) throw new BackupError('BACKUP_BAD_TABLE', name);
}

function normaliseValue(value: unknown, where: string): BackupValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number') return value;
  throw new BackupError('BACKUP_BAD_VALUE', where);
}

/** Stable serialisation: object keys sorted, array order kept. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
}

/** Checksum of everything that must survive a round trip (no export timestamp). */
export async function dumpChecksum(body: Omit<BackupDump, 'checksum' | 'exported_at'>): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(body));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Every table the workspace owns, in schema order, then anything extra. */
export async function listWorkspaceTables(source: BackupSource): Promise<string[]> {
  const rows = await source.all(`SELECT name FROM sqlite_master WHERE type = 'table'`);
  const existing = new Set(rows.map((row) => String(row.name)));
  const ordered = SCHEMA_TABLE_ORDER.filter((name) => existing.has(name));
  const extra = [...existing]
    .filter((name) => !SCHEMA_TABLE_ORDER.includes(name) && !INTERNAL_TABLE.test(name))
    .sort();
  return [...ordered, ...extra];
}

export interface ExportOptions {
  now?: string;
}

export async function exportDatabase(source: BackupSource, options: ExportOptions = {}): Promise<BackupDump> {
  const tables: BackupTable[] = [];
  for (const name of await listWorkspaceTables(source)) {
    assertTableName(name);
    const rows = await source.all(`SELECT * FROM "${name}"`);
    const clean = rows.map((row) => Object.fromEntries(
      Object.entries(row).map(([column, value]) => [column, normaliseValue(value, `${name}.${column}`)]),
    ) as Record<string, BackupValue>);
    tables.push({ name, row_count: clean.length, rows: clean });
  }

  const body = {
    format: BACKUP_FORMAT as typeof BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: SCHEMA_VERSION,
    tables,
  };
  return {
    ...body,
    exported_at: options.now ?? new Date().toISOString(),
    checksum: await dumpChecksum(body),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Shape and version checks, then the checksum — in that order. */
export function readDump(input: unknown): BackupDump {
  if (!isRecord(input)) throw new BackupError('BACKUP_INVALID');
  if (input.format !== BACKUP_FORMAT) throw new BackupError('BACKUP_FORMAT_UNSUPPORTED', String(input.format));
  if (input.format_version !== BACKUP_FORMAT_VERSION) {
    throw new BackupError('BACKUP_FORMAT_UNSUPPORTED', String(input.format_version));
  }
  const schemaVersion = Number(input.schema_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) throw new BackupError('BACKUP_INVALID');
  if (schemaVersion > SCHEMA_VERSION) {
    throw new BackupError('BACKUP_SCHEMA_NEWER', `${schemaVersion} > ${SCHEMA_VERSION}`);
  }
  if (!Array.isArray(input.tables)) throw new BackupError('BACKUP_INVALID');

  const tables: BackupTable[] = input.tables.map((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string' || !Array.isArray(entry.rows)) {
      throw new BackupError('BACKUP_INVALID');
    }
    const rows = entry.rows.map((row) => {
      if (!isRecord(row)) throw new BackupError('BACKUP_INVALID');
      return Object.fromEntries(
        Object.keys(row).map((column) => [column, normaliseValue(row[column], `${entry.name}.${column}`)]),
      ) as Record<string, BackupValue>;
    });
    return { name: entry.name, row_count: rows.length, rows };
  });

  return {
    format: BACKUP_FORMAT,
    format_version: BACKUP_FORMAT_VERSION,
    schema_version: schemaVersion,
    exported_at: typeof input.exported_at === 'string' ? input.exported_at : '',
    checksum: String(input.checksum ?? ''),
    tables,
  };
}

export interface RestoreOptions {
  /** Required to replace a workspace that already holds rows. */
  allow_overwrite?: boolean;
}

export interface RestoreReport {
  schema_version: number;
  source_schema_version: number;
  replaced: boolean;
  tables: { name: string; rows: number }[];
}

async function countRows(source: BackupSource, name: string): Promise<number> {
  const rows = await source.all(`SELECT COUNT(*) AS count FROM "${name}"`);
  return Number(rows[0]?.count ?? 0);
}

/**
 * Writes a dump into the workspace. Rows are inserted parents-first, which keeps
 * the four declared foreign keys satisfied without disabling them; the target
 * must be empty unless `allow_overwrite` is explicit.
 */
export async function restoreDatabase(
  source: BackupSource,
  input: unknown,
  options: RestoreOptions = {},
): Promise<RestoreReport> {
  const dump = readDump(input);
  const body = {
    format: dump.format,
    format_version: dump.format_version,
    schema_version: dump.schema_version,
    tables: dump.tables,
  };
  if ((await dumpChecksum(body)) !== dump.checksum) throw new BackupError('BACKUP_CHECKSUM_MISMATCH');

  const targetTables = new Set(
    (await source.all(`SELECT name FROM sqlite_master WHERE type = 'table'`)).map((row) => String(row.name)),
  );
  for (const table of dump.tables) {
    assertTableName(table.name);
    if (!targetTables.has(table.name)) throw new BackupError('BACKUP_UNKNOWN_TABLE', table.name);
  }

  const names = dump.tables.map((table) => table.name);
  const ordered = [
    ...SCHEMA_TABLE_ORDER.filter((name) => names.includes(name)),
    ...names.filter((name) => !SCHEMA_TABLE_ORDER.includes(name)),
  ];
  const byName = new Map(dump.tables.map((table) => [table.name, table]));

  if (!options.allow_overwrite) {
    let occupied = 0;
    for (const name of ordered) {
      if (WORKSPACE_DATA_TABLES.has(name)) occupied += await countRows(source, name);
    }
    if (occupied > 0) throw new BackupError('TARGET_NOT_EMPTY');
  }

  // Clear what the dump covers, children first: the schema seeds reference rows
  // (`expense_categories`, `import_tax_rules`), and the dump carries its own.
  for (const name of [...ordered].reverse()) await source.run(`DELETE FROM "${name}"`);

  const statements: { sql: string; bindings: BackupValue[] }[] = [];
  for (const name of ordered) {
    const table = byName.get(name);
    if (!table || table.rows.length === 0) continue;
    const columns = [...new Set(table.rows.flatMap((row) => Object.keys(row)))].sort();
    const sql = `INSERT INTO "${name}" (${columns.map((column) => `"${column}"`).join(', ')}) `
      + `VALUES (${columns.map(() => '?').join(', ')})`;
    for (const row of table.rows) {
      statements.push({ sql, bindings: columns.map((column) => row[column] ?? null) });
    }
  }
  for (let index = 0; index < statements.length; index += 200) {
    await source.batch(statements.slice(index, index + 200));
  }

  // The schema is the one this code just created, whatever the dump came from.
  if (targetTables.has('app_meta') && byName.has('app_meta')) {
    await source.run(
      `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [String(SCHEMA_VERSION)],
    );
  }

  return {
    schema_version: SCHEMA_VERSION,
    source_schema_version: dump.schema_version,
    replaced: Boolean(options.allow_overwrite),
    tables: ordered.map((name) => ({ name, rows: byName.get(name)?.rows.length ?? 0 })),
  };
}

/** D1 adapter for the route; tests use the same interface over node:sqlite. */
export function d1BackupSource(database: D1Database): BackupSource {
  return {
    all: async (sql, bindings = []) => {
      const result = await database.prepare(sql).bind(...bindings).all<Record<string, unknown>>();
      return result.results ?? [];
    },
    run: async (sql, bindings = []) => {
      await database.prepare(sql).bind(...bindings).run();
    },
    batch: async (statements) => {
      if (statements.length === 0) return;
      await database.batch(statements.map((statement) => database.prepare(statement.sql).bind(...statement.bindings)));
    },
  };
}
