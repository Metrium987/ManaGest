import { describe, expect, it } from 'vitest';
import {
  isExpired,
  lotTrackingMode,
  normaliseExpiryDate,
  normaliseLotCode,
  pickFefo,
  tracksLots,
  type StockLot,
} from '../server/lib/lots';

const lot = (id: string, lot_code: string, expiry_date: string | null, quantity_milli: number, created_at = '2026-01-01T00:00:00.000Z'): StockLot => ({
  id, lot_code, expiry_date, quantity_milli, created_at,
});

describe('lot tracking mode', () => {
  it('treats anything unknown as no tracking', () => {
    expect(lotTrackingMode('lot')).toBe('lot');
    expect(lotTrackingMode('serial')).toBe('serial');
    expect(lotTrackingMode('LOT')).toBe('none');
    expect(lotTrackingMode(null)).toBe('none');
    expect(tracksLots('serial')).toBe(true);
    expect(tracksLots(undefined)).toBe(false);
  });
});

describe('lot codes and expiry dates', () => {
  it('trims a code and refuses an empty one', () => {
    expect(normaliseLotCode('  LOT-42 ')).toBe('LOT-42');
    expect(normaliseLotCode('   ')).toBeNull();
    expect(normaliseLotCode(42)).toBeNull();
  });

  it('accepts only a real ISO date', () => {
    expect(normaliseExpiryDate('2026-12-31')).toBe('2026-12-31');
    expect(normaliseExpiryDate('31/12/2026')).toBeNull();
    expect(normaliseExpiryDate('2026-02-31')).toBeNull();
    expect(normaliseExpiryDate(null)).toBeNull();
  });

  it('flags a lot whose expiry day is past, not the one expiring today', () => {
    expect(isExpired({ expiry_date: '2026-11-01' }, '2026-11-02')).toBe(true);
    expect(isExpired({ expiry_date: '2026-11-02' }, '2026-11-02')).toBe(false);
    expect(isExpired({ expiry_date: null }, '2026-11-02')).toBe(false);
  });
});

describe('FEFO picking', () => {
  it('takes the soonest expiry first, undated lots last', () => {
    const { picks, missing_milli } = pickFefo([
      lot('3', 'C', null, 1000),
      lot('1', 'A', '2026-11-30', 1000),
      lot('2', 'B', '2026-11-10', 1000),
    ], 2000);
    expect(picks.map((pick) => pick.lot_code)).toEqual(['B', 'A']);
    expect(missing_milli).toBe(0);
  });

  it('splits a quantity across lots instead of rounding up to one batch', () => {
    const { picks, missing_milli } = pickFefo([
      lot('1', 'A', '2026-11-10', 500),
      lot('2', 'B', '2026-11-20', 5000),
    ], 1250);
    expect(picks).toEqual([
      { lot_id: '1', lot_code: 'A', quantity_milli: 500 },
      { lot_id: '2', lot_code: 'B', quantity_milli: 750 },
    ]);
    expect(missing_milli).toBe(0);
  });

  it('reports what it could not cover rather than inventing stock', () => {
    const { picks, missing_milli } = pickFefo([lot('1', 'A', '2026-11-10', 400)], 1000);
    expect(picks).toHaveLength(1);
    expect(missing_milli).toBe(600);
  });

  it('ignores empty lots and asks nothing for a zero quantity', () => {
    expect(pickFefo([lot('1', 'A', '2026-11-10', 0), lot('2', 'B', null, -500)], 1000))
      .toEqual({ picks: [], missing_milli: 1000 });
    expect(pickFefo([lot('1', 'A', '2026-11-10', 1000)], 0))
      .toEqual({ picks: [], missing_milli: 0 });
  });

  it('orders two undated lots by arrival then code, so a pick list is stable', () => {
    const { picks } = pickFefo([
      lot('2', 'B', null, 1000, '2026-02-01T00:00:00.000Z'),
      lot('1', 'A', null, 1000, '2026-01-01T00:00:00.000Z'),
    ], 2000);
    expect(picks.map((pick) => pick.lot_code)).toEqual(['A', 'B']);
  });
});
