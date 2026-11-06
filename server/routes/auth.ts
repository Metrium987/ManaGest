import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { nowISO, one } from '../db';
import { logActivity } from '../lib/audit';
import {
  DUMMY_PASSWORD_HASH, constantTimeEqual, hashPassword, randomToken, sha256Hex, verifyPassword,
} from '../lib/crypto';
import { fail } from '../lib/errors';
import { validatePassword } from '../lib/passwords';
import { loginThrottle, maskedEmail, recordLoginFailure } from '../lib/limits';
import {
  generateRecoveryCodes, generateTotpSecret, groupSecret, normalizeRecoveryCode, otpauthUri,
  verifyTotp,
} from '../lib/totp';
import { resolveUserPermissions } from '../services/roles';
import { parseInput } from '../lib/validation';
import { clientIp, loadCompany, requireAuth } from '../middleware';
import { createSession, destroySession } from '../services/session';
import { readMailConfig } from '../services/email';
import type { AppEnv, CompanyRow, UserRow } from '../types';


const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
  password: z.string().min(1).max(200),
});

const passwordSchema = z.object({
  current_password: z.string().min(1).max(200),
  new_password: z.string().min(1).max(200),
});

const mfaChallengeSchema = z.object({
  challenge: z.string().min(10).max(200),
  code: z.string().min(4).max(20),
});

async function loginPayload(user: UserRow, database: D1Database) {
  return {
    user: {
      id: user.id,
      email: user.email,
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
      // A per-user permission list is resolved here too, otherwise the interface
      // gates on the fixed role while the API already applies the custom list.
      permissions: await resolveUserPermissions(database, user),
    },
  };
}

/**
 * A-22: changing an authentication factor needs the current password, not just
 * a session. A wrong password is counted by the login throttle (A-20) and never
 * accepted twice: there is no stored "re-authenticated" window to reuse.
 */
