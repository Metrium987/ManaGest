/**
 * A-28 — deterministic concurrency tests.
 *
 * The real worker runs over a local `node:sqlite` base (same harness as A-26),
 * but a gate synchronises the requests on the exact statement that matters: both
 * sides have read the same pre-state before either writes. That makes the race
 * reproducible, instead of hoping that `Promise.all` happens to interleave.
 *
 * Covered here: double issue of one invoice (stock and status), double settlement
 * of one balance, and a period close racing a settlement. The two other scenarios
 * named by the fiches already have their own deterministic tests:
 * `tests/setup-concurrency.test.ts` (double installation) and
 * `tests/audit-chain-concurrency.test.ts` (50 audit writes).
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

const EMAIL = 'owner@example.test';
const PASSWORD = 'ManaGest-Demo-2026!';
const DAY = new Date().toISOString().slice(0, 10);
const ORIGIN = 'https://app.example.pf';

interface Row {
  [key: string]: unknown;
}

/** Blocks matching statements until `expected` requests reached them, or a manual release. */
class Gate {
  private hits = 0;
  private released = false;
  private waiting: (() => void)[] = [];

  constructor(private readonly marker: string, private readonly expected: number) {}

  async pass(sql: string): Promise<void> {
    if (this.released || !sql.includes(this.marker)) return;
    this.hits += 1;
    if (this.hits >= this.expected) {
      this.release();
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  release(): void {
    this.released = true;
    for (const resolve of this.waiting) resolve();
    this.waiting = [];
  }

  get reached(): number {
    return this.hits;
  }
}

function asD1(database: DatabaseSync, gate?: Gate): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => {
        await gate?.pass(sql);
        return { results: database.prepare(sql).all(...(params as never[])) as Row[] };
      },
      first: async () => {
        await gate?.pass(sql);
        return (database.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null;
      },
      run: async () => {
        await gate?.pass(sql);
        const result = database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    });
    return bind([]);
  };
  return {
    prepare,
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  } as unknown as D1Database;
}

interface Harness {
  database: DatabaseSync;
  cookie: string;
  call: (method: string, path: string, body?: unknown) => Promise<Response>;
}

