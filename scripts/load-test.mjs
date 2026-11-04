#!/usr/bin/env node
/**
 * V-04 — small load test, run only when someone asks for it.
 *
 * It is deliberately read-only: it logs in and repeats the screens a session
 * actually opens. A load test that writes would measure the wrong thing here
 * (D1 serialises writes anyway) and would pollute real data.
 *
 * No dependency on purpose: this must still run in two years without an
 * install. Node 20+ (global fetch).
 *
 *   BASE_URL=https://app.example LOAD_EMAIL=... LOAD_PASSWORD=... \
 *     LOAD_USERS=25 LOAD_DURATION=60 node scripts/load-test.mjs
 *
 * Exit code 1 when a request fails with 5xx, or when the error rate is above
 * LOAD_MAX_ERROR_RATE (default 1%).
 */

const BASE_URL = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
const ACCOUNTS = (process.env.LOAD_ACCOUNTS ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean)
  .map((entry) => {
    const at = entry.indexOf(':');
    return at === -1
      ? { email: entry, password: process.env.LOAD_PASSWORD ?? '' }
      : { email: entry.slice(0, at), password: entry.slice(at + 1) };
  });
const SINGLE = process.env.LOAD_EMAIL
  ? [{ email: process.env.LOAD_EMAIL, password: process.env.LOAD_PASSWORD ?? '' }]
  : [];
const USERS = Number(process.env.LOAD_USERS ?? 25);
const DURATION = Number(process.env.LOAD_DURATION ?? 60);
const MAX_ERROR_RATE = Number(process.env.LOAD_MAX_ERROR_RATE ?? 0.01);

/** The screens a session opens, in the order it opens them. */
const ENDPOINTS = [
  '/api/dashboard',
  '/api/clients?page=1&per_page=50',
  '/api/invoices?page=1&per_page=25',
  '/api/quotes?page=1&per_page=25',
  '/api/search?q=fac',
];

function fail(message) {
  console.error(`load-test: ${message}`);
  process.exit(2);
}

if (!BASE_URL) fail('BASE_URL is required (never run this against production data you care about)');
if (!Number.isFinite(USERS) || USERS < 1) fail('LOAD_USERS must be a positive number');
if (!Number.isFinite(DURATION) || DURATION < 1) fail('LOAD_DURATION must be a positive number');

const accounts = ACCOUNTS.length ? ACCOUNTS : SINGLE;
if (!accounts.length) fail('set LOAD_EMAIL/LOAD_PASSWORD, or LOAD_ACCOUNTS="a@b:pw,c@d:pw"');
if (accounts.some((account) => !account.email || !account.password)) {
  fail('every account needs an email and a password');
}

/** Cookies are all a read-only session needs; CSRF only guards writes. */
function cookieHeader(response) {
  const raw = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  return raw
    .filter(Boolean)
    .map((line) => line.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
}

async function login(account) {
  const response = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ email: account.email, password: account.password }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = payload?.error?.code ?? response.status;
    // A second factor cannot be answered by a script; say so instead of
    // reporting a mysterious zero-throughput run.
    const hint = code === 'MFA_REQUIRED' ? ' (account uses a second factor — use one without it)' : '';
    fail(`login refused for ${account.email}: ${code}${hint}`);
  }
  const cookies = cookieHeader(response);
  if (!cookies) fail(`login for ${account.email} returned no session cookie`);
  return cookies;
}

const stats = new Map(ENDPOINTS.map((path) => [path, { ms: [], ok: 0, client: 0, server: 0, forbidden: 0 }]));
let requests = 0;

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function worker(cookies, deadline) {
  while (Date.now() < deadline) {
    for (const path of ENDPOINTS) {
      if (Date.now() >= deadline) break;
      const entry = stats.get(path);
      const started = performance.now();
      let status = 0;
      try {
        const response = await fetch(`${BASE_URL}${path}`, {
          headers: { Accept: 'application/json', Cookie: cookies },
        });
        status = response.status;
        // Drain so the connection is reusable and the timing includes the body.
        await response.arrayBuffer();
      } catch {
        status = -1;
      }
      const elapsed = performance.now() - started;
      entry.ms.push(elapsed);
      requests += 1;
      if (status === 403) entry.forbidden += 1;
      else if (status >= 200 && status < 300) entry.ok += 1;
      else if (status >= 500 || status === -1) entry.server += 1;
      else entry.client += 1;
    }
  }
}

const label = ACCOUNTS.length ? `${accounts.length} account(s)` : '1 account';
console.log(`load-test: ${USERS} concurrent sessions on ${label}, ${DURATION}s, ${ENDPOINTS.length} screens, target ${BASE_URL}`);
console.log('load-test: 25 sessions is an assumption, not a measurement — say what you actually expect');

const sessions = [];
for (const account of accounts) sessions.push(await login(account));
console.log(`load-test: logged in (${sessions.length}/${accounts.length})`);

const deadline = Date.now() + DURATION * 1000;
const startedAt = Date.now();
await Promise.all(
  Array.from({ length: USERS }, (_value, index) => worker(sessions[index % sessions.length], deadline)),
);
const seconds = (Date.now() - startedAt) / 1000;

let failed = 0;
console.log('');
console.log('screen                                    n     ok   4xx   5xx   p50    p95    max');
for (const [path, entry] of stats) {
  failed += entry.server;
  const bad = entry.client + entry.forbidden;
  console.log(
    `${path.padEnd(40)} ${String(entry.ms.length).padStart(5)} ${String(entry.ok).padStart(6)} ` +
      `${String(bad).padStart(5)} ${String(entry.server).padStart(5)} ` +
      `${`${percentile(entry.ms, 50).toFixed(0)}ms`.padStart(6)} ` +
      `${`${percentile(entry.ms, 95).toFixed(0)}ms`.padStart(6)} ` +
      `${`${Math.max(0, ...entry.ms).toFixed(0)}ms`.padStart(6)}`,
  );
}

const errorRate = requests ? failed / requests : 1;
console.log('');
console.log(`load-test: ${requests} requests in ${seconds.toFixed(1)}s (${(requests / seconds).toFixed(1)} req/s), 5xx ${(errorRate * 100).toFixed(2)}%`);

// 4xx are reported, not failed: a 403 means the test account lacks a module,
// which is the permission system working, not the server struggling.
if (failed > 0 || errorRate > MAX_ERROR_RATE) {
  console.error(`load-test: FAILED — ${failed} server error(s), ${(errorRate * 100).toFixed(2)}% above the ${(MAX_ERROR_RATE * 100).toFixed(0)}% ceiling`);
  process.exit(1);
}
console.log('load-test: PASSED — no server error, error rate under the ceiling');