async function assertCurrentPassword(c: Context<AppEnv>, password: string | undefined): Promise<void> {
  const user = c.get('user')!;
  const row = await c.env.DB.prepare(`SELECT email, password_hash FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ email: string; password_hash: string }>();
  const email = row?.email ?? user.email;
  const ip = clientIp(c);
  const valid = Boolean(password)
    && (await verifyPassword(String(password), row?.password_hash ?? DUMMY_PASSWORD_HASH));
  if (valid) return;
  const recorded = await recordLoginFailure(c.env.DB, { email, ip });
  if (!recorded) {
    const decision = await loginThrottle(c.env.DB, { email, ip });
    return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(decision.retryAfterSeconds) });
  }
  return fail(401, 'INVALID_CREDENTIALS');
}

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', async (c) => {
  const company = await loadCompany(c.env.DB);
  if (!company) return fail(409, 'SETUP_REQUIRED');

  const body = parseInput(loginSchema, await c.req.json().catch(() => ({})));
  const ip = clientIp(c);

  // A-20: both quotas are checked before any password work, so a throttled
  // caller learns nothing about the account by timing.
  const throttle = await loginThrottle(c.env.DB, { email: body.email, ip });
  if (throttle.blocked) {
    await logActivity(c.env.DB, {
      userId: null,
      action: 'login_blocked',
      entityType: 'auth',
      entityId: maskedEmail(body.email),
      summary: 'activity.login_blocked',
      meta: { reason: 'throttle', retry_after: throttle.retryAfterSeconds, ip },
      ip,
    });
    return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(throttle.retryAfterSeconds) });
  }

  const user = await c.env.DB.prepare(
    `SELECT * FROM users WHERE email = ? AND deleted_at IS NULL AND is_active = 1`,
  )
    .bind(body.email)
    .first<UserRow>();

  const hash = user?.password_hash ?? DUMMY_PASSWORD_HASH;
  const valid = await verifyPassword(body.password, hash);

  if (!valid || !user) {
    // A-20: the failure is recorded by one conditional INSERT. If the quota
    // refuses it, the attempt is throttled instead of merely refused.
    const recorded = await recordLoginFailure(c.env.DB, { email: body.email, ip });
    if (!recorded) {
      const decision = await loginThrottle(c.env.DB, { email: body.email, ip });
      await logActivity(c.env.DB, {
        userId: null,
        action: 'login_blocked',
        entityType: 'auth',
        entityId: maskedEmail(body.email),
        summary: 'activity.login_blocked',
        meta: { reason: 'quota', retry_after: decision.retryAfterSeconds, ip },
        ip,
      });
      return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(decision.retryAfterSeconds) });
    }
    return fail(401, 'INVALID_CREDENTIALS');
  }

  await c.env.DB.prepare(
    `INSERT INTO login_attempts (id, email, ip, successful, created_at) VALUES (?, ?, ?, 1, ?)`,
  )
    .bind(crypto.randomUUID(), body.email, ip, nowISO())
    .run();

  await c.env.DB.prepare(`DELETE FROM login_attempts WHERE email = ? AND successful = 0`)
    .bind(body.email)
    .run();

  // Second factor: mint a five-minute single-use challenge instead of a
  // session; the session only exists once the authenticator app answers it.
  if (user.mfa_enabled) {
    await c.env.DB.prepare(
      `DELETE FROM mfa_challenges WHERE user_id = ? AND (used_at IS NOT NULL OR expires_at < ?)`,
    )
      .bind(user.id, nowISO())
      .run();

    const challenge = randomToken(32);
    await c.env.DB.prepare(
      `INSERT INTO mfa_challenges (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    )
      .bind(
        crypto.randomUUID(),
        user.id,
        await sha256Hex(challenge),
        new Date(Date.now() + 5 * 60_000).toISOString(),
        nowISO(),
      )
      .run();

    return c.json({ mfa_required: true, challenge });
  }

  await c.env.DB.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`)
    .bind(nowISO(), user.id)
    .run();

  await createSession(c, user, company);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'login',
    entityType: 'session',
    entityId: user.id,
    summary: 'activity.login',
    meta: { ip },
  });

  return c.json(await loginPayload(user, c.env.DB));
});

/**
 * Completes the login when the account has a second factor: consumes the
 * challenge once, accepts either a TOTP code or a recovery code, and only then
 * creates the session. Failures are counted like password failures.
 */
authRoutes.post('/mfa/verify', async (c) => {
  const company = await loadCompany(c.env.DB);
  if (!company) return fail(409, 'SETUP_REQUIRED');

  const body = parseInput(mfaChallengeSchema, await c.req.json().catch(() => ({})));
  const ip = clientIp(c);

  const challenge = await c.env.DB.prepare(
    `SELECT c.id, c.user_id, c.expires_at, c.used_at, u.email, u.mfa_secret, u.mfa_codes,
            u.is_active, u.deleted_at
     FROM mfa_challenges c JOIN users u ON u.id = c.user_id
     WHERE c.token_hash = ?`,
  )
    .bind(await sha256Hex(body.challenge))
    .first<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
      email: string;
      mfa_secret: string | null;
      mfa_codes: string | null;
      is_active: number;
      deleted_at: string | null;
    }>();

  if (
    !challenge ||
    challenge.used_at ||
    challenge.expires_at <= nowISO() ||
    !challenge.is_active ||
    challenge.deleted_at ||
    !challenge.mfa_secret
  ) {
    return fail(401, 'INVALID_CREDENTIALS');
  }

  const throttle = await loginThrottle(c.env.DB, { email: challenge.email, ip });
  if (throttle.blocked) {
    return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(throttle.retryAfterSeconds) });
  }

  const code = body.code.trim();
  const isTotp = /^\d{6}$/.test(code);
  const totpOk = isTotp ? await verifyTotp(challenge.mfa_secret, code) : false;

  let remainingCodes: string[] | null = null;
  if (!totpOk && !isTotp && challenge.mfa_codes) {
    try {
      const stored = JSON.parse(challenge.mfa_codes) as string[];
      const digest = await sha256Hex(normalizeRecoveryCode(code));
      const index = stored.findIndex((hash) => constantTimeEqual(hash, digest));
      if (index >= 0) remainingCodes = stored.filter((_, position) => position !== index);
    } catch {
      remainingCodes = null;
    }
  }

  if (!totpOk && remainingCodes === null) {
    const recorded = await recordLoginFailure(c.env.DB, { email: challenge.email, ip });
    if (!recorded) {
      const decision = await loginThrottle(c.env.DB, { email: challenge.email, ip });
      return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(decision.retryAfterSeconds) });
    }
    return fail(401, 'INVALID_CODE');
  }

  const user = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(challenge.user_id)
    .first<UserRow>();
  if (!user) return fail(401, 'INVALID_CREDENTIALS');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE mfa_challenges SET used_at = ? WHERE id = ?`).bind(nowISO(), challenge.id),
    c.env.DB.prepare(`UPDATE users SET last_login_at = ?, mfa_codes = ? WHERE id = ?`).bind(
      nowISO(),
      remainingCodes ? JSON.stringify(remainingCodes) : user.mfa_codes,
      user.id,
    ),
    c.env.DB.prepare(`DELETE FROM login_attempts WHERE email = ? AND successful = 0`).bind(challenge.email),
    c.env.DB.prepare(`DELETE FROM mfa_challenges WHERE user_id = ? AND used_at IS NULL`).bind(user.id),
  ]);

  await createSession(c, user, company);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'login',
    entityType: 'session',
    entityId: user.id,
    summary: remainingCodes ? 'activity.login_recovery' : 'activity.login',
    meta: { ip, mfa: true, recovery: Boolean(remainingCodes) },
    ip,
  });

  return c.json(await loginPayload(user, c.env.DB));
});

