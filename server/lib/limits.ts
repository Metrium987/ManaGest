import { nowISO } from '../db';

/**
 * A-20: login throttling. The account quota stops a targeted lockout from being
 * cheap; the IP quota stops one host from spraying many accounts. Both are
 * sliding windows over `login_attempts`, and a failure is recorded by a single
 * conditional INSERT so concurrent attempts cannot overshoot the quota.
 */
export const LOGIN_WINDOW_MINUTES = 15;
export const LOGIN_MAX_PER_ACCOUNT = 8;
export const LOGIN_MAX_PER_IP = 50;
export const LOGIN_ATTEMPT_RETENTION_DAYS = 90;

export interface LoginAttemptContext {
  email: string;
  ip: string | null;
}

export interface ThrottleDecision {
  blocked: boolean;
  retryAfterSeconds: number;
}

function windowStart(now: Date): string {
  return new Date(now.getTime() - LOGIN_WINDOW_MINUTES * 60_000).toISOString();
}

async function failures(
  database: D1Database,
  column: 'email' | 'ip',
  value: string,
  cutoff: string,
): Promise<{ count: number; oldest: string | null }> {
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM login_attempts
       WHERE ${column} = ? AND successful = 0 AND created_at >= ?`,
    )
    .bind(value, cutoff)
    .first<{ count: number; oldest: string | null }>();
  return { count: Number(row?.count ?? 0), oldest: row?.oldest ?? null };
}

/** Seconds until the oldest failure of the blocking window expires. */
function waitSeconds(oldest: string | null, now: Date): number {
  if (!oldest) return Math.max(1, LOGIN_WINDOW_MINUTES * 60);
  const expiresAt = new Date(oldest).getTime() + LOGIN_WINDOW_MINUTES * 60_000;
  return Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1000));
}

export async function loginThrottle(
  database: D1Database,
  context: LoginAttemptContext,
  now = new Date(),
): Promise<ThrottleDecision> {
  const cutoff = windowStart(now);
  const account = await failures(database, 'email', context.email, cutoff);
  if (account.count >= LOGIN_MAX_PER_ACCOUNT) {
    return { blocked: true, retryAfterSeconds: waitSeconds(account.oldest, now) };
  }
  if (context.ip) {
    const address = await failures(database, 'ip', context.ip, cutoff);
    if (address.count >= LOGIN_MAX_PER_IP) {
      return { blocked: true, retryAfterSeconds: waitSeconds(address.oldest, now) };
    }
  }
  return { blocked: false, retryAfterSeconds: 0 };
}

/**
 * Records one failure only while both quotas still have room. `INSERT … SELECT …
 * WHERE` is a single statement, so twenty simultaneous attempts record exactly
 * the remaining quota and no more. Returns false when the row was refused.
 */
export async function recordLoginFailure(
  database: D1Database,
  context: LoginAttemptContext,
  now = new Date(),
): Promise<boolean> {
  const cutoff = windowStart(now);
  const row = await database
    .prepare(
      `INSERT INTO login_attempts (id, email, ip, successful, created_at)
       SELECT ?, ?, ?, 0, ?
       WHERE (SELECT COUNT(*) FROM login_attempts
              WHERE email = ? AND successful = 0 AND created_at >= ?) < ?
         AND (? IS NULL OR (SELECT COUNT(*) FROM login_attempts
              WHERE ip = ? AND successful = 0 AND created_at >= ?) < ?)
       RETURNING id`,
    )
    .bind(
      crypto.randomUUID(), context.email, context.ip, nowISO(),
      context.email, cutoff, LOGIN_MAX_PER_ACCOUNT,
      context.ip, context.ip, cutoff, LOGIN_MAX_PER_IP,
    )
    .first<{ id: string }>();
  return Boolean(row?.id);
}

/**
 * A-23: installation and break-glass recovery are one-shot endpoints, so they
 * get their own per-IP budget instead of the account login quota. Five attempts
 * per window, counted under a reserved key, then `429` until the window slides.
 */
export const SETUP_WINDOW_MINUTES = 15;
export const SETUP_MAX_ATTEMPTS_PER_IP = 5;

export async function setupThrottle(
  database: D1Database,
  context: { key: string; ip: string },
  now = new Date(),
): Promise<ThrottleDecision> {
  const cutoff = new Date(now.getTime() - SETUP_WINDOW_MINUTES * 60_000).toISOString();
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM login_attempts
       WHERE email = ? AND ip = ? AND successful = 0 AND created_at >= ?`,
    )
    .bind(context.key, context.ip, cutoff)
    .first<{ count: number; oldest: string | null }>();
  if (Number(row?.count ?? 0) < SETUP_MAX_ATTEMPTS_PER_IP) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  const expiresAt = new Date(row?.oldest ?? now.toISOString()).getTime()
    + SETUP_WINDOW_MINUTES * 60_000;
  return { blocked: true, retryAfterSeconds: Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1000)) };
}

/** Records one installation attempt, whether it succeeds or not. */
export async function recordSetupAttempt(
  database: D1Database,
  context: { key: string; ip: string },
): Promise<void> {
  await database
    .prepare(`INSERT INTO login_attempts (id, email, ip, successful, created_at) VALUES (?, ?, ?, 0, ?)`)
    .bind(crypto.randomUUID(), context.key, context.ip, nowISO())
    .run();
}

/** Never journal a full address: the journal is readable by more roles. */
export function maskedEmail(email: string): string {
  const at = email.indexOf('@');
  return at <= 0 ? '***' : `${email.slice(0, 1)}***${email.slice(at)}`;
}

/** A-20 step 3: attempts older than the retention window leave the daily pass. */
export async function purgeLoginAttempts(database: D1Database, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - LOGIN_ATTEMPT_RETENTION_DAYS * 86_400_000).toISOString();
  const result = await database
    .prepare(`DELETE FROM login_attempts WHERE created_at < ?`)
    .bind(cutoff)
    .run();
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}
