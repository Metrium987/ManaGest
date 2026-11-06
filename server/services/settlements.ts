import { postDocumentEntry } from './accounting';
import { nowISO } from '../db';
import { ApiError } from '../lib/errors';
import { convertToBase } from '../lib/fx';
import { nextNumber } from '../lib/numbering';
import { freezeFx } from './currencies';
import { recalcInvoice } from './documents';

/**
 * A-01: one settlement path. An invoice is collected in its own currency at the
 * payment-date rate; the receivable is relieved at the rate frozen on the
 * invoice, and the difference is the realised gain or loss. The row, its
 * allocation and the draft-to-sent transition are written in a single `batch`,
 * so an invoice can never be marked paid without its payment.
 *
 * Stock is **not** touched here: issuing a draft (which consumes it) is the
 * caller's job, because only the route knows the warehouse reference.
 */
export interface SettleInvoiceInput {
  invoiceId: string;
  userId: string;
  method: string;
  reference?: string | null;
  /** Business day of the settlement, in the company's timezone. */
  date: string;
  numberPattern: string;
}

export interface SettleInvoiceResult {
  payment_id: string;
  number: string;
  amount: number;
  currency: string;
  exchange_rate: number;
  amount_xpf: number;
  fx_difference: number;
}

interface InvoiceRow {
  id: string;
  client_id: string;
  number: string | null;
  status: string;
  balance: number;
  total: number;
  currency: string;
  exchange_rate: number;
  currency_decimals: number;
}

export async function settleInvoice(
  database: D1Database,
  input: SettleInvoiceInput,
): Promise<SettleInvoiceResult> {
  const invoice = await database
    .prepare(
      `SELECT id, client_id, number, status, balance, total, currency, exchange_rate, currency_decimals
       FROM invoices WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(input.invoiceId)
    .first<InvoiceRow>();
  if (!invoice) throw new ApiError(404, 'NOT_FOUND');
  if (invoice.status === 'cancelled') throw new ApiError(409, 'INVOICE_CANCELLED');
  if (invoice.balance <= 0) throw new ApiError(409, 'INVOICE_ALREADY_PAID');

  const amount = Number(invoice.balance);
  const currency = String(invoice.currency ?? 'XPF').toUpperCase();
  // No guessed rate: a missing rate on the payment date is refused (422).
  const fx = await freezeFx(database, currency, input.date);
  const decimals = fx.currency.decimals;
  const amountXpf = convertToBase(amount, decimals, fx.rate);
  const receivable = convertToBase(
    amount,
    Number(invoice.currency_decimals ?? decimals),
    Number(invoice.exchange_rate ?? 1),
  );
  const fxDifference = amountXpf - receivable;

  const paymentId = crypto.randomUUID();
  const number = await nextNumber(database, 'payment', 'REG', input.numberPattern, input.date);
  const now = nowISO();
  const issued = invoice.status === 'draft';

  await database.batch([
    database
      .prepare(
        `INSERT INTO payments (id, client_id, number, date, amount, currency, exchange_rate, amount_xpf, fx_difference,
          method, reference, status, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?)`,
      )
      .bind(
        paymentId, invoice.client_id, number, input.date, amount, currency, fx.rate, amountXpf, fxDifference,
        input.method, input.reference ?? null, input.userId, now, now,
      ),
    database
      .prepare(
        `INSERT INTO payment_allocations
           (id, payment_id, invoice_id, amount, amount_xpf, exchange_rate, fx_difference, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), paymentId, invoice.id, amount, amountXpf, fx.rate, fxDifference, now),
    ...(issued
      ? [
          database
            .prepare(
              `UPDATE invoices SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ?`,
            )
            .bind(now, now, invoice.id),
        ]
      : []),
  ]);

  await recalcInvoice(database, invoice.id);
  // A-18: the cash entry lands with the payment, before anything reads.
  await postDocumentEntry(database, 'payment', paymentId);

  return {
    payment_id: paymentId,
    number,
    amount,
    currency,
    exchange_rate: fx.rate,
    amount_xpf: amountXpf,
    fx_difference: fxDifference,
  };
}
