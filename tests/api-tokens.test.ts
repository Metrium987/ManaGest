import { describe, expect, it } from 'vitest';
import { expiryFrom, newTokenValue, parseAbilities, sanitiseAbilities } from '../server/services/api-tokens';
import type { Permission } from '../shared/domain';

describe('API tokens (AUDIT §7 P0.6)', () => {
  it('issues a token whose prefix is displayable but whose secret is not repeated', () => {
    const first = newTokenValue();
    const second = newTokenValue();
    expect(first.value.startsWith(`mg_${first.prefix}_`)).toBe(true);
    expect(first.value).not.toBe(second.value);
    expect(first.prefix).toHaveLength(8);
    expect(first.value.length).toBeGreaterThan(20);
  });

  it('never grants a permission the creator does not hold', () => {
    const owned: Permission[] = ['clients.read', 'invoices.read'];
    expect(sanitiseAbilities(['clients.read', 'users.write'], owned)).toEqual(['clients.read']);
  });

  it('drops duplicates and non-declared names', () => {
    const owned: Permission[] = ['clients.read'];
    expect(sanitiseAbilities(['clients.read', 'clients.read', 'ghost'], owned)).toEqual(['clients.read']);
  });

  it('narrows by intersection, which is what the request uses', () => {
    const tokenAbilities: Permission[] = ['clients.read', 'invoices.read'];
    const laterOwned: Permission[] = ['clients.read'];
    expect(sanitiseAbilities(tokenAbilities, laterOwned)).toEqual(['clients.read']);
  });

  it('computes expiry from the configured lifetime', () => {
    const from = new Date('2026-10-29T00:00:00Z');
    expect(expiryFrom(30, from)).toBe('2026-11-28T00:00:00.000Z');
    expect(expiryFrom(0, from)).toBeNull();
    expect(expiryFrom(Number.NaN, from)).toBeNull();
  });

  it('reads a malformed stored list as no permission at all', () => {
    expect(parseAbilities('{not json')).toEqual([]);
    expect(parseAbilities('["clients.read",3]')).toEqual(['clients.read']);
    expect(parseAbilities(null)).toEqual([]);
  });
});
