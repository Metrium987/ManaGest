import { describe, expect, it } from 'vitest';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  isWorkingDay,
  unassignedMinutes,
  weekStart,
  weeklyLoads,
  type PlanningCalendar,
} from '../shared/planning';

const calendar: PlanningCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  businessStart: '07:30',
  businessEnd: '16:30',
  holidays: ['2026-11-11'],
};

describe('planning arithmetic (G2)', () => {
  it('finds the Monday of the week', () => {
    expect(weekStart('2026-11-02')).toBe('2026-11-02'); // Monday
    expect(weekStart('2026-11-08')).toBe('2026-11-02'); // Sunday belongs to it
    expect(weekStart('2026-11-09')).toBe('2026-11-09');
  });

  it('knows the weekend and the configured holidays', () => {
    expect(isWorkingDay('2026-11-07', calendar)).toBe(false); // Saturday
    expect(isWorkingDay('2026-11-11', calendar)).toBe(false); // Armistice, entered as a row
    expect(isWorkingDay('2026-11-12', calendar)).toBe(true);
  });

  it('counts business minutes only while the office is open', () => {
    // Same day, 08:00 → 10:00, then a full day, weekend and holiday skipped.
    expect(businessMinutesBetween('2026-11-02T08:00', '2026-11-02T10:00', calendar)).toBe(120);
    expect(businessMinutesBetween('2026-11-06T08:00', '2026-11-09T10:00', calendar)).toBe(510 + 150);
  });

  it('moves a deadline to the next opening day', () => {
    // 4 h from Friday 15:00: 90 min left Friday, 150 min Monday morning.
    expect(addBusinessMinutes('2026-11-06T15:00', 240, calendar)).toBe('2026-11-09T10:00');
    // 90 min left on Tuesday, then Wednesday 11 is a holiday: only 30 min
    // remain on Thursday, so the deadline is 07:30 + 30 = 08:00.
    expect(addBusinessMinutes('2026-11-10T15:00', 120, calendar)).toBe('2026-11-12T08:00');
  });

  it('flags a week over capacity and ignores unassigned tasks', () => {
    const tasks = [
      { id: 'a', assignee_id: 'u1', planned_start: '2026-11-02', planned_end: '2026-11-04', minutes: 1200 },
      { id: 'b', assignee_id: 'u1', planned_start: '2026-11-05', planned_end: '2026-11-06', minutes: 1200 },
      { id: 'c', assignee_id: 'u2', planned_start: '2026-11-03', planned_end: '2026-11-03', minutes: 300 },
      { id: 'd', assignee_id: null, planned_start: '2026-11-03', planned_end: '2026-11-03', minutes: 600 },
    ];
    const loads = weeklyLoads(tasks, new Map([['u1', 2100]]), 2100);
    const u1 = loads.find((load) => load.assignee_id === 'u1');
    const u2 = loads.find((load) => load.assignee_id === 'u2');
    expect(u1).toMatchObject({ week: '2026-11-02', minutes: 2400, capacity: 2100, overloaded: true });
    expect(u2).toMatchObject({ minutes: 300, capacity: 2100, overloaded: false });
    expect(unassignedMinutes(tasks)).toBe(600);
    expect(loads.some((load) => load.assignee_id === null)).toBe(false);
  });
});
