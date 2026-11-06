/**
 * The second factor shipped with the authentication module but was only covered
 * indirectly. This drives the real routes: setup, activation with a generated
 * code, login challenge, TOTP verification, single-use recovery code and
 * disabling. It proves the PENDING line "MFA non planifié" is out of date.
 *
 * A-22 adds the other half of the guarantee: a session alone cannot change a
 * factor, and the password that carried a setup does not authorise the
 * activation that follows it.
 */
import { DatabaseSync } from 'node:sqlite';
import { beforeAll, describe, expect, it } from 'vitest';
import { ensureSchema } from '../server/db';
import { authRoutes } from '../server/routes/auth';
import { Hono } from 'hono';
import { ApiError } from '../server/lib/errors';
import { setupRoutes } from '../server/routes/setup';
import { totpAt } from '../server/lib/totp';
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

/** The worker maps thrown ApiErrors to JSON; the routes are exercised the same way. */
const app = new Hono();
app.onError((error, c) => {
  const api = error as ApiError;
  return c.json({ code: api.code, details: api.details }, (api.status ?? 500) as 400);
});
app.route('/', authRoutes);

const EMAIL = 'owner@example.test';
const PASSWORD = 'ManaGest-Demo-2026!';
const env = { DB: null as unknown as D1Database };

function post(path: string, body: unknown, cookie?: string, ip = '10.1.0.1') {
  return app.request(path, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': ip,
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  }, env as never);
}

function cookieOf(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = /mg_session=([^;]+)/.exec(raw);
  if (!match) throw new Error(`session absente: ${raw}`);
  return `mg_session=${match[1]}`;
}

/** The code for the current 30-second step, as an authenticator app would show. */
function currentCode(secret: string): Promise<string> {
  return totpAt(secret.replace(/\s/g, ''), Math.floor(Date.now() / 1000 / 30));
}

