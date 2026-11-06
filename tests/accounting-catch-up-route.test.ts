import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { requirePermission } from '../server/middleware';
import { ApiError } from '../server/lib/errors';
import { permissionsForRole } from '../server/lib/permissions';
import type { AppEnv } from '../server/types';

/** A-18: the repair/catch-up guard is `accounting.write`. This exercises the same
 * middleware the route registers, with an owner (allowed) and a viewer (refused);
 * `tests/permissions.test.ts` pins `accountingRoutes.post('/catch-up', requirePermission('accounting.write'), …)`
 * in the route file itself. */
function appFor(role: 'owner' | 'viewer') {
  const app = new Hono<AppEnv>();
  app.onError((error, c) => error instanceof ApiError
    ? c.json({ error: error.code }, error.status as never)
    : c.json({ error: 'INTERNAL' }, 500));
  app.use('*', async (c, next) => {
    c.set('user', { id: 'user-1', role, permissions: permissionsForRole(role) } as never);
    await next();
  });
  app.post('/catch-up', requirePermission('accounting.write'), (c) => c.json({ ok: true }));
  return app;
}

describe('A-18 the catch-up route is reserved to accounting.write', () => {
  it('an owner may run the catch-up', async () => {
    const response = await appFor('owner').request('/catch-up', { method: 'POST' });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('a viewer is refused with 403', async () => {
    const response = await appFor('viewer').request('/catch-up', { method: 'POST' });
    expect(response.status).toBe(403);
  });
});
