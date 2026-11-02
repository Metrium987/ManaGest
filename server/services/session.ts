import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../shared/domain';
import { DEFAULT_SESSION_ABSOLUTE_HOURS, DEFAULT_SESSION_IDLE_MINUTES } from '../../shared/company-defaults';
import { nowISO } from '../db';
import { cookieValues } from '../lib/cookies';
import { randomToken, sha256Hex } from '../lib/crypto';
import { resolveUserPermissions } from './roles';
import type { AppEnv, AppSession, AuthenticatedUser, CompanyRow, SessionRow, UserRow } from '../types';

const IDLE_REFRESH_MS = 60_000;

interface CookieSecurity {
  secure: boolean;
  sameSite: 'None' | 'Lax';
  partitioned: boolean;
}

/**
 * Two contexts, two policies:
 *
 * - the preview panel embeds the app in a third-party frame reached over HTTPS
 *   through a local proxy, so the Worker only sees plain HTTP. A `Lax` cookie is
 *   never sent back there: login succeeds, then every authenticated call answers
 *   401. That frame gets `None; Secure; Partitioned` (CHIPS).
 * - a real deployment is visited first-party over HTTPS: it gets the ordinary
 *   `Lax; Secure` cookie, which every browser accepts. Exotic attributes are
 *   kept out of that path on purpose — a browser that drops them loses the
 *   session immediately after login.
 */
function cookieSecurity(c: Context<AppEnv>): CookieSecurity {
  const url = new URL(c.req.url);
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
  const host = (c.req.header('host') ?? '').toLowerCase();
  const https = url.protocol === 'https:' || forwarded === 'https' || host.endsWith('.style.dev');
  if (host.endsWith('.style.dev')) return { secure: true, sameSite: 'None', partitioned: true };
  if (https) return { secure: true, sameSite: 'Lax', partitioned: false };
  return { secure: false, sameSite: 'Lax', partitioned: false };
}

/** Every session token presented by this request, in header order. */
export function cookieCandidates(c: Context<AppEnv>, name: string): string[] {
  return cookieValues(c.req.header('cookie') ?? '', name);
}

/**
 * Resolves the session behind the request by trying every token the browser
 * sent. A user can hold a partitioned cookie from an earlier deployment next to
 * the current one; stopping at the first (dead) candidate answered 401 right
 * after a successful login.
 */
export async function loadSessionFromRequest(
  c: Context<AppEnv>,
): Promise<{ session: AppSession; user: UserRow } | null> {
  for (const token of cookieCandidates(c, SESSION_COOKIE)) {
    const loaded = await loadSession(c.env.DB, token);
    if (loaded) return loaded;
  }
  return null;
}

export async function createSession(
  c: Context<AppEnv>,
  user: UserRow,
  company: CompanyRow,
): Promise<AppSession> {
  const token = randomToken(32);
  const csrf = randomToken(24);
  const id = crypto.randomUUID();
  const now = Date.now();
  const idleMinutes = Math.max(5, company.session_idle_minutes || DEFAULT_SESSION_IDLE_MINUTES);
  const absoluteHours = Math.max(1, company.session_absolute_hours || DEFAULT_SESSION_ABSOLUTE_HOURS);
  const expiresAt = new Date(now + idleMinutes * 60_000).toISOString();
  const absoluteExpiresAt = new Date(now + absoluteHours * 3_600_000).toISOString();
  const tokenHash = await sha256Hex(token);

  const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? null;
  const userAgent = c.req.header('user-agent')?.slice(0, 250) ?? null;

  await c.env.DB.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, ip, user_agent, created_at, last_seen_at, expires_at, absolute_expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, tokenHash, csrf, ip, userAgent, nowISO(), nowISO(), expiresAt, absoluteExpiresAt)
    .run();

  const security = cookieSecurity(c);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    ...security,
    path: '/',
    maxAge: idleMinutes * 60,
  });
  setCookie(c, CSRF_COOKIE, csrf, {
    httpOnly: false,
    ...security,
    path: '/',
    maxAge: idleMinutes * 60,
  });

  return {
    id,
    token,
    csrf_secret: csrf,
    created_at: nowISO(),
    expires_at: expiresAt,
    absolute_expires_at: absoluteExpiresAt,
    user: await toAuthenticatedUser(c.env.DB, user),
  };
}

