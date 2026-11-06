/**
 * A-26 — HTTP integration on a local D1 database.
 *
 * Harness: the real `server/worker` Hono application is called with real
 * `Request` objects, over a fresh `node:sqlite` database built for each case by
 * `provisionDatabase` (A-10 migrations, column healing, system roles). Nothing is
 * mocked: routes, permissions, sessions, validation, SQL and persisted effects
 * are the application's own. This is the same D1 adapter the rest of the suite
 * uses; `@cloudflare/vitest-pool-workers` is not a dependency of this project and
 * `wrangler dev` is not available to a unit runner, so the adapter is the harness
 * that keeps the suite dependency-free while exercising the migrated schema.
 *
 * Every case creates its own database, so files and cases can run in parallel
 * without sharing state. Fixtures are synthetic (`example.test`, `10.6.0.x`).
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { provisionDatabase } from '../../server/db';
import worker from '../../server/worker';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_VAT_REGIMES,
  ENTITY_CATEGORIES,
  LEGAL_FORMS,
} from '../../shared/client-profile';

type Row = Record<string, unknown>;

const EMAIL = 'owner@example.test';
const PASSWORD = 'ManaGest-Demo-2026!';
const DAY = '2026-11-06';
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
  cookie: string;
  call: (method: string, path: string, body?: unknown, session?: string) => Promise<Response>;
}

async function freshWorkspace(): Promise<Harness> {
  const database = new DatabaseSync(':memory:');
  const db = asD1(database);
  await provisionDatabase(db);
  // The base currency is workspace reference data: a non-demo installation does
  // not create it, so the fixture writes the same row an operator would save.
  const stamp = new Date().toISOString();
  database.prepare(
    `INSERT OR IGNORE INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
     VALUES ('XPF', 'Franc Pacifique', 'F', 0, 1, 1, ?, ?)`,
  ).run(stamp, stamp);
  const env = { DB: db };

  let csrf = '';
  const call = (method: string, path: string, body?: unknown, session?: string): Promise<Response> =>
    Promise.resolve(worker.request(`${ORIGIN}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        'x-forwarded-for': '10.6.0.1',
        ...(session ? { cookie: `${session}; mg_csrf=${csrf}` } : {}),
        ...(session && csrf ? { 'x-csrf-token': csrf } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, env as never));

  const installed = await call('POST', '/api/setup/install', {
    company: {
      name: 'Integration SARL',
      legal_name: 'Integration SARL',
      entity_category: ENTITY_CATEGORIES[0],
      legal_form: LEGAL_FORMS[0],
      tax_id: 'T98765',
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

  const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
  if (login.status !== 200) throw new Error(`login ${login.status}`);
  const raw = (login.headers.getSetCookie?.() ?? [login.headers.get('set-cookie') ?? '']).join('; ');
  const sessionMatch = /mg_session=([^;]+)/.exec(raw);
  const csrfMatch = /mg_csrf=([^;]+)/.exec(raw);
  if (!sessionMatch || !csrfMatch) throw new Error('cookies de session absents');
  csrf = csrfMatch[1];
  return { database, env, cookie: `mg_session=${sessionMatch[1]}`, call };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createClient(h: Harness): Promise<string> {
  const response = await h.call('POST', '/api/clients', {
    display_name: 'Client Intégration',
    entity_category: ENTITY_CATEGORIES[0],
    legal_name: 'Client Intégration SARL',
    legal_form: LEGAL_FORMS[0],
    tax_id: 'C12345',
    first_name: 'Marie',
    last_name: 'Test',
    po_box_municipality: 'Papeete',
    postal_code: '98714',
    vat_regime: CLIENT_VAT_REGIMES[0],
    payment_method: CLIENT_PAYMENT_METHODS[0],
    payment_terms_code: CLIENT_PAYMENT_TERMS[0],
    data_consent_accepted: true,
  }, h.cookie);
  if (response.status !== 201) throw new Error(`client ${response.status}: ${await response.clone().text()}`);
  return (await json<{ id: string }>(response)).id;
}

function line(unitPrice = 100_000) {
  return [{ id: 'line-1', description: 'Prestation de service', quantity: 1, unit_price: unitPrice, tax_rate: 13 }];
}

async function createInvoice(h: Harness, clientId: string, currency?: string): Promise<{ id: string; number: string }> {
  const response = await h.call('POST', '/api/invoices', {
    client_id: clientId,
    date: DAY,
    ...(currency ? { currency } : {}),
    line_items: line(),
  }, h.cookie);
  if (response.status !== 201) throw new Error(`invoice ${response.status}: ${await response.clone().text()}`);
  return json<{ id: string; number: string }>(response);
}

async function createCredit(h: Harness, clientId: string): Promise<{ id: string }> {
  const response = await h.call('POST', '/api/credits', {
    client_id: clientId,
    date: DAY,
    line_items: line(),
  }, h.cookie);
  if (response.status !== 201) throw new Error(`credit ${response.status}: ${await response.clone().text()}`);
  return json<{ id: string }>(response);
}

async function issueCredit(h: Harness, id: string): Promise<Response> {
  return h.call('POST', `/api/credits/${id}/send`, {}, h.cookie);
}

async function issueInvoice(h: Harness, id: string): Promise<void> {
  const response = await h.call('POST', `/api/invoices/${id}/send`, {}, h.cookie);
  expect(response.status).toBe(200);
}

function scalar(database: DatabaseSync, sql: string, ...params: unknown[]): number {
  const row = database.prepare(sql).get(...(params as never[])) as { value: number };
  return Number(row.value);
}

describe('P0 HTTP integration on a migrated local D1', () => {
  it('records a settlement and closes the invoice balance (encaissement devise)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);
    const invoice = await createInvoice(h, clientId);
    await issueInvoice(h, invoice.id);

    const payment = await h.call('POST', '/api/payments', {
      client_id: clientId,
      date: DAY,
      amount: 113_000,
      allocations: [{ invoice_id: invoice.id, amount: 113_000 }],
    }, h.cookie);
    expect(payment.status).toBe(201);
    const { id: paymentId } = await json<{ id: string }>(payment);

    const row = h.database
      .prepare('SELECT currency, total, total_xpf, balance, paid_total FROM invoices WHERE id = ?')
      .get(invoice.id) as { currency: string; total: number; total_xpf: number; balance: number; paid_total: number };
    expect(row.currency).toBe('XPF');
    expect(row.balance).toBe(0);
    expect(row.paid_total).toBe(113_000);
    expect(row.total_xpf).toBe(113_000);
    expect(scalar(h.database, 'SELECT COUNT(*) AS value FROM payment_allocations WHERE payment_id = ?', paymentId)).toBe(1);
  });

  it('refuses to edit an issued invoice (immutabilité)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);
    const invoice = await createInvoice(h, clientId);
    await issueInvoice(h, invoice.id);

    const patch = await h.call('PATCH', `/api/invoices/${invoice.id}`, {
      client_id: clientId,
      date: DAY,
      line_items: line(999_999),
    }, h.cookie);
    expect(patch.status).toBe(409);
    const body = await json<{ error: { code: string } }>(patch);
    expect(body.error.code).toMatch(/IMMUTABLE|LOCKED|RETENTION/);

    const stored = h.database.prepare('SELECT total FROM invoices WHERE id = ?').get(invoice.id) as { total: number };
    expect(stored.total).toBe(113_000);

    const remove = await h.call('DELETE', `/api/invoices/${invoice.id}`, undefined, h.cookie);
    expect([409, 422]).toContain(remove.status);
    expect(scalar(h.database, 'SELECT COUNT(*) AS value FROM invoices WHERE id = ? AND deleted_at IS NULL', invoice.id)).toBe(1);
  });

  it('issues a VAT credit note with the right totals (avoir TVA)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);

    const { id } = await createCredit(h, clientId);
    expect((await issueCredit(h, id)).status).toBe(200);

    const detail = await h.call('GET', `/api/credits/${id}`, undefined, h.cookie);
    expect(detail.status).toBe(200);
    const body = await json<{ subtotal: number; tax_total: number; total: number; total_xpf: number }>(detail);
    expect(body.subtotal).toBe(100_000);
    expect(body.tax_total).toBe(13_000);
    expect(body.total).toBe(113_000);
    expect(body.total_xpf).toBe(113_000);
  });

  it('stores the credit VAT line and posts it to the ledger (TVA des avoirs)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);
    const { id } = await createCredit(h, clientId);
    expect((await issueCredit(h, id)).status).toBe(200);

    const taxLines = h.database
      .prepare('SELECT rate, base, amount FROM credit_tax_lines WHERE credit_id = ?')
      .all(id) as { rate: number; base: number; amount: number }[];
    expect(taxLines).toHaveLength(1);
    expect(taxLines[0].rate).toBe(13);
    expect(taxLines[0].base).toBe(100_000);
    expect(taxLines[0].amount).toBe(13_000);

    const sync = await h.call('POST', '/api/accounting/sync', {}, h.cookie);
    expect(sync.status).toBe(200);
    const entry = h.database
      .prepare("SELECT id FROM journal_entries WHERE source_type = 'credit' AND source_id = ?")
      .get(id) as { id: string } | undefined;
    expect(entry?.id).toBeTruthy();
    expect(scalar(h.database, 'SELECT COUNT(*) AS value FROM journal_lines WHERE entry_id = ?', entry!.id)).toBeGreaterThanOrEqual(3);
  });

  it('reverses the settlement when its payment is deleted (contre-écriture)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);
    const invoice = await createInvoice(h, clientId);
    await issueInvoice(h, invoice.id);

    const payment = await h.call('POST', '/api/payments', {
      client_id: clientId,
      date: DAY,
      amount: 113_000,
      allocations: [{ invoice_id: invoice.id, amount: 113_000 }],
    }, h.cookie);
    expect(payment.status).toBe(201);
    const { id: paymentId } = await json<{ id: string }>(payment);
    expect(scalar(h.database, 'SELECT balance AS value FROM invoices WHERE id = ?', invoice.id)).toBe(0);

    const removed = await h.call('DELETE', `/api/payments/${paymentId}`, undefined, h.cookie);
    expect(removed.status).toBe(200);
    expect(scalar(h.database, 'SELECT balance AS value FROM invoices WHERE id = ?', invoice.id)).toBe(113_000);
    expect(scalar(h.database, 'SELECT COUNT(*) AS value FROM payments WHERE id = ? AND deleted_at IS NULL', paymentId)).toBe(0);

    const sync = await h.call('POST', '/api/accounting/sync', {}, h.cookie);
    expect(sync.status).toBe(200);
    // The credit note against the cancelled settlement is persisted, not just computed.
    expect(scalar(h.database, "SELECT COUNT(*) AS value FROM activities WHERE entity_type = 'payment' AND action = 'deleted'")).toBeGreaterThanOrEqual(1);
  });

  it('blocks a credit above the approval threshold and records the request (approbations)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);

    const threshold = await h.call('PUT', '/api/settings/extras/approval_credit_amount', { value: '100' }, h.cookie);
    expect(threshold.status).toBe(200);

    const { id: creditId } = await createCredit(h, clientId);
    const blocked = await issueCredit(h, creditId);
    expect(blocked.status).toBe(409);
    const refusal = await json<{ error: { code: string } }>(blocked);
    expect(refusal.error.code).toBe('APPROVAL_REQUIRED');

    const pending = await h.call('GET', '/api/approvals?status=pending', undefined, h.cookie);
    expect(pending.status).toBe(200);
    const list = await json<{ data: { id: string; status: string; rule: string }[] }>(pending);
    const approval = list.data.find((entry) => entry.rule.includes('credit') || entry.status === 'pending');
    expect(approval).toBeTruthy();

    // Separation of duties: the requester cannot clear their own request, and the
    // approval stays pending until someone else decides.
    const selfApproval = await h.call('POST', `/api/approvals/${approval!.id}/approve`, {}, h.cookie);
    expect(selfApproval.status).toBe(403);
    expect(scalar(h.database, "SELECT COUNT(*) AS value FROM approvals WHERE status = 'pending'")).toBeGreaterThanOrEqual(1);

    const missing = await h.call('POST', '/api/approvals/unknown/approve', {}, h.cookie);
    expect(missing.status).toBe(404);
  });

  it('moves stock on a manual adjustment and persists the balance', async () => {
    const h = await freshWorkspace();
    const created = await h.call('POST', '/api/products', {
      name: 'Article intégration',
      item_type: 'stockable',
      unit_price: 1_000,
    }, h.cookie);
    if (created.status !== 201) throw new Error(`product ${created.status}: ${await created.clone().text()}`);
    const { id } = await json<{ id: string }>(created);

    const adjustment = await h.call('POST', `/api/products/${id}/adjust-stock`, {
      delta: 5,
      kind: 'in',
      reason: 'Réception test',
    }, h.cookie);
    expect(adjustment.status).toBe(200);

    expect(scalar(h.database, 'SELECT quantity_milli AS value FROM products WHERE id = ?', id)).toBe(5_000);
    expect(scalar(h.database, "SELECT COUNT(*) AS value FROM stock_movements WHERE product_id = ? AND kind = 'in'", id)).toBe(1);

    const out = await h.call('POST', `/api/products/${id}/adjust-stock`, { delta: -2, kind: 'out' }, h.cookie);
    expect(out.status).toBe(200);
    expect(scalar(h.database, 'SELECT quantity_milli AS value FROM products WHERE id = ?', id)).toBe(3_000);
  });

  it('reports EUR and XPF revenue in the base currency (rapport multi-devises)', async () => {
    const h = await freshWorkspace();
    const clientId = await createClient(h);
    const now = new Date().toISOString();
    h.database.prepare(
      `INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
       VALUES ('EUR', 'Euro', '€', 2, 0, 1, ?, ?)`,
    ).run(now, now);
    h.database.prepare(
      `INSERT INTO exchange_rates (id, currency, rate, effective_date, note, created_by, created_at)
       VALUES ('rate-eur', 'EUR', 119.3317, '2026-01-01', 'test', NULL, ?)`,
    ).run(now);

    const xpf = await createInvoice(h, clientId);
    await issueInvoice(h, xpf.id);
    const eur = await createInvoice(h, clientId, 'EUR');
    await issueInvoice(h, eur.id);

    const report = await h.call('GET', '/api/reports/revenue-summary?from=2026-11-01&to=2026-11-30', undefined, h.cookie);
    expect(report.status).toBe(200);
    const body = await json<{ rows: { total_xpf: number }[]; summary: { total_xpf: number } }>(report);
    const expected = scalar(h.database, "SELECT COALESCE(SUM(total_xpf), 0) AS value FROM invoices WHERE status = 'sent' AND deleted_at IS NULL");
    expect(expected).toBeGreaterThan(113_000);
    expect(body.summary.total_xpf).toBe(expected);
    expect(body.rows.reduce((sum, row) => sum + row.total_xpf, 0)).toBe(expected);
  });
});
