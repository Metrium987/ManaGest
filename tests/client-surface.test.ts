import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CLIENT_ROUTES, PUBLIC_ROUTES } from '@/lib/access';
import { NAV } from '@/components/layout/AppShell';
import { entryTrace } from '@/lib/accounting-trace';

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
    const publicPages = new Set([
      'LoginPage', 'SetupPage', 'PublicDocumentPage', 'ForgotPasswordPage', 'ResetPasswordPage',
    ]);
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

  it('gives every detail drawer the record it is about', () => {
    const root = join(process.cwd(), 'src/features');
    const files = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => file.endsWith('.tsx'))
      .map((file) => join(root, file));
    const drawers = files.filter((file) => readFileSync(file, 'utf8').includes('showRecord({'));
    expect(drawers.length).toBeGreaterThan(8);
    for (const file of drawers) {
      const text = readFileSync(file, 'utf8');
      const calls = (text.match(/showRecord\(\{/g) ?? []).length;
      const traces = (text.match(/trace:/g) ?? []).length;
      expect(traces, `${file}: ${calls} drawer(s) without a traced record`).toBeGreaterThanOrEqual(calls);
    }
  });

  it('gives every detail page the activity trail', () => {
    const root = join(process.cwd(), 'src/features');
    const pages = (readdirSync(root, { recursive: true }) as string[])
      .filter((file) => /DetailPage\.tsx$/.test(file))
      .map((file) => join(root, file));
    expect(pages.length).toBeGreaterThan(2);
    for (const file of pages) {
      expect(readFileSync(file, 'utf8'), `${file} has no ActivityTrail`).toContain('<ActivityTrail');
    }
  });

  it('only traces entity types the server journals', () => {
    const serverTypes = new Set<string>();
    for (const directory of ['server/routes', 'server/services']) {
      const root = join(process.cwd(), directory);
      for (const file of (readdirSync(root, { recursive: true }) as string[]).filter((n) => n.endsWith('.ts'))) {
        const text = readFileSync(join(root, file), 'utf8');
        for (const match of text.matchAll(/entityType: '([a-z_]+)'/g)) serverTypes.add(match[1]);
      }
    }
    const clientTypes = new Set<string>();
    const root = join(process.cwd(), 'src/features');
    for (const file of (readdirSync(root, { recursive: true }) as string[]).filter((n) => n.endsWith('.tsx'))) {
      const text = readFileSync(join(root, file), 'utf8');
      for (const match of text.matchAll(/trace: \{ entityType: '([a-z_]+)'/g)) clientTypes.add(match[1]);
      for (const match of text.matchAll(/<ActivityTrail entityType="([a-z_]+)"/g)) clientTypes.add(match[1]);
    }
    expect(clientTypes.size).toBeGreaterThan(10);
    for (const type of clientTypes) expect(serverTypes, `unknown entity type ${type}`).toContain(type);
    const mapped = [
      ...['invoice', 'credit', 'payment', 'expense'].map((source) => entryTrace({ source_type: source, source_id: 'x' })),
      entryTrace({ source_type: 'opening', source_id: 'x' }),
    ].filter((ref): ref is { entityType: string; entityId: string } => Boolean(ref));
    expect(mapped.length).toBe(5);
    for (const ref of mapped) expect(serverTypes, `accounting maps to unjournalled ${ref.entityType}`).toContain(ref.entityType);
  });

  it('gates the settings entry of the account menu as well', () => {
    expect(shell).toMatch(/can\('settings\.read'\) \?[\s\S]{0,160}to="\/parametres"/);
  });
});
