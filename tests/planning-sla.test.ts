import { describe, expect, it } from 'vitest';
import { localDateTimeIn, todayIn } from '../server/lib/dates';
import {
  POLYNESIA_HOLIDAYS,
  SLA_DEFAULT_POLICIES,
  addBusinessMinutes,
  businessHoursError,
  easterSunday,
  holidayError,
  correctedHolidaySeeds,
  missingHolidaySeeds,
  missingSlaDefaults,
  slaTierError,
  type PlanningCalendar,
} from '../shared/planning';

const calendar: PlanningCalendar = {
  workingDays: [1, 2, 3, 4, 5],
  businessStart: '07:30',
  businessEnd: '16:30',
  holidays: ['2026-11-11'],
};

describe('SLA start values (G3)', () => {
  it('tightens both clocks as priority rises', () => {
    expect(SLA_DEFAULT_POLICIES.map((policy) => policy.priority)).toEqual(['P1', 'P2', 'P3']);
    const responses = SLA_DEFAULT_POLICIES.map((policy) => policy.response_minutes);
    const resolutions = SLA_DEFAULT_POLICIES.map((policy) => policy.resolution_minutes);
    expect(responses).toEqual([...responses].sort((a, b) => a - b));
    expect(resolutions).toEqual([...resolutions].sort((a, b) => a - b));
    expect(new Set(responses).size).toBe(responses.length);
    expect(new Set(resolutions).size).toBe(resolutions.length);
    for (const policy of SLA_DEFAULT_POLICIES) {
      expect(policy.resolution_minutes).toBeGreaterThan(policy.response_minutes);
    }
  });

  it('only fills the priorities that are absent', () => {
    // P1 exists (renamed and retimed by the owner), P2 was deactivated: it still
    // exists as a row, so only P3 is seeded.
    const missing = missingSlaDefaults([{ priority: 'P1' }, { priority: 'P2' }]);
    expect(missing.map((policy) => policy.priority)).toEqual(['P3']);
  });

  it('never returns a tier already present, whatever its values', () => {
    const present = SLA_DEFAULT_POLICIES.map((policy) => ({ priority: policy.priority }));
    expect(missingSlaDefaults(present)).toEqual([]);
  });

  it('computes a P1 deadline across a weekend and a holiday', () => {
    // 60 working minutes from Friday 16:00: 30 min that day, then Monday 07:30
    // plus the remaining 30 → 08:00. Saturday and Sunday are skipped.
    const p1 = SLA_DEFAULT_POLICIES[0];
    expect(p1.priority).toBe('P1');
    expect(addBusinessMinutes('2026-11-06T16:00', p1.response_minutes, calendar)).toBe('2026-11-09T08:00');
  });

  it('skips a public holiday for the resolution clock', () => {
    // P1 resolution is 240 min. Opened Tuesday 15:00: 90 min before closing,
    // Wednesday 11 is Armistice (a row, not a rule), so the remaining 150 min
    // land Thursday 07:30 → 10:00.
    const p1 = SLA_DEFAULT_POLICIES[0];
    expect(p1.resolution_minutes).toBe(240);
    expect(addBusinessMinutes('2026-11-10T15:00', p1.resolution_minutes, calendar)).toBe('2026-11-12T10:00');
  });

  it('keeps a full working day inside the same day', () => {
    // 480 min from 08:00 still fits Tuesday (08:00 → 16:00), so it must not be
    // pushed to the next day just because it is a long delay.
    const p2 = SLA_DEFAULT_POLICIES[1];
    expect(addBusinessMinutes('2026-11-10T08:00', p2.resolution_minutes, calendar)).toBe('2026-11-10T16:00');
  });

  it('ships the standard tiers as defaults, not as open decisions', () => {
    expect(SLA_DEFAULT_POLICIES.map((policy) => [
      policy.priority, policy.response_minutes, policy.resolution_minutes,
    ])).toEqual([['P1', 60, 240], ['P2', 240, 480], ['P3', 480, 1440]]);
  });
});

