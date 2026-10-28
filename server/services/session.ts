import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { CSRF_COOKIE, SESSION_COOKIE } from '../../shared/domain';
import { nowISO } from '../db';
import { randomToken, sha256Hex } from '../lib/crypto';
import { permissionsForRole } from '../lib/permissions';
import type { AppEnv, AppSession, AuthenticatedUser, CompanyRow, SessionRow, UserRow } from '../types';

const IDLE_REFRESH_MS = 60_000;

function isSecureRequest(c: Context<AppEnv>): boolean {
  const url = new URL(c.req.url);
  return url.protocol === 'https:';
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
  const idleMinutes = Math.max(5, company.session_idle_minutes || 30);
  const absoluteHours = Math.max(1, company.session_absolute_hours || 12);
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

  const secure = isSecureRequest(c);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: idleMinutes * 60,
  });
  setCookie(c, CSRF_COOKIE, csrf, {
    httpOnly: false,
    secure,
    sameSite: 'Lax',
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
    user: toAuthenticatedUser(user),
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
              u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
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
    const idleMinutes = Math.max(5, company?.session_idle_minutes ?? 30);
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
      user: toAuthenticatedUser(user),
    },
    user,
  };
}

export async function destroySession(c: Context<AppEnv>, sessionId: string): Promise<void> {
  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  deleteCookie(c, CSRF_COOKIE, { path: '/' });
}

export function clearSessionCookies(c: Context<AppEnv>): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  deleteCookie(c, CSRF_COOKIE, { path: '/' });
}

export async function currentUser(c: Context<AppEnv>): Promise<AuthenticatedUser | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return null;
  const loaded = await loadSession(c.env.DB, token);
  return loaded?.session.user ?? null;
}

export function toAuthenticatedUser(user: UserRow): AuthenticatedUser {
  return {
    id: user.id,
    email: user.email,
    first_name: user.first_name,
    last_name: user.last_name,
    role: user.role,
    permissions: permissionsForRole(user.role),
  };
}
