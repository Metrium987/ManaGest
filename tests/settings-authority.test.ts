/**
 * A-30 — authority over settings.
 *
 * The route guards and the permission matrix already existed; this file freezes
 * them and proves the two behaviours that were missing: a settings write leaves
 * a per-key before/after line in the journal, and a delegated account manager
 * cannot grant a role or a permission they do not hold.
 *
 * Harness: the real worker over a freshly migrated `node:sqlite` database per
 * case (A-26), so cases are independent and parallel-safe. Fixtures are synthetic.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { provisionDatabase } from '../server/db';
import worker from '../server/worker';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_VAT_REGIMES,
  ENTITY_CATEGORIES,
  LEGAL_FORMS,
} from '../shared/client-profile';

type Row = Record<string, unknown>;
interface Credentials { cookie: string; csrf: string }

const PASSWORD = 'ManaGest-Demo-2026!';
const ORIGIN = 'https://app.example.pf';

function asD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => ({ results: database.prepare(sql).all(...(params as never[])) as Row[] }),
      first: async () => (database.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null,
      run: async () => {
        const result = database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
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

interface Harness {
  database: DatabaseSync;
  env: { DB: D1Database };
  owner: Credentials;
  call: (method: string, path: string, body?: unknown, credentials?: Credentials) => Promise<Response>;
  login: (email: string) => Promise<Credentials>;
}

async function freshWorkspace(): Promise<Harness> {
  const database = new DatabaseSync(':memory:');
  const db = asD1(database);
  await provisionDatabase(db);
  const stamp = new Date().toISOString();
  database.prepare(
    `INSERT OR IGNORE INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
     VALUES ('XPF', 'Franc Pacifique', 'F', 0, 1, 1, ?, ?)`,
  ).run(stamp, stamp);
  const env = { DB: db };

  const call = (method: string, path: string, body?: unknown, credentials?: Credentials): Promise<Response> =>
    Promise.resolve(worker.request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '10.6.0.9',
        ...(credentials ? { cookie: `${credentials.cookie}; mg_csrf=${credentials.csrf}`, 'x-csrf-token': credentials.csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env as never));

  const login = async (email: string): Promise<Credentials> => {
    const response = await call('POST', '/api/auth/login', { email, password: PASSWORD });
    if (response.status !== 200) throw new Error(`login ${email}: ${response.status}`);
    const raw = (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie') ?? '']).join('; ');
    const session = /mg_session=([^;]+)/.exec(raw);
    const csrf = /mg_csrf=([^;]+)/.exec(raw);
    if (!session || !csrf) throw new Error('session cookies missing');
    return { cookie: `mg_session=${session[1]}`, csrf: csrf[1] };
  };

  const installed = await call('POST', '/api/setup/install', {
    company: {
      name: 'Authority SARL',
      legal_name: 'Authority SARL',
      entity_category: ENTITY_CATEGORIES[0],
      legal_form: LEGAL_FORMS[0],
      tax_id: 'T98766',
      po_box_municipality: 'Papeete',
      postal_code: '98714',
      vat_regime_detail: CLIENT_VAT_REGIMES[0],
      payment_method: CLIENT_PAYMENT_METHODS[0],
      payment_terms_code: CLIENT_PAYMENT_TERMS[0],
      data_consent_accepted: true,
    },
    admin: { first_name: 'Test', last_name: 'Owner', email: 'owner@example.test', password: PASSWORD },
    demo_data: false,
  });
  if (installed.status !== 201) throw new Error(`installation ${installed.status}`);

  const owner = await login('owner@example.test');
  return { database, env, owner, call, login };
}

async function createUser(h: Harness, email: string, role: 'admin' | 'accountant' | 'sales' | 'viewer'): Promise<string> {
  const response = await h.call('POST', '/api/users', {
    first_name: 'Test', last_name: role, email, role, password: PASSWORD,
  }, h.owner);
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

async function errorCode(response: Response): Promise<string> {
  return ((await response.json()) as { error: { code: string } }).error.code;
}

describe('settings authority (A-30)', () => {
  it('freezes who reads and who writes settings', async () => {
    const h = await freshWorkspace();
    const adminId = await createUser(h, 'admin@example.test', 'admin');
    await createUser(h, 'accountant@example.test', 'accountant');
    await createUser(h, 'sales@example.test', 'sales');
    await createUser(h, 'viewer@example.test', 'viewer');
    expect(adminId).toBeTruthy();

    const adminCred = await h.login('admin@example.test');
    const accountant = await h.login('accountant@example.test');
    const sales = await h.login('sales@example.test');
    const viewer = await h.login('viewer@example.test');

    expect((await h.call('GET', '/api/settings/extras', undefined, h.owner)).status).toBe(200);
    expect((await h.call('PATCH', '/api/settings/extras', { retention_years: '11' }, h.owner)).status).toBe(200);
    expect((await h.call('GET', '/api/settings/extras', undefined, adminCred)).status).toBe(200);
    expect((await h.call('PATCH', '/api/settings/extras', { retention_years: '12' }, adminCred)).status).toBe(200);

    expect((await h.call('GET', '/api/settings/extras', undefined, accountant)).status).toBe(200);
    const refused = await h.call('PATCH', '/api/settings/extras', { retention_years: '13' }, accountant);
    expect(refused.status).toBe(403);
    expect(await errorCode(refused)).toBe('FORBIDDEN');

    expect((await h.call('GET', '/api/settings/extras', undefined, sales)).status).toBe(403);
    expect((await h.call('PATCH', '/api/settings/extras', { retention_years: '14' }, sales)).status).toBe(403);
    expect((await h.call('GET', '/api/settings/extras', undefined, viewer)).status).toBe(403);
    expect((await h.call('PATCH', '/api/settings/extras', { retention_years: '15' }, viewer)).status).toBe(403);
  });

  it('journals each modified key with its previous value', async () => {
    const h = await freshWorkspace();
    expect((await h.call('PATCH', '/api/settings/extras', { retention_years: '11' }, h.owner)).status).toBe(200);
    expect((await h.call('PUT', '/api/settings/extras/retention_years', { value: '12' }, h.owner)).status).toBe(200);

    const rows = h.database.prepare(
      `SELECT entity_id, before_json, after_json FROM activities
        WHERE entity_type = 'settings' AND entity_id = 'extras:retention_years'
        ORDER BY rowid ASC`,
    ).all() as { entity_id: string; before_json: string; after_json: string }[];
    expect(rows).toHaveLength(2);
    const first = JSON.parse(rows[0].after_json) as Record<string, string>;
    expect(first.retention_years).toBe('11');
    expect(JSON.parse(rows[0].before_json ?? '{}')).toEqual({ retention_years: null });
    const secondBefore = JSON.parse(rows[1].before_json) as Record<string, string>;
    const secondAfter = JSON.parse(rows[1].after_json) as Record<string, string>;
    expect(secondBefore.retention_years).toBe('11');
    expect(secondAfter.retention_years).toBe('12');
  });

  it('refuses a delegated manager who tries to widen a role or a permission', async () => {
    const h = await freshWorkspace();
    const targetId = await createUser(h, 'target@example.test', 'viewer');
    await createUser(h, 'delegated@example.test', 'viewer');
    const stamp = new Date().toISOString();
    h.database.prepare(
      `INSERT INTO roles (key, name, permissions, is_system, created_at, updated_at)
       VALUES ('delegated_manager', 'Delegated manager', '["users.read","users.write","settings.read"]', 0, ?, ?)`,
    ).run(stamp, stamp);
    h.database.prepare(
      `INSERT INTO roles (key, name, permissions, is_system, created_at, updated_at)
       VALUES ('wide_role', 'Wide role', '["users.read","users.write","settings.write"]', 0, ?, ?)`,
    ).run(stamp, stamp);
    h.database.prepare(`UPDATE users SET role_key = 'delegated_manager' WHERE email = 'delegated@example.test'`).run();

    const delegated = await h.login('delegated@example.test');
    const adminAttempt = await h.call('PATCH', `/api/roles/assign/${targetId}`, { role: 'admin' }, delegated);
    expect(adminAttempt.status).toBe(403);
    expect(await errorCode(adminAttempt)).toBe('SELF_ESCALATION');

    const wideAttempt = await h.call('PATCH', `/api/roles/assign/${targetId}`, { role: 'wide_role' }, delegated);
    expect(wideAttempt.status).toBe(403);
    expect(await errorCode(wideAttempt)).toBe('SELF_ESCALATION');

    const permissionAttempt = await h.call(
      'PUT', `/api/roles/user/${targetId}/permissions`, { permissions: ['settings.write'] }, delegated,
    );
    expect(permissionAttempt.status).toBe(403);
    expect(await errorCode(permissionAttempt)).toBe('SELF_ESCALATION');

    // Only the owner names an administrator.
    expect((await h.call('PATCH', `/api/roles/assign/${targetId}`, { role: 'admin' }, h.owner)).status).toBe(200);
  });
});
