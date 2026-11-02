import { describe, expect, it } from 'vitest';
import { contractDraft, noticeDeadline } from '../server/lib/contracts';

const maintenance = {
  id: 'svc-maintenance',
  name: 'Maintenance annuelle',
  item_type: 'service',
  unit_price: 120000,
  tax_rate: 16,
  billing_frequency: 'yearly',
  renewal_mode: 'tacit',
  notice_days: 30,
  service_type: 'subscription',
  price_revision_index: 'ICP',
};

describe('contract draft', () => {
  it('takes frequency, notice and renewal from the service sheet', () => {
    const draft = contractDraft(maintenance, '2026-03-01');
    expect(draft.frequency).toBe('yearly');
    expect(draft.notice_days).toBe(30);
    expect(draft.renewal_mode).toBe('tacit');
    expect(draft.contract_start).toBe('2026-03-01');
  });

  it('bills one unit of the service at its price', () => {
    const draft = contractDraft(maintenance, '2026-03-01');
    expect(draft.line).toEqual({
      product_id: 'svc-maintenance', description: 'Maintenance annuelle', quantity: 1, unit_price: 120000, tax_rate: 16,
    });
  });

  it('falls back to monthly and tacit, never to an unknown mode', () => {
    const draft = contractDraft({ ...maintenance, billing_frequency: null, renewal_mode: 'bizarre', notice_days: null }, '2026-01-01');
    expect(draft.frequency).toBe('monthly');
    expect(draft.renewal_mode).toBe('tacit');
    expect(draft.notice_days).toBe(0);
  });

  it('refuses a stockable article', () => {
    expect(() => contractDraft({ ...maintenance, item_type: 'stockable' }, '2026-01-01')).toThrowError(/NOT_A_SERVICE/);
  });
});

describe('notice deadline', () => {
  it('counts back from the end date', () => {
    expect(noticeDeadline('2026-12-31', 30)).toBe('2026-12-01');
  });

  it('has nothing to warn about without an end date', () => {
    expect(noticeDeadline(null, 30)).toBeNull();
    expect(noticeDeadline('2026-12-31', 0)).toBe('2026-12-31');
  });
});
