import { describe, expect, it } from 'vitest';
import {
  PRICE_HISTORY_DEFAULTS,
  changeBp,
  priceCutoff,
  priceStats,
  shouldRecordPrice,
  type PricePoint,
} from '../server/lib/price-history';

const point = (overrides: Partial<PricePoint> = {}): PricePoint => ({
  price: 10_000,
  currency: 'XPF',
  recorded_at: '2026-09-01T00:00:00.000Z',
  source: 'manual',
  source_ref: null,
  ...overrides,
});

const now = new Date('2026-11-02T00:00:00.000Z');

describe('price variation', () => {
  it('expresses a change in basis points', () => {
    expect(changeBp(10_000, 11_000)).toBe(1000);
    expect(changeBp(10_000, 9_000)).toBe(-1000);
    expect(changeBp(12_000, 12_000)).toBe(0);
  });

  it('never invents a percentage without a usable base', () => {
    expect(changeBp(0, 500)).toBe(0);
    expect(changeBp(-10, 500)).toBe(0);
    expect(changeBp(Number.NaN, 500)).toBe(0);
  });
});

describe('what enters the ledger', () => {
  it('records a first price and a real change', () => {
    expect(shouldRecordPrice(null, 900)).toBe(true);
    expect(shouldRecordPrice(900, 950)).toBe(true);
    expect(shouldRecordPrice(900, 900, 'XPF', 'USD')).toBe(true);
  });

  it('ignores a re-save, a zero and a negative price', () => {
    expect(shouldRecordPrice(900, 900, 'XPF', 'XPF')).toBe(false);
    expect(shouldRecordPrice(900, 0)).toBe(false);
    expect(shouldRecordPrice(900, -5)).toBe(false);
  });
});

describe('retention cutoff', () => {
  it('walks back the configured number of months', () => {
    expect(priceCutoff(36, now)).toBe('2023-11-02T00:00:00.000Z');
    expect(priceCutoff(1, now)).toBe('2026-10-02T00:00:00.000Z');
  });

  it('falls back to the default when the setting is unusable', () => {
    expect(priceCutoff(0, now)).toBe(priceCutoff(PRICE_HISTORY_DEFAULTS.months, now));
    expect(priceCutoff(Number.NaN, now)).toBe(priceCutoff(PRICE_HISTORY_DEFAULTS.months, now));
  });
});

describe('price statistics', () => {
  it('compares the last price with the one before it', () => {
    const stats = priceStats([
      point({ price: 10_000, recorded_at: '2026-10-01T00:00:00.000Z' }),
      point({ price: 12_000, recorded_at: '2026-10-20T00:00:00.000Z' }),
    ], {}, now);
    expect(stats.last?.price).toBe(12_000);
    expect(stats.previous?.price).toBe(10_000);
    expect(stats.change_bp).toBe(2000);
    expect(stats.alert).toBe(true);
  });

  it('uses the configured threshold, and 0 disables the alert', () => {
    const points = [point({ price: 10_000, recorded_at: '2026-10-01T00:00:00.000Z' }), point({ price: 10_500, recorded_at: '2026-10-20T00:00:00.000Z' })];
    expect(priceStats(points, { alert_percent: 5 }, now).alert).toBe(true);
    expect(priceStats(points, { alert_percent: 10 }, now).alert).toBe(false);
    expect(priceStats(points, { alert_percent: 0 }, now).alert).toBe(false);
  });

  it('averages only the configured window', () => {
    const stats = priceStats([
      point({ price: 1_000, recorded_at: '2026-01-01T00:00:00.000Z' }),
      point({ price: 20_000, recorded_at: '2026-10-15T00:00:00.000Z' }),
      point({ price: 30_000, recorded_at: '2026-10-25T00:00:00.000Z' }),
    ], { window_days: 30 }, now);
    // The January price is outside the 30-day window, so it cannot drag the
    // reference average down and hide a real increase.
    expect(stats.average).toBe(25_000);
  });

  it('reports no change on a single price, and no percentage without a previous one', () => {
    const stats = priceStats([point({ price: 10_000 })], {}, now);
    expect(stats.previous).toBeNull();
    expect(stats.change_bp).toBe(0);
    expect(stats.alert).toBe(false);
    expect(stats.average).toBe(10_000);
  });

  it('ignores rows with no usable price', () => {
    const stats = priceStats([
      point({ price: 0 }),
      point({ price: 10_000, recorded_at: '2026-10-02T00:00:00.000Z' }),
    ], {}, now);
    expect(stats.count).toBe(1);
    expect(stats.last?.price).toBe(10_000);
  });
});
