import { PERMISSIONS, ROLE_PERMISSIONS, type Permission, type Role } from '../../shared/domain';
import { fail } from './errors';

export function permissionsForRole(role: Role): Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

export function hasPermission(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

export function assertPermission(role: Role, permission: Permission): void {
  if (!hasPermission(role, permission)) fail(403, 'FORBIDDEN');
}

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS as readonly string[]).includes(permission) && hasPermission(role, permission);
}
