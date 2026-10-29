import { Hono } from 'hono';
import { z } from 'zod';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import { decideApproval, listApprovals } from '../services/approvals';
import type { AppEnv } from '../types';

/** Approval queue (AUDIT §7 P0.5). Deciding is a control act, journaled. */
export const approvalRoutes = new Hono<AppEnv>();
approvalRoutes.use('*', requireAuth);

approvalRoutes.get('/', requirePermission('approvals.read'), async (c) => {
  const status = c.req.query('status') ?? '';
  const allowed = ['pending', 'approved', 'rejected'];
  if (status && !allowed.includes(status)) return fail(422, 'VALIDATION_ERROR', { status: 'unknown' });
  return c.json({ data: await listApprovals(c.env.DB, status || null) });
});

const decisionSchema = z.object({
  note: z.string().trim().max(500).nullish(),
});

approvalRoutes.post('/:id/approve', requirePermission('approvals.write'), async (c) => {
  const body = parseInput(decisionSchema, await c.req.json().catch(() => ({})));
  const user = c.get('user')!;
  await decideApproval(c.env.DB, {
    id: c.req.param('id'), decision: 'approved', userId: user.id, note: body.note ?? null,
  });
  return c.json({ ok: true, ip: clientIp(c) });
});

approvalRoutes.post('/:id/reject', requirePermission('approvals.write'), async (c) => {
  const body = parseInput(
    z.object({ note: z.string().trim().min(1).max(500) }),
    await c.req.json().catch(() => ({})),
  );
  const user = c.get('user')!;
  await decideApproval(c.env.DB, {
    id: c.req.param('id'), decision: 'rejected', userId: user.id, note: body.note,
  });
  return c.json({ ok: true });
});
