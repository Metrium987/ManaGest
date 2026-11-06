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
/** A-19: the claim, the predecessor lookup and the insert are serialised inside
 * the isolate, so concurrent handlers cannot interleave them. The `seq` itself
 * comes from one atomic `UPDATE … RETURNING`, which also protects isolates that
 * do not share this queue. */
let auditQueue: Promise<unknown> = Promise.resolve();

async function claimSeq(database: D1Database): Promise<number | null> {
  const claim = await database
    .prepare(`UPDATE audit_tail SET seq = seq + 1 WHERE id = 1 RETURNING seq`)
    .first<{ seq: number }>();
  if (claim?.seq !== undefined) return Number(claim.seq);
  await database.prepare(`INSERT OR IGNORE INTO audit_tail (id, seq) VALUES (1, 0)`).run();
  const retry = await database
    .prepare(`UPDATE audit_tail SET seq = seq + 1 WHERE id = 1 RETURNING seq`)
    .first<{ seq: number }>();
  return retry?.seq === undefined ? null : Number(retry.seq);
}

async function previousHash(database: D1Database, seq: number | null): Promise<string | null> {
  if (seq !== null && seq > 1) {
    // The predecessor is written by the writer that claimed seq - 1; the queue
    // makes it visible here, and the bounded wait covers another isolate.
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const row = await database
        .prepare(`SELECT hash FROM activities WHERE seq = ?`)
        .bind(seq - 1)
        .first<{ hash: string | null }>();
      if (row) return row.hash;
    }
  }
  const last = await database
    .prepare(
      `SELECT hash FROM activities WHERE hash IS NOT NULL ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    )
    .first<{ hash: string | null }>();
  return last?.hash ?? null;
}

async function appendActivity(database: D1Database, input: ActivityInput): Promise<void> {
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
  const seq = await claimSeq(database);
  const prevHash = await previousHash(database, seq);
  const hash = await chainHash(prevHash, payloadOf(row));

  await database
    .prepare(
      `INSERT INTO activities (id, user_id, action, entity_type, entity_id, summary, meta,
        before_json, after_json, ip, prev_hash, hash, seq, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      row.id, row.user_id, row.action, row.entity_type, row.entity_id, row.summary, row.meta,
      row.before_json, row.after_json, row.ip, prevHash, hash, seq, row.created_at,
    )
    .run();
}

export async function logActivity(database: D1Database, input: ActivityInput): Promise<void> {
  const next = auditQueue.then(
    () => appendActivity(database, input),
    () => appendActivity(database, input),
  );
  auditQueue = next.then(() => undefined, () => undefined);
  return next;
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
              ip, prev_hash, hash, seq, created_at
       FROM activities
       ORDER BY CASE WHEN seq IS NULL THEN 0 ELSE 1 END, seq ASC, created_at ASC, rowid ASC`,
    )
    .all<ActivityRow & { seq: number | null }>();

  let prevHash: string | null = null;
  let checked = 0;
  let expectedSeq = 1;
  for (const row of rows.results ?? []) {
    // Entries written before the chain existed carry no hash; they are the
    // starting point, not a break.
    if (row.hash === null) continue;
    const expected = await chainHash(prevHash, payloadOf(row));
    if (row.prev_hash !== prevHash || row.hash !== expected) {
      return { ok: false, checked, broken_at: row.id };
    }
    // A-19: numbered entries must be contiguous. A gap means a write claimed a
    // seq and never inserted: it is reported, never silently skipped.
    if (row.seq !== null && row.seq !== undefined) {
      if (row.seq !== expectedSeq) return { ok: false, checked, broken_at: row.id };
      expectedSeq = row.seq + 1;
    }
    prevHash = row.hash;
    checked += 1;
  }
  return { ok: true, checked };
}
