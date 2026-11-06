/**
 * A-04: the VAT return nets issued credit notes. A credit mirror is written from
 * the same totals as the document, a draft reverses nothing, and a deleted credit
 * is ignored — the declared VAT is what the business actually kept.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { tvaRecapData } from '../server/routes/dashboard';
import { syncCreditFromRow, syncInvoiceFromRow } from '../server/services/documents';

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

const NOW = '2026-03-01T00:00:00.000Z';
const LINE = (unit: number, rate = 13) => [{
  id: `l-${rate}`, description: 'Prestation', quantity: 1, unit_price: unit, tax_rate: rate,
}];

async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return { raw, db };
}

async function invoice(db: D1Database, id: string, unit: number, status = 'sent') {
  const tax = Math.round(unit * 0.13);
  await db.prepare(
    `INSERT INTO invoices (id, client_id, number, status, date, currency, subtotal, discount_type,
      discount_value, discount_total, tax_total, total, tax_exempt, line_items, created_at, updated_at)
     VALUES (?, 'cli-1', ?, ?, '2026-03-05', 'XPF', ?, 'percent', 0, 0, ?, ?, 0, ?, ?, ?)`,
  ).bind(id, `FAC-${id}`, status, unit, tax, unit + tax, JSON.stringify(LINE(unit)), NOW, NOW).run();
  await syncInvoiceFromRow(db, { id, line_items: LINE(unit), discount_type: 'percent', discount_value: 0, tax_exempt: 0 });
}

async function credit(db: D1Database, id: string, unit: number, options: { status?: string; deleted?: boolean } = {}) {
  const tax = Math.round(unit * 0.13);
  await db.prepare(
    `INSERT INTO credits (id, client_id, number, status, date, currency, subtotal, discount_type,
      discount_value, discount_total, tax_total, total, applied_total, balance, tax_exempt, line_items,
      created_at, updated_at, deleted_at)
     VALUES (?, 'cli-1', ?, ?, '2026-03-06', 'XPF', ?, 'percent', 0, 0, ?, ?, 0, ?, 0, ?, ?, ?, ?)`,
  ).bind(
    id, `AV-${id}`, options.status ?? 'sent', unit, tax, unit + tax, unit + tax,
    JSON.stringify(LINE(unit)), NOW, NOW, options.deleted ? NOW : null,
  ).run();
  await syncCreditFromRow(db, { id, line_items: LINE(unit), discount_type: 'percent', discount_value: 0, tax_exempt: 0 });
}

describe('VAT mirror of credit notes — A-04', () => {
  it('nets an issued credit against the invoice it reverses', async () => {
    const { db } = await database();
    await invoice(db, 'inv-1', 100000);
    await credit(db, 'cr-1', 50000);
    const { periods, totals } = await tvaRecapData(db, '2026-03-01', '2026-03-31');
    expect(totals).toMatchObject({ base: 50000, tax: 6500 });
    expect(periods[0]).toMatchObject({ period: '2026-03', base: 50000, tax: 6500 });
    expect(periods[0].rates).toEqual([{ rate: 13, base: 50000, tax: 6500 }]);
  });

  it('ignores a draft credit and a deleted one', async () => {
    const { db } = await database();
    await invoice(db, 'inv-1', 100000);
    await credit(db, 'cr-draft', 40000, { status: 'draft' });
    await credit(db, 'cr-gone', 30000, { deleted: true });
    const { totals } = await tvaRecapData(db, '2026-03-01', '2026-03-31');
    expect(totals).toMatchObject({ base: 100000, tax: 13000 });
  });

  it('reverses both rates of a multi-rate credit', async () => {
    const { db } = await database();
    await db.prepare(
      `INSERT INTO invoices (id, client_id, number, status, date, currency, subtotal, discount_type,
        discount_value, discount_total, tax_total, total, tax_exempt, line_items, created_at, updated_at)
       VALUES ('inv-2', 'cli-1', 'FAC-2', 'sent', '2026-03-07', 'XPF', 25000, 'percent', 0, 0, 3450, 28450, 0, '[]', ?, ?)`,
    ).bind(NOW, NOW).run();
    await syncInvoiceFromRow(db, {
      id: 'inv-2',
      line_items: [{ id: 'a', description: 'A', quantity: 1, unit_price: 20000, tax_rate: 16 },
        { id: 'b', description: 'B', quantity: 1, unit_price: 5000, tax_rate: 5 }],
      discount_type: 'percent', discount_value: 0, tax_exempt: 0,
    });
    await db.prepare(
      `INSERT INTO credits (id, client_id, number, status, date, currency, subtotal, discount_type,
        discount_value, discount_total, tax_total, total, applied_total, balance, tax_exempt, line_items,
        created_at, updated_at)
       VALUES ('cr-2', 'cli-1', 'AV-2', 'applied', '2026-03-07', 'XPF', 5000, 'percent', 0, 0, 250, 5250, 0, 5250, 0, '[]', ?, ?)`,
    ).bind(NOW, NOW).run();
    await syncCreditFromRow(db, {
      id: 'cr-2',
      line_items: [{ id: 'b', description: 'B', quantity: 1, unit_price: 5000, tax_rate: 5 }],
      discount_type: 'percent', discount_value: 0, tax_exempt: 0,
    });
    const { periods, totals } = await tvaRecapData(db, '2026-03-01', '2026-03-31');
    expect(totals).toMatchObject({ base: 20000, tax: 3200 });
    expect(periods[0].rates).toEqual([
      { rate: 16, base: 20000, tax: 3200 },
      { rate: 5, base: 0, tax: 0 },
    ]);
  });

  it('repairs a credit issued before the mirror existed', async () => {
    const { db } = await database();
    await invoice(db, 'inv-1', 100000);
    await credit(db, 'cr-1', 50000);
    await db.prepare('DELETE FROM credit_tax_lines').run();
    const { totals } = await tvaRecapData(db, '2026-03-01', '2026-03-31');
    expect(totals).toMatchObject({ base: 50000, tax: 6500 });
  });
});
