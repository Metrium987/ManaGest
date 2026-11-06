/**
 * A-21: the security headers must describe the origin the browser really used.
 * Behind the platform proxy the Worker sees http, and the preview host serves an
 * iframe — so CSP/HSTS key off `x-forwarded-proto` and the host, and the framing
 * policy is one coherent choice per origin.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import app from '../server/worker';

type Row = Record<string, unknown>;

function asD1(raw: DatabaseSync): D1Database {
  const make = (sql: string, params: unknown[] = []): any => ({
    bind: (...args: unknown[]) => make(sql, args),
    first: async () => raw.prepare(sql).get(...(params as never[])) ?? null,
    all: async () => ({ results: raw.prepare(sql).all(...(params as never[])) as Row[], success: true, meta: {} }),
    run: async () => {
      const result = raw.prepare(sql).run(...(params as never[]));
      return { success: true, meta: { changes: Number(result.changes ?? 0) }, results: [] };
    },
  });
  return {
    prepare: (sql: string) => make(sql),
    batch: async (list: any[]) => Promise.all(list.map((item) => item.run())),
    exec: async (sql: string) => {
      raw.exec(sql);
      return { count: 0, duration: 0 };
    },
  } as unknown as D1Database;
}

let shared: ReturnType<typeof buildEnv> | null = null;

/** `ensureSchema` provisions once per isolate: the app tests share one database. */
function env() {
  if (!shared) shared = buildEnv();
  return shared as NonNullable<typeof shared>;
}

function buildEnv() {
  // The API paths run `withDatabase`, which provisions through the numbered
  // migrations; a schema built from SCHEMA_STATEMENTS would replay the ALTERs.
  const raw = new DatabaseSync(':memory:');
  return {
    DB: asD1(raw),
    ASSETS: {
      fetch: async () => new Response('<!doctype html><html lang="fr"><body></body></html>', {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      }),
    },
  } as never;
}

function request(target: string, headers: Record<string, string> = {}) {
  return app.request(target, { method: 'GET', headers }, env());
}

function csp(response: Response): string {
  return response.headers.get('content-security-policy') ?? '';
}

describe('A-21 security headers on the real origin', () => {
  it('an https document carries the full policy and refuses framing', async () => {
    const response = await request('https://app.example.pf/');
    expect(response.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('permissions-policy')).toBe('camera=(), microphone=(), geolocation=()');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');

    const policy = csp(response);
    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).toContain("img-src 'self' data: blob:");
    expect(policy).toContain("font-src 'self' data:");
    expect(policy).toContain("connect-src 'self'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain('frame-ancestors *');
  });

  it('an error answer keeps the same headers (404)', async () => {
    const response = await request('https://app.example.pf/api/does-not-exist');
    expect(response.status).toBe(404);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(csp(response)).toContain("frame-ancestors 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('a setup error keeps the same headers (409)', async () => {
    const response = await request('https://app.example.pf/api/accounting/journal');
    expect(response.status).toBe(409);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(csp(response)).toContain("default-src 'self'");
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('the preview origin may frame itself, and no other origin may', async () => {
    const response = await request('https://preview-abc.style.dev/');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-frame-options')).toBeNull();
    expect(csp(response)).toContain('frame-ancestors https://preview-abc.style.dev');
    expect(csp(response)).not.toContain("frame-ancestors 'none'");
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('the https policy is emitted behind the proxy (x-forwarded-proto)', async () => {
    const response = await request('http://internal.worker/', { 'x-forwarded-proto': 'https' });
    expect(response.status).toBe(200);
    expect(response.headers.get('strict-transport-security')).toBe('max-age=31536000; includeSubDomains');
    expect(csp(response)).toContain("frame-ancestors 'none'");
  });

  it('localhost keeps its development policy: nosniff, no HSTS, no CSP', async () => {
    const response = await request('http://localhost:8787/');
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('strict-transport-security')).toBeNull();
    expect(response.headers.get('content-security-policy')).toBeNull();
  });
});
