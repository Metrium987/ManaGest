/**
 * Retention guard (OQ-005/006): issued documents are never deleted, only
 * cancelled. The configurable retention window (default 10 years, pending
 * local validation with the DICP) blocks purging older documents.
 *
 * A-24 adds the operational side: a policy table, a bounded batch purge kept
 * idempotent under concurrency, a size report for the diagnosis screen, and the
 * only deletion of `activities` the audit chain can still verify — the newest
 * removed entry becomes the chain anchor.
 */
export const DEFAULT_RETENTION_YEARS = 10;

const DAY_MS = 86_400_000;

/** Cutoff date as YYYY-MM-DD after which the retention window has elapsed. */
export function retentionCutoff(docDate: string, retentionYears: number): string {
  const yearPart = docDate.slice(0, 4);
  const y = Number(yearPart);
  if (!Number.isFinite(y)) return docDate;
  return `${y + Math.max(0, retentionYears)}${docDate.slice(4)}`;
}

/** True once the retention window has elapsed (document may be purged). */
export function retentionElapsed(docDate: string, retentionYears: number, today: string): boolean {
  return retentionCutoff(docDate, retentionYears) < today;
}

/** A-24: at most this many rows leave per statement, and this many statements per pass. */
export const PURGE_BATCH_SIZE = 500;
export const PURGE_MAX_BATCHES = 20;

export interface RetentionPolicy {
  key: string;
  table: string;
  column: string;
  days: number;
  /** Chunks only leave when their attachment is gone or soft-deleted. */
  special?: 'orphan-chunks';
}

/**
 * A-24 policy table. Financial documents are deliberately absent: invoices,
 * payments, credits, expenses and the ledger never appear here, so no purge can
 * reach them. `activities` keeps the ten-year accounting window.
 */
export const RETENTION_POLICIES: RetentionPolicy[] = [
  { key: 'activities', table: 'activities', column: 'created_at', days: 3650 },
  { key: 'login_attempts', table: 'login_attempts', column: 'created_at', days: 90 },
  { key: 'sessions', table: 'sessions', column: 'expires_at', days: 30 },
  { key: 'public_link_access', table: 'public_link_access', column: 'created_at', days: 365 },
  { key: 'mfa_challenges', table: 'mfa_challenges', column: 'created_at', days: 7 },
  { key: 'password_reset_tokens', table: 'password_reset_tokens', column: 'created_at', days: 1 },
  { key: 'attachment_chunks', table: 'attachment_chunks', column: 'attachment_id', days: 1, special: 'orphan-chunks' },
];

/** Tables whose size the diagnosis screen reports. */
export const RETENTION_TABLES = [
  'activities',
  'login_attempts',
  'sessions',
  'public_link_access',
  'mfa_challenges',
  'password_reset_tokens',
  'attachments',
  'attachment_chunks',
];

export interface PurgeOutcome {
  policy: string;
  deleted: number;
  batches: number;
  /** True when the per-pass ceiling stopped the pass before the backlog ended. */
  capped: boolean;
}

export interface PurgeReport {
  at: string;
  total: number;
  policies: PurgeOutcome[];
}

export const AUDIT_CHAIN_ANCHOR = 'audit_chain_anchor';

interface AnchorRow {
  seq: number;
  hash: string | null;
}

/** The newest activity removed by a purge; the chain resumes from its hash. */
export async function auditChainAnchor(database: D1Database): Promise<AnchorRow | null> {
  const row = await database
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(AUDIT_CHAIN_ANCHOR)
    .first<{ value: string }>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as { seq?: unknown; hash?: unknown };
    if (!Number.isFinite(Number(parsed.seq))) return null;
    return { seq: Number(parsed.seq), hash: typeof parsed.hash === 'string' ? parsed.hash : null };
  } catch {
    return null;
  }
}

/**
 * Removes the old audit rows and moves the anchor to the newest one removed.
 * Deletion follows `seq` so a partial pass leaves a contiguous remainder, and the
 * anchor only ever moves forward: two overlapping passes cannot rewind it.
 */
