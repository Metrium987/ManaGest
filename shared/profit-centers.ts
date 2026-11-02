/**
 * Q11 — profit centres.
 *
 * A centre is a short code that says *why* a line was sold: a shop, an activity, a
 * contract. The code is copied onto the invoice line (a snapshot), so renaming or
 * archiving a centre never rewrites what an issued document says — the same rule the
 * accounting modules already follow for accounts.
 */

export const PROFIT_CENTER_PATTERN = /^[A-Z0-9][A-Z0-9_-]{0,19}$/;

/** A code as it may be stored: upper-case, one of the workspace's own codes. */
export function normaliseProfitCenter(value: unknown): string | null {
  const code = String(value ?? '').trim().toUpperCase().replace(/\s+/g, '-');
  if (!code) return null;
  return code.slice(0, 20);
}

export function isValidProfitCenter(code: string): boolean {
  return PROFIT_CENTER_PATTERN.test(code);
}

export interface ProfitCenterSale {
  code: string | null;
  base: number;
  tax: number;
  total: number;
  document_id: string;
}

export interface ProfitCenterSummary {
  code: string | null;
  name: string | null;
  archived: boolean;
  base: number;
  tax: number;
  total: number;
  lines: number;
  documents: number;
}

/**
 * Turn invoice lines into one row per centre. A line sold without a centre is kept
 * under `null` instead of being dropped: the total of the report must equal the
 * turnover it claims to explain.
 */
export function aggregateProfitCenters(
  sales: ProfitCenterSale[],
  centres: { code: string; name: string; archived?: boolean | number }[],
): ProfitCenterSummary[] {
  const byCode = new Map(centres.map((centre) => [centre.code, centre]));
  const rows = new Map<string, { base: number; tax: number; total: number; lines: number; documents: Set<string> }>();

  for (const sale of sales) {
    const code = normaliseProfitCenter(sale.code) ?? '';
    const row = rows.get(code) ?? { base: 0, tax: 0, total: 0, lines: 0, documents: new Set<string>() };
    row.base += Math.round(Number(sale.base) || 0);
    row.tax += Math.round(Number(sale.tax) || 0);
    row.total += Math.round(Number(sale.total) || 0);
    row.lines += 1;
    row.documents.add(sale.document_id);
    rows.set(code, row);
  }

  return [...rows.entries()]
    // A centre whose sales and credits cancel out is not turnover: showing a zero
    // line would ask the reader to check a row that says nothing.
    .filter(([, row]) => row.base !== 0 || row.tax !== 0 || row.total !== 0)
    .map(([code, row]) => ({
      code: code || null,
      name: code ? byCode.get(code)?.name ?? null : null,
      archived: code ? Boolean(byCode.get(code)?.archived) : false,
      base: row.base,
      tax: row.tax,
      total: row.total,
      lines: row.lines,
      documents: row.documents.size,
    }))
    .sort((a, b) => b.total - a.total || String(a.code ?? '').localeCompare(String(b.code ?? '')));
}
