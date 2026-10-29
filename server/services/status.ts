import type { DocumentStatus } from '../../shared/domain';

/**
 * Invoice status is derived from the outstanding balance and the amounts
 * already applied, except for cancellations which are terminal.
 * Draft documents stay drafts until explicitly sent.
 */
export function deriveInvoiceStatus(
  current: string,
  balance: number,
  paidTotal: number,
): DocumentStatus {
  if (current === 'cancelled') return 'cancelled';
  if (balance <= 0) return 'paid';
  if (paidTotal > 0) return 'partial';
  if (current === 'draft') return 'draft';
  return 'sent';
}

/**
 * Amount a credit note may cover as a refund of an issued invoice (BK-006 as
 * adapted by OQ-012: refunds are credit notes, never payment refunds).
 * - paid invoice: at most what was actually received (money to give back);
 * - sent / partial invoice: at most the outstanding balance (the credit
 *   offsets what is still owed);
 * - draft or cancelled: nothing (issue the document first, or cancel instead).
 */
export function refundableAmount(status: string, balance: number, paidTotal: number): number {
  if (status === 'paid') return Math.max(0, paidTotal);
  if (status === 'sent' || status === 'partial') return Math.max(0, balance);
  return 0;
}

export function isOverdue(status: string, dueDate: string | null, today: string): boolean {
  if (!dueDate) return false;
  if (status !== 'sent' && status !== 'partial') return false;
  return dueDate < today;
}

/** Quote validity: past its valid_until date and not yet approved or converted. */
export function isExpiredQuote(status: string, validUntil: string | null, today: string): boolean {
  if (!validUntil) return false;
  if (['approved', 'converted', 'rejected', 'cancelled', 'draft'].includes(status)) return false;
  return validUntil < today;
}
