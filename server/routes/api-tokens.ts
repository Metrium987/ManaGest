import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { getExtra } from '../lib/settings-extra';
import { parseInput } from '../lib/validation';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import { createApiToken, parseAbilities, sanitiseAbilities } from '../services/api-tokens';
import type { AppEnv } from '../types';

/**
 * API token management (AUDIT §7 P0.6). The value is displayed once, at creation.
 * A token-authenticated request may not create or revoke tokens: that would let a
 * narrow credential mint a wider one.
 */
export const apiTokenRoutes = new Hono<AppEnv>();
apiTokenRoutes.use('*', requireAuth);

function refuseTokenAuth(c: { get: (key: 'api_token') => unknown }): void {
  if (c.get('api_token')) fail(403, 'TOKEN_SCOPE');
}

apiTokenRoutes.get('/', requireAuth, async (c) => {
  refuseTokenAuth(c);
  const user = c.get('user')!;
  const canSeeAll = user.permissions.includes('users.write');
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.user_id, t.name, t.prefix, t.abilities, t.created_at, t.last_used_at, t.expires_at, t.revoked_at,
            u.email AS user_email
     FROM api_tokens t JOIN users u ON u.id = t.user_id
     ${canSeeAll ? '' : 'WHERE t.user_id = ?'}
     ORDER BY t.created_at DESC LIMIT 200`,
  ).bind(...(canSeeAll ? [] : [user.id])).all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, abilities: parseAbilities(row.abilities as string) })),
  });
});

apiTokenRoutes.post('/', requireAuth, async (c) => {
  refuseTokenAuth(c);
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      name: z.string().trim().min(2).max(60),
      abilities: z.array(z.string().min(1).max(60)).max(60).default([]),
      lifetime_days: z.coerce.number().int().min(1).max(3650).optional(),
    }),
    await c.req.json().catch(() => ({})),
  );

  // The session already resolved this user's permissions (custom roles included),
  // so the narrowing check uses that set and never re-derives a role name.
  const owned = user.permissions;
  const requested = body.abilities.length ? body.abilities : owned;
  const abilities = sanitiseAbilities(requested, owned);
  if (!abilities.length) return fail(422, 'VALIDATION_ERROR', { abilities: 'empty' });

  const lifetime = body.lifetime_days
    ?? (Number(await getExtra(c.env.DB, 'api_token_lifetime_days')) || 365);
  const maxPerUser = Number(await getExtra(c.env.DB, 'api_token_max_per_user')) || 10;

  const result = await createApiToken(c.env.DB, {
    userId: user.id,
    name: body.name,
    abilities,
    createdBy: user.id,
    lifetimeDays: lifetime,
    maxPerUser,
  });
  if ('error' in result) return fail(409, 'TOKEN_LIMIT_REACHED');

  await logActivity(c.env.DB, {
    userId: user.id, action: 'created', entityType: 'api_token', entityId: result.id,
    summary: 'activity.api_token_created',
    meta: { name: body.name, abilities: result.abilities.length, expires_at: result.expires_at },
    ip: clientIp(c),
  });

  // The plaintext value appears exactly once, in this response.
  return c.json({
    id: result.id,
    value: result.value,
    prefix: result.prefix,
    abilities: result.abilities,
    expires_at: result.expires_at,
  }, 201);
});

apiTokenRoutes.delete('/:id', requireAuth, async (c) => {
  refuseTokenAuth(c);
  const user = c.get('user')!;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT id, user_id, name, revoked_at FROM api_tokens WHERE id = ?`)
    .bind(id)
    .first<{ id: string; user_id: string; name: string; revoked_at: string | null }>();
  if (!row) return fail(404, 'NOT_FOUND');
  const isAdmin = user.permissions.includes('users.write');
  if (row.user_id !== user.id && !isAdmin) return fail(403, 'FORBIDDEN');
  if (row.revoked_at) return c.json({ ok: true, already: true });

  await c.env.DB.prepare(`UPDATE api_tokens SET revoked_at = ? WHERE id = ?`).bind(nowISO(), id).run();
  await logActivity(c.env.DB, {
    userId: user.id, action: 'revoked', entityType: 'api_token', entityId: id,
    summary: 'activity.api_token_revoked', meta: { name: row.name }, ip: clientIp(c),
  });
  return c.json({ ok: true });
});

/** Admin-only listing of every token in the workspace. */
apiTokenRoutes.get('/all', requirePermission('users.read'), async (c) => {
  refuseTokenAuth(c);
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.name, t.prefix, t.abilities, t.created_at, t.last_used_at, t.expires_at, t.revoked_at,
            u.email AS user_email
     FROM api_tokens t JOIN users u ON u.id = t.user_id ORDER BY t.created_at DESC LIMIT 200`,
  ).all<Record<string, unknown>>();
  return c.json({ data: (rows.results ?? []).map((row) => ({ ...row, abilities: parseAbilities(row.abilities as string) })) });
});
