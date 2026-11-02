import { describe, expect, it } from 'vitest';
import {
  lotBalancesFromMovements,
  signedLotQuantity,
} from '../server/lib/lot-balances';

describe('lot balances', () => {
  it('applies the same sign rule as the location ledger', () => {
    expect(signedLotQuantity({ kind: 'in', quantity_milli: 1000 })).toBe(1000);
    expect(signedLotQuantity({ kind: 'out', quantity_milli: 1000 })).toBe(-1000);
    expect(signedLotQuantity({ kind: 'adjustment', quantity_milli: -500 })).toBe(-500);
  });

  it('splits one batch across the shelves it sits on', () => {
    const rows = lotBalancesFromMovements([
      { lot: 'L1', location: 'ENTREPOT', kind: 'in', quantity_milli: 5000 },
      { lot: 'L1', location: 'ENTREPOT', kind: 'out', quantity_milli: 2000 },
      { lot: 'L1', location: 'BOUTIQUE', kind: 'in', quantity_milli: 2000 },
    ]);
    expect(rows).toEqual([
      { lot_code: 'L1', location: 'BOUTIQUE', quantity_milli: 2000 },
      { lot_code: 'L1', location: 'ENTREPOT', quantity_milli: 3000 },
    ]);
  });

  it('nets a transfer back to where it started', () => {
    const rows = lotBalancesFromMovements([
      { lot: 'L1', location: 'A', kind: 'in', quantity_milli: 1000 },
      { lot: 'L1', location: 'A', kind: 'out', quantity_milli: 1000 },
      { lot: 'L1', location: 'B', kind: 'in', quantity_milli: 1000 },
      { lot: 'L1', location: 'B', kind: 'out', quantity_milli: 1000 },
    ]);
    expect(rows).toEqual([]);
  });

  it('drops the empty shelves and the movements without a batch', () => {
    const rows = lotBalancesFromMovements([
      { lot: 'L1', location: 'A', kind: 'in', quantity_milli: 1000 },
      { lot: 'L1', location: 'A', kind: 'out', quantity_milli: 1000 },
      { lot: null, location: 'A', kind: 'in', quantity_milli: 999 },
    ]);
    expect(rows).toEqual([]);
  });

  it('keeps the unassigned shelf last', () => {
    const rows = lotBalancesFromMovements([
      { lot: 'L2', location: null, kind: 'in', quantity_milli: 10 },
      { lot: 'L1', location: 'A', kind: 'in', quantity_milli: 10 },
    ]);
    expect(rows).toEqual([
      { lot_code: 'L1', location: 'A', quantity_milli: 10 },
      { lot_code: 'L2', location: null, quantity_milli: 10 },
    ]);
  });
});
