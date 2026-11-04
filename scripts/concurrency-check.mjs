#!/usr/bin/env node
/**
 * V-03 — the write-concurrency claims, checked by actually racing two requests
 * instead of trusting a code reading.
 *
 * A load test cannot answer this: the claims are about who wins a write, not
 * about how many requests a server survives. So this script creates its own
 * data and fires two requests at the same time, twice over:
 *
 *   1. two invoices created simultaneously  → two distinct numbers, both 201
 *   2. two settlements of one bank line     → exactly one payment, one 200
 *
 * The abandoned 29/10 branch also raced two edits of one invoice and expected
 * `EDIT_CONFLICT`. This build has no editing claim and no version column on
 * invoices, so that claim is dropped rather than asserted against nothing.
 *
 * Dependency-free (Node 20+), against a running server:
 *
 *   BASE_URL=http://127.0.0.1:8787 CHECK_EMAIL=... CHECK_PASSWORD=... \
 *     node scripts/concurrency-check.mjs
 *
 * Exit code 1 when a claim is violated. It writes data on purpose — run it
 * against a disposable database, never production.
 */

const BASE_URL = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
const EMAIL = process.env.CHECK_EMAIL ?? '';
const PASSWORD = process.env.CHECK_PASSWORD ?? '';
const TODAY = process.env.CHECK_DATE ?? new Date().toISOString().slice(0, 10);
const MARK = `concurrence-${Date.now().toString(36)}`;

function stop(message) {
  console.error(`concurrency-check: ${message}`);
  process.exit(2);
}

if (!BASE_URL) stop('BASE_URL is required');
if (!EMAIL || !PASSWORD) stop('CHECK_EMAIL and CHECK_PASSWORD are required');

const jar = new Map();
let csrf = '';

/**
 * Every cookie has to go back, `mg_csrf` included: the write guard is bound to
 * the session secret and requires the header to equal the cookie, so sending
 * only the session cookie earns a 403 CSRF_TOKEN on every write.
 */
function remember(response) {
  const lines = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  for (const line of lines.filter(Boolean)) {
    const pair = line.split(';')[0].trim();
    const at = pair.indexOf('=');
    if (at <= 0) continue;
    const name = pair.slice(0, at);
    const value = pair.slice(at + 1);
    if (value === '' || /expires=Thu, 01 Jan 1970/i.test(line)) jar.delete(name);
    else jar.set(name, value);
    if (name === 'mg_csrf') csrf = decodeURIComponent(value);
  }
}

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; ');
}

async function call(method, path, body) {
  const headers = { Accept: 'application/json', Cookie: cookieHeader() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  // Writes need the double-submit token: the cookie is paired with a header.
  if (method !== 'GET' && csrf) headers['x-csrf-token'] = csrf;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  remember(response);
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text.slice(0, 200) };
  }
  return { status: response.status, body: payload };
}

function code(result) {
  return result.body?.error?.code ?? (result.status >= 200 && result.status < 300 ? 'OK' : `HTTP_${result.status}`);
}

const results = [];
function claim(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}\n      ${detail}`);
}

// ---------------------------------------------------------------- session
const login = await call('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD });
if (login.status !== 200) stop(`login failed: ${login.status} ${code(login)}`);
if (!jar.has('mg_session') || !csrf) stop('login returned no session or no CSRF cookie');

// ---------------------------------------------------------------- fixtures
const client = await call('POST', '/api/clients', { display_name: `Client ${MARK}` });
if (client.status !== 201 && client.status !== 200) stop(`client creation failed: ${client.status} ${code(client)}`);
const clientId = client.body.id ?? client.body.data?.id;
if (!clientId) stop('client creation returned no id');

const line = (price) => [{ id: crypto.randomUUID(), description: `Prestation ${MARK}`, quantity: 1, unit_price: price, tax_rate: 0 }];
const invoiceBody = () => ({ client_id: clientId, date: TODAY, due_date: TODAY, line_items: line(120000) });

async function invoice(id) {
  const result = await call('GET', `/api/invoices/${id}`);
  if (result.status !== 200) stop(`reading invoice ${id} failed: ${result.status}`);
  return result.body;
}

/**
 * Two requests leave before either answer is read, so they overlap as much as
 * the runtime allows. A small stagger would weaken the test, and D1 serialises
 * writes anyway — that is exactly what makes these claims meaningful.
 */
async function race(...requests) {
  return Promise.all(requests);
}

// ------------------------------------------- 1. numbering under concurrency
const [first, second] = await race(
  call('POST', '/api/invoices', invoiceBody()),
  call('POST', '/api/invoices', invoiceBody()),
);
const bothCreated = first.status === 201 && second.status === 201;
const numbers = [first.body.number, second.body.number].filter(Boolean);
claim(
  'two invoices created at once get two numbers',
  bothCreated && numbers.length === 2 && numbers[0] !== numbers[1],
  `${first.status}/${second.status} → ${numbers.join(' , ') || 'no numbers'} ` +
    `(${bothCreated ? 'both created' : `one refused: ${code(first)} ${code(second)}`})`,
);

// --------------------------------- 2. one bank line, two simultaneous settlements
const target = bothCreated ? first.body : null;
if (!target) {
  console.error('concurrency-check: no invoice to settle, stopping after claim 1');
  process.exit(1);
}

const sent = await call('POST', `/api/invoices/${target.id}/send`);
if (sent.status !== 200 && sent.status !== 204) stop(`sending invoice failed: ${sent.status} ${code(sent)}`);
const before = await invoice(target.id);
const balance = Number(before.balance ?? 0);
if (!balance) stop('the invoice to settle has no balance');

const account = await call('POST', '/api/bank/accounts', { name: `Compte ${MARK}`, opening_balance: 0 });
if (account.status !== 201 && account.status !== 200) stop(`bank account creation failed: ${account.status} ${code(account)}`);
const accountId = account.body.id ?? account.body.data?.id;
if (!accountId) stop('bank account creation returned no id');

const imported = await call('POST', '/api/bank/transactions/import', {
  account_id: accountId,
  transactions: [{ date: TODAY, label: `Virement ${MARK}`, amount: balance }],
});
if (imported.status !== 201 && imported.status !== 200) stop(`transaction import failed: ${imported.status} ${code(imported)}`);

const statement = await call('GET', `/api/bank/transactions?account_id=${accountId}`);
const transaction = (statement.body.data ?? [])[0];
if (!transaction) stop('imported transaction not found');

const matches = await race(
  call('POST', `/api/bank/transactions/${transaction.id}/match`, { invoice_id: target.id }),
  call('POST', `/api/bank/transactions/${transaction.id}/match`, { invoice_id: target.id }),
);
const accepted = matches.filter((result) => result.status === 200).length;
const after = await invoice(target.id);
const paid = Number(after.paid_total ?? 0);
const total = Number(after.total ?? 0);
const overpaid = paid > total + 1;

claim(
  'two settlements of one bank line produce exactly one payment',
  accepted === 1 && !overpaid,
  `${matches.map((result) => result.status).join('/')} → ${matches.map(code).join(' , ')} · ` +
    `facture payée ${paid} / ${total}${overpaid ? ' — SURPAIEMENT : deux règlements sont passés' : ''}`,
);

// ---------------------------------------------------------------- summary
const failed = results.filter((result) => !result.ok);
console.log('');
if (failed.length) {
  console.error(`concurrency-check: ${failed.length}/${results.length} claim(s) violated (data written under marker ${MARK})`);
  process.exit(1);
}
console.log(`concurrency-check: all ${results.length} claims hold (data written under marker ${MARK})`);
