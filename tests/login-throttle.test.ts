/**
 * A-20: login throttling. The account quota (8 failures / 15 min) stops a cheap
 * targeted lockout, the IP quota (50 failures / 15 min) stops one host spraying
 * accounts, and the failure is recorded by a single conditional INSERT so
 * concurrent attempts cannot overshoot either quota.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../server/db';
import { authRoutes } from '../server/routes/auth';
import { Hono } from 'hono';
import { ApiError } from '../server/lib/errors';
import { setupRoutes } from '../server/routes/setup';
import { purgeLoginAttempts } from '../server/lib/limits';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_VAT_REGIMES,
  ENTITY_CATEGORIES,
  LEGAL_FORMS,
} from '../shared/client-profile';

type Row = Record<string, unknown>;

function asD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => ({ results: database.prepare(sql).all(...(params as never[])) as Row[] }),
      first: async () => (database.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null,
      run: async () => {
        const result = database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: { changes: Number(result.changes ?? 0) } };
      },
    });
    return bind([]);
  };
  return {
    prepare,
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

const app = new Hono();
app.onError((error, c) => {
  const api = error as ApiError;
  if (api.status === 429 && api.details?.retry_after) {
    c.header('Retry-After', api.details.retry_after);
  }
  return c.json({ code: api.code, details: api.details }, (api.status ?? 500) as 400);
});
app.route('/', authRoutes);

const ADMIN_EMAIL = 'owner@example.test';
const PASSWORD = 'ManaGest-Demo-2026!';
const env = {} as unknown as { DB: D1Database };

let database: DatabaseSync;
let d1: D1Database;
let installed = false;

/** `ensureSchema` provisions once per isolate, so the workspace is installed
 * once and each test starts from an empty attempt/journal history. */
async function ready() {
  if (!installed) await install();
  database.prepare(`DELETE FROM login_attempts`).run();
  database.prepare(`DELETE FROM activities WHERE action = 'login_blocked'`).run();
}

async function install() {
  database = new DatabaseSync(':memory:');
  d1 = asD1(database);
  await ensureSchema(d1);
  env.DB = d1;

  const response = await setupRoutes.request('/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      company: {
        name: 'ManaGest Test',
        legal_name: 'ManaGest Test SARL',
        entity_category: ENTITY_CATEGORIES[0],
        legal_form: LEGAL_FORMS[0],
        tax_id: 'T12345',
        po_box_municipality: 'Papeete',
        postal_code: '98714',
        vat_regime_detail: CLIENT_VAT_REGIMES[0],
        payment_method: CLIENT_PAYMENT_METHODS[0],
        payment_terms_code: CLIENT_PAYMENT_TERMS[0],
        data_consent_accepted: true,
      },
      admin: { first_name: 'Test', last_name: 'Owner', email: ADMIN_EMAIL, password: PASSWORD },
      demo_data: false,
    }),
  }, env as never);
  if (response.status !== 201) throw new Error(`installation ${response.status}`);
  installed = true;
}

function login(password: string, email = ADMIN_EMAIL, ip = '10.0.0.1') {
  return app.request('/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ email, password }),
  }, env as never);
}

function failureCount(email = ADMIN_EMAIL): number {
  return Number(
    (database.prepare(
      `SELECT COUNT(*) AS n FROM login_attempts WHERE email = ? AND successful = 0`,
    ).get(email) as { n: number }).n,
  );
}

describe('A-20 login throttling', () => {
  it('the account quota answers 429 with Retry-After, then reopens after the window', async () => {
    await ready();
    for (let attempt = 0; attempt < 8; attempt += 1) {
      expect((await login('wrong-password')).status).toBe(401);
    }
    expect(failureCount()).toBe(8);

    const blocked = await login('wrong-password');
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(15 * 60);
    expect((await blocked.json() as { code: string }).code).toBe('TOO_MANY_ATTEMPTS');

    // Even the right password waits: the quota is checked before the lookup.
    expect((await login(PASSWORD)).status).toBe(429);

    // Window expiry: the failures are older than 15 minutes.
    database.prepare(
      `UPDATE login_attempts SET created_at = '2020-01-01T00:00:00.000Z' WHERE successful = 0`,
    ).run();
    const reopened = await login(PASSWORD);
    expect(reopened.status).toBe(200);
  });

  it('the IP quota blocks a host spraying many accounts', async () => {
    await ready();
    for (let account = 0; account < 50; account += 1) {
      const response = await login('wrong-password', `target-${account}@example.test`, '203.0.113.9');
      expect(response.status).toBe(401);
    }
    const blocked = await login('wrong-password', 'target-51@example.test', '203.0.113.9');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toBeTruthy();

    // Another address is unaffected by that host's quota.
    const elsewhere = await login('wrong-password', 'target-51@example.test', '203.0.113.10');
    expect(elsewhere.status).toBe(401);
  });

  it('twenty simultaneous attempts record exactly the remaining quota', async () => {
    await ready();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () => login('wrong-password')),
    );
    const statuses = responses.map((response) => response.status);
    expect(statuses.filter((status) => status === 401)).toHaveLength(8);
    expect(statuses.filter((status) => status === 429)).toHaveLength(12);
    expect(failureCount()).toBe(8);
  });

  it('a refusal is journalled without the full address or the password', async () => {
    await ready();
    for (let attempt = 0; attempt < 8; attempt += 1) await login('wrong-password');
    await login('wrong-password');

    const rows = database
      .prepare(`SELECT entity_id, meta FROM activities WHERE action = 'login_blocked'`)
      .all() as { entity_id: string; meta: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_id).toBe('o***@example.test');
    expect(rows[0].meta).not.toContain(PASSWORD);
    expect(rows[0].meta).not.toContain(ADMIN_EMAIL);
  });

  it('the daily purge drops attempts past the retention window', async () => {
    await ready();
    await login('wrong-password');
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    database.prepare(`UPDATE login_attempts SET created_at = ?`).run(old);

    expect(await purgeLoginAttempts(d1)).toBe(1);
    expect(failureCount()).toBe(0);
  });
});
