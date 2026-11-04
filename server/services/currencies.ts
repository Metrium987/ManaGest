import { nowISO } from '../db';
import { ApiError } from '../lib/errors';
import { BASE_CURRENCY } from '../lib/fx';

export interface CurrencyRow {
  code: string;
  label: string;
  symbol: string;
  decimals: number;
  is_base: number;
  active: number;
  rate?: number | null;
  rate_date?: string | null;
}

export interface FxContext {
  currency: CurrencyRow;
  rate: number;
}

export async function listCurrencies(database: D1Database): Promise<CurrencyRow[]> {
  const rows = await database
    .prepare(
      `SELECT c.*,
        (SELECT r.rate FROM exchange_rates r WHERE r.currency = c.code ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) AS rate,
        (SELECT r.effective_date FROM exchange_rates r WHERE r.currency = c.code ORDER BY r.effective_date DESC, r.created_at DESC LIMIT 1) AS rate_date
       FROM currencies c ORDER BY c.is_base DESC, c.code`,
    )
    .all<CurrencyRow>();
  return rows.results ?? [];
}

export async function getCurrency(database: D1Database, code: string): Promise<CurrencyRow | null> {
  return database
    .prepare(`SELECT * FROM currencies WHERE code = ?`)
    .bind(code.trim().toUpperCase())
    .first<CurrencyRow>();
}

/**
 * The rate that applies to a document dated `date`: the latest rate entered on
 * or before that day. A missing rate is an explicit refusal, never a guess.
 */
export async function rateOn(database: D1Database, currency: string, date: string): Promise<number> {
  const code = currency.trim().toUpperCase();
  if (code === BASE_CURRENCY) return 1;
  const row = await database
    .prepare(
      `SELECT rate FROM exchange_rates
       WHERE currency = ? AND effective_date <= ?
       ORDER BY effective_date DESC, created_at DESC LIMIT 1`,
    )
    .bind(code, date)
    .first<{ rate: number }>();
  if (!row || !(Number(row.rate) > 0)) {
    throw new ApiError(422, 'EXCHANGE_RATE_MISSING', { currency: code, date });
  }
  return Number(row.rate);
}

/** Resolves an active currency and freezes its rate for a document date. */
export async function freezeFx(database: D1Database, currency: string, date: string): Promise<FxContext> {
  const code = currency.trim().toUpperCase();
  const row = await getCurrency(database, code);
  if (!row) throw new ApiError(422, 'CURRENCY_UNKNOWN', { currency: code });
  if (!row.active) throw new ApiError(422, 'CURRENCY_INACTIVE', { currency: code });
  const rate = row.is_base ? 1 : await rateOn(database, code, date);
  return { currency: row, rate };
}

export async function listRates(database: D1Database, currency: string) {
  const rows = await database
    .prepare(
      `SELECT id, currency, rate, effective_date, note, created_at
       FROM exchange_rates WHERE currency = ?
       ORDER BY effective_date DESC, created_at DESC`,
    )
    .bind(currency.trim().toUpperCase())
    .all();
  return rows.results ?? [];
}

export async function saveRate(
  database: D1Database,
  input: { currency: string; rate: number; date: string; note?: string | null; userId: string },
): Promise<void> {
  const code = input.currency.trim().toUpperCase();
  const currency = await getCurrency(database, code);
  if (!currency) throw new ApiError(422, 'CURRENCY_UNKNOWN', { currency: code });
  if (code === BASE_CURRENCY) throw new ApiError(422, 'BASE_CURRENCY_LOCKED');
  if (!(input.rate > 0)) throw new ApiError(422, 'EXCHANGE_RATE_INVALID');
  await database
    .prepare(
      `INSERT INTO exchange_rates (id, currency, rate, effective_date, note, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(currency, effective_date) DO UPDATE SET
         rate = excluded.rate, note = excluded.note, created_by = excluded.created_by, created_at = excluded.created_at`,
    )
    .bind(crypto.randomUUID(), code, input.rate, input.date, input.note ?? null, input.userId, nowISO())
    .run();
}
