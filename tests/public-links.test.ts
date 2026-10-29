import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTL_DAYS,
  MAX_TTL_DAYS,
  canAcceptQuote,
  clampTtl,
  linkState,
} from '../server/services/public-links';

describe('public links (T-103)', () => {
  it('reports exactly one state: revoked wins over expired', () => {
    const now = '2026-10-29T10:00:00.000Z';
    expect(linkState({ expires_at: '2026-11-30T00:00:00.000Z', revoked_at: null }, now)).toBe('active');
    expect(linkState({ expires_at: '2026-10-01T00:00:00.000Z', revoked_at: null }, now)).toBe('expired');
    expect(linkState({ expires_at: '2026-10-01T00:00:00.000Z', revoked_at: '2026-10-02T00:00:00.000Z' }, now)).toBe('revoked');
    expect(linkState({ expires_at: '2026-11-30T00:00:00.000Z', revoked_at: '2026-10-02T00:00:00.000Z' }, now)).toBe('revoked');
  });

  it('treats the expiry instant itself as expired', () => {
    const at = '2026-10-29T10:00:00.000Z';
    expect(linkState({ expires_at: at, revoked_at: null }, at)).toBe('expired');
  });

  it('keeps the lifetime inside the documented bounds', () => {
    expect(clampTtl(undefined)).toBe(DEFAULT_TTL_DAYS);
    expect(clampTtl('abc')).toBe(DEFAULT_TTL_DAYS);
    expect(clampTtl(0)).toBe(1);
    expect(clampTtl(-5)).toBe(1);
    expect(clampTtl(7.9)).toBe(7);
    expect(clampTtl(9999)).toBe(MAX_TTL_DAYS);
  });

  it('accepts a quote only while it is sent', () => {
    expect(canAcceptQuote('quote', 'sent')).toBe(true);
    expect(canAcceptQuote('quote', 'approved')).toBe(false);
    expect(canAcceptQuote('quote', 'rejected')).toBe(false);
    expect(canAcceptQuote('quote', 'converted')).toBe(false);
    expect(canAcceptQuote('invoice', 'sent')).toBe(false);
    expect(canAcceptQuote('credit', 'sent')).toBe(false);
  });
});
