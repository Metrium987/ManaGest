import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/domain';
import { isSystemRole } from '../services/roles';
import type { AppEnv } from '../types';

/**
 * Custom roles (T-202b). The five fixed roles are listed but never editable:
 * they are the contract the route guards were written against. A custom role is
 * a stored permission list, and an account carries it in `users.role_key`.
 */
export const roleRoutes = new Hono<AppEnv>();
roleRoutes.use('*', requireAuth);

const roleSchema = z.object({
  name: z.string().trim().min(2).max(60),
  permissions: z.array(z.string().min(1).max(60)).max(200).default([]),
});

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

/** Every requested permission must exist in the code; a typo is a 422, not a silent narrowing. */
function validatePermissions(values: string[]): Permission[] {
  const unknown = values.find((value) => !(PERMISSIONS as readonly string[]).includes(value));
  if (unknown) return fail(422, 'UNKNOWN_PERMISSION', { permission: unknown }) as never;
  return [...new Set(values)] as Permission[];
}

interface RoleRow {
  key: string;
  name: string;
  permissions: string;
  is_system: number;
}

roleRoutes.get('/', requirePermission('users.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT r.key, r.name, r.permissions, r.is_system,
            (SELECT COUNT(*) FROM users u WHERE u.deleted_at IS NULL AND u.role_key = r.key) AS users
       FROM roles r ORDER BY r.is_system DESC, r.name ASC`,
  ).all<RoleRow & { users: number }>();

  return c.json({
    roles: (rows.results ?? []).map((row) => ({
      key: row.key,
      name: row.name,
      is_system: row.is_system,
      users: row.users,
      permissions: isSystemRole(row.key) ? ROLE_PERMISSIONS[row.key as Role] : JSON.parse(row.permissions),
    })),
  });
});

roleRoutes.post('/', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const body = parseInput(roleSchema, await c.req.json().catch(() => ({})));
  const key = slugify(body.name);
  if (!key) return fail(422, 'VALIDATION_ERROR', { name: 'invalid' });
  if (isSystemRole(key)) return fail(409, 'SYSTEM_ROLE');
  const existing = await c.env.DB.prepare(`SELECT key FROM roles WHERE key = ?`).bind(key).first();
  if (existing) return fail(409, 'ROLE_EXISTS');

  const permissions = validatePermissions(body.permissions);
  await c.env.DB.prepare(
    `INSERT INTO roles (key, name, permissions, is_system, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)`,
  ).bind(key, body.name, JSON.stringify(permissions), nowISO(), nowISO()).run();

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'created', entityType: 'role', entityId: key,
    summary: 'activity.role_created', meta: { name: body.name, permissions: permissions.length },
  });
  return c.json({ key, name: body.name, permissions }, 201);
});

roleRoutes.patch('/:key', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const key = c.req.param('key');
  if (isSystemRole(key)) return fail(409, 'SYSTEM_ROLE');
  const body = parseInput(roleSchema, await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(`SELECT key FROM roles WHERE key = ?`).bind(key).first();
  if (!existing) return fail(404, 'NOT_FOUND');

  const permissions = validatePermissions(body.permissions);
  await c.env.DB.prepare(`UPDATE roles SET name = ?, permissions = ?, updated_at = ? WHERE key = ? AND is_system = 0`)
    .bind(body.name, JSON.stringify(permissions), nowISO(), key).run();

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'updated', entityType: 'role', entityId: key,
    summary: 'activity.role_updated', meta: { name: body.name, permissions: permissions.length },
  });
  return c.json({ ok: true });
});

roleRoutes.delete('/:key', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const key = c.req.param('key');
  if (isSystemRole(key)) return fail(409, 'SYSTEM_ROLE');
  const assigned = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM users WHERE role_key = ? AND deleted_at IS NULL`,
  ).bind(key).first<{ count: number }>();
  if ((assigned?.count ?? 0) > 0) return fail(409, 'ROLE_IN_USE');

  await c.env.DB.prepare(`DELETE FROM roles WHERE key = ? AND is_system = 0`).bind(key).run();
  await logActivity(c.env.DB, {
    userId: actor.id, action: 'deleted', entityType: 'role', entityId: key,
    summary: 'activity.role_deleted',
  });
  return c.body(null, 204);
});

/** Assigns a fixed or custom role to an account. */
roleRoutes.patch('/assign/:userId', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const userId = c.req.param('userId');
  const body = parseInput(
    z.object({ role: z.string().trim().min(1).max(40) }),
    await c.req.json().catch(() => ({})),
  );

  const target = await c.env.DB.prepare(`SELECT id, role, role_key FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(userId)
    .first<{ id: string; role: Role; role_key: string | null }>();
  if (!target) return fail(404, 'NOT_FOUND');

  let nextRole: Role = target.role;
  let nextKey: string | null = null;
  if (isSystemRole(body.role)) {
    nextRole = body.role;
  } else {
    const custom = await c.env.DB.prepare(`SELECT key FROM roles WHERE key = ? AND is_system = 0`)
      .bind(body.role)
      .first();
    if (!custom) return fail(422, 'VALIDATION_ERROR', { role: 'unknown' });
    nextKey = body.role;
  }

  // Removing the last owner would lock the workspace out of its own settings.
  if (target.role === 'owner' && nextRole !== 'owner') {
    const owners = await c.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND is_active = 1 AND deleted_at IS NULL`,
    ).first<{ count: number }>();
    if ((owners?.count ?? 0) <= 1) return fail(409, 'LAST_OWNER');
  }

  await c.env.DB.prepare(`UPDATE users SET role = ?, role_key = ?, updated_at = ? WHERE id = ?`)
    .bind(nextRole, nextKey, nowISO(), userId).run();

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'updated', entityType: 'user', entityId: userId,
    summary: 'activity.role_assigned',
    meta: { role: nextKey ?? nextRole, previous: target.role_key ?? target.role },
  });

  return c.json({ ok: true, role: nextKey ?? nextRole });
});
