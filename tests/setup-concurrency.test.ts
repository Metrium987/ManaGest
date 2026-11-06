/**
 * A-23: one workspace, one installation, even under concurrency, plus a per-IP
 * budget on the two endpoints that need no session (`/install`, `/recover-owner`).
 * The routes are driven for real against SQLite through the D1 adapter.
 *
 * `ensureSchema` memoises its work per isolate, so the file provisions one
 * database and resets the mutable rows before each case rather than building a
 * second schema.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureSchema } from '../server/db';
import { setupRoutes } from '../server/routes/setup';
import { Hono } from 'hono';
import { ApiError } from '../server/lib/errors';
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
        database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: {} };
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
  return c.json({ code: api.code, details: api.details }, (api.status ?? 500) as 400);
});
app.route('/', setupRoutes);

const env = { DB: null as unknown as D1Database, OWNER_RECOVERY_TOKEN: undefined as string | undefined };
let database: DatabaseSync;

function payload(email = 'owner@example.test') {
  return {
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
    admin: { first_name: 'Test', last_name: 'Owner', email, password: 'ManaGest-Demo-2026!' },
    demo_data: false,
  };
}

function install(ip = '10.9.0.1', email = 'owner@example.test') {
  return app.request('/install', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(payload(email)),
  }, env as never);
}

function recover(ip: string, token: string, email = 'rescued@example.test') {
  return app.request('/recover-owner', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      'x-recovery-token': token,
    },
    body: JSON.stringify({ email, password: 'Sauvetage-Solide-2026!' }),
  }, env as never);
}

function count(sql: string): number {
  const row = database.prepare(sql).get() as { value: number };
  return row.value;
}

beforeAll(async () => {
  database = new DatabaseSync(':memory:');
  const d1 = asD1(database);
  await ensureSchema(d1);
  env.DB = d1;
});

beforeEach(() => {
  for (const table of ['sessions', 'users', 'company', 'tax_rates', 'login_attempts', 'app_meta']) {
    database.prepare(`DELETE FROM ${table}`).run();
  }
  env.OWNER_RECOVERY_TOKEN = undefined;
});

describe('installation is a singleton', () => {
  it('two concurrent installations: one company, the loser receives 409', async () => {
    const [first, second] = await Promise.all([install(), install()]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const loser = first.status === 409 ? first : second;
    expect((await loser.json() as { code: string }).code).toBe('ALREADY_CONFIGURED');

    expect(count('SELECT COUNT(*) AS value FROM company')).toBe(1);
    expect(count("SELECT COUNT(*) AS value FROM users WHERE role = 'owner'")).toBe(1);
  });

  it('refuses the sixth installation attempt from one address with 429', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await install('10.9.0.2')).status);
    }
    expect(statuses.slice(0, 5)).toEqual([201, 409, 409, 409, 409]);
    expect(statuses[5]).toBe(429);

    const blocked = await install('10.9.0.2');
    expect(blocked.status).toBe(429);
    const body = await blocked.json() as { code: string; details: { retry_after: string } };
    expect(body.code).toBe('TOO_MANY_ATTEMPTS');
    expect(Number(body.details.retry_after)).toBeGreaterThan(0);

    // The budget is per address: another host is not punished.
    expect((await install('10.9.0.3')).status).toBe(409);
  });
});

describe('owner recovery keeps its protection', () => {
  it('throttles a guessed token, while the valid one stays single-use', async () => {
    env.OWNER_RECOVERY_TOKEN = 'recovery-secret-for-test';
    expect((await install('10.9.0.4')).status).toBe(201);

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 6; attempt += 1) {
      statuses.push((await recover('10.9.0.5', 'wrong-token')).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);

    const first = await recover('10.9.0.6', 'recovery-secret-for-test');
    expect(first.status).toBe(200);

    const second = await recover('10.9.0.7', 'recovery-secret-for-test');
    expect(second.status).toBe(409);
    expect((await second.json() as { code: string }).code).toBe('RECOVERY_ALREADY_USED');
    expect(count("SELECT COUNT(*) AS value FROM app_meta WHERE key = 'owner_recovery_used'")).toBe(1);
  });
});
