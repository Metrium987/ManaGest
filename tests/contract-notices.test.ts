import { describe, expect, it } from 'vitest';
import { contractNotices } from '../server/lib/contracts';

const base = {
  id: 'c1', client_name: 'Client A', end_date: '2026-12-31', notice_days: 30, renewal_mode: 'tacit', status: 'active',
};

describe('contract notices', () => {
  it('flags a contract inside the lead window', () => {
    const [row] = contractNotices([base], '2026-12-10', 30);
    expect(row.notice_deadline).toBe('2026-12-01');
    expect(row.overdue).toBe(true); // the deadline already passed on 1 December
  });

  it('keeps quiet before the window opens', () => {
    expect(contractNotices([base], '2026-10-01', 30)).toEqual([]);
  });

  it('reports a deadline still ahead as a countdown', () => {
    const [row] = contractNotices([{ ...base, end_date: '2027-01-31' }], '2026-12-20', 30);
    expect(row.days_left).toBe(12);
    expect(row.overdue).toBe(false);
  });

  it('ignores express renewals, paused contracts and endless contracts', () => {
    expect(contractNotices([{ ...base, renewal_mode: 'fixed_term' }], '2026-12-10')).toEqual([]);
    expect(contractNotices([{ ...base, status: 'paused' }], '2026-12-10')).toEqual([]);
    expect(contractNotices([{ ...base, end_date: null }], '2026-12-10')).toEqual([]);
  });

  it('ignores contracts that already ended', () => {
    expect(contractNotices([{ ...base, end_date: '2026-11-01' }], '2026-12-10')).toEqual([]);
  });

  it('sorts by the nearest deadline', () => {
    const rows = contractNotices(
      [{ ...base, id: 'a', end_date: '2027-01-20' }, { ...base, id: 'b', end_date: '2027-01-05' }],
      '2026-12-20',
      60,
    );
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