/** Stores a fresh secret (not yet active); activation needs a valid code. */
authRoutes.post('/mfa/setup', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ current_password: z.string().max(200).optional() }),
    await c.req.json().catch(() => ({})),
  );
  await assertCurrentPassword(c, body.current_password);
  const row = await c.env.DB.prepare(`SELECT mfa_enabled FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ mfa_enabled: number }>();
  if (row?.mfa_enabled) return fail(409, 'MFA_ALREADY_ENABLED');

  const secret = generateTotpSecret();
  await c.env.DB.prepare(`UPDATE users SET mfa_secret = ?, updated_at = ? WHERE id = ?`)
    .bind(secret, nowISO(), user.id)
    .run();

  return c.json({ secret: groupSecret(secret), otpauth_uri: otpauthUri(secret, user.email) });
});

/** Activates MFA and returns the one-time set of recovery codes. */
authRoutes.post('/mfa/enable', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ code: z.string().min(4).max(20), current_password: z.string().max(200).optional() }),
    await c.req.json().catch(() => ({})),
  );
  await assertCurrentPassword(c, body.current_password);
  const row = await c.env.DB.prepare(`SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ mfa_secret: string | null; mfa_enabled: number }>();
  if (row?.mfa_enabled) return fail(409, 'MFA_ALREADY_ENABLED');
  if (!row?.mfa_secret) return fail(409, 'MFA_SETUP_REQUIRED');
  if (!(await verifyTotp(row.mfa_secret, body.code))) return fail(401, 'INVALID_CODE');

  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((value) => sha256Hex(normalizeRecoveryCode(value))));
  await c.env.DB.prepare(
    `UPDATE users SET mfa_enabled = 1, mfa_codes = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(JSON.stringify(hashes), nowISO(), user.id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'enabled',
    entityType: 'user',
    entityId: user.id,
    summary: 'activity.mfa_enabled',
    ip: clientIp(c),
  });

  return c.json({ recovery_codes: codes });
});

authRoutes.post('/mfa/disable', requireAuth, async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      code: z.string().max(20).optional(),
      current_password: z.string().max(200).optional(),
    }),
    await c.req.json().catch(() => ({})),
  );
  const row = await c.env.DB.prepare(
    `SELECT mfa_secret, mfa_codes, mfa_enabled FROM users WHERE id = ?`,
  )
    .bind(user.id)
    .first<{ mfa_secret: string | null; mfa_codes: string | null; mfa_enabled: number }>();
  if (!row?.mfa_enabled) return fail(409, 'MFA_NOT_ENABLED');

  const code = (body.code ?? '').trim();
  const isTotp = /^\d{6}$/.test(code);
  let ok = isTotp && row.mfa_secret ? await verifyTotp(row.mfa_secret, code) : false;
  if (!ok && !isTotp && row.mfa_codes) {
    try {
      const stored = JSON.parse(row.mfa_codes) as string[];
      const digest = await sha256Hex(normalizeRecoveryCode(code));
      ok = stored.some((hash) => constantTimeEqual(hash, digest));
    } catch {
      ok = false;
    }
  }
  if (!ok && body.current_password) {
    const account = await c.env.DB.prepare(`SELECT password_hash FROM users WHERE id = ?`)
      .bind(user.id)
      .first<{ password_hash: string }>();
    ok = await verifyPassword(body.current_password, account?.password_hash ?? DUMMY_PASSWORD_HASH);
  }
  if (!ok) {
    const recorded = await recordLoginFailure(c.env.DB, { email: user.email, ip: clientIp(c) });
    if (!recorded) {
      const decision = await loginThrottle(c.env.DB, { email: user.email, ip: clientIp(c) });
      return fail(429, 'TOO_MANY_ATTEMPTS', { retry_after: String(decision.retryAfterSeconds) });
    }
    return fail(401, 'INVALID_CREDENTIALS');
  }

  await c.env.DB.prepare(
    `UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_codes = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(nowISO(), user.id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'disabled',
    entityType: 'user',
    entityId: user.id,
    summary: 'activity.mfa_disabled',
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

authRoutes.post('/logout', requireAuth, async (c) => {
  const session = c.get('session');
  const user = c.get('user');
  if (session) {
    await destroySession(c, session.id);
    await logActivity(c.env.DB, {
      userId: user?.id ?? null,
      action: 'logout',
      entityType: 'session',
      entityId: session.id,
      summary: 'activity.logout',
    });
  }
  return c.json({ ok: true });
});

authRoutes.get('/me', requireAuth, async (c) => {
  const user = c.get('user')!;
  const company = c.get('company') as CompanyRow;
  const mfa = await c.env.DB.prepare(`SELECT mfa_enabled FROM users WHERE id = ?`)
    .bind(user.id)
    .first<{ mfa_enabled: number }>();
  return c.json({
    user: { ...user, mfa_enabled: Boolean(mfa?.mfa_enabled) },
    company,
    // The session already carries the permissions resolved for this account.
    permissions: user.permissions,
  });
});

authRoutes.patch('/profile', requireAuth, async (c) => {
  const body = parseInput(
    z.object({
      first_name: z.string().trim().min(1).max(80),
      last_name: z.string().trim().min(1).max(80),
      email: z.string().trim().toLowerCase().email().max(190),
    }),
    await c.req.json().catch(() => ({})),
  );
  const user = c.get('user')!;

  const duplicate = await c.env.DB.prepare(
    `SELECT id FROM users WHERE email = ? AND id <> ? AND deleted_at IS NULL`,
  )
    .bind(body.email, user.id)
    .first<{ id: string }>();
  if (duplicate) return fail(409, 'EMAIL_TAKEN');

  await c.env.DB.prepare(
    `UPDATE users SET first_name = ?, last_name = ?, email = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(body.first_name, body.last_name, body.email, nowISO(), user.id)
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'user',
    entityId: user.id,
    summary: 'activity.profile_updated',
  });

  return c.json({ ok: true });
});

authRoutes.post('/change-password', requireAuth, async (c) => {
  const body = parseInput(passwordSchema, await c.req.json().catch(() => ({})));
  const user = c.get('user')!;
  const session = c.get('session')!;

  const row = await c.env.DB.prepare(`SELECT * FROM users WHERE id = ?`)
    .bind(user.id)
    .first<UserRow>();
  if (!row) return fail(404, 'NOT_FOUND');

  const valid = await verifyPassword(body.current_password, row.password_hash);
  if (!valid) return fail(401, 'INVALID_CREDENTIALS');

  validatePassword({
    password: body.new_password,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
  });

  const hashed = await hashPassword(body.new_password);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(
      hashed,
      nowISO(),
      user.id,
    ),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`).bind(user.id, session.id),
  ]);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'user',
    entityId: user.id,
    summary: 'activity.password_changed',
  });

  return c.json({ ok: true });
});

