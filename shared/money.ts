import { ZERO_DECIMAL_CURRENCIES } from './domain';

const EXTRA_DECIMALS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
};

/** Number of decimal places for a currency. XPF uses none. */
export function currencyDecimals(currency: string): number {
  const code = currency.toUpperCase();
  if ((ZERO_DECIMAL_CURRENCIES as readonly string[]).includes(code)) return 0;
  if (code in EXTRA_DECIMALS) return EXTRA_DECIMALS[code];
  return 2;
}

/** Convert a human amount into integer minor units. */
export function toMinor(amount: number, currency: string): number {
  return Math.round(amount * 10 ** currencyDecimals(currency));
}

/** Convert integer minor units back to a human amount. */
export function fromMinor(minor: number, currency: string): number {
  return minor / 10 ** currencyDecimals(currency);
}

/** Round half away from zero, matching accounting expectations. */
export function roundMinor(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function formatMoney(minor: number, currency = 'XPF', locale = 'fr-FR'): string {
  const value = fromMinor(minor, currency);
  const decimals = currencyDecimals(currency);
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value);
  } catch {
    return `${value.toFixed(decimals)} ${currency}`;
  }
}
