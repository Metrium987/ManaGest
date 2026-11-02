import { describe, expect, it } from 'vitest';
import { completionRateBp, deferredAmount, recognitionDelta, recognizedAmount } from '../server/lib/revenue';

describe('completion rate', () => {
  it('is zero before the period starts', () => {
    expect(completionRateBp('2026-01-01', '2026-01-31', '2025-12-20')).toBe(0);
  });

  it('is complete once the period has ended', () => {
    expect(completionRateBp('2026-01-01', '2026-01-31', '2026-02-05')).toBe(10000);
  });

  it('is halfway at the middle of the period', () => {
    expect(completionRateBp('2026-01-01', '2026-01-31', '2026-01-16')).toBe(5000);
  });

  it('treats a zero-length period as complete rather than dividing by zero', () => {
    expect(completionRateBp('2026-01-01', '2026-01-01', '2026-01-01')).toBe(10000);
  });
});

describe('recognition amounts', () => {
  it('recognises the share of the period elapsed', () => {
    expect(recognizedAmount(120000, 5000)).toBe(60000);
    expect(deferredAmount(120000, 5000)).toBe(60000);
  });

  it('never recognises more than the total', () => {
    expect(recognizedAmount(120000, 12000)).toBe(120000);
  });

  it('books only the difference since the last run', () => {
    expect(recognitionDelta(120000, 5000, 7500)).toBe(30000);
  });

  it('books nothing when the rate did not move backwards or at all', () => {
    expect(recognitionDelta(120000, 7500, 5000)).toBe(0);
    expect(recognitionDelta(120000, 5000, 5000)).toBe(0);
  });
});
