/**
 * Multi-currency proof: the owner types currencies and rates, a document freezes
 * the rate it was issued with, the ledger posts XPF at that rate, and a
 * settlement at a different rate books the realised difference in 666/766.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { DEFAULT_ACCOUNT_CODES } from '../shared/accounts';
import { computeTotals } from '../server/lib/tax';
import { convertToBase, currencyCodeError, settlementDifference } from '../server/lib/fx';
import { creditLines, invoiceLines, isBalanced, paymentLines } from '../server/lib/accounting';
import { buildVatReturn } from '../server/lib/vat-return';
import { freezeFx, rateOn, saveRate } from '../server/services/currencies';

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

async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  await db
    .prepare(
      `INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
       VALUES ('USD', 'Dollar américain', '$', 2, 0, 1, ?, ?)`,
    )
    .bind(NOW, NOW)
    .run();
  return { raw, db };
}

const codes = DEFAULT_ACCOUNT_CODES;

describe('conversion and settlement arithmetic', () => {
  it('converts minor units of a foreign currency into whole XPF', () => {
    // 123,45 USD at 110 XPF = 13 579,5 → 13 580
    expect(convertToBase(12_345, 2, 110)).toBe(13_580);
    // XPF has no decimals: the rate is 1 and the amount is already its own unit.
    expect(convertToBase(12_345, 0, 1)).toBe(12_345);
  });

  it('refuses an absent or nonsensical rate instead of guessing one', () => {
    expect(() => convertToBase(1_000, 2, 0)).toThrowError(/EXCHANGE_RATE_INVALID/);
    expect(settlementDifference(5_750, 5_500)).toBe(250);
    expect(currencyCodeError('usd')).toBe('invalid_code');
    expect(currencyCodeError('USD')).toBeNull();
  });
});

describe('manual currency registry and frozen rates', () => {
  it('keeps XPF as the unit of account without a rate', async () => {
    const { db } = await database();
    const fx = await freezeFx(db, 'XPF', '2026-03-01');
    expect(fx.currency.is_base).toBe(1);
    expect(fx.rate).toBe(1);
  });

  it('resolves the latest rate on or before the document date', async () => {
    const { db } = await database();
    await saveRate(db, { currency: 'USD', rate: 110, date: '2026-01-01', userId: 'u' });
    await saveRate(db, { currency: 'USD', rate: 115, date: '2026-03-01', userId: 'u' });
    expect(await rateOn(db, 'USD', '2026-02-28')).toBe(110);
    expect(await rateOn(db, 'USD', '2026-03-01')).toBe(115);
    await expect(rateOn(db, 'USD', '2025-12-31')).rejects.toMatchObject({ code: 'EXCHANGE_RATE_MISSING' });
  });

  it('refuses a deactivated currency with a clear code', async () => {
    const { db } = await database();
    await saveRate(db, { currency: 'USD', rate: 110, date: '2026-01-01', userId: 'u' });
    await db.prepare(`UPDATE currencies SET active = 0 WHERE code = 'USD'`).run();
    await expect(freezeFx(db, 'USD', '2026-03-01')).rejects.toMatchObject({ code: 'CURRENCY_INACTIVE' });
  });

  it('does not rewrite a document when the rate changes later', async () => {
    const { db } = await database();
    await saveRate(db, { currency: 'USD', rate: 110, date: '2026-01-01', userId: 'u' });
    await db.prepare(
      `INSERT INTO invoices (id, client_id, number, status, date, currency, exchange_rate, currency_decimals,
        subtotal, tax_total, total, subtotal_xpf, tax_total_xpf, total_xpf, balance, line_items, created_at, updated_at)
       VALUES ('inv-1', 'cli-1', 'FAC-1', 'sent', '2026-02-01', 'USD', 110, 2, 10000, 1300, 11300, 11000, 1430, 12430, 12430, '[]', ?, ?)`,
    ).bind(NOW, NOW).run();
    await saveRate(db, { currency: 'USD', rate: 200, date: '2026-03-01', userId: 'u' });
    const stored = await db.prepare(`SELECT exchange_rate, total_xpf, currency FROM invoices WHERE id = 'inv-1'`).first<Row>();
    expect(stored).toMatchObject({ exchange_rate: 110, total_xpf: 12430, currency: 'USD' });
  });
});

describe('ledger postings in both currencies', () => {
  const totals = computeTotals(
    [{ id: 'l1', description: 'Conseil', quantity: 1, unit_price: 10_000, tax_rate: 13 }],
    { discount_type: 'percent', discount_value: 0 },
    false,
  );

  const document = {
    number: 'FAC-1',
    date: '2026-02-01',
    subtotal: totals.subtotal,
    discountTotal: totals.discount_total,
    taxTotal: totals.tax_total,
    total: totals.total,
    currency: 'USD',
    exchangeRate: 110,
    xpf: {
      subtotal: convertToBase(totals.subtotal, 2, 110),
      discountTotal: 0,
      taxTotal: convertToBase(totals.tax_total, 2, 110),
      total: convertToBase(totals.total, 2, 110),
    },
  };

  it('issues a USD invoice in XPF and keeps the original amount on the line', () => {
    const lines = invoiceLines(document, null, codes);
    expect(isBalanced(lines)).toBe(true);
    const receivable = lines.find((line) => line.account_code === codes.client)!;
    expect(receivable.debit).toBe(12_430);
    expect(receivable.currency).toBe('USD');
    expect(receivable.original_amount).toBe(11_300);
    expect(lines.find((line) => line.account_code === codes.vatDue)?.credit).toBe(1_430);
  });

  it('reverses exactly the same amounts on a credit note in USD', () => {
    const lines = creditLines(document, null, codes);
    expect(isBalanced(lines)).toBe(true);
    const receivable = lines.find((line) => line.account_code === codes.client)!;
    expect(receivable.credit).toBe(12_430);
    expect(lines.find((line) => line.account_code === codes.vatDue)?.debit).toBe(1_430);
  });

  it('books a realised gain in 766 when the payment rate is higher', () => {
    const amount = 5_000; // 50,00 USD, half of the invoice
    const cash = convertToBase(amount, 2, 115); // 5 750
    const receivable = convertToBase(amount, 2, 110); // 5 500
    const lines = paymentLines(cash, 'REG-1', codes, {
      currency: 'USD', exchangeRate: 115, originalAmount: amount,
      receivable, difference: cash - receivable,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((line) => line.account_code === codes.fxGain)?.credit).toBe(250);
    expect(lines.find((line) => line.account_code === codes.client)?.credit).toBe(5_500);
  });

  it('books a realised loss in 666 when the payment rate is lower', () => {
    const amount = 5_000;
    const cash = convertToBase(amount, 2, 105); // 5 250
    const receivable = convertToBase(amount, 2, 110); // 5 500
    const lines = paymentLines(cash, 'REG-2', codes, {
      currency: 'USD', exchangeRate: 105, originalAmount: amount,
      receivable, difference: cash - receivable,
    });
    expect(isBalanced(lines)).toBe(true);
    expect(lines.find((line) => line.account_code === codes.fxLoss)?.debit).toBe(250);
  });
});

describe('VAT recap in the unit of account', () => {
  it('aggregates foreign invoices in XPF and deducts foreign credit notes', () => {
    const recap = buildVatReturn({
      invoices: [[{ rate: 13, base: convertToBase(10_000, 2, 110), amount: convertToBase(1_300, 2, 110) }]],
      credits: [[{ rate: 13, base: convertToBase(2_000, 2, 110), amount: convertToBase(260, 2, 110) }]],
    });
    expect(recap.total_base).toBe(8_800);
    expect(recap.total_tax).toBe(1_144);
  });
});
