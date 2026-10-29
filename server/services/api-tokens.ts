import { nowISO } from '../db';
import { sha256Hex, randomToken } from '../lib/crypto';
import { resolveUserPermissions } from './roles';
import type { Permission } from '../../shared/domain';
import type { UserRow } from '../types';

/**
 * Named API tokens (AUDIT §7 P0.6), inspired by Invoice Ninja's company token
 * (a credential bound to a user and presented in `X-API-TOKEN`) with the two
 * controls Invoice Ninja does not have: **per-token abilities** and **expiry**.
 *
 * Only the SHA-256 digest is stored; the value is returned once at creation.
 * Every default (lifetime, maximum per account) is a setting, not a constant in
 * this file — see `lib/settings-extra.ts`.
 */

export interface ApiTokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  token_hash: string;
  abilities: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
}

const TOKEN_PREFIX = 'mg';

/** `mg_<8-char prefix>_<43-char secret>` — the prefix is safe to display. */
export function newTokenValue(): { value: string; prefix: string } {
  const secret = randomToken(32);
  const prefix = secret.slice(0, 8);
  return { value: `${TOKEN_PREFIX}_${prefix}_${secret}`, prefix };
}

export function expiryFrom(days: number, from = new Date()): string | null {
  if (!Number.isFinite(days) || days <= 0) return null;
  return new Date(from.getTime() + days * 86_400_000).toISOString();
}

/** A token can never grant more than its creator holds. */
export function sanitiseAbilities(requested: readonly string[], allowed: readonly Permission[]): Permission[] {
  const set = new Set(allowed as readonly string[]);
  const seen = new Set<string>();
  const resolved: Permission[] = [];
  for (const entry of requested) {
    if (!set.has(entry) || seen.has(entry)) continue;
    seen.add(entry);
    resolved.push(entry as Permission);
  }
  return resolved;
}

export interface VerifiedToken {
  tokenId: string;
  name: string;
  user: UserRow;
  permissions: Permission[];
}

export async function createApiToken(
  database: D1Database,
  input: {
    userId: string;
    name: string;
    abilities: readonly string[];
    createdBy: string;
    lifetimeDays: number;
    maxPerUser: number;
  },
): Promise<{ id: string; value: string; prefix: string; abilities: Permission[]; expires_at: string | null } | { error: 'MAX_REACHED' }> {
  const active = await database
    .prepare(`SELECT COUNT(*) AS count FROM api_tokens WHERE user_id = ? AND revoked_at IS NULL`)
    .bind(input.userId)
    .first<{ count: number }>();
  if ((active?.count ?? 0) >= input.maxPerUser) return { error: 'MAX_REACHED' };

  const user = await database
    .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL`)
    .bind(input.userId)
    .first<UserRow>();
  if (!user) return { error: 'MAX_REACHED' };

  const allowed = await resolveUserPermissions(database, user);
  const abilities = sanitiseAbilities(input.abilities, allowed);
  const { value, prefix } = newTokenValue();
  const id = crypto.randomUUID();
  const expiresAt = expiryFrom(input.lifetimeDays);

  await database
    .prepare(
      `INSERT INTO api_tokens (id, user_id, name, prefix, token_hash, abilities, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.userId, input.name, prefix, await sha256Hex(value), JSON.stringify(abilities), input.createdBy, nowISO(), expiresAt)
    .run();

  return { id, value, prefix, abilities, expires_at: expiresAt };
}

export async function verifyApiToken(
  database: D1Database,
  rawToken: string,
): Promise<VerifiedToken | null> {
  if (!rawToken || rawToken.length > 200) return null;
  const row = await database
    .prepare(`SELECT * FROM api_tokens WHERE token_hash = ?`)
    .bind(await sha256Hex(rawToken))
    .first<ApiTokenRow>();
  if (!row || row.revoked_at) return null;
  if (row.expires_at && row.expires_at <= nowISO()) return null;

  const user = await database
    .prepare(`SELECT * FROM users WHERE id = ? AND deleted_at IS NULL AND is_active = 1`)
    .bind(row.user_id)
    .first<UserRow>();
  if (!user) return null;

  // The effective set is the intersection: a token narrowed to `invoices.read`
  // stays narrowed even if its owner is promoted later.
  const owned = await resolveUserPermissions(database, user);
  const permissions = sanitiseAbilities(parseAbilities(row.abilities), owned);

  const lastSeen = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
  if (Date.now() - lastSeen > 60_000) {
    await database.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).bind(nowISO(), row.id).run();
  }

  return { tokenId: row.id, name: row.name, user, permissions };
}

export function parseAbilities(raw: string | null | undefined): Permission[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is Permission => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}
