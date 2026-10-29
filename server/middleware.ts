import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE, type Permission } from '../shared/domain';
import { ensureSchema } from './db';
import { constantTimeEqual } from './lib/crypto';
import { ApiError, fail } from './lib/errors';
import { loadSession } from './services/session';
import { verifyApiToken } from './services/api-tokens';
import type { AppEnv, CompanyRow } from './types';

/** Provisions the schema once per isolate and exposes typed bindings. */
export const withDatabase: MiddlewareHandler<AppEnv> = async (c, next) => {
  await ensureSchema(c.env.DB);
  c.set('db', c.env.DB);
  await next();
};

export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  // Responses from the static-assets binding have immutable headers, so every
  // header is written onto a fresh copy instead of the original object.
  const headers = new Headers(c.res.headers);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  const url = new URL(c.req.url);
  const isHttps = url.protocol === 'https:';
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (isHttps && !isLocal) {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    headers.set(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
  }
  if (url.pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }
  headers.set('X-Robots-Tag', 'noindex, nofollow');

  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
};

/**
 * Origin check for every unsafe request plus a session-bound token check.
 * SameSite cookies are defence in depth, not a substitute for this.
 */
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) return next();

  const origin = c.req.header('origin');
  if (origin) {
    let originHost: string;
    try {
      originHost = new URL(origin).host;
    } catch {
      return fail(403, 'CSRF_ORIGIN');
    }
    if (originHost !== new URL(c.req.url).host) return fail(403, 'CSRF_ORIGIN');
  }

  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const header = c.req.header(CSRF_HEADER);
    const cookieToken = getCookie(c, CSRF_COOKIE);
    if (!header || !cookieToken || !constantTimeEqual(header, cookieToken)) {
      return fail(403, 'CSRF_TOKEN');
    }
    const loaded = await loadSession(c.env.DB, token);
    if (!loaded) return fail(401, 'UNAUTHENTICATED');
    if (!constantTimeEqual(loaded.session.csrf_secret, header)) {
      return fail(403, 'CSRF_TOKEN');
    }
    c.set('session', loaded.session);
    c.set('user', loaded.session.user);
  }

  return next();
};

/** Loads the company record; used by every authenticated route. */
export async function loadCompany(database: D1Database): Promise<CompanyRow | null> {
  return database.prepare(`SELECT * FROM company LIMIT 1`).first<CompanyRow>();
}

/** Requires a valid session and an installed company. */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const company = await loadCompany(c.env.DB);
  if (!company) return fail(409, 'SETUP_REQUIRED');
  c.set('company', company);

  if (!c.get('session')) {
    // Named API token first (AUDIT §7 P0.6): `X-API-TOKEN`, as Invoice Ninja
    // does, or a Bearer token for convenience. The effective permissions are the
    // intersection of the token's abilities and its owner's current permissions.
    const presented = c.req.header('x-api-token')
      ?? (c.req.header('authorization')?.toLowerCase().startsWith('bearer ')
        ? c.req.header('authorization')!.slice(7).trim()
        : '');
    if (presented) {
      const verified = await verifyApiToken(c.env.DB, presented);
      if (!verified) return fail(401, 'INVALID_API_TOKEN');
      c.set('api_token', { id: verified.tokenId, name: verified.name });
      c.set('user', {
        id: verified.user.id,
        email: verified.user.email,
        first_name: verified.user.first_name,
        last_name: verified.user.last_name,
        role: verified.user.role,
        permissions: verified.permissions,
      });
      return next();
    }

    const cookie = getCookie(c, SESSION_COOKIE);
    if (!cookie) return fail(401, 'UNAUTHENTICATED');
    const loaded = await loadSession(c.env.DB, cookie);
    if (!loaded) return fail(401, 'UNAUTHENTICATED');
    c.set('session', loaded.session);
    c.set('user', loaded.session.user);
  }

  return next();
};

/** Route-level permission guard. */
export function requirePermission(permission: Permission): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) return fail(401, 'UNAUTHENTICATED');
    // T-202b: the guard reads the permissions resolved for this session, not the
    // role name. A fixed role resolves exactly as before; a custom role resolves
    // from its stored list.
    try {
      if (!user.permissions.includes(permission)) throw new ApiError(403, 'FORBIDDEN');
    } catch (error) {
      if (error instanceof ApiError) throw error;
      return fail(403, 'FORBIDDEN');
    }
    await next();
  };
}

export function clientIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
}
