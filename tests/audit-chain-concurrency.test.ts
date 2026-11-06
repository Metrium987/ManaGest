import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { logActivity, verifyActivityChain } from '../server/lib/audit';

type Db = Parameters<typeof logActivity>[0];

/** Minimal D1 surface over node:sqlite: `first()` also answers `UPDATE … RETURNING`. */
function asD1(raw: DatabaseSync): Db {
  const make = (sql: string, params: unknown[] = []): any => ({
    bind: (...args: unknown[]) => make(sql, args),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])), success: true, meta: {} }),
    run: async () => {
      raw.prepare(sql).run(...(params as never[]));
      return { success: true, meta: {}, results: [] };
    },
  });
  return {
    prepare: (sql: string) => make(sql),
    batch: async (list: any[]) => Promise.all(list.map((item) => item.run())),
    exec: async (sql: string) => {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as Db;
}

function fresh() {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return { raw, db: asD1(raw) };
}

function audit(actor = 'user-1') {
  return {
    userId: actor,
    action: 'updated',
    entityType: 'invoice',
    entityId: 'inv-1',
    summary: 'activity.invoice_updated',
  };
}

describe('A-19 the audit chain has a total order', () => {
  it('fifty concurrent writes get distinct, contiguous sequences', async () => {
    const { raw, db } = fresh();
    await Promise.all(Array.from({ length: 50 }, (_, index) => logActivity(db, audit(`user-${index}`))));

    const sequences = (raw.prepare(`SELECT seq FROM activities ORDER BY seq`).all() as { seq: number }[])
      .map((row) => Number(row.seq));
    expect(sequences).toHaveLength(50);
    expect(sequences).toEqual(Array.from({ length: 50 }, (_, index) => index + 1));
    expect(new Set(sequences).size).toBe(50);

    const chain = await verifyActivityChain(db);
    expect(chain).toEqual({ ok: true, checked: 50 });
  });

  it('the tail keeps the last claimed sequence and the chain follows it', async () => {
    const { raw, db } = fresh();
    await logActivity(db, audit('a'));
    await logActivity(db, audit('b'));
    await logActivity(db, audit('c'));

    const tail = raw.prepare(`SELECT seq FROM audit_tail WHERE id = 1`).get() as { seq: number };
    expect(Number(tail.seq)).toBe(3);
    const chained = raw
      .prepare(`SELECT seq, prev_hash, hash FROM activities ORDER BY seq`)
      .all() as { seq: number; prev_hash: string | null; hash: string }[];
    expect(chained[0].prev_hash).toBeNull();
    expect(chained[1].prev_hash).toBe(chained[0].hash);
    expect(chained[2].prev_hash).toBe(chained[1].hash);
    expect((await verifyActivityChain(db)).ok).toBe(true);
  });

  it('a gap in the sequence is reported, not skipped', async () => {
    const { raw, db } = fresh();
    await logActivity(db, audit('a'));
    await logActivity(db, audit('b'));
    await logActivity(db, audit('c'));

    // Simulate a claim that never inserted: the chain is unbroken but seq jumps.
    raw.prepare(`UPDATE activities SET seq = 9 WHERE seq = 3`).run();
    const chain = await verifyActivityChain(db);
    expect(chain.ok).toBe(false);
    expect(chain.checked).toBe(2);
  });

  it('a tampered link still breaks the chain', async () => {
    const { raw, db } = fresh();
    await logActivity(db, audit('a'));
    await logActivity(db, audit('b'));
    raw.prepare(`UPDATE activities SET prev_hash = 'tampered' WHERE seq = 2`).run();
    const chain = await verifyActivityChain(db);
    expect(chain.ok).toBe(false);
    expect(chain.broken_at).toBeTruthy();
  });

  it('entries written before the chain are tolerated', async () => {
    const { raw, db } = fresh();
    raw
      .prepare(
        `INSERT INTO activities (id, user_id, action, entity_type, entity_id, summary, meta,
          before_json, after_json, ip, prev_hash, hash, seq, created_at)
         VALUES ('legacy', NULL, 'created', 'client', 'c-1', 'legacy', NULL, NULL, NULL, NULL, NULL, NULL, NULL,
                 '2025-01-01T00:00:00.000Z')`,
      )
      .run();
    await logActivity(db, audit('a'));
    const chain = await verifyActivityChain(db);
    expect(chain).toEqual({ ok: true, checked: 1 });
  });
});
