import { DEFAULT_LOCALE, ZERO_DECIMAL_CURRENCIES } from './domain';

const EXTRA_DECIMALS: Record<string, number> = {
  BIF: 0, CLP: 0, DJF: 0, GNF: 0, ISK: 0, KMF: 0, KRW: 0, PYG: 0,
  RWF: 0, UGX: 0, UYI: 0, VND: 0, VUV: 0, XAF: 0, XOF: 0, XPF: 0,
};

/**
 * A-09: `currencies.decimals` is the single source of truth. This map is only the
 * offline fallback — for a currency the workspace has not described (a PDF built
 * from a raw row, an import before the settings are loaded). An explicit value in
 * 0..4 always wins, so a three-decimal currency is neither rounded to two nor
 * printed with the wrong precision.
 */
export function currencyDecimals(currency: string, decimals?: number | null): number {
  if (decimals !== undefined && decimals !== null) {
    const explicit = Number(decimals);
    if (Number.isInteger(explicit) && explicit >= 0 && explicit <= 4) return explicit;
  }
  const code = currency.toUpperCase();
  if ((ZERO_DECIMAL_CURRENCIES as readonly string[]).includes(code)) return 0;
  if (code in EXTRA_DECIMALS) return EXTRA_DECIMALS[code];
  return 2;
}

/** Convert a human amount into integer minor units. */
export function toMinor(amount: number, currency: string, decimals?: number | null): number {
  return Math.round(amount * 10 ** currencyDecimals(currency, decimals));
}

/** Convert integer minor units back to a human amount. */
export function fromMinor(minor: number, currency: string, decimals?: number | null): number {
  return minor / 10 ** currencyDecimals(currency, decimals);
}

/** Round half away from zero, matching accounting expectations. */
export function roundMinor(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function formatMoney(
  minor: number,
  currency = 'XPF',
  locale = DEFAULT_LOCALE,
  configuredDecimals?: number | null,
): string {
  const decimals = currencyDecimals(currency, configuredDecimals);
  const value = fromMinor(minor, currency, decimals);
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
