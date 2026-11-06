import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import {
  allLines,
  journalEntries,
  postDocumentEntry,
  syncAccounting,
} from '../server/services/accounting';

type Db = Parameters<typeof syncAccounting>[0];

/** Minimal D1 surface over node:sqlite, enough for the accounting service. */
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

function entriesOf(raw: DatabaseSync, sourceId: string) {
  return raw
    .prepare('SELECT event FROM journal_entries WHERE source_id = ? ORDER BY event')
    .all(sourceId) as { event: string }[];
}

function linesOf(raw: DatabaseSync, sourceId: string) {
  return raw
    .prepare(
      `SELECT l.account_code, l.debit, l.credit FROM journal_lines l
       JOIN journal_entries e ON e.id = l.entry_id
       WHERE e.source_id = ? ORDER BY l.account_code`,
    )
    .all(sourceId) as { account_code: string; debit: number; credit: number }[];
}

function insertInvoice(raw: DatabaseSync, id: string, status = 'sent') {
  raw
    .prepare(
      `INSERT INTO invoices (id, client_id, number, status, date, subtotal, tax_total, total,
         subtotal_xpf, tax_total_xpf, total_xpf, line_items, created_at, updated_at)
       VALUES (?, 'cli-1', ?, ?, '2026-10-01', 25000, 3450, 28450, 25000, 3450, 28450, '[]', '2026-10-01', '2026-10-01')`,
    )
    .run(id, `FAC-${id}`, status);
}

function insertCredit(raw: DatabaseSync, id: string) {
  raw
    .prepare(
      `INSERT INTO credits (id, client_id, number, status, date, subtotal, tax_total, total,
         subtotal_xpf, tax_total_xpf, total_xpf, line_items, created_at, updated_at)
       VALUES (?, 'cli-1', ?, 'sent', '2026-10-02', 10000, 1380, 11380, 10000, 1380, 11380, '[]', '2026-10-02', '2026-10-02')`,
    )
    .run(id, `AV-${id}`);
}

function insertPayment(raw: DatabaseSync, id: string, status = 'completed', deletedAt: string | null = null) {
  raw
    .prepare(
      `INSERT INTO payments (id, client_id, number, date, amount, amount_xpf, status, created_at, updated_at, deleted_at)
       VALUES (?, 'cli-1', ?, '2026-10-03', 28450, 28450, ?, '2026-10-03', '2026-10-03', ?)`,
    )
    .run(id, `REG-${id}`, status, deletedAt);
}

function insertExpense(raw: DatabaseSync, id: string, deletedAt: string | null = null) {
  raw
    .prepare(
      `INSERT INTO expenses (id, category, date, amount, tax_amount, reference, created_at, updated_at, deleted_at)
       VALUES (?, 'supplies', '2026-10-04', 20000, 2760, ?, '2026-10-04', '2026-10-04', ?)`,
    )
    .run(id, `DEP-${id}`, deletedAt);
}

