import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { requireAuth } from '../middleware';
import type { AppEnv } from '../types';
import type { Permission } from '../../shared/domain';

/**
 * Saved filters (T-206). A filter is a named query string for one list, stored
 * per workspace. Reads and writes both require the permission of the list they
 * belong to, so a saved filter can never become a way to reach data the session
 * could not open by hand.
 *
 * That permission depends on the requested list, so it is applied inside the
 * handler through `requirePermission(LIST_PERMISSIONS[list])`; `requireAuth` on
 * the route line is what the route-guard invariant test can see statically.
 */
const LIST_PERMISSIONS = {
  clients: 'clients.read',
  invoices: 'invoices.read',
  quotes: 'quotes.read',
  payments: 'payments.read',
  expenses: 'expenses.read',
  vendors: 'vendors.read',
  products: 'products.read',
  purchase_orders: 'purchase_orders.read',
  projects: 'projects.read',
  tasks: 'tasks.read',
  bank: 'bank.read',
} as const satisfies Record<string, Permission>;

type ListKey = keyof typeof LIST_PERMISSIONS;
const LIST_KEYS = Object.keys(LIST_PERMISSIONS) as [ListKey, ...ListKey[]];

export const filterRoutes = new Hono<AppEnv>();
filterRoutes.use('*', requireAuth);

function requireListPermission(c: { get: (key: 'user') => { permissions: string[] } | undefined }, permission: string): void {
  const user = c.get('user');
  if (!user) {
    fail(401, 'UNAUTHENTICATED');
  } else if (!user.permissions.includes(permission)) {
    fail(403, 'FORBIDDEN');
  }
}

filterRoutes.get('/', requireAuth, async (c) => {
  const list = c.req.query('list') ?? '';
  const permission = LIST_PERMISSIONS[list as ListKey];
  if (!permission) return fail(422, 'VALIDATION_ERROR', { list: 'unknown' });
  requireListPermission(c, permission);
  const rows = await c.env.DB.prepare(
    `SELECT id, list_key, name, query, created_at FROM saved_filters WHERE list_key = ? ORDER BY name COLLATE NOCASE ASC`,
  ).bind(list).all();
  return c.json({ data: rows.results ?? [] });
});

filterRoutes.post('/', requireAuth, async (c) => {
  const body = parseInput(
    z.object({
      list: z.enum(LIST_KEYS),
      name: z.string().trim().min(1).max(60),
      query: z.string().trim().max(500).default(''),
    }),
    await c.req.json().catch(() => ({})),
  );
  requireListPermission(c, LIST_PERMISSIONS[body.list]);
  const user = c.get('user')!;
  await c.env.DB.prepare(
    `INSERT INTO saved_filters (id, list_key, name, query, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(list_key, name) DO UPDATE SET query = excluded.query`,
  ).bind(crypto.randomUUID(), body.list, body.name, body.query, user.id, nowISO()).run();
  const row = await c.env.DB.prepare(
    `SELECT id, list_key, name, query, created_at FROM saved_filters WHERE list_key = ? AND name = ?`,
  ).bind(body.list, body.name).first();
  return c.json(row, 201);
});

filterRoutes.delete('/:id', requireAuth, async (c) => {
  const row = await c.env.DB.prepare(`SELECT list_key FROM saved_filters WHERE id = ?`)
    .bind(c.req.param('id')).first<{ list_key: ListKey }>();
  if (!row) return fail(404, 'NOT_FOUND');
  const permission = LIST_PERMISSIONS[row.list_key];
  if (!permission) return fail(404, 'NOT_FOUND');
  requireListPermission(c, permission);
  await c.env.DB.prepare(`DELETE FROM saved_filters WHERE id = ?`).bind(c.req.param('id')).run();
  return c.body(null, 204);
});
