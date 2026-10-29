import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import {
  parseThresholds, ruleFor, violatesSeparation,
  type ApprovalEntity, type Thresholds,
} from '../lib/approvals';
import { fail } from '../lib/errors';
import { getExtra, type ExtraKey } from '../lib/settings-extra';

/**
 * Approval service (AUDIT §7 P0.5). Thresholds are settings; a rule set to 0 is
 * simply off. An approval is requested once per document (unique key), and the
 * decision can never be taken by the person who asked for it — that is the whole
 * point of a second pair of eyes.
 */

const THRESHOLD_KEYS: ExtraKey[] = [
  'approval_credit_amount',
  'approval_expense_amount',
  'approval_discount_percent',
  'separation_of_duties',
];

export async function approvalThresholds(database: D1Database): Promise<Thresholds> {
  const raw: Record<string, string> = {};
  for (const key of THRESHOLD_KEYS) raw[key] = await getExtra(database, key);
  return parseThresholds(raw);
}

export interface ApprovalRow {
  id: string;
  entity_type: string;
  entity_id: string;
  amount: number;
  rule: string;
  status: string;
  requested_by: string | null;
  decided_by: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
}

export async function approvalOf(
  database: D1Database,
  entityType: ApprovalEntity,
  entityId: string,
): Promise<ApprovalRow | null> {
  return database
    .prepare(`SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ?`)
    .bind(entityType, entityId)
    .first<ApprovalRow>();
}

/**
 * Records the approval request if the document crosses a configured threshold,
 * then refuses the action while it is still pending. An approved or rejected
 * decision is respected: only `pending` blocks.
 */
export async function requireApprovalIfNeeded(
  database: D1Database,
  input: {
    entityType: ApprovalEntity;
    entityId: string;
    amount: number;
    discountPercent?: number;
    requestedBy: string;
  },
): Promise<void> {
  const limits = await approvalThresholds(database);
  const rule = ruleFor(input.entityType, { amount: input.amount, discountPercent: input.discountPercent }, limits);
  if (!rule) return;

  const existing = await approvalOf(database, input.entityType, input.entityId);
  if (!existing) {
    await database
      .prepare(
        `INSERT INTO approvals (id, entity_type, entity_id, amount, rule, status, requested_by, created_at)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .bind(crypto.randomUUID(), input.entityType, input.entityId, Math.round(input.amount), rule, input.requestedBy, nowISO())
      .run();
    await logActivity(database, {
      userId: input.requestedBy, action: 'requested', entityType: 'approval', entityId: input.entityId,
      summary: 'activity.approval_requested', meta: { entity: input.entityType, rule, amount: input.amount },
    });
    return fail(409, 'APPROVAL_REQUIRED', { rule });
  }
  if (existing.status === 'rejected') return fail(409, 'APPROVAL_REJECTED');
  if (existing.status === 'pending') return fail(409, 'APPROVAL_REQUIRED', { rule: existing.rule });
}

/** Separation of duties: the creator cannot collect what they issued. */
export async function assertSeparation(
  database: D1Database,
  creatorId: string | null,
  actorId: string,
): Promise<void> {
  const limits = await approvalThresholds(database);
  if (violatesSeparation(limits.separation, creatorId, actorId)) {
    fail(403, 'SEPARATION_OF_DUTIES');
  }
}

export async function decideApproval(
  database: D1Database,
  input: { id: string; decision: 'approved' | 'rejected'; userId: string; note: string | null },
): Promise<void> {
  const row = await database.prepare(`SELECT * FROM approvals WHERE id = ?`)
    .bind(input.id).first<ApprovalRow>();
  if (!row) return fail(404, 'NOT_FOUND');
  if (row.status !== 'pending') return fail(409, 'ALREADY_DECIDED');
  if (row.requested_by && row.requested_by === input.userId) return fail(403, 'SAME_APPROVER');

  await database
    .prepare(`UPDATE approvals SET status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(input.decision, input.userId, input.note, nowISO(), input.id)
    .run();

  await logActivity(database, {
    userId: input.userId, action: input.decision, entityType: 'approval', entityId: row.entity_id,
    summary: input.decision === 'approved' ? 'activity.approval_approved' : 'activity.approval_rejected',
    meta: { entity: row.entity_type, rule: row.rule, amount: row.amount },
    before: { status: 'pending' }, after: { status: input.decision },
  });
}

export async function listApprovals(
  database: D1Database,
  status: string | null,
): Promise<ApprovalRow[]> {
  const rows = await database
    .prepare(
      `SELECT a.*, u.email AS requested_email, d.email AS decided_email
       FROM approvals a
       LEFT JOIN users u ON u.id = a.requested_by
       LEFT JOIN users d ON d.id = a.decided_by
       ${status ? 'WHERE a.status = ?' : ''}
       ORDER BY a.created_at DESC LIMIT 200`,
    )
    .bind(...(status ? [status] : []))
    .all<ApprovalRow>();
  return rows.results ?? [];
}
