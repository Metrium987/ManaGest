/**
 * A-09: `currencies.decimals` is the single source of truth. An explicit value in
 * 0..4 wins over the built-in map; the map is only the offline fallback.
 */
import { describe, expect, it } from 'vitest';
import { currencyDecimals, formatMoney as formatShared, fromMinor, toMinor } from '../shared/money';

describe('currency decimals — A-09', () => {
  it('keeps the fallback map for currencies the workspace has not described', () => {
    expect(currencyDecimals('XPF')).toBe(0);
    expect(currencyDecimals('EUR')).toBe(2);
    expect(currencyDecimals('ZZZ')).toBe(2);
  });

  it('honours a configured three-decimal currency', () => {
    expect(currencyDecimals('KWD', 3)).toBe(3);
    expect(toMinor(1.234, 'KWD', 3)).toBe(1234);
    expect(fromMinor(1234, 'KWD', 3)).toBeCloseTo(1.234, 6);
    expect(formatShared(1234, 'KWD', 'fr-FR', 3).replace(/\u00a0|\u202f/g, ' ')).toContain('1,234');
  });

  it('ignores an impossible configuration and falls back to the map', () => {
    expect(currencyDecimals('XPF', 2)).toBe(2);
    expect(currencyDecimals('EUR', -1)).toBe(2);
    expect(currencyDecimals('EUR', 9)).toBe(2);
    expect(currencyDecimals('EUR', 1.5)).toBe(2);
  });

  it('stores and renders XPF without decimals', () => {
    expect(toMinor(1234, 'XPF')).toBe(1234);
    expect(formatShared(1234, 'XPF').replace(/\u00a0|\u202f/g, ' ')).toContain('1 234');
  });
});
