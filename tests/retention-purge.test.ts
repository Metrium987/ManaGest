/**
 * A-24: the policies, the bounded batch pass, idempotence, the orphan-chunk rule
 * and the audit chain that must stay verifiable once old entries leave.
 *
 * `ensureSchema` memoises its work per isolate, so the file provisions one
 * database and clears its mutable rows before each case.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../server/db';
import { logActivity, verifyActivityChain } from '../server/lib/audit';
import {
  PURGE_BATCH_SIZE,
  RETENTION_POLICIES,
  auditChainAnchor,
  purgeExpired,
  retentionReport,
} from '../server/lib/retention';

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

const NOW = new Date('2026-11-06T12:00:00.000Z');
const DAY = 86_400_000;
const iso = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();
const isoAhead = (days: number) => new Date(NOW.getTime() + days * DAY).toISOString();

let database: DatabaseSync;
let db: D1Database;

function exec(sql: string, ...params: unknown[]): void {
  database.prepare(sql).run(...(params as never[]));
}

function count(sql: string, ...params: unknown[]): number {
  const row = database.prepare(sql).get(...(params as never[])) as { value: number };
  return Number(row.value);
}

beforeAll(async () => {
  database = new DatabaseSync(':memory:');
  db = asD1(database);
  await ensureSchema(db);
});

beforeEach(() => {
  for (const table of [
    'attachment_chunks',
    'attachments',
    'password_reset_tokens',
    'mfa_challenges',
    'public_link_access',
    'sessions',
    'login_attempts',
    'activities',
    'app_meta',
    'audit_tail',
  ]) {
    try {
      database.prepare(`DELETE FROM ${table}`).run();
    } catch {
      // A table a case never seeded may not exist yet on the very first run.
    }
  }
  exec(`INSERT INTO audit_tail (id, seq) VALUES (1, 0)`);
});

function seedAttempts(prefix: string, daysAgo: number, total = 1): void {
  for (let index = 0; index < total; index += 1) {
    exec(
      `INSERT INTO login_attempts (id, email, ip, successful, created_at) VALUES (?, ?, ?, 0, ?)`,
      `${prefix}-${index}`,
      `${prefix}-${index}@example.test`,
      '10.0.0.1',
      iso(daysAgo),
    );
  }
}

describe('retention policies', () => {
  it('purges what is past its window and keeps what is not', async () => {
    // 91 days is past the 90-day window, 89 is not.
    seedAttempts('old', 91);
    seedAttempts('fresh', 89);

    // Expired 31 days ago vs expired 29 days ago vs still active.
    for (const [id, expires] of [
      ['old', iso(31)],
      ['fresh', iso(29)],
      ['active', isoAhead(1)],
    ] as const) {
      exec(
        `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, ip, user_agent,
          created_at, last_seen_at, expires_at, absolute_expires_at)
         VALUES (?, 'u1', ?, 'csrf', '10.0.0.1', 'test', ?, ?, ?, ?)`,
        id,
        `hash-${id}`,
        iso(60),
        iso(60),
        expires,
        isoAhead(30),
      );
    }

    for (const [id, created] of [['old', iso(366)], ['fresh', iso(364)]] as const) {
      exec(
        `INSERT INTO public_link_access (id, link_id, action, ip, user_agent, created_at)
         VALUES (?, 'link', 'view', '10.0.0.1', 'test', ?)`,
        id,
        created,
      );
    }

    for (const [id, created] of [['old', iso(8)], ['fresh', iso(6)]] as const) {
      exec(
        `INSERT INTO mfa_challenges (id, user_id, token_hash, expires_at, used_at, created_at)
         VALUES (?, 'u1', ?, ?, NULL, ?)`,
        id,
        `mfa-${id}`,
        created,
        created,
      );
    }

    for (const [id, created] of [['old', iso(2)], ['fresh', iso(0.5)]] as const) {
      exec(
        `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used_at, requested_ip, created_at)
         VALUES (?, 'u1', ?, ?, NULL, '10.0.0.1', ?)`,
        id,
        `reset-${id}`,
        created,
        created,
      );
    }

    // Legacy audit rows (no hash, no seq) age out on their own.
    exec(
      `INSERT INTO activities (id, action, entity_type, summary, created_at)
       VALUES ('legacy-old', 'created', 'company', 'old', ?)`,
      iso(4000),
    );
    exec(
      `INSERT INTO activities (id, action, entity_type, summary, created_at)
       VALUES ('legacy-fresh', 'created', 'company', 'fresh', ?)`,
      iso(1),
    );

    const report = await purgeExpired(db, NOW);
    expect(report.total).toBeGreaterThan(0);

    expect(count('SELECT COUNT(*) AS value FROM login_attempts')).toBe(1);
    expect(count("SELECT COUNT(*) AS value FROM login_attempts WHERE id = 'fresh-0'")).toBe(1);

    expect(count('SELECT COUNT(*) AS value FROM sessions')).toBe(2);
    expect(count("SELECT COUNT(*) AS value FROM sessions WHERE id = 'active'")).toBe(1);

    expect(count('SELECT COUNT(*) AS value FROM public_link_access')).toBe(1);
    expect(count('SELECT COUNT(*) AS value FROM mfa_challenges')).toBe(1);
    expect(count('SELECT COUNT(*) AS value FROM password_reset_tokens')).toBe(1);
    expect(count("SELECT COUNT(*) AS value FROM activities WHERE id = 'legacy-old'")).toBe(0);
    expect(count("SELECT COUNT(*) AS value FROM activities WHERE id = 'legacy-fresh'")).toBe(1);

    // Financial tables are not in the policy set at all: no purge can reach them.
    const financial = ['invoices', 'payments', 'credits', 'expenses', 'journal_lines', 'journal_entries'];
    expect(RETENTION_POLICIES.map((policy) => policy.table).filter((table) => financial.includes(table))).toEqual([]);

    const policies = Object.fromEntries(report.policies.map((outcome) => [outcome.policy, outcome.deleted]));
    expect(policies.login_attempts).toBe(1);
    expect(policies.sessions).toBe(1);
    expect(policies.public_link_access).toBe(1);
    expect(policies.mfa_challenges).toBe(1);
    expect(policies.password_reset_tokens).toBe(1);
    expect(policies.activities).toBe(1);
  });

  it('is idempotent: a second pass deletes nothing', async () => {
    seedAttempts('old', 91, 3);
    const first = await purgeExpired(db, NOW);
    expect(first.total).toBeGreaterThan(0);

    const second = await purgeExpired(db, NOW);
    expect(second.total).toBe(0);
    expect(second.policies.every((outcome) => outcome.deleted === 0)).toBe(true);
    expect(count('SELECT COUNT(*) AS value FROM login_attempts')).toBe(0);
  });

  it('works in bounded batches and reports them', async () => {
    const total = PURGE_BATCH_SIZE * 2 + 50;
    seedAttempts('bulk', 91, total);

    const report = await purgeExpired(db, NOW);
    const outcome = report.policies.find((entry) => entry.policy === 'login_attempts')!;
    expect(outcome.deleted).toBe(total);
    expect(outcome.batches).toBe(3);
    expect(outcome.capped).toBe(false);
    expect(count('SELECT COUNT(*) AS value FROM login_attempts')).toBe(0);
  });

  it('never removes a chunk whose attachment is alive or freshly deleted', async () => {
    for (const [id, deleted] of [
      ['live', null],
      ['gone', null],
      ['recent', iso(0.5)],
      ['old', iso(2)],
    ] as const) {
      if (id !== 'gone') {
        exec(
          `INSERT INTO attachments (id, entity_type, entity_id, filename, mime_type, size_bytes,
            checksum, storage, uploaded_by, created_at, deleted_at)
           VALUES (?, 'expense', 'e1', 'r.pdf', 'application/pdf', 3, 'ck', 'database', 'u1', ?, ?)`,
          id,
          iso(10),
          deleted,
        );
      }
      exec(`INSERT INTO attachment_chunks (attachment_id, seq, content) VALUES (?, 0, 'abc')`, id);
    }

    await purgeExpired(db, NOW);

    expect(count("SELECT COUNT(*) AS value FROM attachment_chunks WHERE attachment_id = 'live'")).toBe(1);
    expect(count("SELECT COUNT(*) AS value FROM attachment_chunks WHERE attachment_id = 'recent'")).toBe(1);
    expect(count("SELECT COUNT(*) AS value FROM attachment_chunks WHERE attachment_id = 'old'")).toBe(0);
    expect(count("SELECT COUNT(*) AS value FROM attachment_chunks WHERE attachment_id = 'gone'")).toBe(0);
  });
});

describe('audit chain after a purge', () => {
  it('anchors the removed prefix and keeps verifying new entries', async () => {
    await logActivity(db, { userId: null, action: 'created', entityType: 'company', entityId: 'c1', summary: 'one' });
    await logActivity(db, { userId: null, action: 'updated', entityType: 'company', entityId: 'c1', summary: 'two' });
    expect((await verifyActivityChain(db)).ok).toBe(true);

    // Eleven years later: the whole chain is past the accounting window.
    const later = new Date(NOW.getTime() + 11 * 365 * DAY);
    const report = await purgeExpired(db, later);
    expect(report.policies.find((entry) => entry.policy === 'activities')!.deleted).toBe(2);

    const anchor = await auditChainAnchor(db);
    expect(anchor).not.toBeNull();
    expect(anchor!.seq).toBe(2);

    // Writes continue from the anchor rather than from a missing predecessor.
    await logActivity(db, { userId: null, action: 'created', entityType: 'invoice', entityId: 'i1', summary: 'after purge' });
    const verification = await verifyActivityChain(db);
    expect(verification.ok).toBe(true);
    expect(verification.checked).toBeGreaterThanOrEqual(1);

    const logged = database.prepare(`SELECT summary, meta FROM activities WHERE summary = 'activity.retention_purged'`).all() as { summary: string; meta: string }[];
    expect(logged.length).toBeGreaterThanOrEqual(1);
    expect(JSON.parse(logged[0].meta).total).toBeGreaterThan(0);
  });
});

describe('diagnosis report', () => {
  it('reports rows and payload bytes per retained table', async () => {
    seedAttempts('size', 1, 2);
    const report = await retentionReport(db);
    expect(report.policies).toHaveLength(RETENTION_POLICIES.length);
    expect(report.tables.map((table) => table.table)).toContain('login_attempts');
    const attempts = report.tables.find((table) => table.table === 'login_attempts')!;
    expect(attempts.rows).toBe(2);
    expect(attempts.bytes).toBeGreaterThan(0);
    expect(report.total_rows).toBeGreaterThanOrEqual(2);
  });
});