export async function loadSession(
  database: D1Database,
  token: string,
): Promise<{ session: AppSession; user: UserRow } | null> {
  const tokenHash = await sha256Hex(token);
  const row = await database
    .prepare(
      `SELECT s.id AS session_id, s.csrf_secret, s.created_at AS session_created_at,
              s.last_seen_at, s.expires_at, s.absolute_expires_at,
              u.id, u.email, u.first_name, u.last_name, u.role, u.role_key, u.is_active,
              u.mfa_secret, u.mfa_enabled, u.mfa_codes,
              u.password_hash, u.last_login_at, u.created_at, u.updated_at, u.deleted_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<
      SessionRow &
        UserRow & {
          session_id: string;
          session_created_at: string;
        }
    >();

  if (!row) return null;

  const now = nowISO();
  if (row.expires_at <= now || row.absolute_expires_at <= now) {
    await database.prepare(`DELETE FROM sessions WHERE id = ?`).bind(row.session_id).run();
    return null;
  }
  if (!row.is_active || row.deleted_at) return null;

  const elapsed = Date.now() - new Date(row.last_seen_at).getTime();
  let expiresAt = row.expires_at;
  if (elapsed > IDLE_REFRESH_MS) {
    const company = await database
      .prepare(`SELECT session_idle_minutes, session_absolute_hours FROM company LIMIT 1`)
      .first<{ session_idle_minutes: number; session_absolute_hours: number }>();
    const idleMinutes = Math.max(5, company?.session_idle_minutes ?? DEFAULT_SESSION_IDLE_MINUTES);
    const candidate = new Date(Date.now() + idleMinutes * 60_000).toISOString();
    expiresAt = candidate < row.absolute_expires_at ? candidate : row.absolute_expires_at;
    await database
      .prepare(`UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?`)
      .bind(now, expiresAt, row.session_id)
      .run();
  }

  const user: UserRow = {
    id: row.id,
    email: row.email,
    password_hash: row.password_hash,
    first_name: row.first_name,
    last_name: row.last_name,
    role: row.role,
    role_key: row.role_key ?? null,
    is_active: row.is_active,
    mfa_secret: row.mfa_secret,
    mfa_enabled: row.mfa_enabled,
    mfa_codes: row.mfa_codes,
    last_login_at: row.last_login_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at,
  };

  return {
    session: {
      id: row.session_id,
      token,
      csrf_secret: row.csrf_secret,
      created_at: row.session_created_at,
      expires_at: expiresAt,
      absolute_expires_at: row.absolute_expires_at,
      user: await toAuthenticatedUser(database, user),
    },
    user,
  };
}

export async function destroySession(c: Context<AppEnv>, sessionId: string): Promise<void> {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
  clearSessionCookies(c);
}

/**
 * Drops the cookies of the current browser. Both variants are emitted: the very
 * first deployment issued CHIPS cookies, and a browser keeps that copy next to
 * the plain one unless the delete carries the same attributes. A leftover
 * partitioned cookie is what kept sending a dead token before a fresh login.
 */
export function clearSessionCookies(c: Context<AppEnv>): void {
  const { secure } = cookieSecurity(c);
  for (const name of [SESSION_COOKIE, CSRF_COOKIE]) {
    deleteCookie(c, name, { path: '/' });
    if (secure) {
      deleteCookie(c, name, { path: '/', secure: true, sameSite: 'None', partitioned: true });
    }
  }
}

export async function currentUser(c: Context<AppEnv>): Promise<AuthenticatedUser | null> {
  const loaded = await loadSessionFromRequest(c);
  return loaded?.session.user ?? null;
}

export async function toAuthenticatedUser(database: D1Database, user: UserRow): Promise<AuthenticatedUser> {
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    permissions: await resolveUserPermissions(database, user),
  };
}