/* ------------------------------------------------------- password reset */

const forgotPasswordSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(190),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(20).max(200),
  password: z.string().min(1).max(200),
});

const RESET_TTL_MINUTES = 60;
const RESET_MAX_PER_HOUR = 5;

/**
 * Public by design: a locked-out user has no session. The answer is the same
 * whether or not the address exists, so the route cannot be used to discover
 * accounts; only the mailbox holder learns anything, by receiving the link.
 * Without a configured provider the flow stays silent but successful.
 */
authRoutes.post('/forgot-password', async (c) => {
  const company = await loadCompany(c.env.DB);
  if (!company) return fail(409, 'SETUP_REQUIRED');

  const body = parseInput(forgotPasswordSchema, await c.req.json().catch(() => ({})));
  const ip = clientIp(c);
  const cutoff = new Date(Date.now() - 60 * 60_000).toISOString();
  const recent = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM password_reset_tokens WHERE requested_ip = ? AND created_at >= ?`,
  )
    .bind(ip, cutoff)
    .first<{ count: number }>();
  if ((recent?.count ?? 0) >= RESET_MAX_PER_HOUR) return fail(429, 'TOO_MANY_ATTEMPTS');

  const user = await c.env.DB.prepare(
    `SELECT id, email, first_name FROM users
     WHERE email = ? AND deleted_at IS NULL AND is_active = 1`,
  )
    .bind(body.email)
    .first<{ id: string; email: string; first_name: string }>();
  if (!user) return c.json({ ok: true });

  const config = await readMailConfig(c.env.DB);
  if (config.provider === 'manual') return c.json({ ok: true });

  const token = randomToken(32);
  const now = nowISO();
  const expiresAt = new Date(Date.now() + RESET_TTL_MINUTES * 60_000).toISOString();
  await c.env.DB.batch([
    // Previous links stop working, but the rows stay for the hourly quota.
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE user_id = ? AND used_at IS NULL`).bind(now, user.id),
    c.env.DB.prepare(`DELETE FROM password_reset_tokens WHERE created_at < ?`)
      .bind(new Date(Date.now() - 24 * 60 * 60_000).toISOString()),
    c.env.DB.prepare(
      `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), user.id, await sha256Hex(token), expiresAt, ip, now),
  ]);

  const link = `${new URL(c.req.url).origin}/reinitialiser-mot-de-passe?token=${token}`;
  try {
    const { dispatchMail } = await import('../services/email');
    await dispatchMail(config, {
      to: user.email,
      subject: `Réinitialisation de votre mot de passe — ${company.name}`,
      text: `Bonjour ${user.first_name},\n\nUne réinitialisation de mot de passe a été demandée pour votre compte ${company.name}.\n\nOuvrez ce lien pour choisir un nouveau mot de passe :\n${link}\n\nCe lien expire dans ${RESET_TTL_MINUTES} minutes et ne sert qu'une fois. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message : votre mot de passe reste inchangé.`,
    }, c.env);
  } catch {
    // A delivery failure must not change the answer: that would reveal the
    // address, and the user can simply ask again.
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'requested',
    entityType: 'user',
    entityId: user.id,
    summary: 'activity.password_reset_requested',
    ip,
  });

  return c.json({ ok: true });
});

