import { afterEach, describe, expect, it } from 'vitest';
import { setLanguage, t } from '../src/lib/i18n';

/**
 * A dotted key that is stored as a flat string silently renders as its own key
 * (`planning.tabs.report` on screen). This test pins the labels the planning
 * screen actually reads, in both languages.
 */
const KEYS = [
  'planning.title',
  'planning.subtitle',
  'planning.tabs.report',
  'planning.tabs.settings',
  'planning.tabs.calendar',
  'planning.tabs.sla',
  'planning.weekday.0',
  'planning.weekday.6',
  'planning.policyScope_client',
  'planning.policyScope_contract',
  'planning.overWarn',
  'planning.calendarHint',
  'planning.breachesHint',
  'nav.planning',
];

afterEach(() => setLanguage('fr'));

describe('planning screen labels (G2/G3)', () => {
  it('all resolve in French', () => {
    setLanguage('fr');
    for (const key of KEYS) expect(t(key), key).not.toBe(key);
  });

  it('all resolve in English', () => {
    setLanguage('en');
    for (const key of KEYS) expect(t(key), key).not.toBe(key);
  });

  it('keeps the Monday-first weekday ordering', () => {
    setLanguage('fr');
    expect(t('planning.weekday.1')).toBe('lundi');
    setLanguage('en');
    expect(t('planning.weekday.1')).toBe('Monday');
  });
});
