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
    if (Number(row.rate) <= 0) continue; // a 0 % line is never a VAT bucket (BK-001)
    const period = ensure(row.period);
    period.base += Number(row.base);
    period.tax += Number(row.tax);
    period.documents += Number(row.documents);
    period.rates.push({ rate: Number(row.rate), base: Number(row.base), tax: Number(row.tax) });
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

export interface RevenuePeriod {
  period: string;
  taxable: number;
  exempt: number;
  total: number;
  collected: number;
  documents: number;
}

export function mergeRevenue(
  invoiceRows: { period: string; taxable: number; exempt: number; total: number; documents: number }[],
  paymentRows: { period: string; collected: number }[],
): RevenuePeriod[] {
  const periods = new Map<string, RevenuePeriod>();
  const ensure = (period: string): RevenuePeriod => {
    const existing = periods.get(period);
    if (existing) return existing;
    const created: RevenuePeriod = {
      period,
      taxable: 0,
      exempt: 0,
      total: 0,
      collected: 0,
      documents: 0,
    };
    periods.set(period, created);
    return created;
  };

  for (const row of invoiceRows) {
    const period = ensure(row.period);
    period.taxable += Number(row.taxable);
    period.exempt += Number(row.exempt);
    period.total += Number(row.total);
    period.documents += Number(row.documents);
  }
  for (const row of paymentRows) {
    const period = ensure(row.period);
    period.collected += Number(row.collected);
  }

  return [...periods.values()].sort((a, b) => a.period.localeCompare(b.period));
}

export function revenueCsv(periods: RevenuePeriod[]): string {
  return toCsv(
    [
      { key: 'period', label: 'période' },
      { key: 'taxable', label: 'CA taxable (TTC)' },
      { key: 'exempt', label: 'CA exonéré (TTC)' },
      { key: 'total', label: 'CA total (TTC)' },
      { key: 'collected', label: 'encaissé' },
      { key: 'documents', label: 'documents' },
    ],
    periods as unknown as Record<string, unknown>[],
  );
}
