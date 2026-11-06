import { ApiError } from '../lib/errors';
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

/**
 * A-02: an issued document is immutable. Correcting it means issuing a credit
 * note (or cancelling it), never rewriting its lines or amounts — the rule Odoo
 * states for a validated invoice and the one the VAT rules imply.
 */
export function isEditable(status: string): boolean {
  return status === 'draft';
}

export type DocumentKind = 'invoice' | 'quote' | 'credit';

/**
 * A-02: one guard for every write route. It throws the same code and the same
 * payload — `{ document, status }` — so an invoice, a quote and a credit note
 * refuse a rewrite in exactly the same way, and the client can translate it.
 */
export function assertEditable(status: string, document: DocumentKind): void {
  if (isEditable(status)) return;
  throw new ApiError(409, 'DOCUMENT_IMMUTABLE', { document, status });
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
