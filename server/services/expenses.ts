import { nowISO } from '../db';
import { convertToBase } from '../lib/fx';
import { freezeFx } from './currencies';

/**
 * Expenses in a foreign currency (A-08).
 *
 * An expense is typed in the currency of its receipt, but the books add XPF and
 * nothing else. The rate is the one in force on the expense date, frozen on the
 * row: re-entering a later rate must never change what a closed month cost. The
 * rule is the document convention (`exchange_rate REAL`, like invoices), not the
 * `exchange_rate_micro` of the import sheets, which exists for landed-cost
 * precision only (see `server/lib/valuation.ts`).
 */
export interface ExpenseFx {
  currency: string;
  exchange_rate: number;
  amount_xpf: number;
  tax_amount_xpf: number;
}

/** Resolves the currency, freezes its rate and computes the XPF base. */
export async function expenseFx(
  database: D1Database,
  input: { currency: string; date: string; amount: number; tax_amount: number },
): Promise<ExpenseFx> {
  const fx = await freezeFx(database, input.currency, input.date);
  return {
    currency: fx.currency.code,
    exchange_rate: fx.rate,
    amount_xpf: convertToBase(input.amount, fx.currency.decimals, fx.rate),
    tax_amount_xpf: convertToBase(input.tax_amount, fx.currency.decimals, fx.rate),
  };
}

export interface NewExpense {
  vendor_id: string | null;
  client_id: string | null;
  category: string;
  date: string;
  amount: number;
  tax_amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  is_billable: boolean;
  currency: string;
  createdBy: string;
}

export async function createExpense(
  database: D1Database,
  input: NewExpense,
): Promise<{ id: string; fx: ExpenseFx }> {
  const fx = await expenseFx(database, input);
  const id = crypto.randomUUID();
  await database
    .prepare(
      `INSERT INTO expenses (id, vendor_id, client_id, category, date, amount, tax_amount, payment_method, reference, notes,
        is_billable, created_by, created_at, updated_at, currency, exchange_rate, amount_xpf, tax_amount_xpf)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, input.vendor_id, input.client_id, input.category, input.date, input.amount, input.tax_amount,
      input.payment_method, input.reference, input.notes, input.is_billable ? 1 : 0, input.createdBy,
      nowISO(), nowISO(), fx.currency, fx.exchange_rate, fx.amount_xpf, fx.tax_amount_xpf,
    )
    .run();
  return { id, fx };
}