async function purgeActivitiesBatch(
  database: D1Database,
  cutoff: string,
): Promise<{ results: unknown[] }> {
  const numbered = await database
    .prepare(
      `DELETE FROM activities WHERE rowid IN (
         SELECT rowid FROM activities
          WHERE seq IS NOT NULL AND created_at < ?
          ORDER BY seq ASC LIMIT ?)
       RETURNING seq, hash`,
    )
    .bind(cutoff, PURGE_BATCH_SIZE)
    .all<{ seq: number; hash: string | null }>();

  const removed = numbered.results ?? [];
  const newest = removed.reduce<AnchorRow | null>((current, row) => {
    const seq = Number(row.seq);
    if (!Number.isFinite(seq)) return current;
    return !current || seq > current.seq ? { seq, hash: row.hash } : current;
  }, null);
  if (newest) {
    await database
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value
         WHERE CAST(COALESCE(json_extract(app_meta.value, '$.seq'), 0) AS INTEGER)
               < CAST(json_extract(excluded.value, '$.seq') AS INTEGER)`,
      )
      .bind(AUDIT_CHAIN_ANCHOR, JSON.stringify(newest))
      .run();
  }

  // Entries written before the hash chain existed carry no `seq`; the verifier
  // skips them, so they can leave on age alone.
  const legacy = await database
    .prepare(
      `DELETE FROM activities WHERE rowid IN (
         SELECT rowid FROM activities
          WHERE seq IS NULL AND created_at < ?
          LIMIT ?)
       RETURNING rowid`,
    )
    .bind(cutoff, PURGE_BATCH_SIZE)
    .all<{ rowid: number }>();

  return { results: [...removed, ...(legacy.results ?? [])] };
}

async function purgeTable(
  database: D1Database,
  policy: RetentionPolicy,
  now: Date,
): Promise<PurgeOutcome> {
  const cutoff = new Date(now.getTime() - policy.days * DAY_MS).toISOString();
  let deleted = 0;
  let batches = 0;
  let capped = false;
  while (batches < PURGE_MAX_BATCHES) {
    const rows = policy.key === 'activities'
      ? await purgeActivitiesBatch(database, cutoff)
      : await database
        .prepare(
          `DELETE FROM ${policy.table} WHERE rowid IN (
             SELECT rowid FROM ${policy.table} WHERE ${policy.column} < ? LIMIT ?)
           RETURNING rowid`,
        )
        .bind(cutoff, PURGE_BATCH_SIZE)
        .all<{ rowid: number }>();
    const count = (rows.results ?? []).length;
    deleted += count;
    batches += 1;
    if (count < PURGE_BATCH_SIZE) break;
    if (batches === PURGE_MAX_BATCHES) capped = true;
  }
  return { policy: policy.key, deleted, batches, capped };
}

/**
 * A chunk has no timestamp of its own, so age is read from its attachment: a
 * missing parent is always an orphan, a soft-deleted parent must be older than
 * the one-day grace. A chunk of a live attachment is never touched.
 */
async function purgeOrphanChunks(database: D1Database, now: Date): Promise<PurgeOutcome> {
  const cutoff = new Date(now.getTime() - DAY_MS).toISOString();
  let deleted = 0;
  let batches = 0;
  let capped = false;
  while (batches < PURGE_MAX_BATCHES) {
    const rows = await database
      .prepare(
        `DELETE FROM attachment_chunks WHERE rowid IN (
           SELECT c.rowid FROM attachment_chunks c
             LEFT JOIN attachments a ON a.id = c.attachment_id
            WHERE a.id IS NULL OR (a.deleted_at IS NOT NULL AND a.deleted_at < ?)
            LIMIT ?)
         RETURNING rowid`,
      )
      .bind(cutoff, PURGE_BATCH_SIZE)
      .all<{ rowid: number }>();
    const count = (rows.results ?? []).length;
    deleted += count;
    batches += 1;
    if (count < PURGE_BATCH_SIZE) break;
    if (batches === PURGE_MAX_BATCHES) capped = true;
  }
  return { policy: 'attachment_chunks', deleted, batches, capped };
}

/**
 * One purge pass. Every statement is a `DELETE … RETURNING` over `rowid`, so a
 * concurrent pass deletes disjoint rows instead of double-counting them and the
 * count is exact. Nothing is written when no row was due.
 */
export async function purgeExpired(
  database: D1Database,
  now = new Date(),
): Promise<PurgeReport> {
  const policies: PurgeOutcome[] = [];
  for (const policy of RETENTION_POLICIES) {
    policies.push(
      policy.special === 'orphan-chunks'
        ? await purgeOrphanChunks(database, now)
        : await purgeTable(database, policy, now),
    );
  }
  const total = policies.reduce((sum, outcome) => sum + outcome.deleted, 0);
  if (total > 0) {
    const { logActivity } = await import('./audit');
    await logActivity(database, {
      userId: null,
      action: 'purged',
      entityType: 'retention',
      entityId: 'daily',
      summary: 'activity.retention_purged',
      meta: {
        total,
        policies: Object.fromEntries(
          policies.filter((outcome) => outcome.deleted > 0).map((outcome) => [outcome.policy, outcome.deleted]),
        ),
      },
    });
  }
  return { at: now.toISOString(), total, policies };
}

export interface TableSize {
  table: string;
  rows: number;
  /** Payload bytes of the text/number columns, not page or index overhead. */
  bytes: number;
}

export interface RetentionReport {
  policies: RetentionPolicy[];
  tables: TableSize[];
  total_rows: number;
  total_bytes: number;
}

/** A-24 diagnosis: row count and payload estimate per retained table. */
export async function retentionReport(database: D1Database): Promise<RetentionReport> {
  const tables: TableSize[] = [];
  for (const table of RETENTION_TABLES) {
    const info = await database.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
    const columns = (info.results ?? []).map((column) => `LENGTH(CAST(COALESCE(${column.name}, '') AS TEXT))`);
    const sum = columns.length ? `SUM(${columns.join(' + ')})` : '0';
    const row = await database
      .prepare(`SELECT COUNT(*) AS rows, COALESCE(${sum}, 0) AS bytes FROM ${table}`)
      .first<{ rows: number; bytes: number }>();
    tables.push({ table, rows: Number(row?.rows ?? 0), bytes: Number(row?.bytes ?? 0) });
  }
  return {
    policies: RETENTION_POLICIES,
    tables,
    total_rows: tables.reduce((sum, table) => sum + table.rows, 0),
    total_bytes: tables.reduce((sum, table) => sum + table.bytes, 0),
  };
}
