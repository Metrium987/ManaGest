/**
 * A-25: the data-health card and the public health answer, driven through the
 * real worker routes. A gap is injected in the database, the dashboard and
 * `/api/health` must both see it, and the public answer must carry no personal
 * data. `ensureSchema` memoises per isolate, so the file keeps one database.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureSchema } from '../server/db';
import worker from '../server/worker';
import { hashPassword } from '../server/lib/crypto';
import { purgeExpired } from '../server/lib/retention';
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

const EMAIL = 'owner@example.test';
const PASSWORD = 'ManaGest-Demo-2026!';
const env = { DB: null as unknown as D1Database };
let database: DatabaseSync;
let cookie = '';

function post(path: string, body: unknown, session?: string) {
  return worker.request(`https://app.example.pf${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': '10.5.0.1',
      ...(session ? { cookie: session } : {}),
    },
    body: JSON.stringify(body),
  }, env as never);
}

function get(path: string, session: string) {
  return worker.request(`https://app.example.pf${path}`, {
    headers: { cookie: session, 'x-forwarded-for': '10.5.0.1' },
  }, env as never);
}

function cookieOf(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = /mg_session=([^;]+)/.exec(raw);
  if (!match) throw new Error(`session absente: ${raw}`);
  return `mg_session=${match[1]}`;
}

beforeAll(async () => {
  database = new DatabaseSync(':memory:');
  const d1 = asD1(database);
  await ensureSchema(d1);
  env.DB = d1;

  const installed = await post('/api/setup/install', {
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
    admin: { first_name: 'Test', last_name: 'Owner', email: EMAIL, password: PASSWORD },
    demo_data: false,
  });
  if (installed.status !== 201) throw new Error(`installation ${installed.status}`);

  const login = await post('/api/auth/login', { email: EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  cookie = cookieOf(login);
});

function count(sql: string): number {
  const row = database.prepare(sql).get() as { value: number };
  return Number(row.value);
}

describe('data health card', () => {
  it('is served to a role that may read activity, with schema and counters', async () => {
    const response = await get('/api/dashboard/observability', cookie);
    expect(response.status).toBe(200);
    const body = await response.json() as {
      schema: { version: number | null };
      accounting: { backlog: number };
      largest_tables: { table: string; bytes: number }[];
      purge: { last_at: string | null };
    };
    expect(body.schema.version).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(body.accounting.backlog)).toBe(true);
    expect(body.largest_tables.length).toBeGreaterThan(0);
    expect(body.purge.last_at).toBeNull();
  });

  it('shows an injected integrity gap on the dashboard and in /api/health', async () => {
    // A session pointing at a user that does not exist: the A-12 report counts it.
    database.prepare(
      `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, ip, user_agent,
        created_at, last_seen_at, expires_at, absolute_expires_at)
       VALUES ('orphan', 'ghost-user', 'orphan-hash', 'csrf', '10.9.9.9', 'test', ?, ?, ?, ?)`,
    ).run(
      new Date().toISOString(), new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
    );

    const dashboard = await get('/api/dashboard/observability', cookie);
    expect(dashboard.status).toBe(200);
    const body = await dashboard.json() as {
      integrity_gaps: number;
      integrity_relations: { relation: string; orphans: number }[];
    };
    expect(body.integrity_gaps).toBeGreaterThanOrEqual(1);
    expect(body.integrity_relations.some((relation) => relation.relation === 'sessions.user_id')).toBe(true);

    const health = await worker.request('https://app.example.pf/api/health', {}, env as never);
    expect(health.status).toBe(200);
    const payload = await health.json() as { status: string; integrity_gaps: number };
    expect(payload.status).toBe('degraded');
    expect(payload.integrity_gaps).toBeGreaterThanOrEqual(1);

    database.prepare(`DELETE FROM sessions WHERE id = 'orphan'`).run();
    const repaired = await worker.request('https://app.example.pf/api/health', {}, env as never);
    expect((await repaired.json() as { status: string }).status).toBe('ok');
  });

  it('keeps the public health answer free of personal data', async () => {
    const health = await worker.request('https://app.example.pf/api/health', {}, env as never);
    const raw = await health.text();
    expect(raw).not.toContain(EMAIL);
    expect(raw).not.toContain('10.5.0.1');
    expect(raw).not.toContain('/api/');
    const payload = JSON.parse(raw) as Record<string, unknown>;
    for (const forbidden of ['email', 'ip', 'user_id', 'user', 'samples', 'path', 'token']) {
      expect(Object.keys(payload)).not.toContain(forbidden);
    }
    expect(payload.status).toBe('ok');
  });

  it('refuses the card to a role without activity.read or accounting.read', async () => {
    const hash = await hashPassword(PASSWORD);
    const now = new Date().toISOString();
    database.prepare(
      `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
       VALUES ('viewer-1', 'viewer@example.test', ?, 'View', 'Only', 'viewer', 1, ?, ?)`,
    ).run(hash, now, now);

    const login = await post('/api/auth/login', { email: 'viewer@example.test', password: PASSWORD });
    expect(login.status).toBe(200);
    const viewer = cookieOf(login);
    const response = await get('/api/dashboard/observability', viewer);
    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN');
  });

  it('reports the purge state after a retention pass', async () => {
    database.prepare(
      `INSERT INTO login_attempts (id, email, ip, successful, created_at)
       VALUES ('old-attempt', 'old@example.test', '10.5.0.9', 1, ?)`,
    ).run(new Date(Date.now() - 200 * 86_400_000).toISOString());
    expect(count('SELECT COUNT(*) AS value FROM login_attempts WHERE id = \'old-attempt\'')).toBe(1);

    const report = await purgeExpired(env.DB as D1Database);
    expect(report.total).toBeGreaterThanOrEqual(1);

    const health = await worker.request('https://app.example.pf/api/health', {}, env as never);
    const payload = await health.json() as { purged_at: string | null; purged_total: number };
    expect(payload.purged_at).not.toBeNull();
    expect(payload.purged_total).toBeGreaterThanOrEqual(1);
  });
});
