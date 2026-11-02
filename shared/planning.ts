/**
 * Planning and SLA arithmetic, shared by the API and the UI.
 *
 * Nothing here is a rule of the business: every function receives its calendar
 * (working days, opening hours, non-working days) and its capacity. The values
 * live in settings, so a workspace can plan Monday–Saturday or 07:00–15:00
 * without a code change. The defaults below are only what a new workspace
 * starts from — 35 h/week, Monday–Friday, 07:30–16:30, which is the usual
 * office day in French Polynesia.
 */

/**
 * SLA start values. A contract nobody has signed yet cannot carry a real
 * commitment, so a new workspace opens with three standard tiers rather than an
 * empty screen. They are ordinary rows: renaming, retiming or deactivating one
 * is done in the SLA screen and is never overwritten by a later seed.
 *
 * The tiers follow the usual escalation order — the higher the priority, the
 * shorter both clocks — and are expressed in working minutes, so a P1 opened on
 * Friday afternoon is not due during the weekend:
 *   P1 Urgent    1 h acknowledgment,  4 h resolution
 *   P2 Normal    4 h acknowledgment,  8 h resolution
 *   P3 Planned   8 h acknowledgment, 24 h resolution
 * A working day is 9 h (07:30–16:30 by default), so P3 resolution lands the next
 * working morning at the earliest, never on a public holiday.
 */
export const SLA_DEFAULT_POLICIES: { priority: string; name: string; response_minutes: number; resolution_minutes: number }[] = [
  { priority: 'P1', name: 'Standard — P1 Urgent', response_minutes: 60, resolution_minutes: 240 },
  { priority: 'P2', name: 'Standard — P2 Normal', response_minutes: 240, resolution_minutes: 480 },
  { priority: 'P3', name: 'Standard — P3 Planifié', response_minutes: 480, resolution_minutes: 1440 },
];

/**
 * Which standard tiers are still missing. A tier already present — even renamed
 * or deactivated by the owner — is never re-created and never overwritten: the
 * seed only fills the gaps of a workspace that has none.
 */
export function missingSlaDefaults(
  existing: { priority: string }[],
): typeof SLA_DEFAULT_POLICIES {
  const present = new Set(existing.map((row) => row.priority));
  return SLA_DEFAULT_POLICIES.filter((policy) => !present.has(policy.priority));
}

export interface PlanningCalendar {
  /** ISO weekdays, 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** 'HH:MM', local to the company timezone. */
  businessStart: string;
  businessEnd: string;
  /** 'YYYY-MM-DD' days the business does not work (public holidays, closures). */
  holidays: string[];
}

export const PLANNING_DEFAULTS = {
  weeklyCapacityMinutes: 35 * 60,
  workingDays: [1, 2, 3, 4, 5],
  businessStart: '07:30',
  businessEnd: '16:30',
} as const;

/**
 * French Polynesia public holidays, used to seed a new workspace's calendar.
 * They are rows, not rules: the owner edits, adds or deletes them in the
 * calendar screen, and the SLA arithmetic never knows a holiday by name.
 *
 * The seed covers the current and next civil year so a new workspace is not
 * stale on 1 January. Fixed-date days are listed; the Easter-derived days are
 * computed from the Gregorian Easter, so no year is frozen in the code.
 */
export const HOLIDAY_SEED_YEARS = [2026, 2027] as const;

