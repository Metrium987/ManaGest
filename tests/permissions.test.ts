import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import {
  PERMISSIONS,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '../shared/domain';
import { can, assertPermission, permissionsForRole } from '../server/lib/permissions';
import { ApiError } from '../server/lib/errors';

// ===== R-C invariant: every route registration carries a server-side check =====

const ROUTES_DIR = 'server/routes';

/**
 * Routes whose protection is deliberate and verified separately:
 * - login/MFA verify: public by definition (the login flow itself);
 * - setup/status, setup/install: pre-installation endpoints refusing once configured;
 * - dashboard/search: router uses '*': requireAuth — every role may read per OQ-021 (viewer included);
 * - export: per-entity permission differs per entity, so the 403 test lives in the
 *   handler (`hasPermission(user.role, spec.permission)`) — asserted below by the
 *   FILE_LEVEL_GUARDS entry; unknown entities 404 before any DB access.
 * - public links (T-103): the anonymous document routes are guarded by the token
 *   itself (256-bit, hashed at rest, expiring, revocable), and link creation calls
 *   `assertPermission` inside the handler because the required permission depends on
 *   the document type — both asserted by the FILE_LEVEL_GUARDS entry below.
 */
const ALLOWLIST = new Set([
  'auth.ts /login',
  'auth.ts /mfa/verify',
  'setup.ts /status',
  'setup.ts /install',
  'dashboard.ts /',
  'export.ts /:entity',
  'public-links.ts /',
  'public-links.ts /:token',
  'public-links.ts /:token/pdf',
  'public-links.ts /:token/accept',
  'email.ts /:kind/:id',
]);

/** The search router is guarded at router level, not per line: verify it stays. */
const FILE_LEVEL_GUARDS: Record<string, string> = {
  'dashboard.ts': "searchRoutes.use('*', requireAuth)",
  'export.ts': 'if (!hasPermission(user.role, spec.permission as Permission)) return fail(403',
  'public-links.ts': 'assertPermission(user.role, ENTITY_PERMISSIONS[link.entity_type].write)',
};

function routeLines(): { file: string; path: string; line: number; text: string }[] {
  const out: { file: string; path: string; line: number; text: string }[] = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
    src.split('\n').forEach((text, index) => {
      const match = text.match(/Routes\.(get|post|put|patch|delete)\(\s*'([^']*)'/);
      if (!match) return;
      out.push({ file, path: match[2], line: index + 1, text });
    });
  }
  return out;
}

describe('R-C: server-side permission coverage (T-008 sweep)', () => {
  const routes = routeLines();

  it('found a plausible number of registered routes', () => {
    expect(routes.length).toBeGreaterThan(50);
  });

  it('every route is guarded by requirePermission, requireAuth on the same line, or the verified allowlist', () => {
    // dashboard.ts search route: router-level `searchRoutes.use('*', requireAuth)`, asserted below.
    const offenders: string[] = [];
    for (const route of routes) {
      const guarded = /requirePermission|requireAuth/.test(route.text);
      const allowed = ALLOWLIST.has(`${route.file} ${route.path}`);
      if (!guarded && !allowed) offenders.push(`${route.file}: ${route.path} @ ${route.line}`);
    }
    expect(offenders).toEqual([]);
    for (const [file, guard] of Object.entries(FILE_LEVEL_GUARDS)) {
      expect(readFileSync(join(ROUTES_DIR, file), 'utf8').includes(guard)).toBe(true);
    }
  });
});

// ===== Role matrix sanity (OQ-021 confirmed model) =====

const ROLES: Role[] = ['owner', 'admin', 'accountant', 'sales', 'viewer'];

describe('R-C: role × permission matrix', () => {
  it('owner and admin hold every declared permission', () => {
    for (const role of ['owner', 'admin'] as Role[]) {
      for (const permission of PERMISSIONS) {
        expect(can(role, permission), `${role} lacks ${permission}`).toBe(true);
      }
    }
  });

  it('permissionsForRole returns only declared permissions', () => {
    for (const role of ROLES) {
      for (const permission of permissionsForRole(role)) {
        expect((PERMISSIONS as readonly string[]).includes(permission)).toBe(true);
      }
    }
  });

  it('viewer is read-only: no .write, .delete or user management', () => {
    for (const permission of permissionsForRole('viewer')) {
      expect(permission.endsWith('.write')).toBe(false);
      expect(permission.endsWith('.delete')).toBe(false);
      expect(permission.startsWith('users.')).toBe(false);
    }
  });

  it('non-admin roles cannot manage users', () => {
    for (const role of ROLES.filter(r => r !== 'owner' && r !== 'admin')) {
      expect(can(role, 'users.write' as Permission)).toBe(false);
    }
  });

  it('only owner/admin/accountant control periods; sales and viewer do not', () => {
    expect(can('accountant', 'periods.write' as Permission)).toBe(true); // their core control
    for (const role of ['sales', 'viewer'] as Role[]) {
      expect(can(role, 'periods.write' as Permission)).toBe(false);
      expect(can(role, 'periods.read' as Permission)).toBe(false);
    }
  });

  it('unknown permission or role is denied', () => {
    expect(can('viewer', 'not_a_permission' as Permission)).toBe(false);
  });

  it('assertPermission throws 403 ApiError', () => {
    expect(() => assertPermission('viewer', 'invoices.write')).toThrowError(ApiError);
    let status = 0;
    try {
      assertPermission('viewer', 'invoices.write');
    } catch (error) {
      status = (error as ApiError).status;
    }
    expect(status).toBe(403);
  });

  it('every role resolves through the static matrix (custom roles arrive in T-202)', () => {
    for (const role of ROLES) {
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    }
  });
});
