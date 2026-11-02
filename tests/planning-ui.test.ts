import { describe, expect, it } from 'vitest';
import { capacityUsagePercent, weekDates, weekStart } from '../shared/planning';

describe('planning screen helpers (G2)', () => {
  it('builds a Monday-first week grid', () => {
    const days = weekDates(weekStart('2026-11-05')); // a Thursday
    expect(days).toHaveLength(7);
    expect(days[0]).toBe('2026-11-02');
    expect(days[6]).toBe('2026-11-08');
    expect(new Date(`${days[0]}T00:00:00Z`).getUTCDay()).toBe(1);
  });

  it('keeps the grid stable across a month boundary', () => {
    const days = weekDates('2026-10-26');
    expect(days).toEqual([
      '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01',
    ]);
  });

  it('reads the week share without dividing by zero', () => {
    expect(capacityUsagePercent(1050, 2100)).toBe(50);
    expect(capacityUsagePercent(2400, 2100)).toBe(114);
    expect(capacityUsagePercent(600, 0)).toBe(0);
    expect(capacityUsagePercent(-30, 2100)).toBe(0);
  });
});