/**
 * Consumes the link once, applies the password policy, revokes every existing
 * session and clears the other pending links of that account.
 */
authRoutes.post('/reset-password', async (c) => {
  const body = parseInput(resetPasswordSchema, await c.req.json().catch(() => ({})));
  const row = await c.env.DB.prepare(
    `SELECT r.id, r.user_id, r.expires_at, r.used_at,
            u.email, u.first_name, u.last_name, u.is_active, u.deleted_at
     FROM password_reset_tokens r JOIN users u ON u.id = r.user_id
     WHERE r.token_hash = ?`,
  )
    .bind(await sha256Hex(body.token))
    .first<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
      email: string;
      first_name: string;
      last_name: string;
      is_active: number;
      deleted_at: string | null;
    }>();

  if (!row || row.used_at || row.expires_at <= nowISO() || !row.is_active || row.deleted_at) {
    return fail(422, 'INVALID_RESET_TOKEN');
  }

  validatePassword({
    password: body.password,
    email: row.email,
    firstName: row.first_name,
    lastName: row.last_name,
  });

  const hashed = await hashPassword(body.password);
  const now = nowISO();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).bind(hashed, now, row.user_id),
    c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(row.user_id),
    c.env.DB.prepare(`DELETE FROM mfa_challenges WHERE user_id = ?`).bind(row.user_id),
    c.env.DB.prepare(`UPDATE password_reset_tokens SET used_at = ? WHERE id = ?`).bind(now, row.id),
    c.env.DB.prepare(`DELETE FROM password_reset_tokens WHERE user_id = ? AND id <> ?`).bind(row.user_id, row.id),
  ]);

  await logActivity(c.env.DB, {
    userId: row.user_id,
    action: 'updated',
    entityType: 'user',
    entityId: row.user_id,
    summary: 'activity.password_reset_completed',
    ip: clientIp(c),
  });

  return c.json({ ok: true });
});

