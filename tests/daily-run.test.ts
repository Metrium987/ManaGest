import { describe, expect, it } from 'vitest';
import {
  MAX_CATCH_UP_CYCLES,
  RUN_ATTEMPT_LIMIT,
  RUN_ATTEMPT_WINDOW_MINUTES,
  canRetryPrevious,
  pendingCycles,
  retryAfterSeconds,
  runStatusFor,
} from '../server/services/daily-run';
import { advanceRunDate } from '../server/services/recurring';

describe('run status (what the caller is told)', () => {
  it('is a success only when nothing failed', () => {
    expect(runStatusFor(3, 0)).toBe('success');
    expect(runStatusFor(0, 0)).toBe('success');
  });

  it('is a failure when nothing could be generated', () => {
    expect(runStatusFor(0, 2)).toBe('failed');
  });

  it('is partial when some templates worked', () => {
    expect(runStatusFor(2, 1)).toBe('partial');
  });

  it('is skipped when the period is closed, even with an empty summary', () => {
    expect(runStatusFor(0, 0, 'PERIOD_LOCKED')).toBe('skipped');
  });
});

describe('retry policy (a failed day is retryable, a finished one is not)', () => {
  it('allows a retry after a failure or a skip', () => {
    expect(canRetryPrevious('failed')).toBe(true);
    expect(canRetryPrevious('skipped')).toBe(true);
  });

  it('refuses a retry after success, while running, or when nothing ran', () => {
    for (const status of ['success', 'partial', 'running', null, undefined, '']) {
      expect(canRetryPrevious(status)).toBe(false);
    }
  });
});

describe('attempt window (a leaked token is not an unlimited lever)', () => {
  const now = new Date('2026-10-29T10:00:00Z');
  const attemptAt = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

  it('allows while the window has room', () => {
    expect(retryAfterSeconds([attemptAt(5), attemptAt(20)], now)).toBe(0);
    expect(retryAfterSeconds([], now)).toBe(0);
  });

  it('refuses once the limit is reached and says how long to wait', () => {
    const attempts = Array.from({ length: RUN_ATTEMPT_LIMIT }, (_, index) => attemptAt(index + 1));
    const wait = retryAfterSeconds(attempts, now);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(RUN_ATTEMPT_WINDOW_MINUTES * 60);
  });

  it('ignores attempts older than the window', () => {
    const stale = Array.from({ length: RUN_ATTEMPT_LIMIT }, (_, index) => attemptAt(RUN_ATTEMPT_WINDOW_MINUTES + index + 1));
    expect(retryAfterSeconds(stale, now)).toBe(0);
  });

  it('does not move backwards on a malformed timestamp', () => {
    expect(retryAfterSeconds(['not-a-date', attemptAt(1)], now)).toBe(0);
  });
});

describe('catch-up (a backlog is generated, but never without a ceiling)', () => {
  const today = '2026-10-29';

  it('does nothing when the template is not due', () => {
    expect(pendingCycles('2026-11-01', 'monthly', 1, today)).toBe(0);
  });

  it('counts a template due today', () => {
    expect(pendingCycles(today, 'monthly', 1, today)).toBe(1);
  });

  it('generates the missed months one by one', () => {
    expect(pendingCycles('2026-07-01', 'monthly', 1, today)).toBe(4);
    expect(pendingCycles('2026-10-22', 'weekly', 1, today)).toBe(2);
    expect(pendingCycles('2026-10-01', 'quarterly', 1, today)).toBe(1);
  });

  it('stops at the documented ceiling instead of producing a year of invoices', () => {
    expect(pendingCycles('2020-01-01', 'monthly', 1, today)).toBe(MAX_CATCH_UP_CYCLES);
    expect(pendingCycles('2026-01-01', 'weekly', 1, today, 3)).toBe(3);
  });

  it('keeps the engine rule on a month-end start date (the 31st drifts to the 28th)', () => {
    // Not introduced here: the manual run has always advanced from the last date.
    expect(pendingCycles('2026-01-31', 'monthly', 1, '2026-03-31')).toBe(3);
  });
});

describe('run date advance (shared with the manual route)', () => {
  it('adds weeks', () => {
    expect(advanceRunDate('2026-10-29', 'weekly', 1)).toBe('2026-11-05');
    expect(advanceRunDate('2026-10-29', 'weekly', 2)).toBe('2026-11-12');
  });

  it('adds months, quarters, half-years and years', () => {
    expect(advanceRunDate('2026-10-29', 'monthly', 1)).toBe('2026-11-29');
    expect(advanceRunDate('2026-10-29', 'quarterly', 1)).toBe('2027-01-29');
    expect(advanceRunDate('2026-10-29', 'semiannual', 1)).toBe('2027-04-29');
    expect(advanceRunDate('2026-10-29', 'yearly', 1)).toBe('2027-10-29');
  });

  it('clamps a short month instead of overflowing into the next one', () => {
    expect(advanceRunDate('2026-01-31', 'monthly', 1)).toBe('2026-02-28');
    expect(advanceRunDate('2028-01-31', 'monthly', 1)).toBe('2028-02-29');
  });
});
