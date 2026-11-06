/**
 * A-07: every report adds XPF. A mixed set of documents must be summed in the
 * base currency, balances scaled pro rata, and taxable + exempt must stay equal
 * to the total. These assertions fail if the CASE helper is dropped or if a
 * document's own currency leaks into an aggregate.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  baseAmountSql, baseBalanceSql, mergeRevenue, revenueCsv,
} from '../server/lib/reports';

function documents() {
  const raw = new DatabaseSync(':memory:');
  raw.exec(`CREATE TABLE docs (
    id TEXT PRIMARY KEY, total REAL NOT NULL, total_xpf REAL NOT NULL,
    balance REAL NOT NULL, tax_exempt INTEGER NOT NULL, currency TEXT NOT NULL)`);
  // 1 000 EUR at 119,33 -> 119 330 XPF ; 100 000 XPF stays itself.
  raw.exec(`INSERT INTO docs VALUES ('eur', 1000, 119330, 500, 0, 'EUR')`);
  raw.exec(`INSERT INTO docs VALUES ('xpf', 100000, 100000, 40000, 1, 'XPF')`);
  // A genuine zero document must not fall back to another unit.
  raw.exec(`INSERT INTO docs VALUES ('zero', 0, 0, 0, 0, 'XPF')`);
  return raw;
}

const scalar = (raw: DatabaseSync, sql: string): number =>
  Number((raw.prepare(sql).get() as { value: number } | undefined)?.value ?? 0);

describe('report aggregation in XPF — A-07', () => {
  it('sums a mixed set at the XPF base and keeps zero totals zero', () => {
    const raw = documents();
    const total = scalar(raw, `SELECT COALESCE(SUM(${baseAmountSql('total', 'total_xpf')}),0) AS value FROM docs`);
    expect(total).toBe(219330);

    const taxable = scalar(raw, `SELECT COALESCE(SUM(CASE WHEN tax_exempt = 0 THEN ${baseAmountSql('total', 'total_xpf')} END),0) AS value FROM docs`);
    const exempt = scalar(raw, `SELECT COALESCE(SUM(CASE WHEN tax_exempt = 1 THEN ${baseAmountSql('total', 'total_xpf')} END),0) AS value FROM docs`);
    expect(taxable + exempt).toBe(total);
    expect(taxable).toBe(119330);
    expect(exempt).toBe(100000);
  });

  it('scales an open balance at the document rate', () => {
    const raw = documents();
    const aged = scalar(raw, `SELECT COALESCE(SUM(${baseBalanceSql('balance', 'total', 'total_xpf')}),0) AS value FROM docs`);
    // 500 EUR of 1 000 -> half of 119 330 ; plus 40 000 XPF.
    expect(aged).toBe(59665 + 40000);
  });

  it('keeps the per-month revenues consistent in XPF', () => {
    const periods = mergeRevenue(
      [
        { period: '2026-01', taxable_xpf: 119330, exempt_xpf: 0, total_xpf: 119330, documents: 1 },
        { period: '2026-01', taxable_xpf: 0, exempt_xpf: 100000, total_xpf: 100000, documents: 1 },
      ],
      [{ period: '2026-01', collected_xpf: 59665 }],
    );
    expect(periods).toEqual([
      { period: '2026-01', taxable_xpf: 119330, exempt_xpf: 100000, total_xpf: 219330, collected_xpf: 59665, documents: 2 },
    ]);
    const [row] = periods;
    expect(row.taxable_xpf + row.exempt_xpf).toBe(row.total_xpf);
    expect(revenueCsv(periods)).toContain('CA total (XPF)');
  });
});