async function installAndLogin(): Promise<{ cookie: string; database: DatabaseSync }> {
  const database = new DatabaseSync(':memory:');
  const d1 = asD1(database);
  await ensureSchema(d1);
  env.DB = d1;

  const installed = await setupRoutes.request('/install', {
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
      admin: { first_name: 'Test', last_name: 'Owner', email: EMAIL, password: PASSWORD },
      demo_data: false,
    }),
  }, env as never);
  if (installed.status !== 201) throw new Error(`installation ${installed.status}`);

  const login = await post('/login', { email: EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  return { cookie: cookieOf(login), database };
}

let database: DatabaseSync;
let cookie: string;

/** A second browser: the same account, another session. */
async function freshSession(): Promise<string> {
  const login = await post('/login', { email: EMAIL, password: PASSWORD });
  expect(login.status).toBe(200);
  return cookieOf(login);
}

function scalar(sql: string, ...params: unknown[]): number {
  const row = database.prepare(sql).get(...(params as never[])) as { value: number };
  return row.value;
}

function mfaState(): { mfa_secret: string | null; mfa_enabled: number } {
  return database
    .prepare('SELECT mfa_secret, mfa_enabled FROM users WHERE email = ?')
    .get(EMAIL) as { mfa_secret: string | null; mfa_enabled: number };
}

describe('TOTP second factor', () => {
  beforeAll(async () => {
    const installed = await installAndLogin();
    database = installed.database;
    cookie = installed.cookie;
  });

  it('enrols, challenges the login, accepts a code, uses a recovery code once and disables', async () => {
    const setup = await post('/mfa/setup', { current_password: PASSWORD }, cookie);
    expect(setup.status).toBe(200);
    const { secret, otpauth_uri } = await setup.json() as { secret: string; otpauth_uri: string };
    expect(secret.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);
    expect(otpauth_uri).toContain('otpauth://totp/');

    const code = await currentCode(secret);
    const enabled = await post('/mfa/enable', { code, current_password: PASSWORD }, cookie);
    expect(enabled.status).toBe(200);
    const { recovery_codes } = await enabled.json() as { recovery_codes: string[] };
    expect(recovery_codes).toHaveLength(10);

    // A correct password alone now returns a five-minute challenge, no session.
    const challenged = await post('/login', { email: EMAIL, password: PASSWORD });
    expect(challenged.status).toBe(200);
    const challenge = await challenged.json() as { mfa_required: boolean; challenge: string };
    expect(challenge.mfa_required).toBe(true);
    expect(challenged.headers.get('set-cookie')).toBeNull();

    const wrong = await post('/mfa/verify', { challenge: challenge.challenge, code: '000000' });
    expect(wrong.status).toBe(401);

    const fresh = await (await post('/login', { email: EMAIL, password: PASSWORD })).json() as { challenge: string };
    const verified = await post('/mfa/verify', { challenge: fresh.challenge, code: await currentCode(secret) });
    expect(verified.status).toBe(200);
    const session = cookieOf(verified);
    const me = await app.request('/me', { headers: { cookie: session } }, env as never);
    expect(me.status).toBe(200);

    // A recovery code stands in for the app and is consumed.
    const first = await (await post('/login', { email: EMAIL, password: PASSWORD })).json() as { challenge: string };
    const recovery = await post('/mfa/verify', { challenge: first.challenge, code: recovery_codes[0] });
    expect(recovery.status).toBe(200);

    const second = await (await post('/login', { email: EMAIL, password: PASSWORD })).json() as { challenge: string };
    const reused = await post('/mfa/verify', { challenge: second.challenge, code: recovery_codes[0] });
    expect(reused.status).toBe(401);

    const disabled = await post('/mfa/disable', { code: await currentCode(secret) }, session);
    expect(disabled.status).toBe(200);

    const plain = await post('/login', { email: EMAIL, password: PASSWORD });
    expect(plain.status).toBe(200);
    expect((await plain.json() as { mfa_required?: boolean }).mfa_required).toBeUndefined();
    expect(plain.headers.get('set-cookie')).toContain('mg_session=');
  });

  it('refuses to start MFA setup without the current password', async () => {
    const session = await freshSession();
    const before = scalar('SELECT COUNT(*) AS value FROM login_attempts WHERE email = ?', EMAIL);

    const refused = await post('/mfa/setup', {}, session);
    expect(refused.status).toBe(401);
    expect((await refused.json() as { code: string }).code).toBe('INVALID_CREDENTIALS');
    expect(mfaState().mfa_secret).toBeNull();

    const after = scalar('SELECT COUNT(*) AS value FROM login_attempts WHERE email = ?', EMAIL);
    expect(after).toBe(before + 1);
  });

  it('counts a wrong password and only stores the secret with the right one', async () => {
    const session = await freshSession();
    const wrong = await post('/mfa/setup', { current_password: 'Pas-Le-Bon-2026!' }, session);
    expect(wrong.status).toBe(401);
    expect((await wrong.json() as { code: string }).code).toBe('INVALID_CREDENTIALS');
    expect(mfaState().mfa_secret).toBeNull();

    const accepted = await post('/mfa/setup', { current_password: PASSWORD }, session);
    expect(accepted.status).toBe(200);
    const { secret } = await accepted.json() as { secret: string };
    expect(secret.replace(/\s/g, '')).toMatch(/^[A-Z2-7]{32}$/);
    expect(mfaState().mfa_secret).not.toBeNull();
  });

  it('needs the password again to enable, even though the setup carried it', async () => {
    const session = await freshSession();
    const setup = await post('/mfa/setup', { current_password: PASSWORD }, session);
    expect(setup.status).toBe(200);
    const { secret } = await setup.json() as { secret: string };
    const code = await currentCode(secret);

    // The previous request authenticated the person, not the device: the code
    // and the session from the setup are not enough on their own.
    const refused = await post('/mfa/enable', { code }, session);
    expect(refused.status).toBe(401);
    expect((await refused.json() as { code: string }).code).toBe('INVALID_CREDENTIALS');
    expect(mfaState().mfa_enabled).toBe(0);

    const enabled = await post('/mfa/enable', { code, current_password: PASSWORD }, session);
    expect(enabled.status).toBe(200);
    expect(mfaState().mfa_enabled).toBe(1);
  });

  it('refuses a wrong password to disable, and accepts the current one alone', async () => {
    const refused = await post('/mfa/disable', { current_password: 'Pas-Le-Bon-2026!' }, cookie);
    expect(refused.status).toBe(401);
    expect((await refused.json() as { code: string }).code).toBe('INVALID_CREDENTIALS');
    expect(mfaState().mfa_enabled).toBe(1);

    const disabled = await post('/mfa/disable', { current_password: PASSWORD }, cookie);
    expect(disabled.status).toBe(200);
    expect(mfaState().mfa_enabled).toBe(0);
  });
});
