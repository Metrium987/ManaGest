/**
 * A-06: an approval covers a precise amount and discount. Raising either reopens
 * the request as a new revision; a refusal can be corrected and resubmitted; the
 * history keeps every revision, and nobody approves their own request.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import {
  approvalHistory, decideApproval, requireApprovalIfNeeded,
} from '../server/services/approvals';

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

async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  raw.exec(`INSERT INTO settings_extra (key, value, updated_at) VALUES ('approval_credit_amount', '100000', '2026-01-01T00:00:00.000Z')`);
  raw.exec(`INSERT INTO settings_extra (key, value, updated_at) VALUES ('approval_expense_amount', '0', '2026-01-01T00:00:00.000Z')`);
  raw.exec(`INSERT INTO settings_extra (key, value, updated_at) VALUES ('approval_discount_percent', '15', '2026-01-01T00:00:00.000Z')`);
  return { raw, db };
}

const request = (db: D1Database, amount: number, discountPercent?: number) => requireApprovalIfNeeded(db, {
  entityType: 'credit', entityId: 'cr-1', amount, discountPercent, requestedBy: 'u1',
});

const pending = (db: D1Database) => db
  .prepare(`SELECT * FROM approvals WHERE entity_id = 'cr-1' AND status = 'pending' ORDER BY revision DESC LIMIT 1`)
  .first<Row>() as Promise<Row>;

describe('approval revisions — A-06', () => {
  it('reopens the request when the amount changes after approval', async () => {
    const { db } = await database();
    await expect(request(db, 150_000)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const first = await pending(db);
    expect(first).toMatchObject({ revision: 1, controlled_amount: 150_000, status: 'pending' });

    await decideApproval(db, { id: String(first.id), decision: 'approved', userId: 'u2', note: null });
    // The controlled amount is what was approved, not what the document says now.
    await expect(request(db, 150_000)).resolves.toBeUndefined();

    await expect(request(db, 200_000)).rejects.toMatchObject({
      code: 'APPROVAL_REQUIRED', details: { rule: 'credit_amount', previous: '1', revision: '2' },
    });
    expect(await pending(db)).toMatchObject({ revision: 2, controlled_amount: 200_000 });
    const history = await approvalHistory(db, 'credit', 'cr-1');
    expect(history.map((row) => row.revision)).toEqual([2, 1]);
    expect(history[1]).toMatchObject({ status: 'approved', controlled_amount: 150_000 });
  });

  it('turns a raised discount on an approved invoice into a new request', async () => {
    const { db } = await database();
    const invoice = (percent: number) => requireApprovalIfNeeded(db, {
      entityType: 'invoice', entityId: 'inv-1', amount: 500_000, discountPercent: percent, requestedBy: 'u1',
    });
    await expect(invoice(15)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const row = await db.prepare(`SELECT * FROM approvals WHERE entity_id = 'inv-1'`).first<Row>();
    expect(row).toMatchObject({ controlled_discount: 15 });
    await decideApproval(db, { id: String(row!.id), decision: 'approved', userId: 'u2', note: null });
    await expect(invoice(15)).resolves.toBeUndefined();
    await expect(invoice(35)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const next = await db.prepare(`SELECT MAX(revision) AS r FROM approvals WHERE entity_id = 'inv-1'`).first<Row>();
    expect(next?.r).toBe(2);
  });

  it('allows a new request after a refusal, keeping the old one', async () => {
    const { db } = await database();
    await expect(request(db, 400_000)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const first = await pending(db);
    await decideApproval(db, { id: String(first.id), decision: 'rejected', userId: 'u2', note: 'too high' });

    await expect(request(db, 400_000)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const rows = await approvalHistory(db, 'credit', 'cr-1');
    expect(rows.map((row) => [row.revision, row.status])).toEqual([[2, 'pending'], [1, 'rejected']]);
  });

  it('refuses self-approval and a decided revision', async () => {
    const { db } = await database();
    await expect(request(db, 150_000)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const first = await pending(db);
    await expect(decideApproval(db, { id: String(first.id), decision: 'approved', userId: 'u1', note: null }))
      .rejects.toMatchObject({ code: 'SAME_APPROVER' });

    await decideApproval(db, { id: String(first.id), decision: 'approved', userId: 'u2', note: null });
    await expect(decideApproval(db, { id: String(first.id), decision: 'approved', userId: 'u2', note: null }))
      .rejects.toMatchObject({ code: 'ALREADY_DECIDED' });
  });
});
