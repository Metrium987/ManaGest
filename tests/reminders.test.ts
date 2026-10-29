import { describe, expect, it } from 'vitest';
import {
  DEFAULT_REMINDER_INTERVAL_DAYS,
  REMINDER_MAX_LEVEL,
  levelsToRecord,
  reminderLevelDue,
} from '../server/services/reminders';

describe('reminder level (how late is late)', () => {
  it('reminds nothing while the invoice is not overdue', () => {
    for (const days of [0, -1, -30, Number.NaN]) {
      expect(reminderLevelDue(days)).toBe(0);
    }
  });

  it('sends the first reminder the day after the due date', () => {
    expect(reminderLevelDue(1)).toBe(1);
    expect(reminderLevelDue(2)).toBe(1);
  });

  it('waits the interval before the second one', () => {
    const interval = DEFAULT_REMINDER_INTERVAL_DAYS;
    expect(reminderLevelDue(interval)).toBe(1);
    expect(reminderLevelDue(interval + 1)).toBe(2);
    expect(reminderLevelDue(interval * 2)).toBe(2);
    expect(reminderLevelDue(interval * 2 + 1)).toBe(3);
  });

  it('stops at the documented maximum instead of escalating forever', () => {
    expect(reminderLevelDue(10_000)).toBe(REMINDER_MAX_LEVEL);
  });

  it('follows a workspace interval', () => {
    expect(reminderLevelDue(3, 3)).toBe(1);
    expect(reminderLevelDue(4, 3)).toBe(2);
    expect(reminderLevelDue(7, 3)).toBe(3);
  });

  it('treats a nonsense interval as one day rather than dividing by zero', () => {
    expect(reminderLevelDue(5, 0)).toBe(3);
    expect(reminderLevelDue(5, -2)).toBe(3);
  });
});

describe('what a pass owes (no repeated nagging)', () => {
  it('owes nothing when no level is due', () => {
    expect(levelsToRecord(0, [])).toEqual([]);
  });

  it('owes every missing level, in order', () => {
    expect(levelsToRecord(3, [])).toEqual([1, 2, 3]);
    expect(levelsToRecord(3, [1])).toEqual([2, 3]);
    expect(levelsToRecord(3, [1, 2])).toEqual([3]);
  });

  it('owes nothing when the level was already recorded', () => {
    expect(levelsToRecord(2, [1, 2])).toEqual([]);
    expect(levelsToRecord(1, [1])).toEqual([]);
  });

  it('ignores a recorded level above what is due', () => {
    expect(levelsToRecord(1, [3])).toEqual([1]);
  });
});
