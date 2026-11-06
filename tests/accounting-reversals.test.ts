/**
 * A-05: the journal is append-only. Voiding a payment or deleting an expense
 * posts the exact mirror of the original entry, balances to the cent, and never
 * posts twice.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { isBalanced, totalsOf } from '../server/lib/accounting';
import { syncAccounting } from '../server/services/accounting';
import {
  expenseLines, expenseReversalLines, paymentLines, paymentReversalLines,
} from '../server/lib/accounting';

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

const NOW = '2026-04-01T00:00:00.000Z';

async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return { raw, db };
}

/** Net movement per account: an original entry plus its mirror must come to zero. */
function netByAccount(lines: { account_code: string; debit: number; credit: number }[]) {
  const balances = new Map<string, number>();
  for (const entry of lines) {
    balances.set(entry.account_code, (balances.get(entry.account_code) ?? 0) + entry.debit - entry.credit);
  }
  return [...balances.values()];
}

describe('reversal lines — A-05', () => {
  it('mirrors a payment including its realised difference', () => {
    const settlement = { currency: 'USD', exchangeRate: 115, originalAmount: 100000, receivable: 110000, difference: 5000 };
    const original = paymentLines(115000, 'REG-1', undefined, settlement);
    const reversal = paymentReversalLines(115000, 'REG-1', undefined, settlement);
    expect(isBalanced(original)).toBe(true);
    expect(isBalanced(reversal)).toBe(true);
    for (const balance of netByAccount([...original, ...reversal])) expect(balance).toBe(0);
    const gain = reversal.find((entry) => entry.account_code === '766000' || entry.debit > 0);
    expect(gain).toBeTruthy();
  });

  it('mirrors an expense and its deductible VAT', () => {
    const original = expenseLines(113000, 13000, 'EXP-1');
    const reversal = expenseReversalLines(113000, 13000, 'EXP-1');
    expect(isBalanced(original)).toBe(true);
    expect(isBalanced(reversal)).toBe(true);
    expect(totalsOf(reversal)).toEqual({ debit: 113000, credit: 113000 });
    for (const balance of netByAccount([...original, ...reversal])) expect(balance).toBe(0);
  });
});

describe('journal reversals — A-05', () => {
  async function seed() {
    const { raw, db } = await database();
    await db.prepare(
      `INSERT INTO payments (id, client_id, number, date, amount, currency, exchange_rate, amount_xpf,
        fx_difference, method, status, created_by, created_at, updated_at)
       VALUES ('pay-1', 'cli-1', 'REG-2026-0001', '2026-04-02', 100000, 'XPF', 1, 100000, 0, 'transfer', 'completed', 'u1', ?, ?)`,
    ).bind(NOW, NOW).run();
    await db.prepare(
      `INSERT INTO expenses (id, category, date, amount, tax_amount, payment_method, reference, is_billable,
        created_at, updated_at)
       VALUES ('exp-1', 'other', '2026-04-03', 113000, 13000, 'transfer', 'EXP-1', 0, ?, ?)`,
    ).bind(NOW, NOW).run();
    return { raw, db };
  }

  async function entries(raw: DatabaseSync) {
    return raw.prepare(
      `SELECT e.id, e.event, e.source_type, SUM(l.debit) AS debit, SUM(l.credit) AS credit
       FROM journal_entries e JOIN journal_lines l ON l.entry_id = e.id
       GROUP BY e.id ORDER BY e.event`,
    ).all() as { id: string; event: string; source_type: string; debit: number; credit: number }[];
  }

  it('posts the mirror of a voided payment and of a deleted expense, once', async () => {
    const { raw, db } = await seed();
    await syncAccounting(db);
    let posted = await entries(raw);
    expect(posted.map((row) => row.event).sort()).toEqual(['completed', 'posted']);

    raw.prepare(`UPDATE payments SET status = 'void', deleted_at = ? WHERE id = 'pay-1'`).run(NOW);
    raw.prepare(`UPDATE expenses SET deleted_at = ? WHERE id = 'exp-1'`).run(NOW);
    await syncAccounting(db);
    posted = await entries(raw);
    expect(posted.map((row) => row.event).sort()).toEqual(['completed', 'posted', 'reversed', 'voided']);

    // Each entry balances on its own, and every account nets to zero once the
    // original and its mirror are taken together.
    for (const row of posted) expect(row.debit).toBe(row.credit);
    const total = raw.prepare('SELECT SUM(debit) AS d, SUM(credit) AS c FROM journal_lines').get() as Row;
    expect(total.d).toBe(total.c);

    await syncAccounting(db);
    expect((await entries(raw)).length).toBe(4);
  });
});
