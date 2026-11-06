/**
 * A-08: expenses and purchase orders in a foreign currency keep their rate and
 * their XPF base, and a receipt is valued in XPF before it reaches the weighted
 * average cost. Remove the conversion (or the frozen base) and these assertions
 * fail: the mixed totals no longer match and a USD receipt prices stock at the
 * raw minor amount.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { baseAmountSql } from '../server/lib/reports';
import { createExpense, type NewExpense } from '../server/services/expenses';
import { receiptUnitCost } from '../server/services/stock';

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

/** XPF is the base; USD is a 2-decimal currency at 119,33 XPF per dollar. */
async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  const now = '2026-01-01T00:00:00.000Z';
  // The schema already seeds the base currency: adjust it instead of re-inserting.
  raw.exec(`UPDATE currencies SET decimals = 0, is_base = 1, active = 1 WHERE code = 'XPF'`);
  raw.exec(`INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
            VALUES ('USD', 'Dollar', '$', 2, 0, 1, '${now}', '${now}')
            ON CONFLICT(code) DO UPDATE SET decimals = 2, is_base = 0, active = 1`);
  raw.exec(`INSERT INTO exchange_rates (id, currency, rate, effective_date, created_at)
            VALUES ('rate-usd', 'USD', 119.33, '2026-01-01', '${now}')
            ON CONFLICT(currency, effective_date) DO UPDATE SET rate = excluded.rate`);
  return { raw, db };
}

const newExpense = (over: Partial<NewExpense> = {}): NewExpense => ({
  vendor_id: null, client_id: null, category: 'other', date: '2026-01-15',
  amount: 0, tax_amount: 0, payment_method: 'transfer', reference: null, notes: null,
  is_billable: false, currency: 'XPF', createdBy: 'u1', ...over,
});

describe('expenses and purchases in a foreign currency — A-08', () => {
  it('freezes the rate and stores the XPF base of a USD expense', async () => {
    const { db } = await database();
    // 100,00 USD (10 000 minor units) at 119,33 XPF per dollar.
    const { id, fx } = await createExpense(db, newExpense({ currency: 'USD', amount: 10_000, tax_amount: 1_200 }));
    expect(fx).toEqual({ currency: 'USD', exchange_rate: 119.33, amount_xpf: 11_933, tax_amount_xpf: 1_432 });
    const row = await db.prepare(`SELECT amount, currency, exchange_rate, amount_xpf, tax_amount_xpf FROM expenses WHERE id = ?`)
      .bind(id).first<Row>();
    expect(row).toMatchObject({ amount: 10_000, currency: 'USD', exchange_rate: 119.33, amount_xpf: 11_933, tax_amount_xpf: 1_432 });
  });

  it('keeps an XPF expense at parity and does not change a closed month', async () => {
    const { raw, db } = await database();
    const { fx } = await createExpense(db, newExpense({ amount: 70_000, tax_amount: 0 }));
    expect(fx).toEqual({ currency: 'XPF', exchange_rate: 1, amount_xpf: 70_000, tax_amount_xpf: 0 });

    const usd = await createExpense(db, newExpense({ currency: 'USD', amount: 10_000 }));
    // A later rate entry must not rewrite what the expense already cost.
    raw.exec(`INSERT INTO exchange_rates (id, currency, rate, effective_date, created_at)
              VALUES ('rate-usd-2', 'USD', 200, '2026-02-01', '2026-02-01T00:00:00.000Z')
              ON CONFLICT(currency, effective_date) DO UPDATE SET rate = excluded.rate`);
    const stored = await db.prepare(`SELECT amount_xpf FROM expenses WHERE id = ?`).bind(usd.id).first<Row>();
    expect(stored?.amount_xpf).toBe(11_933);
  });

  it('aggregates expenses in XPF, never by adding two currencies', async () => {
    const { db } = await database();
    await createExpense(db, newExpense({ currency: 'USD', amount: 10_000 }));
    await createExpense(db, newExpense({ amount: 70_000 }));
    const sum = async (sql: string) => Number((await db.prepare(sql).first<Row>())?.value ?? 0);
    const base = await sum(`SELECT COALESCE(SUM(${baseAmountSql('amount', 'amount_xpf')}),0) AS value FROM expenses WHERE deleted_at IS NULL`);
    const naive = await sum(`SELECT COALESCE(SUM(amount),0) AS value FROM expenses WHERE deleted_at IS NULL`);
    expect(base).toBe(11_933 + 70_000);
    expect(base).not.toBe(naive);
  });

  it('values a received line in XPF before the average cost', () => {
    // 25,00 USD at 119,33 -> 2 983 XPF per unit; an XPF order keeps its amount.
    expect(receiptUnitCost(2_500, { rate: 119.33, decimals: 2 })).toBe(2_983);
    expect(receiptUnitCost(2_500, { rate: 1, decimals: 0 })).toBe(2_500);
    expect(receiptUnitCost(2_500)).toBe(2_500);
    expect(receiptUnitCost(2_500, { rate: 119.33, decimals: 2 })).not.toBe(2_500);
  });
});