/** Gregorian Easter Sunday for a year, as 'YYYY-MM-DD' (Meeus/Jones/Butcher). */
export function easterSunday(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Shifts an ISO day by a number of days, before the calendar helpers exist. */
function shiftDay(iso: string, days: number): string {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function seedHolidaysFor(year: number): { date: string; label: string }[] {
  const easter = easterSunday(year);
  const fixed: [string, string][] = [
    ['01-01', 'Nouvel an'],
    ['03-05', 'Arrivée de l’Évangile'],
    ['05-01', 'Fête du Travail'],
    ['05-08', 'Victoire 1945'],
    // Since 2026 the 29 June autonomy day is no longer a holiday: it was replaced
    // by 20 November (Matari’i — fête de l’abondance) by the loi du Pays of 2025.
    ['11-20', 'Matari’i — fête de l’abondance'],
    ['07-14', 'Fête nationale'],
    ['08-15', 'Assomption'],
    ['11-01', 'Toussaint'],
    ['11-11', 'Armistice'],
    ['12-25', 'Noël'],
  ];
  return [
    ...fixed.map(([monthDay, label]) => ({ date: `${year}-${monthDay}`, label })),
    { date: shiftDay(easter, -2), label: 'Vendredi saint' },
    { date: shiftDay(easter, 1), label: 'Lundi de Pâques' },
    { date: shiftDay(easter, 39), label: 'Ascension' },
    { date: shiftDay(easter, 49), label: 'Lundi de Pentecôte' },
  ].sort((left, right) => left.date.localeCompare(right.date));
}

export const POLYNESIA_HOLIDAYS: { date: string; label: string }[] =
  HOLIDAY_SEED_YEARS.flatMap(seedHolidaysFor);

/**
 * Seed rows a calendar is still missing. A whole year is added only when that
 * year has no row at all: a workspace open since 2026 picks up 2027 without the
 * owner re-entering anything, while a day the owner deleted inside an already
 * seeded year stays deleted.
 */
export function missingHolidaySeeds(existingDays: string[]): { date: string; label: string }[] {
  const years = new Set(existingDays.map((day) => day.slice(0, 4)));
  return POLYNESIA_HOLIDAYS.filter((holiday) => !years.has(holiday.date.slice(0, 4)));
}

/**
 * Days that were seeded before a holiday moved. The seed used to write
 * 29 June as "Fête de l’autonomie"; since 2026 that day is worked and
 * 20 November is the holiday. A workspace opened before the correction still
 * holds the old row, so it is replaced — but only when it is untouched: a row
 * the owner renamed is left alone, and the new day is never added twice.
 */
const AUTONOMY_SEED = { monthDay: '06-29', label: 'Fête de l’autonomie' };
const MATARII_SEED = { monthDay: '11-20', label: 'Matari’i — fête de l’abondance' };

export function correctedHolidaySeeds(
  existing: { day: string; label: string | null }[],
): { remove: string[]; add: { date: string; label: string }[] } {
  const labels = new Map(existing.map((row) => [row.day, row.label ?? '']));
  const remove: string[] = [];
  const add: { date: string; label: string }[] = [];
  for (const year of HOLIDAY_SEED_YEARS) {
    const oldDay = `${year}-${AUTONOMY_SEED.monthDay}`;
    const newDay = `${year}-${MATARII_SEED.monthDay}`;
    if (labels.get(oldDay) !== AUTONOMY_SEED.label) continue;
    if (labels.has(newDay)) continue;
    remove.push(oldDay);
    add.push({ date: newDay, label: MATARII_SEED.label });
  }
  return { remove, add };
}

/** Accepted span for a calendar day. Outside it the date is a typo, not a holiday. */
export const HOLIDAY_YEAR_MIN = 2000;
export const HOLIDAY_YEAR_MAX = 2100;

/** Why a calendar day cannot be stored, or null when it can. */
export function holidayError(day: string): 'invalid_date' | 'year_out_of_range' | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return 'invalid_date';
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== date) {
    return 'invalid_date';
  }
  if (year < HOLIDAY_YEAR_MIN || year > HOLIDAY_YEAR_MAX) return 'year_out_of_range';
  return null;
}

/** Why an opening range cannot be stored, or null when it can. */
export function businessHoursError(
  start: string,
  end: string,
): 'invalid_time' | 'empty_range' | null {
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(start) || !time.test(end)) return 'invalid_time';
  if (toMinutes(end) <= toMinutes(start)) return 'empty_range';
  return null;
}

/**
 * SLA tiers escalate: a resolution can never fall due before its response, and
 * a negative delay is a typo. Zero stays allowed (no commitment on that clock).
 */
export function slaTierError(tier: {
  response_minutes: number;
  resolution_minutes: number;
}): 'invalid_minutes' | 'resolution_before_response' | null {
  const { response_minutes, resolution_minutes } = tier;
  if (!Number.isFinite(response_minutes) || !Number.isFinite(resolution_minutes)) return 'invalid_minutes';
  if (response_minutes < 0 || resolution_minutes < 0) return 'invalid_minutes';
  if (resolution_minutes < response_minutes) return 'resolution_before_response';
  return null;
}

const MS_PER_DAY = 86_400_000;

function parseDay(iso: string): Date {
  const [year, month, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
}

function formatDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return formatDay(new Date(parseDay(iso).getTime() + days * MS_PER_DAY));
}

/** Monday of the ISO week containing `iso`. */
export function weekStart(iso: string): string {
  const date = parseDay(iso);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(iso, -offset);
}

export function toMinutes(hhmm: string): number {
  const [hours, minutes] = hhmm.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
}

export function isWorkingDay(iso: string, calendar: PlanningCalendar): boolean {
  const day = iso.slice(0, 10);
  if (calendar.holidays.includes(day)) return false;
  return calendar.workingDays.includes(parseDay(day).getUTCDay());
}

/** Open minutes on a given day: zero when the day is not worked. */
export function openMinutes(iso: string, calendar: PlanningCalendar): number {
  if (!isWorkingDay(iso, calendar)) return 0;
  const span = toMinutes(calendar.businessEnd) - toMinutes(calendar.businessStart);
  return Math.max(0, span);
}

