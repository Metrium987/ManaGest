import { toCsv } from './csv';

/**
 * T-207: local report outputs. A Polynesian business has to hand in a VAT
 * recap and follow its turnover month by month, so these two reports are built
 * from the same figures the invoices carry — no re-keying, no separate ledger.
 *
 * The merging and CSV shaping are pure functions so they can be tested without
 * a database; the route only runs the queries.
 */

export interface TaxRow {
  period: string;
  rate: number;
  base: number;
  tax: number;
  documents: number;
}

export interface ExemptRow {
  period: string;
  exempt_base: number;
  documents: number;
}

export interface TvaRecapPeriod {
  period: string;
  base: number;
  tax: number;
  exempt_base: number;
  documents: number;
  rates: { rate: number; base: number; tax: number }[];
}

/** One line per month, with the per-rate detail kept inside it. */
export function mergeTvaRecap(taxRows: TaxRow[], exemptRows: ExemptRow[]): TvaRecapPeriod[] {
  const periods = new Map<string, TvaRecapPeriod>();

  const ensure = (period: string): TvaRecapPeriod => {
    const existing = periods.get(period);
    if (existing) return existing;
    const created: TvaRecapPeriod = {
      period,
      base: 0,
      tax: 0,
      exempt_base: 0,
      documents: 0,
      rates: [],
    };
    periods.set(period, created);
    return created;
  };

  for (const row of taxRows) {
    const rate = Number(row.rate);
    if (rate <= 0) continue; // a 0 % line is never a VAT bucket (BK-001)
    const period = ensure(row.period);
    period.base += Number(row.base);
    period.tax += Number(row.tax);
    period.documents += Number(row.documents);
    // A-04: an invoice row and the credit row that reverses it share a rate. They
    // are netted into one line, so the recap never shows the same rate twice.
    const bucket = period.rates.find((entry) => entry.rate === rate);
    if (bucket) {
      bucket.base += Number(row.base);
      bucket.tax += Number(row.tax);
    } else {
      period.rates.push({ rate, base: Number(row.base), tax: Number(row.tax) });
    }
  }

  for (const row of exemptRows) {
    const period = ensure(row.period);
    period.exempt_base += Number(row.exempt_base);
    period.documents += Number(row.documents);
  }

  return [...periods.values()]
    .map((period) => ({ ...period, rates: [...period.rates].sort((a, b) => b.rate - a.rate) }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

export function tvaRecapTotals(periods: TvaRecapPeriod[]): {
  base: number;
  tax: number;
  exempt_base: number;
  documents: number;
} {
  return periods.reduce(
    (sum, period) => ({
      base: sum.base + period.base,
      tax: sum.tax + period.tax,
      exempt_base: sum.exempt_base + period.exempt_base,
      documents: sum.documents + period.documents,
    }),
    { base: 0, tax: 0, exempt_base: 0, documents: 0 },
  );
}

/**
 * CSV shape: one row per month and rate. The exempt base is written on the
 * first row of its month only, so summing a column never counts it twice.
 */
export function tvaRecapCsv(periods: TvaRecapPeriod[]): string {
  const columns = [
    { key: 'period', label: 'période' },
    { key: 'rate', label: 'taux' },
    { key: 'base', label: 'base HT imposable' },
    { key: 'tax', label: 'TVA collectée' },
    { key: 'exempt_base', label: 'base exonérée / hors champ' },
    { key: 'documents', label: 'documents' },
  ];

  const rows: Record<string, unknown>[] = [];
  for (const period of periods) {
    if (period.rates.length === 0) {
      rows.push({
        period: period.period,
        rate: '',
        base: period.base,
        tax: period.tax,
        exempt_base: period.exempt_base,
        documents: period.documents,
      });
      continue;
    }
    period.rates.forEach((rate, index) => {
      rows.push({
        period: period.period,
        rate: rate.rate,
        base: rate.base,
        tax: rate.tax,
        exempt_base: index === 0 ? period.exempt_base : 0,
        documents: index === 0 ? period.documents : 0,
      });
    });
  }
  return toCsv(columns, rows);
}

/**
 * A-07: the single aggregation rule of the application.
 *
 * Every report adds XPF, never a mix of two units. A document keeps its own
 * currency and the XPF base computed at its own exchange rate; XPF documents
 * carry `total_xpf = total`, and a genuine zero total must stay zero (hence
 * `> 0` and not `<> 0`). Balances are scaled pro rata of the document so a
 * partial payment keeps the same rate.
 */
export function baseAmountSql(own: string, xpf: string): string {
  return `CASE WHEN ${xpf} > 0 THEN ${xpf} ELSE ${own} END`;
}

export function baseBalanceSql(balance: string, own: string, xpf: string): string {
  return `CASE WHEN ${xpf} > 0 AND ${own} > 0 THEN ROUND(${balance} * 1.0 * ${xpf} / ${own}) ELSE ${balance} END`;
}

export interface RevenuePeriod {
  period: string;
  taxable_xpf: number;
  exempt_xpf: number;
  total_xpf: number;
  collected_xpf: number;
  documents: number;
}

export function mergeRevenue(
  invoiceRows: { period: string; taxable_xpf: number; exempt_xpf: number; total_xpf: number; documents: number }[],
  paymentRows: { period: string; collected_xpf: number }[],
): RevenuePeriod[] {
  const periods = new Map<string, RevenuePeriod>();
  const ensure = (period: string): RevenuePeriod => {
    const existing = periods.get(period);
    if (existing) return existing;
    const created: RevenuePeriod = {
      period,
      taxable_xpf: 0,
      exempt_xpf: 0,
      total_xpf: 0,
      collected_xpf: 0,
      documents: 0,
    };
    periods.set(period, created);
    return created;
  };

  for (const row of invoiceRows) {
    const period = ensure(row.period);
    period.taxable_xpf += Number(row.taxable_xpf);
    period.exempt_xpf += Number(row.exempt_xpf);
    period.total_xpf += Number(row.total_xpf);
    period.documents += Number(row.documents);
  }
  for (const row of paymentRows) {
    const period = ensure(row.period);
    period.collected_xpf += Number(row.collected_xpf);
  }

  return [...periods.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function revenueCsv(periods: RevenuePeriod[]): string {
  return toCsv(
    [
      { key: 'period', label: 'période' },
      { key: 'taxable_xpf', label: 'CA taxable (XPF)' },
      { key: 'exempt_xpf', label: 'CA exonéré (XPF)' },
      { key: 'total_xpf', label: 'CA total (XPF)' },
      { key: 'collected_xpf', label: 'encaissé (XPF)' },
      { key: 'documents', label: 'documents' },
    ],
    periods as unknown as Record<string, unknown>[],
  );
}
