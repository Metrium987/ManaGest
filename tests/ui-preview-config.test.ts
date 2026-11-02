import { describe, expect, it } from 'vitest';
import {
  missingConfigMessage,
  previewConfig,
  REQUIRED_PREVIEW_VARIABLES,
} from '../scripts/preview-config.mjs';

/**
 * H5 — the CI job must fail for the right reason. A missing secret is a
 * configuration error (exit 2, named variables), not a failed check.
 */
describe('hosted preview configuration (H5)', () => {
  it('names every missing variable instead of guessing', () => {
    const config = previewConfig({});
    expect(config.ok).toBe(false);
    expect(config.missing).toEqual([...REQUIRED_PREVIEW_VARIABLES]);
    const message = missingConfigMessage(config);
    for (const key of REQUIRED_PREVIEW_VARIABLES) expect(message).toContain(key);
    expect(message).toContain('Settings → Secrets and variables → Actions');
  });

  it('accepts a complete configuration and trims a trailing slash', () => {
    const config = previewConfig({
      PREVIEW_URL: 'https://preview.exemple.pf/',
      PREVIEW_EMAIL: 'qa@exemple.pf',
      PREVIEW_PASSWORD: 'secret',
    });
    expect(config).toMatchObject({ ok: true, url: 'https://preview.exemple.pf', missing: [] });
    expect(missingConfigMessage(config)).toBe('');
  });

  it('refuses a URL that is not an http(s) origin', () => {
    const config = previewConfig({
      PREVIEW_URL: 'preview.exemple.pf',
      PREVIEW_EMAIL: 'qa@exemple.pf',
      PREVIEW_PASSWORD: 'secret',
    });
    expect(config.ok).toBe(false);
    expect(config.invalidUrl).toContain('origine http(s)');
  });

  it('treats whitespace-only secrets as missing', () => {
    const config = previewConfig({ PREVIEW_URL: '  ', PREVIEW_EMAIL: ' ', PREVIEW_PASSWORD: '' });
    expect(config.missing).toEqual([...REQUIRED_PREVIEW_VARIABLES]);
  });
});
