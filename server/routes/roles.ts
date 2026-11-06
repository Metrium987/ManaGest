import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/domain';
import { isSystemRole, parsePermissions, restrictToActor } from '../services/roles';
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
  // A-30: a delegated account manager cannot create a role wider than itself.
  if (!restrictToActor(actor.permissions, permissions)) return fail(403, 'SELF_ESCALATION');
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
  if (!restrictToActor(actor.permissions, permissions)) return fail(403, 'SELF_ESCALATION');
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

/**
 * Per-user permissions. The account keeps its fixed role as the reference, and a
 * custom role of its own carries the tailored list; both are written in one call
 * so an account is never half-configured. Editing twice updates the same row.
 */
roleRoutes.put('/user/:userId/permissions', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const userId = c.req.param('userId');
  const body = parseInput(
    z.object({ permissions: z.array(z.string().min(1).max(60)).max(200).default([]) }),
    await c.req.json().catch(() => ({})),
  );

  const target = await c.env.DB.prepare(
    `SELECT id, first_name, last_name, role, role_key FROM users WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(userId)
    .first<{ id: string; first_name: string; last_name: string; role: Role; role_key: string | null }>();
  if (!target) return fail(404, 'NOT_FOUND');
  // Only an owner may touch an owner, exactly like the user-management routes.
  if (target.role === 'owner' && actor.role !== 'owner') return fail(403, 'FORBIDDEN');

  const permissions = validatePermissions(body.permissions);
  const allowed = restrictToActor(actor.permissions, permissions);
  if (!allowed) return fail(403, 'SELF_ESCALATION');
  if (!allowed.length) return fail(422, 'VALIDATION_ERROR', { permissions: 'empty' });

  const key = `custom_${target.id.replace(/-/g, '').slice(0, 12)}`;
  const name = `${target.first_name} ${target.last_name}`.trim().slice(0, 52) + ' (sur mesure)';
  const now = nowISO();

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO roles (key, name, permissions, is_system, created_at, updated_at)
       VALUES (?, ?, ?, 0, ?, ?)
       ON CONFLICT(key) DO UPDATE SET name = excluded.name, permissions = excluded.permissions, updated_at = excluded.updated_at`,
    ).bind(key, name, JSON.stringify(allowed), now, now),
    c.env.DB.prepare(`UPDATE users SET role_key = ?, updated_at = ? WHERE id = ?`).bind(key, now, userId),
  ]);

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'updated', entityType: 'user', entityId: userId,
    summary: 'activity.role_assigned',
    meta: { role: name, previous: target.role_key ?? target.role, permissions: allowed.length },
  });

  return c.json({ role_key: key, permissions: allowed });
});

/** Drops the tailored list and gives the account its fixed role back. */
roleRoutes.delete('/user/:userId/permissions', requirePermission('users.write'), async (c) => {
  const actor = c.get('user')!;
  const userId = c.req.param('userId');
  const target = await c.env.DB.prepare(
    `SELECT id, role, role_key FROM users WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(userId)
    .first<{ id: string; role: Role; role_key: string | null }>();
  if (!target) return fail(404, 'NOT_FOUND');
  if (target.role === 'owner' && actor.role !== 'owner') return fail(403, 'FORBIDDEN');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET role_key = NULL, updated_at = ? WHERE id = ?`).bind(nowISO(), userId),
    c.env.DB.prepare(`DELETE FROM roles WHERE key = ? AND is_system = 0`).bind(target.role_key ?? ''),
  ]);

  await logActivity(c.env.DB, {
    userId: actor.id, action: 'updated', entityType: 'user', entityId: userId,
    summary: 'activity.role_assigned',
    meta: { role: target.role, previous: target.role_key ?? target.role },
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
  let nextPermissions: Permission[] = ROLE_PERMISSIONS[target.role];
  if (isSystemRole(body.role)) {
    nextRole = body.role;
    nextPermissions = ROLE_PERMISSIONS[body.role];
  } else {
    const custom = await c.env.DB.prepare(`SELECT key, permissions FROM roles WHERE key = ? AND is_system = 0`)
      .bind(body.role)
      .first<{ key: string; permissions: string }>();
    if (!custom) return fail(422, 'VALIDATION_ERROR', { role: 'unknown' });
    nextKey = body.role;
    nextPermissions = parsePermissions(custom.permissions);
  }
  // A-30: only an owner names an administrator, and nobody hands out a
  // permission they do not hold themselves (no self-escalation by role swap).
  if (actor.role !== 'owner' && (nextRole === 'owner' || nextRole === 'admin')) {
    return fail(403, 'SELF_ESCALATION');
  }
  if (nextPermissions.some((permission) => !actor.permissions.includes(permission))) {
    return fail(403, 'SELF_ESCALATION');
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
