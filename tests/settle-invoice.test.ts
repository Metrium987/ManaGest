/**
 * A-01: collecting an invoice goes through one settlement service. The payment
 * carries its currency, the frozen rate, the XPF amount and the realised
 * difference; the invoice becomes paid from its allocations, never by hand.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { saveRate } from '../server/services/currencies';
import { settleInvoice } from '../server/services/settlements';

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

const NOW = '2026-01-01T00:00:00.000Z';
const PATTERN = 'REG-{YYYY}-{####}';

async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return { raw, db };
}

async function currency(db: D1Database, code: string, decimals: number) {
  await db.prepare(
    `INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, 1, ?, ?)`,
  ).bind(code, code, code, decimals, NOW, NOW).run();
}

async function invoice(db: D1Database, over: Record<string, unknown> = {}) {
  const row = {
    id: 'inv-1', client_id: 'cli-1', number: 'FAC-2026-0001', status: 'sent', date: '2026-01-10',
    currency: 'XPF', exchange_rate: 1, currency_decimals: 0, subtotal: 100000, tax_total: 0,
    total: 100000, total_xpf: 100000, balance: 100000, paid_total: 0, ...over,
  };
  await db.prepare(
    `INSERT INTO invoices (id, client_id, number, status, date, currency, exchange_rate, currency_decimals,
      subtotal, tax_total, total, subtotal_xpf, tax_total_xpf, total_xpf, balance, paid_total,
      tax_exempt, line_items, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, '[]', ?, ?)`,
  ).bind(
    row.id, row.client_id, row.number, row.status, row.date, row.currency, row.exchange_rate,
    row.currency_decimals, row.subtotal, row.tax_total, row.total, row.total_xpf, row.total_xpf,
    row.balance, row.paid_total, NOW, NOW,
  ).run();
  return row;
}

const settle = (db: D1Database) => settleInvoice(db, {
  invoiceId: 'inv-1', userId: 'u1', method: 'transfer', date: '2026-02-01', numberPattern: PATTERN,
});

describe('settleInvoice — A-01', () => {
  it('collects an XPF invoice without inventing a rate', async () => {
    const { raw, db } = await database();
    await invoice(db);
    const result = await settle(db);
    expect(result).toMatchObject({ currency: 'XPF', amount_xpf: 100000, fx_difference: 0 });
    const payment = raw.prepare('SELECT currency, exchange_rate, amount_xpf, fx_difference, status FROM payments').get() as Row;
    expect(payment).toMatchObject({ currency: 'XPF', exchange_rate: 1, amount_xpf: 100000, fx_difference: 0, status: 'completed' });
    const stored = raw.prepare('SELECT status, paid_total, balance FROM invoices WHERE id = ?').get('inv-1') as Row;
    expect(stored).toMatchObject({ status: 'paid', paid_total: 100000, balance: 0 });
  });

  it('books the realised difference when a USD invoice is paid at another rate', async () => {
    const { raw, db } = await database();
    await currency(db, 'USD', 2);
    await saveRate(db, { currency: 'USD', rate: 110, date: '2026-01-01', userId: 'u1' });
    await saveRate(db, { currency: 'USD', rate: 115, date: '2026-02-01', userId: 'u1' });
    await invoice(db, {
      currency: 'USD', exchange_rate: 110, currency_decimals: 2, subtotal: 100000,
      total: 100000, total_xpf: 110000, balance: 100000,
    });
    const result = await settle(db);
    // 1 000,00 USD at 115 → 115 000 XPF banked against 110 000 carried: +5 000 gain.
    expect(result).toMatchObject({ currency: 'USD', amount_xpf: 115000, fx_difference: 5000 });
    const allocation = raw.prepare('SELECT amount, amount_xpf, exchange_rate, fx_difference FROM payment_allocations').get() as Row;
    expect(allocation).toMatchObject({ amount: 100000, amount_xpf: 115000, exchange_rate: 115, fx_difference: 5000 });
  });

  it('produces no difference on an EUR invoice at the fixed parity', async () => {
    const { db } = await database();
    await currency(db, 'EUR', 2);
    await saveRate(db, { currency: 'EUR', rate: 119.3317, date: '2026-01-01', userId: 'u1' });
    await invoice(db, {
      currency: 'EUR', exchange_rate: 119.3317, currency_decimals: 2, subtotal: 100000,
      total: 100000, total_xpf: 119332, balance: 100000,
    });
    const result = await settle(db);
    expect(result.amount_xpf).toBe(119332);
    expect(result.fx_difference).toBe(0);
  });

  it('refuses a cancelled or already settled invoice, and a missing rate', async () => {
    const { db } = await database();
    await invoice(db, { status: 'cancelled' });
    await expect(settle(db)).rejects.toMatchObject({ code: 'INVOICE_CANCELLED' });

    const paid = await database();
    await invoice(paid.db, { balance: 0 });
    await expect(settle(paid.db)).rejects.toMatchObject({ code: 'INVOICE_ALREADY_PAID' });

    const missing = await database();
    await currency(missing.db, 'USD', 2);
    await invoice(missing.db, {
      currency: 'USD', exchange_rate: 110, currency_decimals: 2, total: 100000,
      total_xpf: 110000, balance: 100000,
    });
    await expect(settle(missing.db)).rejects.toMatchObject({ code: 'EXCHANGE_RATE_MISSING' });
  });

  it('issues a draft before settling it, and ends paid', async () => {
    const { raw, db } = await database();
    await invoice(db, { status: 'draft' });
    await settle(db);
    const stored = raw.prepare('SELECT status, sent_at FROM invoices WHERE id = ?').get('inv-1') as Row;
    expect(stored.status).toBe('paid');
    expect(stored.sent_at).toBeTruthy();
    const count = raw.prepare('SELECT COUNT(*) AS n FROM payment_allocations').get() as Row;
    expect(count.n).toBe(1);
  });
});
