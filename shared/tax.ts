import { roundMinor } from './money';

export type LineTaxStatus = 'taxable' | 'exempt';

export interface LineItem {
  id: string;
  product_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  /** Local TVA status per line: exempt lines show no 0-rate bucket (BK-001/PF-TVA-002). */
  tax_status?: LineTaxStatus;
}

export interface DiscountInput {
  discount_type: 'percent' | 'amount';
  discount_value: number;
}

export interface TaxBucket {
  rate: number;
  base: number;
  amount: number;
}

export interface DocumentTotals {
  subtotal: number;
  discount_total: number;
  tax_total: number;
  total: number;
  tax_buckets: TaxBucket[];
}

/**
 * Single source of truth for document arithmetic, shared by the API and the
 * client preview. A document-level discount is spread proportionally across
 * lines before tax, so each tax bucket keeps a correct base.
 * Percentages are in hundredths of a percent (1600 = 16%).
 */
export function computeTotals(
  lines: LineItem[],
  discount: DiscountInput,
  taxExempt: boolean,
): DocumentTotals {
  const safeLines = lines.map((line) => ({
    ...line,
    quantity: Number.isFinite(line.quantity) ? Math.max(0, line.quantity) : 0,
    unit_price: Number.isFinite(line.unit_price) ? Math.max(0, roundMinor(line.unit_price)) : 0,
    tax_rate: Number.isFinite(line.tax_rate) ? Math.min(100, Math.max(0, line.tax_rate)) : 0,
  }));

  const lineTotals = safeLines.map((line) => roundMinor(line.unit_price * line.quantity));
  const subtotal = lineTotals.reduce((sum, value) => sum + value, 0);

  let discountTotal = 0;
  if (discount.discount_type === 'percent') {
    const pct = Math.min(10000, Math.max(0, discount.discount_value)) / 10000;
    discountTotal = roundMinor(subtotal * pct);
  } else {
    discountTotal = Math.min(Math.max(0, roundMinor(discount.discount_value)), subtotal);
  }
  discountTotal = Math.min(discountTotal, subtotal);

  const buckets = new Map<number, TaxBucket>();
  let allocated = 0;

  safeLines.forEach((line, index) => {
    const lineTotal = lineTotals[index];
    const isLast = index === safeLines.length - 1;
    const share = isLast
      ? discountTotal - allocated
      : subtotal > 0
        ? roundMinor((lineTotal * discountTotal) / subtotal)
        : 0;
    allocated += share;
    const taxableBase = Math.max(0, lineTotal - share);
    const exempt = taxExempt || line.tax_status === 'exempt';
    const rate = exempt ? 0 : line.tax_rate;
    const amount = exempt ? 0 : roundMinor((taxableBase * rate) / 100);

    if (exempt) {
      // Exempt lines carry no VAT bucket at all — not a 0% slab (official DICP wording).
      return;
    }
    const bucket = buckets.get(rate) ?? { rate, base: 0, amount: 0 };
    bucket.base += taxableBase;
    bucket.amount += amount;
    buckets.set(rate, bucket);
  });

  const taxBuckets = [...buckets.values()]
    .filter((bucket) => bucket.base > 0 || bucket.amount > 0)
    .sort((a, b) => b.rate - a.rate);

  const taxTotal = taxBuckets.reduce((sum, bucket) => sum + bucket.amount, 0);
  const total = Math.max(0, subtotal - discountTotal + taxTotal);

  return {
    subtotal,
    discount_total: discountTotal,
    tax_total: taxTotal,
    total,
    tax_buckets: taxBuckets,
  };
}

export function lineTotal(line: LineItem): number {
  return roundMinor(line.unit_price * line.quantity);
}