authRoutes.get('/sessions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const session = c.get('session')!;
  const rows = await c.env.DB.prepare(
    `SELECT id, ip, user_agent, created_at, last_seen_at, expires_at FROM sessions
     WHERE user_id = ? ORDER BY last_seen_at DESC`,
  )
    .bind(user.id)
    .all<{ id: string; ip: string | null; user_agent: string | null; created_at: string; last_seen_at: string; expires_at: string }>();

  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, current: row.id === session.id })),
  });
});

authRoutes.delete('/sessions/:id', requireAuth, async (c) => {
  const user = c.get('user')!;
  const session = c.get('session')!;
  const id = c.req.param('id');
  if (id === session.id) return fail(400, 'CANNOT_REVOKE_CURRENT');

  await c.env.DB.prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`)
    .bind(id, user.id)
    .run();
  await logActivity(c.env.DB, { userId: user.id, action: 'revoked', entityType: 'session', entityId: id, summary: 'activity.session_revoked' });
  return c.json({ ok: true });
});

authRoutes.delete('/sessions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const session = c.get('session')!;
  const revoked = await c.env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND id <> ?`)
    .bind(user.id, session.id)
    .run();
  await logActivity(c.env.DB, { userId: user.id, action: 'revoked', entityType: 'session', entityId: null, summary: 'activity.sessions_revoked', meta: { count: revoked.meta.changes } });
  return c.json({ ok: true });
});

export async function ensureOwnerExists(db: D1Database): Promise<boolean> {
  const row = await one<{ count: number }>(
    db.prepare(`SELECT COUNT(*) AS count FROM users WHERE role = 'owner' AND deleted_at IS NULL`),
  );
  return (row?.count ?? 0) > 0;
}
