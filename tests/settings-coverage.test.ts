/**
 * A-29 — every rule value is a setting with a documented default.
 *
 * The registry itself is checked first (every key has an accepted default), then
 * the throttling settings are exercised on a real provisioned database: changing
 * the stored value changes the decision, without any literal left in the path.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { provisionDatabase } from '../server/db';
import {
  loginThrottle,
  purgeLoginAttempts,
  recordLoginFailure,
  recordSetupAttempt,
  setupThrottle,
} from '../server/lib/limits';
import { EXTRA_DEFAULTS, EXTRA_KEYS, isValidExtraValue } from '../server/lib/settings-extra';

type Row = Record<string, unknown>;

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
      const out = [];
      for (const statement of statements) out.push(await statement.run());
      return out;
    },
  } as unknown as D1Database;
}

async function fresh(): Promise<{ db: DatabaseSync; d1: D1Database }> {
  const db = new DatabaseSync(':memory:');
  const d1 = asD1(db);
  await provisionDatabase(d1);
  return { db, d1 };
}

function setExtra(db: DatabaseSync, key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings_extra (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, new Date().toISOString());
}

function oldFailure(db: DatabaseSync, email: string, minutesAgo: number): void {
  db.prepare(
    `INSERT INTO login_attempts (id, email, ip, successful, created_at) VALUES (?, ?, NULL, 0, ?)`,
  ).run(crypto.randomUUID(), email, new Date(Date.now() - minutesAgo * 60_000).toISOString());
}

describe('settings coverage (A-29)', () => {
  it('gives every registry key an accepted default', () => {
    for (const key of EXTRA_KEYS) {
      expect(EXTRA_DEFAULTS[key], key).toBeTruthy();
      expect(isValidExtraValue(key, EXTRA_DEFAULTS[key]), key).toBe(true);
    }
    expect(EXTRA_DEFAULTS.login_max_per_account).toBe('8');
    expect(EXTRA_DEFAULTS.login_max_per_ip).toBe('50');
    expect(EXTRA_DEFAULTS.login_window_minutes).toBe('15');
    expect(EXTRA_DEFAULTS.setup_max_attempts_per_ip).toBe('5');
  });

  it('takes the account quota from the setting, not a literal', async () => {
    const { db, d1 } = await fresh();
    const email = 'owner@example.test';
    for (let index = 0; index < 8; index += 1) {
      expect(await recordLoginFailure(d1, { email, ip: null })).toBe(true);
    }
    expect(await recordLoginFailure(d1, { email, ip: null })).toBe(false);
    expect((await loginThrottle(d1, { email, ip: null })).blocked).toBe(true);

    setExtra(db, 'login_max_per_account', '2');
    const tighter = 'second@example.test';
    expect(await recordLoginFailure(d1, { email: tighter, ip: null })).toBe(true);
    expect(await recordLoginFailure(d1, { email: tighter, ip: null })).toBe(true);
    expect(await recordLoginFailure(d1, { email: tighter, ip: null })).toBe(false);
    expect((await loginThrottle(d1, { email: tighter, ip: null })).blocked).toBe(true);
  });

  it('takes the failure window from the setting', async () => {
    const { db, d1 } = await fresh();
    const email = 'window@example.test';
    for (let index = 0; index < 8; index += 1) oldFailure(db, email, 20);

    expect((await loginThrottle(d1, { email, ip: null })).blocked).toBe(false);
    setExtra(db, 'login_window_minutes', '60');
    expect((await loginThrottle(d1, { email, ip: null })).blocked).toBe(true);
  });

  it('takes the address quota from the setting', async () => {
    const { db, d1 } = await fresh();
    setExtra(db, 'login_max_per_account', '100');
    setExtra(db, 'login_max_per_ip', '2');
    const ip = '10.6.0.3';
    expect(await recordLoginFailure(d1, { email: 'one@example.test', ip })).toBe(true);
    expect(await recordLoginFailure(d1, { email: 'two@example.test', ip })).toBe(true);
    expect(await recordLoginFailure(d1, { email: 'three@example.test', ip })).toBe(false);
    expect((await loginThrottle(d1, { email: 'three@example.test', ip })).blocked).toBe(true);
  });

  it('takes the installation budget from the setting', async () => {
    const { db, d1 } = await fresh();
    setExtra(db, 'setup_max_attempts_per_ip', '2');
    const context = { key: 'setup:install', ip: '10.6.0.4' };
    expect((await setupThrottle(d1, context)).blocked).toBe(false);
    await recordSetupAttempt(d1, context);
    await recordSetupAttempt(d1, context);
    expect((await setupThrottle(d1, context)).blocked).toBe(true);
  });

  it('takes the failed-attempt retention from the setting', async () => {
    const { db, d1 } = await fresh();
    setExtra(db, 'login_attempt_retention_days', '1');
    oldFailure(db, 'old@example.test', 60 * 48);
    db.prepare(
      `INSERT INTO login_attempts (id, email, ip, successful, created_at) VALUES (?, ?, NULL, 0, ?)`,
    ).run(crypto.randomUUID(), 'recent@example.test', new Date().toISOString());

    expect(await purgeLoginAttempts(d1)).toBe(1);
    expect(
      Number((db.prepare('SELECT COUNT(*) AS value FROM login_attempts').get() as { value: number }).value),
    ).toBe(1);
  });
});
