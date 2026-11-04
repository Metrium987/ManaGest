import { ApiError } from './errors';

/** The currency the books are kept in. It never depends on a rate. */
export const BASE_CURRENCY = 'XPF';

export interface CurrencyShape {
  code: string;
  decimals: number;
}

export interface FrozenRate {
  currency: string;
  decimals: number;
  rate: number;
}

/**
 * Converts a document amount (minor units of its own currency) into base
 * currency. `rate` is XPF for one major unit, typed by the owner: no banking
 * feed exists locally, so a guessed rate would be worse than a refusal.
 */
export function convertToBase(amountMinor: number, decimals: number, rate: number): number {
  if (!Number.isFinite(amountMinor)) return 0;
  if (!Number.isFinite(rate) || rate <= 0) throw new ApiError(422, 'EXCHANGE_RATE_INVALID');
  return Math.round((amountMinor / 10 ** decimals) * rate);
}

/**
 * Gain (positive) or loss (negative) on one settlement: what the bank received
 * in XPF at the payment date minus what the invoice carried at its frozen rate.
 */
export function settlementDifference(cashBase: number, receivableBase: number): number {
  return Math.round(cashBase) - Math.round(receivableBase);
}

export interface AllocationFx {
  cash: number;
  receivable: number;
  difference: number;
}

export function allocationFx(
  amountMinor: number,
  decimals: number,
  paymentRate: number,
  invoiceRate: number,
): AllocationFx {
  const cash = convertToBase(amountMinor, decimals, paymentRate);
  const receivable = convertToBase(amountMinor, decimals, invoiceRate);
  return { cash, receivable, difference: settlementDifference(cash, receivable) };
}

/** ISO-like code: three to five capital letters, e.g. XPF, EUR, USD. */
export function currencyCodeError(code: string): string | null {
  return /^[A-Z]{3,5}$/.test(code) ? null : 'invalid_code';
}
