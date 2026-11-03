/**
 * Self-service password reset: the link is issued only for an active account,
 * never reveals whether the address exists, is single-use and expires, and a
 * successful reset closes every session. The provider is stubbed at the fetch
 * boundary, so the payload the user receives is the one asserted here.
 */
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureSchema } from '../server/db';
import { authRoutes } from '../server/routes/auth';
import { Hono } from 'hono';
import { ApiError } from '../server/lib/errors';
import { setupRoutes } from '../server/routes/setup';
import { sha256Hex } from '../server/lib/crypto';
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

const ADMIN_EMAIL = 'owner@example.test';
const OLD_PASSWORD = 'ManaGest-Demo-2026!';
const NEW_PASSWORD = 'Nouveau-MotDePasse-2026!';
const SECRET = 'a-sufficiently-long-test-secret-for-aes-gcm';

const env = {
  MAIL_CONFIG_ENCRYPTION_KEY: SECRET,
  RESEND_API_KEY: 're_test_key',
} as unknown as { DB: D1Database; MAIL_CONFIG_ENCRYPTION_KEY: string; RESEND_API_KEY: string };

let database: DatabaseSync;
let d1: D1Database;

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
      admin: { first_name: 'Test', last_name: 'Owner', email: ADMIN_EMAIL, password: OLD_PASSWORD },
      demo_data: false,
    }),
  }, env as never);
  if (response.status !== 201) throw new Error(`installation ${response.status}`);

  database.prepare(
    `INSERT INTO email_settings (id, provider, sender_name, sender_email, reply_to,
       api_key_ciphertext, api_key_provider, invoice_subject, invoice_body,
       quote_subject, quote_body, credit_subject, credit_body, updated_at)
     VALUES ('workspace', 'resend', 'ManaGest', 'facture@example.pf', '', 'v1.a.b', 'resend',
       's', 'b', 's', 'b', 's', 'b', ?)`,
  ).run(new Date().toISOString());
}

function post(path: string, body: unknown, ip = '10.0.0.1', cookie?: string) {
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

let sent: { to: string[]; subject: string; text: string }[] = [];
const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
  sent.push(JSON.parse(String(init.body)) as { to: string[]; subject: string; text: string });
  return { ok: true, status: 200, json: async () => ({ id: 'mail-1' }) } as unknown as Response;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function login(password: string) {
  return post('/login', { email: ADMIN_EMAIL, password });
}

function sessionCookie(response: Response): string {
  const raw = response.headers.get('set-cookie') ?? '';
  const match = /mg_session=([^;]+)/.exec(raw);
  if (!match) throw new Error(`cookie absent: ${raw}`);
  return `mg_session=${match[1]}`;
}

describe('self-service password reset', () => {
  it('issues a one-hour link, resets the password, revokes sessions and refuses reuse', async () => {
    await install();
    vi.stubGlobal('fetch', fetchMock);
    sent = [];

    const before = await login(OLD_PASSWORD);
    expect(before.status).toBe(200);
    const cookie = sessionCookie(before);

    const requested = await post('/forgot-password', { email: ADMIN_EMAIL });
    expect(requested.status).toBe(200);
    expect(await requested.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toEqual([ADMIN_EMAIL]);
    const token = /reinitialiser-mot-de-passe\?token=([A-Za-z0-9_-]+)/.exec(sent[0].text)?.[1];
    expect(token).toBeTruthy();
    expect(sent[0].text).toContain('expire dans 60 minutes');

    // The mailbox holder is identified, but the stored secret is not the token.
    const stored = database.prepare(`SELECT token_hash, used_at FROM password_reset_tokens`).get() as Row;
    expect(stored.token_hash).toBe(await sha256Hex(token!));
    expect(stored.token_hash).not.toBe(token);
    expect(stored.used_at).toBeNull();

    const reset = await post('/reset-password', { token, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);

    // The session opened before the reset no longer works.
    const me = await app.request('/me', { headers: { cookie } }, env as never);
    expect(me.status).toBe(401);

    expect((await login(OLD_PASSWORD)).status).toBe(401);
    expect((await login(NEW_PASSWORD)).status).toBe(200);

    const reuse = await post('/reset-password', { token, password: NEW_PASSWORD });
    expect(reuse.status).toBe(422);
    expect((await reuse.json()) as { code: string }).toMatchObject({ code: 'INVALID_RESET_TOKEN' });
  });

  it('answers identically for an unknown address and sends nothing', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const before = sent.length;
    const response = await post('/forgot-password', { email: 'inconnu@example.test' }, '10.0.0.9');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(sent).toHaveLength(before);
  });

  it('refuses a password that breaks the policy and keeps the link usable', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const requested = await post('/forgot-password', { email: ADMIN_EMAIL }, '10.0.0.2');
    expect(requested.status).toBe(200);
    const token = /token=([A-Za-z0-9_-]+)/.exec(sent[sent.length - 1].text)?.[1];

    const weak = await post('/reset-password', { token, password: 'court' });
    expect(weak.status).toBe(422);
    expect(((await weak.json()) as { code: string }).code).toBe('VALIDATION_ERROR');

    const ok = await post('/reset-password', { token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('refuses an expired token and a token that does not exist', async () => {
    const user = database.prepare(`SELECT id FROM users WHERE email = ?`).get(ADMIN_EMAIL) as Row;
    const expired = 'a'.repeat(40);
    database.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip, created_at)
       VALUES ('expired', ?, ?, ?, '10.0.0.3', ?)`,
    ).run(user.id as string, await sha256Hex(expired), new Date(Date.now() - 60_000).toISOString(), new Date().toISOString());

    for (const token of [expired, 'b'.repeat(40)]) {
      const response = await post('/reset-password', { token, password: NEW_PASSWORD });
      expect(response.status).toBe(422);
      expect(((await response.json()) as { code: string }).code).toBe('INVALID_RESET_TOKEN');
    }
  });

  it('stays silent and sends nothing while e-mail delivery is not configured', async () => {
    database.prepare(`UPDATE email_settings SET provider = 'manual' WHERE id = 'workspace'`).run();
    vi.stubGlobal('fetch', fetchMock);
    const before = sent.length;
    const response = await post('/forgot-password', { email: ADMIN_EMAIL }, '10.0.0.4');
    expect(response.status).toBe(200);
    expect(sent).toHaveLength(before);
    database.prepare(`UPDATE email_settings SET provider = 'resend' WHERE id = 'workspace'`).run();
  });

  it('limits how many links one address can request per hour', async () => {
    vi.stubGlobal('fetch', fetchMock);
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await post('/forgot-password', { email: ADMIN_EMAIL }, '10.0.0.50')).status);
    }
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
  });
});
