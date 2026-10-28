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

export function isOverdue(status: string, dueDate: string | null, today: string): boolean {
  if (!dueDate) return false;
  if (status !== 'sent' && status !== 'partial') return false;
  return dueDate < today;
}