describe('planning configuration rules (G3)', () => {
  it('seeds the local holidays for the current and next year', () => {
    const dates = POLYNESIA_HOLIDAYS.map((holiday) => holiday.date);
    expect(new Set(dates).size).toBe(dates.length);
    expect(dates).toContain('2026-03-05'); // Arrivée de l’Évangile
    expect(dates).not.toContain('2026-06-29'); // worked since 2026
    expect(dates).toContain('2026-11-20'); // Matari’i — fête de l’abondance
    expect(dates).toContain('2027-03-05');
    expect(dates).not.toContain('2027-06-29');
    expect(dates).toContain('2027-11-20');
    // Easter-derived days follow the calendar, never a frozen list.
    expect(easterSunday(2026)).toBe('2026-04-05');
    expect(dates).toContain('2026-04-03'); // Vendredi saint
    expect(dates).toContain('2026-04-06'); // Lundi de Pâques
    expect(easterSunday(2027)).toBe('2027-03-28');
    expect(dates).toContain('2027-03-26');
    expect(dates).toContain('2027-03-29');
    expect(dates).toContain('2027-05-06'); // Ascension
  });

  it('replaces the old seeded autonomy day without overruling the owner', () => {
    const untouched = correctedHolidaySeeds([{ day: '2026-06-29', label: 'Fête de l’autonomie' }]);
    expect(untouched.remove).toEqual(['2026-06-29']);
    expect(untouched.add).toEqual([{ date: '2026-11-20', label: 'Matari’i — fête de l’abondance' }]);
    // A day the owner renamed is their decision, not a stale seed.
    expect(correctedHolidaySeeds([{ day: '2026-06-29', label: 'Autonomie (gardée)' }]))
      .toEqual({ remove: [], add: [] });
    // Already corrected: neither removed nor added twice.
    expect(correctedHolidaySeeds([
      { day: '2026-06-29', label: 'Fête de l’autonomie' },
      { day: '2026-11-20', label: 'Matari’i' },
    ])).toEqual({ remove: [], add: [] });
  });

  it('fills a new year without re-creating a day the owner deleted', () => {
    const all = POLYNESIA_HOLIDAYS.map((holiday) => holiday.date);
    expect(missingHolidaySeeds(all)).toEqual([]);
    const only2026 = all.filter((day) => day.startsWith('2026-'));
    expect(missingHolidaySeeds(only2026).every((holiday) => holiday.date.startsWith('2027-'))).toBe(true);
    // A deleted 2026 day does not come back: 2026 still has rows of its own.
    const withoutOne = only2026.slice(1);
    expect(missingHolidaySeeds(withoutOne).some((holiday) => holiday.date.startsWith('2026-'))).toBe(false);
  });

  it('refuses an impossible or out-of-range holiday', () => {
    expect(holidayError('2026-06-29')).toBeNull();
    expect(holidayError('1999-06-29')).toBe('year_out_of_range');
    expect(holidayError('2101-01-01')).toBe('year_out_of_range');
    expect(holidayError('2026-02-30')).toBe('invalid_date');
    expect(holidayError('2026-6-9')).toBe('invalid_date');
  });

  it('refuses an empty or malformed opening range', () => {
    expect(businessHoursError('07:30', '16:30')).toBeNull();
    expect(businessHoursError('16:30', '07:30')).toBe('empty_range');
    expect(businessHoursError('07:30', '07:30')).toBe('empty_range');
    expect(businessHoursError('7:30', '16:30')).toBe('invalid_time');
    expect(businessHoursError('07:30', '25:00')).toBe('invalid_time');
  });

  it('refuses a tier whose resolution falls due before its response', () => {
    expect(slaTierError({ response_minutes: 60, resolution_minutes: 240 })).toBeNull();
    expect(slaTierError({ response_minutes: 0, resolution_minutes: 0 })).toBeNull();
    expect(slaTierError({ response_minutes: 240, resolution_minutes: 60 })).toBe('resolution_before_response');
    expect(slaTierError({ response_minutes: -1, resolution_minutes: 60 })).toBe('invalid_minutes');
  });

  it('stamps an SLA opening on the company clock, not on UTC', () => {
    const instant = new Date('2026-11-02T18:05:00Z');
    expect(localDateTimeIn('Pacific/Tahiti', instant)).toBe('2026-11-02T08:05');
    expect(localDateTimeIn('Pacific/Marquesas', instant)).toBe('2026-11-02T08:35');
    // 05:00 UTC is still the previous day in Tahiti; 10:30 UTC is the next one.
    expect(todayIn('Pacific/Tahiti', new Date('2026-11-03T05:00:00Z'))).toBe('2026-11-02');
    expect(todayIn('Pacific/Tahiti', new Date('2026-11-03T10:30:00Z'))).toBe('2026-11-03');
  });

  it('computes the deadline from the configured hours', () => {
    const morning: PlanningCalendar = {
      workingDays: [1, 2, 3, 4, 5], businessStart: '07:30', businessEnd: '16:30', holidays: [],
    };
    const early: PlanningCalendar = { ...morning, businessStart: '06:00', businessEnd: '14:00' };
    // 480 min from Monday 09:00: 450 min before 16:30, the 30 left open Tuesday.
    expect(addBusinessMinutes('2026-11-02T09:00', 480, morning)).toBe('2026-11-03T08:00');
    // Same delay, an earlier opening: 300 min on Monday, the 180 left at 06:00.
    expect(addBusinessMinutes('2026-11-02T09:00', 480, early)).toBe('2026-11-03T09:00');
  });
});
