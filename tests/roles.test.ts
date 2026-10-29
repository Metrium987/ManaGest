import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS } from '../shared/domain';
import {
  SYSTEM_ROLES,
  isSystemRole,
  parsePermissions,
  resolveRolePermissions,
  resolveUserPermissions,
  roleKeyOf,
} from '../server/services/roles';

describe('system roles keep their static matrix (no behaviour change in T-202a)', () => {
  it('recognises exactly the five fixed keys', () => {
    for (const role of SYSTEM_ROLES) expect(isSystemRole(role)).toBe(true);
    for (const other of ['manager', 'Owner', '', 'admin ']) expect(isSystemRole(other)).toBe(false);
  });

  it('resolves a system role from the code, ignoring any stored row', () => {
    for (const role of SYSTEM_ROLES) {
      expect(resolveRolePermissions(role, '["invoices.delete"]')).toEqual(ROLE_PERMISSIONS[role]);
    }
  });

  it('gives a custom key exactly what its stored list says', () => {
    expect(resolveRolePermissions('manager', '["clients.read","invoices.read"]'))
      .toEqual(['clients.read', 'invoices.read']);
  });
});

describe('stored permission lists are filtered, never trusted', () => {
  it('drops a permission that does not exist in the code', () => {
    expect(parsePermissions('["clients.read","invoices.launch_missiles"]')).toEqual(['clients.read']);
  });

  it('drops non-strings, duplicates and an empty list', () => {
    expect(parsePermissions('["clients.read","clients.read",3,null]')).toEqual(['clients.read']);
    expect(parsePermissions('[]')).toEqual([]);
    expect(parsePermissions('')).toEqual([]);
  });

  it('returns nothing for malformed JSON rather than throwing', () => {
    expect(parsePermissions('{not json')).toEqual([]);
    expect(parsePermissions('{"clients.read":true}')).toEqual([]);
    expect(parsePermissions('null')).toEqual([]);
  });

  it('never returns a permission outside the declared set', () => {
    const all = parsePermissions(JSON.stringify(PERMISSIONS));
    expect(all).toHaveLength(PERMISSIONS.length);
  });

  it('gives an unknown custom role nothing at all', () => {
    expect(resolveRolePermissions('ghost', null)).toEqual([]);
    expect(resolveRolePermissions('ghost', undefined)).toEqual([]);
  });
});

/** Minimal D1 stand-in: only the single query used by loadRolePermissions matters here. */
function fakeDatabase(stored: string | null, onQuery?: () => void): D1Database {
  return {
    prepare: () => ({
      bind: () => ({
        first: async () => {
          onQuery?.();
          return stored === null ? null : { permissions: stored };
        },
      }),
    }),
  } as unknown as D1Database;
}

describe('an account carries its assigned role (T-202b)', () => {
  it('a custom key wins over the fixed role column', async () => {
    const permissions = await resolveUserPermissions(
      fakeDatabase('["clients.read"]'),
      { role: 'viewer', role_key: 'terrain' },
    );
    expect(permissions).toEqual(['clients.read']);
  });

  it('no custom key falls back to the fixed role, without touching the database', async () => {
    let queried = false;
    const database = fakeDatabase(null, () => {
      queried = true;
    });
    const permissions = await resolveUserPermissions(database, { role: 'sales', role_key: null });
    expect(permissions).toEqual(ROLE_PERMISSIONS.sales);
    expect(queried).toBe(false);
  });

  it('an assigned key that no longer exists grants nothing', async () => {
    const permissions = await resolveUserPermissions(fakeDatabase(null), {
      role: 'viewer',
      role_key: 'deleted_role',
    });
    expect(permissions).toEqual([]);
  });

  it('the fixed column is what governs when no custom key is set', () => {
    expect(roleKeyOf({ role: 'accountant' })).toBe('accountant');
    expect(roleKeyOf({ role: 'viewer', role_key: 'terrain' })).toBe('terrain');
  });
});
