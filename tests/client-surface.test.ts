import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_ROUTES, PUBLIC_ROUTES } from '@/lib/access';
import { NAV } from '@/components/layout/AppShell';

const app = readFileSync(join(process.cwd(), 'src/App.tsx'), 'utf8');
const shell = readFileSync(join(process.cwd(), 'src/components/layout/AppShell.tsx'), 'utf8');

function elementBlock(): string {
  const start = app.indexOf('const PAGE_ELEMENTS');
  return app.slice(start, app.indexOf('};', start));
}

describe('client surface inventory', () => {
  it('routes exactly the declared screens, and declares public routes explicitly', () => {
    const literalPaths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((match) => match[1]);
    expect(literalPaths.sort()).toEqual([...PUBLIC_ROUTES].sort());
    // Every protected screen comes from the manifest, so nothing can slip in unwrapped.
    expect(app).toContain('CLIENT_ROUTES.map');
    expect(app).toContain('<RequirePermission permission={route.permission}>');
  });

  it('has one element per declared screen and no orphan element', () => {
    const keys = [...elementBlock().matchAll(/^\s+'([^']*)':/gm)].map((match) => match[1]);
    expect(keys.sort()).toEqual(CLIENT_ROUTES.map((route) => route.path).sort());
  });

  it('imports no page component that is not routed', () => {
    const block = elementBlock();
    const publicPages = new Set(['LoginPage', 'SetupPage', 'PublicDocumentPage']);
    const imported = [...app.matchAll(/import \{ (\w+Page) \} from '@\/features\//g)]
      .map((match) => match[1])
      .filter((page) => !publicPages.has(page));
    expect(imported.length).toBeGreaterThan(20);
    for (const page of imported) {
      expect(block, `${page} imported but not routed`).toContain(`<${page} />`);
    }
  });

  it('gives every menu entry a routed screen with the same permission', () => {
    const byPath = new Map(CLIENT_ROUTES.map((route) => [`/${route.path}`, route]));
    for (const section of NAV) {
      for (const item of section.items) {
        const route = byPath.get(item.to.split('?')[0]);
        expect(route, `${item.to} is not declared in CLIENT_ROUTES`).toBeTruthy();
        expect(route!.permission, item.to).toBe(item.permission);
      }
    }
  });

  it('renders the menu through the permission filter, never the raw list', () => {
    expect(shell).toContain('visibleSections(can)');
    expect(shell).not.toContain('NAV.map(');
  });

  it('gates the settings entry of the account menu as well', () => {
    expect(shell).toMatch(/can\('settings\.read'\) \?[\s\S]{0,160}to="\/parametres"/);
  });
});
