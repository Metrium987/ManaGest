import { nowISO } from '../db';
import { getExtra } from './settings-extra';

/**
 * A-20: login throttling. The account quota stops a targeted lockout from being
 * cheap; the IP quota stops one host from spraying many accounts. Both are
 * sliding windows over `login_attempts`, and a failure is recorded by a single
 * conditional INSERT so concurrent attempts cannot overshoot the quota.
 */
interface LoginLimits {
  windowMinutes: number;
  perAccount: number;
  perIp: number;
}

/** A-29: every threshold that decides a refusal is a workspace setting. */
async function loginLimits(database: D1Database): Promise<LoginLimits> {
  return {
    windowMinutes: Number(await getExtra(database, 'login_window_minutes')),
    perAccount: Number(await getExtra(database, 'login_max_per_account')),
    perIp: Number(await getExtra(database, 'login_max_per_ip')),
  };
}

export interface LoginAttemptContext {
  email: string;
  ip: string | null;
}

export interface ThrottleDecision {
  blocked: boolean;
  retryAfterSeconds: number;
}

function windowStart(now: Date, minutes: number): string {
  return new Date(now.getTime() - minutes * 60_000).toISOString();
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
function waitSeconds(oldest: string | null, now: Date, minutes: number): number {
  if (!oldest) return Math.max(1, minutes * 60);
  const expiresAt = new Date(oldest).getTime() + minutes * 60_000;
  return Math.max(1, Math.ceil((expiresAt - now.getTime()) / 1000));
}

export async function loginThrottle(
  database: D1Database,
  context: LoginAttemptContext,
  now = new Date(),
): Promise<ThrottleDecision> {
  const limits = await loginLimits(database);
  const cutoff = windowStart(now, limits.windowMinutes);
  const account = await failures(database, 'email', context.email, cutoff);
  if (account.count >= limits.perAccount) {
    return { blocked: true, retryAfterSeconds: waitSeconds(account.oldest, now, limits.windowMinutes) };
  }
  if (context.ip) {
    const address = await failures(database, 'ip', context.ip, cutoff);
    if (address.count >= limits.perIp) {
      return { blocked: true, retryAfterSeconds: waitSeconds(address.oldest, now, limits.windowMinutes) };
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
  const limits = await loginLimits(database);
  const cutoff = windowStart(now, limits.windowMinutes);
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
      context.email, cutoff, limits.perAccount,
      context.ip, context.ip, cutoff, limits.perIp,
    )
    .first<{ id: string }>();
  return Boolean(row?.id);
}

/**
 * A-23: installation and break-glass recovery are one-shot endpoints, so they
 * get their own per-IP budget instead of the account login quota. Five attempts
 * per window, counted under a reserved key, then `429` until the window slides.
 */
export async function setupThrottle(
  database: D1Database,
  context: { key: string; ip: string },
  now = new Date(),
): Promise<ThrottleDecision> {
  const windowMinutes = Number(await getExtra(database, 'setup_window_minutes'));
  const maxAttempts = Number(await getExtra(database, 'setup_max_attempts_per_ip'));
  const cutoff = new Date(now.getTime() - windowMinutes * 60_000).toISOString();
  const row = await database
    .prepare(
      `SELECT COUNT(*) AS count, MIN(created_at) AS oldest FROM login_attempts
       WHERE email = ? AND ip = ? AND successful = 0 AND created_at >= ?`,
    )
    .bind(context.key, context.ip, cutoff)
    .first<{ count: number; oldest: string | null }>();
  if (Number(row?.count ?? 0) < maxAttempts) {
    return { blocked: false, retryAfterSeconds: 0 };
  }
  const expiresAt = new Date(row?.oldest ?? now.toISOString()).getTime()
    + windowMinutes * 60_000;
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
  const days = Number(await getExtra(database, 'login_attempt_retention_days'));
  const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
  const result = await database
    .prepare(`DELETE FROM login_attempts WHERE created_at < ?`)
    .bind(cutoff)
    .run();
  return Number((result as { meta?: { changes?: number } }).meta?.changes ?? 0);
}
