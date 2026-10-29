import { describe, expect, it } from 'vitest';
import { EXTRA_DEFAULTS, EXTRA_KEYS, isValidExtraValue } from '../server/lib/settings-extra';

/**
 * The batch PATCH used to accept only three fiscal keys, which silently made
 * the approval thresholds and the token limits unwritable (422). These tests
 * pin the rule that every documented setting has a writable default.
 */
describe('settings extras validation', () => {
  it('accepts every documented default', () => {
    for (const key of EXTRA_KEYS) {
      expect(isValidExtraValue(key, EXTRA_DEFAULTS[key]), key).toBe(true);
    }
  });

  it('caps the token settings', () => {
    expect(isValidExtraValue('api_token_lifetime_days', '30')).toBe(true);
    expect(isValidExtraValue('api_token_lifetime_days', '0')).toBe(false);
    expect(isValidExtraValue('api_token_max_per_user', '100')).toBe(true);
    expect(isValidExtraValue('api_token_max_per_user', '101')).toBe(false);
  });

  it('accepts the approval thresholds, including the "off" value', () => {
    expect(isValidExtraValue('approval_credit_amount', '0')).toBe(true);
    expect(isValidExtraValue('approval_expense_amount', '250000')).toBe(true);
    expect(isValidExtraValue('approval_discount_percent', '101')).toBe(false);
  });

  it('only accepts a boolean for separation of duties', () => {
    expect(isValidExtraValue('separation_of_duties', '1')).toBe(true);
    expect(isValidExtraValue('separation_of_duties', 'true')).toBe(true);
    expect(isValidExtraValue('separation_of_duties', 'yes')).toBe(false);
  });

  it('refuses an unknown language, layout or ceiling', () => {
    expect(isValidExtraValue('ui_language', 'de')).toBe(false);
    expect(isValidExtraValue('pdf_layout', 'fancy')).toBe(false);
    expect(isValidExtraValue('attachment_max_mb', '26')).toBe(false);
  });
});
