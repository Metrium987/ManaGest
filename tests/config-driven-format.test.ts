import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, DEFAULT_TIMEZONE } from '@shared/domain';
import { currencyDecimals, formatMoney as formatMoneyShared, toMinor } from '@shared/money';
import { formatDateFR, todayIn } from '../server/lib/dates';
import {
  formatDate,
  formatDateTime,
  formatLocale,
  formatMoney,
  formatTimezone,
  setFormatLocale,
  setFormatTimezone,
} from '../src/lib/format';

/**
 * These tests prove the behaviour comes from the configuration, not from the
 * code: change the timezone, the currency or the locale and the computed value
 * changes with it. The defaults are the French Polynesia ones.
 */

const offsetMinutes = (timezone: string, instant: Date): number => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  }).formatToParts(instant);
  const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  if (name === 'GMT' || name === 'UTC') return 0;
  const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3] ?? 0));
};

afterEach(() => {
  setFormatLocale(DEFAULT_LOCALE);
  setFormatTimezone(DEFAULT_TIMEZONE);
});

describe('timezone configuration drives the computed date', () => {
  it('defaults to Pacific/Tahiti', () => {
    expect(DEFAULT_TIMEZONE).toBe('Pacific/Tahiti');
    expect(formatTimezone()).toBe('Pacific/Tahiti');
  });

  it('returns a different calendar day when the configured timezone changes', () => {
    // 09:55 UTC is still 28 February in Tahiti (UTC−10) and already 1 March in
    // the Marquesas (UTC−9:30): the same instant, two configured answers.
    const instant = new Date('2026-03-01T09:55:00Z');
    expect(todayIn('Pacific/Tahiti', instant)).toBe('2026-02-28');
    expect(todayIn('Pacific/Marquesas', instant)).toBe('2026-03-01');
    expect(todayIn('Europe/Paris', instant)).toBe('2026-03-01');
  });

  it('has no seasonal shift in Polynesia, unlike a DST timezone', () => {
    const winter = new Date('2026-01-15T12:00:00Z');
    const summer = new Date('2026-07-15T12:00:00Z');
    expect(offsetMinutes('Pacific/Tahiti', winter)).toBe(-600);
    expect(offsetMinutes('Pacific/Tahiti', summer)).toBe(-600);
    // The same two instants do move in Paris: this is exactly the assumption the
    // application must not carry.
    expect(offsetMinutes('Europe/Paris', winter)).not.toBe(offsetMinutes('Europe/Paris', summer));
  });

  it('renders timestamps in the configured timezone', () => {
    setFormatTimezone('Pacific/Tahiti');
    expect(formatDateTime('2026-03-01T09:55:00Z')).toContain('28/02/2026');
    expect(formatDateTime('2026-03-01T09:55:00Z')).toContain('23:55');

    setFormatTimezone('Europe/Paris');
    expect(formatDateTime('2026-03-01T09:55:00Z')).toContain('01/03/2026');
    expect(formatDateTime('2026-03-01T09:55:00Z')).toContain('10:55');
  });

  it('keeps a date-only value on its calendar day whatever the timezone', () => {
    setFormatTimezone('Pacific/Kiritimati');
    expect(formatDate('2026-03-01')).toBe('01/03/2026');
    setFormatTimezone('Pacific/Tahiti');
    expect(formatDate('2026-03-01')).toBe('01/03/2026');
  });
});

describe('currency configuration drives the amount and its decimals', () => {
  it('stores Pacific francs as whole units', () => {
    expect(currencyDecimals('XPF')).toBe(0);
    expect(toMinor(1234.4, 'XPF')).toBe(1234);
    // fr-PF renders the Pacific franc as "FCFP" and never adds centimes.
    expect(formatMoneyShared(1234, 'XPF')).toMatch(/^1\s?234\s?FCFP$/);
    expect(formatMoneyShared(1234, 'XPF')).not.toContain(',');
  });

  it('switches the number of decimals with the configured currency', () => {
    expect(currencyDecimals('EUR')).toBe(2);
    const euros = formatMoneyShared(123456, 'EUR');
    expect(euros).toContain('1');
    expect(euros).toMatch(/1\s?234,56/);
  });

  it('formats through the shared currency rules on the client too', () => {
    setFormatLocale('fr-PF');
    expect(formatMoney(1234, 'XPF')).toBe('1\u202f234 XPF');
    setFormatLocale('en-US');
    expect(formatMoney(123456, 'EUR')).toBe('1,234.56 EUR');
  });
});

describe('locale configuration drives the rendering', () => {
  it('defaults to French Polynesia', () => {
    expect(DEFAULT_LOCALE).toBe('fr-PF');
    expect(formatLocale()).toBe('fr-PF');
  });

  it('changes the rendered date when the locale changes', () => {
    setFormatLocale('fr-PF');
    expect(formatDate('2026-03-01')).toBe('01/03/2026');
    setFormatLocale('en-US');
    expect(formatDate('2026-03-01')).toBe('03/01/2026');
    setFormatLocale('de-DE');
    expect(formatDate('2026-03-01')).toBe('01.03.2026');
  });

  it('keeps the server formatter on the configured locale', () => {
    expect(formatDateFR('2026-03-01', 'Pacific/Tahiti', 'fr-PF')).toBe('01/03/2026');
    expect(formatDateFR('2026-03-01', 'Pacific/Tahiti', 'en-US')).toBe('03/01/2026');
  });

  it('falls back to the Polynesian default for an empty setting', () => {
    setFormatLocale('');
    setFormatTimezone('');
    expect(formatLocale()).toBe(DEFAULT_LOCALE);
    expect(formatTimezone()).toBe(DEFAULT_TIMEZONE);
  });
});
