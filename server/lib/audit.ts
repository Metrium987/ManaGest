import { nowISO } from '../db';
import { sha256Hex } from './crypto';

export interface ActivityInput {
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  meta?: Record<string, unknown>;
  /** Snapshot of the fields before the change, for sensitive mutations. */
  before?: Record<string, unknown> | null;
  /** Snapshot of the same fields after the change. */
  after?: Record<string, unknown> | null;
  ip?: string | null;
}

interface ActivityRow {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  meta: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  created_at: string;
  prev_hash: string | null;
  hash: string;
}

/**
 * The exact bytes covered by the chain hash. It is built from an array of raw
 * column values (not a re-serialised object), so the verifier can reproduce it
 * byte for byte from what is stored.
 */
function payloadOf(row: Omit<ActivityRow, 'prev_hash' | 'hash'>): string {
  return JSON.stringify([
    row.id,
    row.user_id,
    row.action,
    row.entity_type,
    row.entity_id,
    row.summary,
    row.meta,
    row.before_json,
    row.after_json,
    row.ip,
    row.created_at,
  ]);
}

async function chainHash(prevHash: string | null, payload: string): Promise<string> {
  return sha256Hex(`${prevHash ?? ''}\n${payload}`);
}

/**
 * Keeps only the keys whose value actually changed, so the journal records the
 * precise modification instead of two full copies of the record. Returns null
 * when nothing changed.
 */
export function diffSnapshot(
  before: object,
  after: object,
  keys: readonly string[],
): { before: Record<string, unknown>; after: Record<string, unknown> } | null {
  const source = before as Record<string, unknown>;
  const target = after as Record<string, unknown>;
  const previous: Record<string, unknown> = {};
  const next: Record<string, unknown> = {};
  let changed = false;
  for (const key of keys) {
    const from = source[key] ?? null;
    const to = target[key] ?? null;
    if (String(from ?? '') !== String(to ?? '')) {
      previous[key] = from;
      next[key] = to;
      changed = true;
    }
  }
  return changed ? { before: previous, after: next } : null;
}

/**
 * Append-only audit journal. Every entry carries the exact change (before and
 * after values for sensitive mutations), the actor, the IP, and a hash that
 * chains it to the previous entry: altering or removing an entry breaks the
 * chain, which `verifyActivityChain` detects.
 */
export async function logActivity(database: D1Database, input: ActivityInput): Promise<void> {
  const previous = await database
    .prepare(`SELECT hash FROM activities ORDER BY created_at DESC, rowid DESC LIMIT 1`)
    .first<{ hash: string | null }>();

  const row = {
    id: crypto.randomUUID(),
    user_id: input.userId,
    action: input.action,
    entity_type: input.entityType,
    entity_id: input.entityId ?? null,
    summary: input.summary,
    meta: input.meta ? JSON.stringify(input.meta) : null,
    before_json: input.before ? JSON.stringify(input.before) : null,
    after_json: input.after ? JSON.stringify(input.after) : null,
    ip: input.ip ?? null,
    created_at: nowISO(),
  };
  const hash = await chainHash(previous?.hash ?? null, payloadOf(row));

  await database
    .prepare(
      `INSERT INTO activities (id, user_id, action, entity_type, entity_id, summary, meta,
        before_json, after_json, ip, prev_hash, hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id, row.user_id, row.action, row.entity_type, row.entity_id, row.summary, row.meta,
      row.before_json, row.after_json, row.ip, previous?.hash ?? null, hash, row.created_at,
    )
    .run();
}

export interface ChainVerification {
  ok: boolean;
  checked: number;
  broken_at?: string;
}

/**
 * Recomputes the whole chain. Any edit, deletion or reordering of an entry
 * changes the input of the next hash and is reported with its identifier.
 */
export async function verifyActivityChain(database: D1Database): Promise<ChainVerification> {
  const rows = await database
    .prepare(
      `SELECT id, user_id, action, entity_type, entity_id, summary, meta, before_json, after_json,
              ip, prev_hash, hash, created_at
       FROM activities ORDER BY created_at ASC, rowid ASC`,
    )
    .all<ActivityRow>();

  let prevHash: string | null = null;
  let checked = 0;
  for (const row of rows.results ?? []) {
    // Entries written before the chain existed carry no hash; they are the
    // starting point, not a break.
    if (row.hash === null) continue;
    const expected = await chainHash(prevHash, payloadOf(row));
    if (row.prev_hash !== prevHash || row.hash !== expected) {
      return { ok: false, checked, broken_at: row.id };
    }
    prevHash = row.hash;
    checked += 1;
  }
  return { ok: true, checked };
}
