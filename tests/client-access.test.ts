import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ROLE_PERMISSIONS, ROLES, type Permission, type Role } from '@shared/domain';
import { CLIENT_ROUTES, canOpenPath } from '@/lib/access';
import { RequirePermission } from '@/components/layout/RouteGuard';
import { visibleSections } from '@/components/layout/AppShell';

const session = vi.hoisted(() => ({ permissions: [] as string[], isLoading: false }));

vi.mock('@/lib/session', () => ({
  useSession: () => ({
    can: (permission: string) => session.permissions.includes(permission),
    isLoading: session.isLoading,
  }),
}));

const DENIAL = /droits|permissions/i;
const SCREEN = 'SCREEN-CONTENT';

function renderWith(role: Role, permission: Permission): string {
  session.permissions = ROLE_PERMISSIONS[role];
  session.isLoading = false;
  return renderToStaticMarkup(
    createElement(RequirePermission, { permission, children: createElement('p', null, SCREEN) }),
  );
}

describe('client guard: direct URL by role', () => {
  it('opens Paramètres for owner, admin and accountant only', () => {
    for (const role of ['owner', 'admin', 'accountant'] as Role[]) {
      expect(renderWith(role, 'settings.read'), role).toContain(SCREEN);
    }
    for (const role of ['sales', 'viewer'] as Role[]) {
      const html = renderWith(role, 'settings.read');
      expect(html, role).not.toContain(SCREEN);
      expect(html, role).toMatch(DENIAL);
    }
  });

  it('opens the activity journal for owner, admin and accountant only', () => {
    for (const role of ['owner', 'admin', 'accountant'] as Role[]) {
      expect(renderWith(role, 'activity.read'), role).toContain(SCREEN);
    }
    for (const role of ['sales', 'viewer'] as Role[]) {
      const html = renderWith(role, 'activity.read');
      expect(html, role).not.toContain(SCREEN);
      expect(html, role).toMatch(DENIAL);
    }
  });

  it('keeps the user directory away from every role but owner and admin', () => {
    expect(renderWith('owner', 'users.read')).toContain(SCREEN);
    expect(renderWith('admin', 'users.read')).toContain(SCREEN);
    for (const role of ['accountant', 'sales', 'viewer'] as Role[]) {
      expect(renderWith(role, 'users.read'), role).not.toContain(SCREEN);
    }
  });

  it('refuses to render a page while the session is still loading', () => {
    session.permissions = ROLE_PERMISSIONS.owner;
    session.isLoading = true;
    const html = renderToStaticMarkup(
      createElement(RequirePermission, { permission: 'settings.read', children: createElement('p', null, SCREEN) }),
    );
    expect(html).not.toContain(SCREEN);
    session.isLoading = false;
  });
});

describe('route access matrix', () => {
  it('declares the permission that opens every screen', () => {
    expect(CLIENT_ROUTES.length).toBeGreaterThan(20);
    for (const route of CLIENT_ROUTES) {
      expect(route.path === 'profil' ? route.permission : typeof route.permission, route.path)
        .toBe(route.path === 'profil' ? null : 'string');
    }
  });

  it('matches the role matrix for every screen', () => {
    for (const route of CLIENT_ROUTES) {
      for (const role of ROLES) {
        const expected = route.permission === null
          || ROLE_PERMISSIONS[role].includes(route.permission);
        expect(canOpenPath(ROLE_PERMISSIONS[role], route.path), `${role} → ${route.path || '/'}`)
          .toBe(expected);
      }
    }
  });

  it('refuses the settings, user and journal screens to sales and read-only accounts', () => {
    for (const role of ['sales', 'viewer'] as Role[]) {
      for (const path of ['parametres', 'parametres/utilisateurs', 'journal']) {
        expect(canOpenPath(ROLE_PERMISSIONS[role], path), `${role} → ${path}`).toBe(false);
      }
    }
    for (const role of ['owner', 'admin', 'accountant'] as Role[]) {
      for (const path of ['parametres', 'journal']) {
        expect(canOpenPath(ROLE_PERMISSIONS[role], path), `${role} → ${path}`).toBe(true);
      }
    }
  });
});

describe('menu visibility by role', () => {
  const targets = (role: Role): string[] => visibleSections(
    (permission) => ROLE_PERMISSIONS[role].includes(permission),
  ).flatMap((section) => section.items.map((item) => item.to.split('?')[0]));

  it('never lists the settings or journal entry for sales and read-only accounts', () => {
    for (const role of ['sales', 'viewer'] as Role[]) {
      expect(targets(role), role).not.toContain('/parametres');
      expect(targets(role), role).not.toContain('/parametres/utilisateurs');
      expect(targets(role), role).not.toContain('/journal');
    }
  });

  it('lists them for owner, admin and accountant', () => {
    for (const role of ['owner', 'admin', 'accountant'] as Role[]) {
      expect(targets(role), role).toContain('/parametres');
      expect(targets(role), role).toContain('/journal');
    }
  });
});
