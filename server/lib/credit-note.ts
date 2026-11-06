import { ApiError } from './errors';
import { computeTotals, type DocumentTotals, type LineItem } from '../../shared/tax';

/**
 * A-03: a credit note is prefilled from the invoice it corrects — the rule Odoo
 * documents ("the only legal method for cancelling, refunding, or modifying a
 * validated invoice"), and the one the Polynesian rules imply once VAT has been
 * mentioned (BOFiP: whoever mentions the tax owes it, and the fix is a
 * rectificative document).
 *
 * The requested amount is a **TTC** share of the invoice. It is spread across
 * the invoice's tax buckets in proportion to what each bucket contributed, so a
 * multi-rate invoice reverses the same mix of rates it collected. Every stored
 * figure comes from `computeTotals`, the single arithmetic source, so the
 * document and the ledger cannot drift apart.
 */
export interface CreditSource {
  number: string | null;
  total: number;
  discount_type: string;
  discount_value: number;
  tax_exempt: number | boolean;
  line_items: unknown;
}

export interface CreditNoteDraft {
  lines: LineItem[];
  totals: DocumentTotals;
}

const EMPTY_DISCOUNT = { discount_type: 'percent' as const, discount_value: 0 };

export function creditNoteFromInvoice(invoice: CreditSource, amount: number): CreditNoteDraft {
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', { amount: 'invalid' });
  }
  if (amount > Number(invoice.total)) throw new ApiError(409, 'AMOUNT_EXCEEDS_BALANCE');

  const sourceLines = Array.isArray(invoice.line_items) ? (invoice.line_items as LineItem[]) : [];
  const label = `Avoir sur facture ${invoice.number ?? ''}`.trim();
  const exempt = Boolean(invoice.tax_exempt);
  const source = computeTotals(
    sourceLines,
    {
      discount_type: invoice.discount_type === 'amount' ? 'amount' : 'percent',
      discount_value: Number(invoice.discount_value ?? 0),
    },
    exempt,
  );

  // An exempt invoice (or one with no taxable bucket at all) reverses without VAT.
  if (exempt || !source.tax_buckets.length) {
    const lines: LineItem[] = [{
      id: 'credit-exempt',
      description: label,
      quantity: 1,
      unit_price: amount,
      tax_rate: 0,
      tax_status: 'exempt',
    }];
    return { lines, totals: computeTotals(lines, EMPTY_DISCOUNT, true) };
  }

  if (source.total <= 0) throw new ApiError(409, 'INVOICE_NOT_OPEN');
  const share = amount / source.total;
  let allocated = 0;
  const lines: LineItem[] = source.tax_buckets
    .map((bucket, index) => {
      const weight = bucket.base + bucket.amount;
      const last = index === source.tax_buckets.length - 1;
      const ttcShare = last ? amount - allocated : Math.round(weight * share);
      allocated += ttcShare;
      const vat = Math.round((ttcShare * bucket.rate) / (100 + bucket.rate));
      return {
        id: `credit-${bucket.rate}`,
        description: `${label} — TVA ${bucket.rate} %`,
        quantity: 1,
        unit_price: Math.max(0, ttcShare - vat),
        tax_rate: bucket.rate,
        tax_status: 'taxable' as const,
      };
    })
    .filter((line) => line.unit_price > 0);

  const totals = computeTotals(lines, EMPTY_DISCOUNT, false);
  if (totals.total <= 0) throw new ApiError(422, 'VALIDATION_ERROR', { amount: 'too_small' });
  return { lines, totals };
}
