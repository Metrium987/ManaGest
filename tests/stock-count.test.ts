import { describe, expect, it } from 'vitest';
import {
  adjustmentsOf,
  countDelta,
  countSummary,
  pendingLines,
  staleLines,
} from '../server/lib/stock-count';

const line = (product_id: string, expected: number, counted: number | null) => ({
  product_id,
  expected_milli: expected,
  counted_milli: counted,
});

describe('cycle counting (B1)', () => {
  it('writes the difference between what is on the shelf and what the books say', () => {
    expect(countDelta(7000, 10000)).toBe(-3000);
    expect(countDelta(12000, 10000)).toBe(2000);
    expect(countDelta(10000, 10000)).toBe(0);
  });

  it('treats an uncounted line as no movement, not as zero stock', () => {
    expect(countDelta(null, 10000)).toBe(0);
    expect(pendingLines([line('a', 1000, null), line('b', 1000, 0)])).toHaveLength(1);
  });

  it('counts a line filled with zero as counted', () => {
    const summary = countSummary([line('a', 1000, 0)]);
    expect(summary.counted).toBe(1);
    expect(summary.pending).toBe(0);
    expect(summary.net_delta_milli).toBe(-1000);
  });

  it('summarises shortages, surpluses and the net effect', () => {
    const summary = countSummary([
      line('a', 1000, 500),
      line('b', 1000, 1500),
      line('c', 1000, 1000),
      line('d', 1000, null),
    ]);
    expect(summary).toEqual({
      total: 4, counted: 3, pending: 1, shortages: 1, surpluses: 1, net_delta_milli: 0,
    });
  });

  it('flags a line that moved after the sheet was opened', () => {
    const stale = staleLines(
      [line('a', 1000, 900), line('b', 2000, 2000)],
      new Map([['a', 800], ['b', 2000]]),
    );
    expect(stale).toEqual([{ product_id: 'a', expected_milli: 1000, current_milli: 800 }]);
  });

  it('flags a product that vanished from the catalogue', () => {
    const stale = staleLines([line('gone', 1000, 1000)], new Map());
    expect(stale).toHaveLength(1);
    expect(stale[0].product_id).toBe('gone');
  });

  it('keeps only the lines that actually differ, in a stable order', () => {
    expect(adjustmentsOf([
      line('b', 1000, 1200),
      line('a', 1000, 1000),
      line('c', 2000, 500),
    ])).toEqual([
      { product_id: 'b', delta_milli: 200 },
      { product_id: 'c', delta_milli: -1500 },
    ]);
  });
});
