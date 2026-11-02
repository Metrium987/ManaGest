import { describe, expect, it } from 'vitest';
import {
  availableAt,
  locationBalances,
  locationTotal,
  signedQuantity,
  validateTransfer,
} from '../server/lib/locations';

describe('movement signs', () => {
  it('reads a sale as a negative quantity even though it is stored positive', () => {
    expect(signedQuantity({ kind: 'out', quantity_milli: 3000 })).toBe(-3000);
    expect(signedQuantity({ kind: 'in', quantity_milli: 3000 })).toBe(3000);
  });

  it('keeps the sign an adjustment already carries', () => {
    expect(signedQuantity({ kind: 'adjust', quantity_milli: -2000 })).toBe(-2000);
    expect(signedQuantity({ kind: 'transfer', quantity_milli: 500 })).toBe(500);
  });
});

describe('balances per location', () => {
  it('adds receptions, removes sales and ignores nothing', () => {
    const balances = locationBalances([
      { location: 'A1', kind: 'in', quantity_milli: 10_000 },
      { location: 'A1', kind: 'out', quantity_milli: 4000 },
      { location: 'A1', kind: 'adjust', quantity_milli: -1000 },
      { location: 'B2', kind: 'in', quantity_milli: 5000 },
    ]);
    expect(balances).toEqual([
      { location: 'A1', quantity_milli: 5000 },
      { location: 'B2', quantity_milli: 5000 },
    ]);
    expect(locationTotal(balances)).toBe(10_000);
  });

  it('collects movements without a location in a last bucket', () => {
    const balances = locationBalances([
      { location: null, kind: 'in', quantity_milli: 2000 },
      { location: 'A1', kind: 'in', quantity_milli: 1000 },
    ]);
    expect(balances.map((row) => row.location)).toEqual(['A1', null]);
    expect(availableAt(balances, null)).toBe(2000);
  });

  it('treats a blank location as no location', () => {
    const balances = locationBalances([
      { location: '  ', kind: 'in', quantity_milli: 1500 },
      { location: ' A1 ', kind: 'in', quantity_milli: 500 },
    ]);
    expect(balances).toEqual([
      { location: 'A1', quantity_milli: 500 },
      { location: null, quantity_milli: 1500 },
    ]);
    expect(availableAt(balances, 'A1')).toBe(500);
    expect(availableAt(balances, 'B9')).toBe(0);
  });

  it('a transfer moves the balance without changing the total', () => {
    const movements = [
      { location: 'A1', kind: 'in' as const, quantity_milli: 6000 },
      { location: 'A1', kind: 'out' as const, quantity_milli: 2500 },
      { location: 'B2', kind: 'in' as const, quantity_milli: 2500 },
    ];
    const balances = locationBalances(movements);
    expect(availableAt(balances, 'A1')).toBe(3500);
    expect(availableAt(balances, 'B2')).toBe(2500);
    expect(locationTotal(balances)).toBe(6000);
  });
});

describe('transfer validation', () => {
  const base = { from: 'A1', to: 'B2', quantity_milli: 1000, available_milli: 1000 };

  it('accepts a transfer within the source balance', () => {
    expect(validateTransfer(base)).toEqual({ ok: true });
  });

  it('refuses an empty source rather than creating goods', () => {
    expect(validateTransfer({ ...base, available_milli: 500 })).toEqual({
      ok: false, status: 409, code: 'INSUFFICIENT_LOCATION_STOCK',
    });
  });

  it('refuses a transfer to the same shelf', () => {
    expect(validateTransfer({ ...base, to: 'A1' })).toMatchObject({
      ok: false, status: 422, details: { to_location: 'same_as_source' },
    });
  });

  it('refuses a missing or non-positive quantity', () => {
    expect(validateTransfer({ ...base, from: '   ' })).toMatchObject({ ok: false, details: { from_location: 'required' } });
    expect(validateTransfer({ ...base, quantity_milli: 0 })).toMatchObject({ ok: false, details: { quantity: 'positive' } });
  });

  it('lets a sheet that allows negative stock move goods it does not have', () => {
    expect(validateTransfer({ ...base, available_milli: 0, allow_negative: true })).toEqual({ ok: true });
  });
});
