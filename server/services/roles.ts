import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/domain';

/**
 * The roles seam (T-202a). The five fixed roles keep their static matrix; a
 * custom role is a row whose permission list is stored. Nothing here changes
 * what a session may do today — the switch happens with T-202b, where an
 * account can actually be given a custom role, so authorisation cannot change
 * before there is a role to assign.
 */

export const SYSTEM_ROLES: Role[] = ['owner', 'admin', 'accountant', 'sales', 'viewer'];

export function isSystemRole(value: string): value is Role {
  return (SYSTEM_ROLES as string[]).includes(value);
}

/** A stored list is filtered against the declared permissions: a typo or a
 * permission removed from the code can never grant anything. */
export function parsePermissions(raw: string | null | undefined): Permission[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const resolved: Permission[] = [];
  for (const entry of parsed) {
    if (typeof entry !== 'string') continue;
    if (!(PERMISSIONS as readonly string[]).includes(entry)) continue;
    if (seen.has(entry)) continue;
    seen.add(entry);
    resolved.push(entry as Permission);
  }
  return resolved;
}

export function resolveRolePermissions(roleKey: string, storedJson: string | null | undefined): Permission[] {
  if (isSystemRole(roleKey)) return [...ROLE_PERMISSIONS[roleKey]];
  return parsePermissions(storedJson);
}

export async function loadRolePermissions(database: D1Database, roleKey: string): Promise<Permission[]> {
  if (isSystemRole(roleKey)) return [...ROLE_PERMISSIONS[roleKey]];
  const row = await database
    .prepare(`SELECT permissions FROM roles WHERE key = ?`)
    .bind(roleKey)
    .first<{ permissions: string }>();
  return parsePermissions(row?.permissions);
}

/** Seeds the five fixed roles so the matrix screen (T-202c) lists them. Idempotent. */
export async function ensureSystemRoles(database: D1Database, now: string): Promise<void> {
  await database.batch(
    SYSTEM_ROLES.map((role) =>
      database
        .prepare(
          `INSERT OR IGNORE INTO roles (key, name, permissions, is_system, created_at, updated_at)
           VALUES (?, ?, ?, 1, ?, ?)`,
        )
        .bind(role, role, JSON.stringify(ROLE_PERMISSIONS[role]), now, now),
    ),
  );
}
