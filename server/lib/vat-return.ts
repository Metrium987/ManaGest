/**
 * VAT recap used to pre-fill the Polynesian 1010 declaration. It aggregates the
 * per-rate buckets already stored on issued invoices and subtracts the credit
 * notes, so the figure matches the ledger instead of a second calculation.
 * It is a summary by rate, not a substitute for the official form.
 */

export interface VatBucket {
  rate: number;
  base: number;
  amount: number;
}

export interface VatReturnRow {
  rate: number;
  base: number;
  tax: number;
}

export interface VatReturn {
  rows: VatReturnRow[];
  total_base: number;
  total_tax: number;
  exempt_base: number;
  documents: number;
  credits: number;
}

export function buildVatReturn(input: {
  invoices: VatBucket[][];
  credits: VatBucket[][];
  exemptBase?: number;
  creditExemptBase?: number;
}): VatReturn {
  const byRate = new Map<number, VatReturnRow>();
  const add = (buckets: VatBucket[], sign: 1 | -1) => {
    for (const bucket of buckets) {
      const row = byRate.get(bucket.rate) ?? { rate: bucket.rate, base: 0, tax: 0 };
      row.base += sign * bucket.base;
      row.tax += sign * bucket.amount;
      byRate.set(bucket.rate, row);
    }
  };

  input.invoices.forEach((buckets) => add(buckets, 1));
  input.credits.forEach((buckets) => add(buckets, -1));

  const rows = [...byRate.values()]
    .filter((row) => row.base !== 0 || row.tax !== 0)
    .sort((a, b) => a.rate - b.rate);

  return {
    rows,
    total_base: rows.reduce((sum, row) => sum + row.base, 0),
    total_tax: rows.reduce((sum, row) => sum + row.tax, 0),
    exempt_base: (input.exemptBase ?? 0) - (input.creditExemptBase ?? 0),
    documents: input.invoices.length,
    credits: input.credits.length,
  };
}
