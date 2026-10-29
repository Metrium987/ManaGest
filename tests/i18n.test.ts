import { describe, expect, it } from 'vitest';
import { fr, getLanguage, setLanguage, t } from '../src/lib/i18n';
import { en } from '../src/lib/i18n-en';

function flatten(node: unknown, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node !== 'object' || node === null) return out;
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else for (const [child, childValue] of flatten(value, path)) out.set(child, childValue);
  }
  return out;
}

const frKeys = flatten(fr);
const enKeys = flatten(en);

describe('UI dictionaries', () => {
  it('English mirrors every French key', () => {
    const missing = [...frKeys.keys()].filter((key) => !enKeys.has(key));
    expect(missing, `missing English keys: ${missing.join(', ')}`).toEqual([]);
  });

  it('English has no key that French does not have', () => {
    const extra = [...enKeys.keys()].filter((key) => !frKeys.has(key));
    expect(extra, `English-only keys: ${extra.join(', ')}`).toEqual([]);
  });

  it('no translation is empty or left in the other language by accident', () => {
    for (const [key, value] of enKeys) {
      expect(value.trim().length, `empty English value for ${key}`).toBeGreaterThan(0);
    }
    for (const [key, value] of frKeys) {
      expect(value.trim().length, `empty French value for ${key}`).toBeGreaterThan(0);
    }
  });

  it('interpolates placeholders in both languages', () => {
    setLanguage('fr');
    expect(t('dashboard.greeting', { name: 'Ana' })).toBe('Bonjour Ana');
    setLanguage('en');
    expect(t('dashboard.greeting', { name: 'Ana' })).toBe('Hello Ana');
    setLanguage('fr');
  });

  it('switches language and falls back to French for an unknown language code', () => {
    setLanguage('en');
    expect(t('common.save')).toBe('Save');
    expect(getLanguage()).toBe('en');
    setLanguage('de');
    expect(getLanguage()).toBe('fr');
    expect(t('common.save')).toBe('Enregistrer');
  });

  it('returns the key itself when nothing matches', () => {
    setLanguage('en');
    expect(t('no.such.key')).toBe('no.such.key');
    setLanguage('fr');
  });

  it('keeps the same key count in both languages', () => {
    expect(enKeys.size).toBe(frKeys.size);
  });
});
