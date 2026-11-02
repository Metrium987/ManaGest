/** Date-only helpers. Instants are stored as ISO 8601 UTC strings. */

import { DEFAULT_LOCALE } from '../../shared/domain';

export function todayIn(timezone: string, reference = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(reference);
}

/**
 * A local instant ('YYYY-MM-DDTHH:MM') in a timezone. Business-hour clocks are
 * local by definition: reading them in UTC would open an SLA at 18:00 in Tahiti
 * for an 08:00 request, long after the office closed.
 */
export function localDateTimeIn(timezone: string, reference = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(reference);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  // Some ICU builds render midnight as 24 in the 24-hour cycle.
  const hour = value('hour') === '24' ? '00' : value('hour');
  return `${value('year')}-${value('month')}-${value('day')}T${hour}:${value('minute')}`;
}

export function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function addMonths(isoDate: string, months: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  const start = new Date(`${from}T00:00:00Z`).getTime();
  const end = new Date(`${to}T00:00:00Z`).getTime();
  return Math.round((end - start) / 86_400_000);
}

export function isBefore(a: string, b: string): boolean {
  return a < b;
}

export function formatDateFR(
  isoDate: string | null | undefined,
  timezone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!isoDate) return '—';
  const date = isoDate.length === 10 ? new Date(`${isoDate}T12:00:00Z`) : new Date(isoDate);
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(date);
}

export function formatDateTimeFR(
  value: string | null | undefined,
  timezone?: string,
  locale: string = DEFAULT_LOCALE,
): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    ...(timezone ? { timeZone: timezone } : {}),
  }).format(new Date(value));
}

export function monthStart(isoDate: string): string {
  return `${isoDate.slice(0, 7)}-01`;
}

export function monthKeyLabel(isoDate: string, locale: string = DEFAULT_LOCALE): string {
  const date = new Date(`${isoDate.slice(0, 7)}-01T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, { month: 'short', year: '2-digit' }).format(date);
}
