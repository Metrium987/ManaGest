import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '@shared/domain';
import { currencyDecimals, fromMinor } from '@shared/money';

export { currencyDecimals };

/**
 * Rendering configuration. These two values come from the company row
 * (`locale`, `timezone`), editable in Paramètres → Société; the defaults are
 * French Polynesia. Nothing here decides the format on its own.
 */
let displayLocale = DEFAULT_LOCALE;
let displayTimezone = DEFAULT_TIMEZONE;

export function setFormatLocale(locale?: string | null): void {
  const next = (locale ?? '').trim();
  displayLocale = next || DEFAULT_LOCALE;
}

export function formatLocale(): string {
  return displayLocale;
}

export function setFormatTimezone(timezone?: string | null): void {
  const next = (timezone ?? '').trim();
  displayTimezone = next || DEFAULT_TIMEZONE;
}

export function formatTimezone(): string {
  return displayTimezone;
}

function numberFormat(options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(displayLocale, options);
  } catch {
    return new Intl.NumberFormat(DEFAULT_LOCALE, options);
  }
}

function dateTimeFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat(displayLocale, options);
  } catch {
    return new Intl.DateTimeFormat(DEFAULT_LOCALE, options);
  }
}

export function formatMoney(minor: number | null | undefined, currency = 'XPF'): string {
  const value = fromMinor(Number(minor ?? 0), currency);
  const decimals = currencyDecimals(currency);
  const formatted = numberFormat({
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
  return `${formatted} ${currency}`;
}

export function formatMoneyParts(minor: number | null | undefined, currency = 'XPF'): { value: string; currency: string } {
  const value = fromMinor(Number(minor ?? 0), currency);
  const decimals = currencyDecimals(currency);
  return {
    value: numberFormat({
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(value),
    currency,
  };
}

/** Plain quantity/number rendering that follows the configured locale. */
export function formatNumber(value: number, maximumFractionDigits = 3): string {
  return numberFormat({ maximumFractionDigits }).format(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const dateOnly = value.length === 10;
  const date = dateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  // A date without time is a calendar day: render it in UTC so no timezone can
  // move it to the previous or next day.
  return dateTimeFormat({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: dateOnly ? 'UTC' : displayTimezone,
  }).format(date);
}

export function formatDateShort(value: string | null | undefined): string {
  if (!value) return '—';
  const dateOnly = value.length === 10;
  const date = dateOnly ? new Date(`${value}T12:00:00Z`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat({
    day: '2-digit',
    month: 'short',
    timeZone: dateOnly ? 'UTC' : displayTimezone,
  }).format(date);
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormat({
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: displayTimezone,
  }).format(date);
}

export function formatLongDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  return dateTimeFormat({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function relativeDays(value: string | null | undefined): number | null {
  if (!value) return null;
  const today = new Date();
  const target = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  const base = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  return Math.round((target.getTime() - base.getTime()) / 86_400_000);
}

export function todayISO(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString().slice(0, 10);
}

export function addDaysISO(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function percentageChange(current: number, previous: number): number | null {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

export function initials(first?: string | null, last?: string | null): string {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase() || '?';
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  return rest === 0 ? `${hours} h` : `${hours} h ${String(rest).padStart(2, '0')}`;
}

export function titleCase(value: string): string {
  return value
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
