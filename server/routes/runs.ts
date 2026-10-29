import { Hono } from 'hono';
import { constantTimeEqual } from '../lib/crypto';
import { todayIn } from '../lib/dates';
import { fail } from '../lib/errors';
import { clientIp, loadCompany } from '../middleware';
import {
  claimDailyRun,
  finishDailyRun,
  registerRunAttempt,
  runDailyPipeline,
  runStatusFor,
  type RunStatus,
  type RunSummary,
} from '../services/daily-run';
import type { AppEnv } from '../types';

/**
 * The external scheduler's entry point (T-104a). It deliberately does **not**
 * accept a session: the caller is a machine, authenticated by a workspace
 * secret, so a stolen browser cookie can never trigger generation.
 */
export const runRoutes = new Hono<AppEnv>();

runRoutes.post('/daily', async (c) => {
  const secret = c.env.DAILY_RUN_TOKEN;
  if (!secret) return fail(503, 'DAILY_RUN_TOKEN_MISSING');

  const header = c.req.header('x-run-token');
  const bearer = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const provided = header ?? bearer;
  if (!provided || !constantTimeEqual(provided, secret)) return fail(401, 'INVALID_RUN_TOKEN');

  const ip = clientIp(c);
  const retryAfter = await registerRunAttempt(c.env.DB, ip);
  if (retryAfter > 0) return fail(429, 'RUN_RATE_LIMITED', { retry_after: String(retryAfter) });

  const company = await loadCompany(c.env.DB);
  if (!company) return fail(409, 'SETUP_REQUIRED');

  const day = todayIn(company.timezone);
  const claim = await claimDailyRun(c.env.DB, day, ip);
  if (!claim.claimed) {
    const run = claim.run ?? {};
    const summary = run.summary_json ? JSON.parse(String(run.summary_json)) : null;
    return c.json({
      ok: true,
      already_ran: true,
      day,
      run: {
        status: run.status ?? 'running',
        started_at: run.started_at ?? null,
        finished_at: run.finished_at ?? null,
        summary,
      },
    });
  }

  let summary: RunSummary;
  let status: RunStatus;
  try {
    summary = await runDailyPipeline(c.env.DB, company, { day, triggerIp: ip });
    status = runStatusFor(summary.generated.length, summary.failed.length, summary.skipped_reason);
  } catch {
    summary = { day, generated: [], failed: [{ id: 'run', code: 'INTERNAL_ERROR' }], templates: 0, truncated: false };
    status = 'failed';
  }

  await finishDailyRun(c.env.DB, day, status, summary);
  const payload = { ok: status !== 'failed', already_ran: false, day, status, summary };
  return c.json(payload, status === 'failed' ? 500 : 200);
});