describe('A-18 accounting is posted when the document is written', () => {
  let raw: DatabaseSync;
  let db: Db;

  beforeEach(() => {
    raw = new DatabaseSync(':memory:');
    for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
    db = asD1(raw);
  });

  it('an issued invoice posts its entry immediately', async () => {
    insertInvoice(raw, 'inv-1');
    expect(await postDocumentEntry(db, 'invoice', 'inv-1')).toBe(true);
    expect(entriesOf(raw, 'inv-1')).toEqual([{ event: 'issued' }]);
    const receivable = linesOf(raw, 'inv-1').find((line) => line.account_code === '411000');
    expect(receivable?.debit).toBe(28_450);
  });

  it('an issued credit posts its entry immediately', async () => {
    insertCredit(raw, 'cre-1');
    expect(await postDocumentEntry(db, 'credit', 'cre-1')).toBe(true);
    expect(entriesOf(raw, 'cre-1')).toEqual([{ event: 'issued' }]);
  });

  it('a completed payment posts its cash entry immediately', async () => {
    insertPayment(raw, 'pay-1');
    expect(await postDocumentEntry(db, 'payment', 'pay-1')).toBe(true);
    expect(entriesOf(raw, 'pay-1')).toEqual([{ event: 'completed' }]);
  });

  it('a created expense posts its charge immediately', async () => {
    insertExpense(raw, 'exp-1');
    expect(await postDocumentEntry(db, 'expense', 'exp-1')).toBe(true);
    const entry = entriesOf(raw, 'exp-1');
    expect(entry).toEqual([{ event: 'posted' }]);
    const expenseLines = linesOf(raw, 'exp-1');
    const debit = expenseLines.reduce((total, line) => total + line.debit, 0);
    const credit = expenseLines.reduce((total, line) => total + line.credit, 0);
    expect(debit).toBeGreaterThan(0);
    expect(debit).toBe(credit);
  });

  it('a cancelled invoice posts the mirror of its entry (limit case)', async () => {
    insertInvoice(raw, 'inv-cancel', 'cancelled');
    expect(await postDocumentEntry(db, 'invoice', 'inv-cancel')).toBe(true);
    expect(entriesOf(raw, 'inv-cancel')).toEqual([{ event: 'cancelled' }]);
    const receivable = linesOf(raw, 'inv-cancel').find((line) => line.account_code === '411000');
    expect(receivable?.credit).toBe(28_450);
  });

  it('a voided payment and a removed expense post their reversals (limit case)', async () => {
    insertPayment(raw, 'pay-void', 'void');
    insertExpense(raw, 'exp-gone', '2026-10-05');
    expect(await postDocumentEntry(db, 'payment', 'pay-void')).toBe(true);
    expect(await postDocumentEntry(db, 'expense', 'exp-gone')).toBe(true);
    expect(entriesOf(raw, 'pay-void')).toEqual([{ event: 'voided' }]);
    expect(entriesOf(raw, 'exp-gone')).toEqual([{ event: 'reversed' }]);
  });

  it('replaying the write transition never duplicates the entry', async () => {
    insertInvoice(raw, 'inv-twice');
    expect(await postDocumentEntry(db, 'invoice', 'inv-twice')).toBe(true);
    expect(await postDocumentEntry(db, 'invoice', 'inv-twice')).toBe(false);
    expect(entriesOf(raw, 'inv-twice')).toEqual([{ event: 'issued' }]);
  });

  it('a draft invoice posts nothing until it is issued', async () => {
    insertInvoice(raw, 'inv-draft', 'draft');
    expect(await postDocumentEntry(db, 'invoice', 'inv-draft')).toBe(false);
    expect(entriesOf(raw, 'inv-draft')).toEqual([]);
  });

  it('the sweep behind an immediate posting creates no duplicate and no balance drift', async () => {
    insertInvoice(raw, 'inv-sync');
    insertExpense(raw, 'exp-sync');
    expect(await postDocumentEntry(db, 'invoice', 'inv-sync')).toBe(true);
    expect(await postDocumentEntry(db, 'expense', 'exp-sync')).toBe(true);
    const before = await journalEntries(db);
    const beforeLines = await allLines(db);

    expect(await syncAccounting(db)).toBe(0);

    const after = await journalEntries(db);
    const afterLines = await allLines(db);
    expect(after.entries).toHaveLength(before.entries.length);
    expect(after.lines).toHaveLength(before.lines.length);
    expect(afterLines).toHaveLength(beforeLines.length);
    expect(afterLines.reduce((total, line) => total + line.debit, 0))
      .toBe(beforeLines.reduce((total, line) => total + line.debit, 0));
    expect(afterLines.reduce((total, line) => total + line.credit, 0))
      .toBe(beforeLines.reduce((total, line) => total + line.credit, 0));
    expect(entriesOf(raw, 'inv-sync')).toEqual([{ event: 'issued' }]);
    expect(entriesOf(raw, 'exp-sync')).toEqual([{ event: 'posted' }]);
  });
});
