import { describe, expect, it } from 'vitest';
import {
  CHART, RETAINED_EARNINGS, balanceSheet, isBalanced, openingLines, totalsOf, typeFromCode,
  type Account,
} from '../server/lib/accounting';

/** The chart the service ends up with once the import created its accounts. */
const chart: Account[] = [
  ...CHART,
  { code: '213000', label: 'Matériel', type: 'asset' },
  { code: '101000', label: 'Capital', type: 'equity' },
  { code: '110000', label: 'Report à nouveau', type: 'equity' },
];

/**
 * T-304: opening balances must produce a **balanced** entry without inventing
 * figures, and the balance sheet must only be derivable from that entry.
 */
describe('opening balances', () => {
  const rows = [
    { code: '213000', label: 'Matériel', debit: 500000, credit: 0 },
    { code: '411000', label: 'Clients', debit: 120000, credit: 0 },
    { code: '401000', label: 'Fournisseurs', debit: 0, credit: 90000 },
    { code: '101000', label: 'Capital', debit: 0, credit: 400000 },
  ];

  it('carries the difference to retained earnings and balances', () => {
    const lines = openingLines(rows);
    expect(isBalanced(lines)).toBe(true);
    const retained = lines.find((line) => line.account_code === RETAINED_EARNINGS);
    // Debits 620 000 − credits 490 000 = 130 000 of prior profit to carry.
    expect(retained).toMatchObject({ debit: 0, credit: 130000 });
  });

  it('posts retained earnings on the debit side for a prior loss', () => {
    const lines = openingLines([
      { code: '213000', debit: 100000, credit: 0 },
      { code: '101000', debit: 0, credit: 150000 },
    ]);
    expect(totalsOf(lines)).toEqual({ debit: 150000, credit: 150000 });
    expect(lines.find((line) => line.account_code === RETAINED_EARNINGS)).toMatchObject({ debit: 50000, credit: 0 });
  });

  it('adds no fourth line when the trial balance already adds up', () => {
    const lines = openingLines([
      { code: '213000', debit: 100000, credit: 0 },
      { code: '101000', debit: 0, credit: 100000 },
    ]);
    expect(lines).toHaveLength(2);
    expect(isBalanced(lines)).toBe(true);
  });

  it('drops zero rows and clamps a negative side', () => {
    const lines = openingLines([
      { code: '213000', debit: 0, credit: 0 },
      { code: '101000', debit: -5000, credit: 20000 },
    ]);
    expect(lines.find((line) => line.account_code === '213000')).toBeUndefined();
    expect(lines.find((line) => line.account_code === '101000')).toMatchObject({ debit: 0, credit: 20000 });
    // A one-sided trial balance still has to post: the gap goes to 110000.
    expect(lines.find((line) => line.account_code === RETAINED_EARNINGS)).toMatchObject({ debit: 20000, credit: 0 });
    expect(isBalanced(lines)).toBe(true);
  });

  it('takes the account side from the code, and from the balance for classes 4 and 5', () => {
    expect(typeFromCode('101000')).toBe('equity');
    expect(typeFromCode('213000')).toBe('asset');
    expect(typeFromCode('411000', 1000)).toBe('asset');
    expect(typeFromCode('401000', -1000)).toBe('liability');
    expect(typeFromCode('512000', 5000)).toBe('asset');
    expect(typeFromCode('606000')).toBe('expense');
    expect(typeFromCode('706000')).toBe('income');
  });

  it('derives a balance sheet that balances, result included', () => {
    const opening = openingLines(rows);
    const sheet = balanceSheet(opening, chart);
    expect(sheet.total_assets).toBe(sheet.total_liabilities + sheet.total_equity);
    expect(sheet.balanced).toBe(true);
    expect(sheet.total_assets).toBe(620000);
  });

  it('adds the year result to equity so the sheet still balances', () => {
    const opening = openingLines(rows);
    const activity = [
      { account_code: '411000', debit: 80000, credit: 0 },
      { account_code: '706000', debit: 0, credit: 80000 },
    ];
    const sheet = balanceSheet([...opening, ...activity], chart);
    expect(sheet.result).toBe(80000);
    expect(sheet.total_assets).toBe(700000);
    expect(sheet.total_liabilities + sheet.total_equity).toBe(700000);
    expect(sheet.balanced).toBe(true);
  });
});