async function freshWorkspace(gate?: Gate): Promise<Harness> {
  const database = new DatabaseSync(':memory:');
  const db = asD1(database, gate);
  await provisionDatabase(db);
  const stamp = new Date().toISOString();
  database
    .prepare(
      `INSERT OR IGNORE INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
       VALUES ('XPF', 'Franc Pacifique', 'F', 0, 1, 1, ?, ?)`,
    )
    .run(stamp, stamp);

  let csrf = '';
  const call = (method: string, path: string, body?: unknown): Promise<Response> =>
    Promise.resolve(
      worker.request(
        `${ORIGIN}${path}`,
        {
          method,
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '10.6.0.2',
            ...(csrf ? { cookie: `mg_session=${session}; mg_csrf=${csrf}`, 'x-csrf-token': csrf } : {}),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { DB: db } as never,
      ),
    );

  let session = '';
  const installed = await call('POST', '/api/setup/install', {
    company: {
      name: 'Concurrence SARL',
      legal_name: 'Concurrence SARL',
      entity_category: ENTITY_CATEGORIES[0],
      legal_form: LEGAL_FORMS[0],
      tax_id: 'T54321',
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
  if (!sessionMatch || !csrfMatch) throw new Error('cookies absents');
  session = sessionMatch[1];
  csrf = csrfMatch[1];

  return { database, cookie: `mg_session=${session}`, call };
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

async function createClient(h: Harness): Promise<string> {
  const response = await h.call('POST', '/api/clients', {
    display_name: 'Client Concurrence',
    entity_category: ENTITY_CATEGORIES[0],
    legal_name: 'Client Concurrence SARL',
    legal_form: LEGAL_FORMS[0],
    tax_id: 'C54321',
    first_name: 'Marie',
    last_name: 'Test',
    po_box_municipality: 'Papeete',
    postal_code: '98714',
    vat_regime: CLIENT_VAT_REGIMES[0],
    payment_method: CLIENT_PAYMENT_METHODS[0],
    payment_terms_code: CLIENT_PAYMENT_TERMS[0],
    data_consent_accepted: true,
  });
  if (response.status !== 201) throw new Error(`client ${response.status}: ${await response.clone().text()}`);
  return (await json<{ id: string }>(response)).id;
}

async function createProduct(h: Harness): Promise<string> {
  const created = await h.call('POST', '/api/products', {
    name: 'Article concurrence',
    item_type: 'stockable',
    unit_price: 1_000,
    track_quantity: true,
  });
  if (created.status !== 201) throw new Error(`product ${created.status}: ${await created.clone().text()}`);
  const { id } = await json<{ id: string }>(created);
  const adjusted = await h.call('POST', `/api/products/${id}/adjust-stock`, { delta: 10, kind: 'in' });
  if (adjusted.status !== 200) throw new Error(`stock ${adjusted.status}`);
  return id;
}

async function createInvoice(
  h: Harness,
  clientId: string,
  productId?: string,
): Promise<{ id: string; number: string }> {
  const response = await h.call('POST', '/api/invoices', {
    client_id: clientId,
    date: DAY,
    line_items: [
      {
        id: 'line-1',
        ...(productId ? { product_id: productId } : {}),
        description: 'Prestation de service',
        quantity: 1,
        unit_price: 100_000,
        tax_rate: 13,
      },
    ],
  });
  if (response.status !== 201) throw new Error(`invoice ${response.status}: ${await response.clone().text()}`);
  return json<{ id: string; number: string }>(response);
}

function count(database: DatabaseSync, sql: string, ...params: unknown[]): number {
  const row = database.prepare(sql).get(...(params as never[])) as { value: number };
  return Number(row.value);
}

async function waitFor(predicate: () => boolean, timeout = 3_000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) throw new Error('la barrière n’a pas été atteinte');
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('HTTP concurrency', () => {
  it('double envoi : un seul statut émis et un seul mouvement de stock', async () => {
    const gate = new Gate('SELECT id, number, status, date, subtotal', 2);
    const h = await freshWorkspace(gate);
    const clientId = await createClient(h);
    const productId = await createProduct(h);
    const invoice = await createInvoice(h, clientId, productId);

    const [first, second] = await Promise.all([
      h.call('POST', `/api/invoices/${invoice.id}/send`, {}),
      h.call('POST', `/api/invoices/${invoice.id}/send`, {}),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 409]);
    expect(count(h.database, "SELECT COUNT(*) AS value FROM stock_movements WHERE reason = 'invoice' AND reference = ?", invoice.number)).toBe(1);
    expect(count(h.database, 'SELECT quantity_milli AS value FROM products WHERE id = ?', productId)).toBe(9_000);
    expect(count(h.database, "SELECT COUNT(*) AS value FROM invoices WHERE id = ? AND status = 'sent'", invoice.id)).toBe(1);
  });

  it('double encaissement : un seul règlement et un solde soldé une fois', async () => {
    const gate = new Gate("AND status IN ('sent', 'partial') AND balance > 0", 2);
    const h = await freshWorkspace(gate);
    const clientId = await createClient(h);
    const invoice = await createInvoice(h, clientId);
    const sent = await h.call('POST', `/api/invoices/${invoice.id}/send`, {});
    expect(sent.status).toBe(200);

    const body = {
      client_id: clientId,
      date: DAY,
      amount: 113_000,
      allocations: [{ invoice_id: invoice.id, amount: 113_000 }],
    };
    const [first, second] = await Promise.all([
      h.call('POST', '/api/payments', body),
      h.call('POST', '/api/payments', body),
    ]);

    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([201, 409]);
    expect(count(h.database, 'SELECT COUNT(*) AS value FROM payments WHERE deleted_at IS NULL')).toBe(1);
    expect(count(h.database, 'SELECT paid_total AS value FROM invoices WHERE id = ?', invoice.id)).toBe(113_000);
    expect(count(h.database, 'SELECT balance AS value FROM invoices WHERE id = ?', invoice.id)).toBe(0);
    expect(count(h.database, 'SELECT COUNT(*) AS value FROM payment_allocations WHERE invoice_id = ?', invoice.id)).toBe(1);
  });

  it('clôture de période : une écriture déjà engagée passe, la suivante est refusée', async () => {
    const gate = new Gate('UPDATE invoices SET balance = balance - ?', 2);
    const h = await freshWorkspace(gate);
    const clientId = await createClient(h);
    const invoice = await createInvoice(h, clientId);
    const sent = await h.call('POST', `/api/invoices/${invoice.id}/send`, {});
    expect(sent.status).toBe(200);

    const payment = h.call('POST', '/api/payments', {
      client_id: clientId,
      date: DAY,
      amount: 113_000,
      allocations: [{ invoice_id: invoice.id, amount: 113_000 }],
    });
    await waitFor(() => gate.reached >= 1);

    const lock = await h.call('POST', '/api/settings/periods', { period: DAY.slice(0, 7), note: 'Fermeture test' });
    expect(lock.status).toBe(201);
    expect(count(h.database, 'SELECT COUNT(*) AS value FROM period_locks WHERE period = ?', DAY.slice(0, 7))).toBe(1);

    gate.release();
    // Documented outcome: the settlement had already passed its period check, so
    // it commits; every later write in the closed period is refused.
    expect((await payment).status).toBe(201);

    const refused = await h.call('POST', '/api/payments', {
      client_id: clientId,
      date: DAY,
      amount: 1_000,
      allocations: [],
    });
    expect(refused.status).toBe(409);
    expect((await json<{ error: { code: string } }>(refused)).error.code).toBe('PERIOD_LOCKED');
    expect(count(h.database, 'SELECT COUNT(*) AS value FROM payments WHERE deleted_at IS NULL')).toBe(1);
  });
});
