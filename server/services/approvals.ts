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
 * simply off. The decision can never be taken by the person who asked for it.
 *
 * A-06: an approval covers **one** amount and one discount. Raising either after
 * approval, or resubmitting after a refusal, opens a new revision instead of
 * being silently accepted or blocked forever. Superseded requests stay as history.
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
  revision: number;
  amount: number;
  controlled_amount: number;
  controlled_discount: number | null;
  rule: string;
  status: string;
  requested_by: string | null;
  decided_by: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  superseded_at: string | null;
}

/** The latest revision is the only one that governs the document. */
export async function approvalOf(
  database: D1Database,
  entityType: ApprovalEntity,
  entityId: string,
): Promise<ApprovalRow | null> {
  return database
    .prepare(`SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ? ORDER BY revision DESC LIMIT 1`)
    .bind(entityType, entityId)
    .first<ApprovalRow>();
}

export async function approvalHistory(
  database: D1Database,
  entityType: ApprovalEntity,
  entityId: string,
): Promise<ApprovalRow[]> {
  const rows = await database
    .prepare(`SELECT * FROM approvals WHERE entity_type = ? AND entity_id = ? ORDER BY revision DESC`)
    .bind(entityType, entityId)
    .all<ApprovalRow>();
  return rows.results ?? [];
}

/** Opens a new pending revision, superseding any request still waiting. */
async function openRevision(
  database: D1Database,
  input: { entityType: ApprovalEntity; entityId: string; amount: number; rule: string; requestedBy: string },
  revision: number,
  controlledDiscount: number,
): Promise<void> {
  const now = nowISO();
  await database
    .prepare(
      `UPDATE approvals SET status = 'superseded', superseded_at = ?
       WHERE entity_type = ? AND entity_id = ? AND status = 'pending'`,
    )
    .bind(now, input.entityType, input.entityId)
    .run();
  await database
    .prepare(
      `INSERT INTO approvals (id, entity_type, entity_id, revision, amount, controlled_amount,
        controlled_discount, rule, status, requested_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), input.entityType, input.entityId, revision,
      Math.round(input.amount), Math.round(input.amount), controlledDiscount,
      input.rule, input.requestedBy, now,
    )
    .run();
  await logActivity(database, {
    userId: input.requestedBy, action: 'requested', entityType: 'approval', entityId: input.entityId,
    summary: 'activity.approval_requested',
    meta: { entity: input.entityType, rule: input.rule, amount: input.amount, revision },
  });
}

/**
 * Records the request if the document crosses a configured threshold, then refuses
 * while it is pending. An approval only covers the amount and discount controlled.
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
  const discount = Math.round(input.discountPercent ?? 0);
  const latest = await approvalOf(database, input.entityType, input.entityId);

  if (latest?.status === 'approved') {
    const same = latest.rule === rule
      && Number(latest.controlled_amount) === Math.round(input.amount)
      && Number(latest.controlled_discount ?? 0) === discount;
    if (same) return;
    if (!rule) return; // corrected below the threshold: nothing left to approve
    await openRevision(database, { ...input, rule }, latest.revision + 1, discount);
    return fail(409, 'APPROVAL_REQUIRED', {
      rule, previous: String(latest.revision), revision: String(latest.revision + 1),
    });
  }

  if (!rule) return;
  const revision = (latest?.revision ?? 0) + 1;
  await openRevision(database, { ...input, rule }, revision, discount);
  return fail(409, 'APPROVAL_REQUIRED', { rule, revision: String(revision) });
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
  // A superseded revision is history: it can no longer be decided (A-06).
  if (row.status !== 'pending') return fail(409, 'ALREADY_DECIDED');
  if (row.requested_by && row.requested_by === input.userId) return fail(403, 'SAME_APPROVER');

  await database
    .prepare(`UPDATE approvals SET status = ?, decided_by = ?, note = ?, decided_at = ? WHERE id = ? AND status = 'pending'`)
    .bind(input.decision, input.userId, input.note, nowISO(), input.id)
    .run();

  await logActivity(database, {
    userId: input.userId, action: input.decision, entityType: 'approval', entityId: row.entity_id,
    summary: input.decision === 'approved' ? 'activity.approval_approved' : 'activity.approval_rejected',
    meta: { entity: row.entity_type, rule: row.rule, amount: row.amount, revision: row.revision },
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
