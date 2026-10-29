/**
 * Approvals by threshold and separation of duties (AUDIT §7 P0.5).
 *
 * Pure rules: the thresholds are **read from the workspace settings**, never
 * constants, and `0` means « this rule is off » rather than « everything needs
 * approval ». The service stores the outcome; this module decides it.
 */

export type ApprovalEntity = 'invoice' | 'credit' | 'expense';

export type ApprovalRule = 'invoice_discount' | 'credit_amount' | 'expense_amount';

export interface Thresholds {
  /** A credit note at or above this amount needs approval; 0 disables the rule. */
  creditAmount: number;
  /** An expense at or above this amount needs approval; 0 disables the rule. */
  expenseAmount: number;
  /** A discount at or above this percentage needs approval; 0 disables the rule. */
  discountPercent: number;
  /** When true, the creator of a document cannot record its payment. */
  separation: boolean;
}

export interface ThresholdInput {
  amount: number;
  /** Only meaningful for invoices; ignored elsewhere. */
  discountPercent?: number;
}

function toNumber(value: string | undefined, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Reads the settings map with clamping: a nonsense value can never block work. */
export function parseThresholds(raw: Record<string, string | undefined>): Thresholds {
  const percent = toNumber(raw.approval_discount_percent);
  return {
    creditAmount: Math.round(toNumber(raw.approval_credit_amount)),
    expenseAmount: Math.round(toNumber(raw.approval_expense_amount)),
    discountPercent: Math.min(100, percent),
    separation: raw.separation_of_duties === '1' || raw.separation_of_duties === 'true',
  };
}

/** A discount as a percentage of the pre-discount subtotal, whatever its form. */
export function discountPercentOf(
  discountType: string,
  discountValue: number,
  subtotal: number,
): number {
  if (discountType === 'percent') return Math.min(100, Math.max(0, discountValue));
  if (subtotal <= 0 || discountValue <= 0) return 0;
  return Math.min(100, Math.round((discountValue / subtotal) * 100));
}

/**
 * Returns the rule that requires an approval, or null. A rule is only evaluated
 * when its threshold is set, so a workspace that never configures approvals is
 * never blocked by a default.
 */
export function ruleFor(
  entity: ApprovalEntity,
  input: ThresholdInput,
  thresholds: Thresholds,
): ApprovalRule | null {
  if (entity === 'credit' && thresholds.creditAmount > 0 && input.amount >= thresholds.creditAmount) {
    return 'credit_amount';
  }
  if (entity === 'expense' && thresholds.expenseAmount > 0 && input.amount >= thresholds.expenseAmount) {
    return 'expense_amount';
  }
  if (
    entity === 'invoice'
    && thresholds.discountPercent > 0
    && (input.discountPercent ?? 0) >= thresholds.discountPercent
  ) {
    return 'invoice_discount';
  }
  return null;
}

/**
 * Separation of duties: the person who issued a document cannot also record the
 * money it produces. Disabled by default because a one-person workspace would
 * otherwise be unable to collect anything.
 */
export function violatesSeparation(
  enabled: boolean,
  creatorId: string | null | undefined,
  actorId: string | null | undefined,
): boolean {
  if (!enabled) return false;
  if (!creatorId || !actorId) return false;
  return creatorId === actorId;
}