/** Business minutes between two local instants ('YYYY-MM-DDTHH:MM'). */
export function businessMinutesBetween(
  startIso: string,
  endIso: string,
  calendar: PlanningCalendar,
): number {
  const startDay = startIso.slice(0, 10);
  const endDay = endIso.slice(0, 10);
  if (endDay < startDay) return 0;
  let total = 0;
  let day = startDay;
  // The loop is bounded by the two dates, so a far end date cannot hang.
  while (day <= endDay) {
    if (isWorkingDay(day, calendar)) {
      const open = toMinutes(calendar.businessStart);
      const close = toMinutes(calendar.businessEnd);
      const from = day === startDay ? Math.max(open, toMinutes(startIso.slice(11, 16) || calendar.businessStart)) : open;
      const to = day === endDay ? Math.min(close, toMinutes(endIso.slice(11, 16) || calendar.businessEnd)) : close;
      if (to > from) total += to - from;
    }
    day = addDays(day, 1);
  }
  return total;
}

/**
 * Adds business minutes to a local instant and returns the resulting local
 * instant ('YYYY-MM-DDTHH:MM'). The clock only runs during opening hours on
 * worked days, so a 4-hour SLA opened at 16:00 ends the next morning.
 */
export function addBusinessMinutes(
  startIso: string,
  minutes: number,
  calendar: PlanningCalendar,
): string {
  let remaining = Math.max(0, Math.round(minutes));
  let day = startIso.slice(0, 10);
  let cursor = Math.max(toMinutes(calendar.businessStart), toMinutes(startIso.slice(11, 16) || calendar.businessStart));
  const close = toMinutes(calendar.businessEnd);

  for (let guard = 0; guard < 3650; guard += 1) {
    if (isWorkingDay(day, calendar)) {
      if (cursor < close) {
        const available = close - cursor;
        if (remaining <= available) {
          const done = cursor + remaining;
          return `${day}T${String(Math.floor(done / 60)).padStart(2, '0')}:${String(done % 60).padStart(2, '0')}`;
        }
        remaining -= available;
      }
    }
    day = addDays(day, 1);
    cursor = toMinutes(calendar.businessStart);
  }
  return `${day}T${calendar.businessEnd}`;
}

export interface PlannableTask {
  id: string;
  assignee_id: string | null;
  planned_start: string | null;
  planned_end: string | null;
  minutes: number;
}

export interface WeeklyLoad {
  week: string;
  assignee_id: string;
  minutes: number;
  capacity: number;
  overloaded: boolean;
}

/**
 * Weekly load per assignee, compared with each person's capacity. Unassigned
 * tasks are deliberately excluded — the owner decided they weigh on the
 * project's charge, not on someone's week.
 */
export function weeklyLoads(
  tasks: PlannableTask[],
  capacities: Map<string, number>,
  defaultCapacity: number,
): WeeklyLoad[] {
  const buckets = new Map<string, { minutes: number; assignee_id: string }>();
  for (const task of tasks) {
    if (!task.assignee_id) continue;
    const anchor = task.planned_start ?? task.planned_end;
    if (!anchor) continue;
    const week = weekStart(anchor);
    const key = `${week}|${task.assignee_id}`;
    const bucket = buckets.get(key) ?? { minutes: 0, assignee_id: task.assignee_id };
    bucket.minutes += Math.max(0, Number(task.minutes ?? 0));
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .map(([key, bucket]) => {
      const week = key.split('|')[0];
      const capacity = capacities.get(bucket.assignee_id) ?? defaultCapacity;
      return {
        week,
        assignee_id: bucket.assignee_id,
        minutes: bucket.minutes,
        capacity,
        overloaded: bucket.minutes > capacity,
      };
    })
    .sort((left, right) => left.week.localeCompare(right.week) || left.assignee_id.localeCompare(right.assignee_id));
}

/** The seven ISO dates of the week starting at `weekStartIso`, Monday first. */
export function weekDates(weekStartIso: string): string[] {
  return Array.from({ length: 7 }, (_, index) => addDays(weekStartIso, index));
}

/** Share of a person's week already planned, as a percentage (0 when no capacity). */
export function capacityUsagePercent(minutes: number, capacity: number): number {
  if (!capacity) return 0;
  return Math.round((Math.max(0, minutes) / capacity) * 100);
}

/** Minutes carried by tasks nobody owns, per project — the project's own charge. */
export function unassignedMinutes(tasks: PlannableTask[]): number {
  return tasks
    .filter((task) => !task.assignee_id)
    .reduce((sum, task) => sum + Math.max(0, Number(task.minutes ?? 0)), 0);
}
