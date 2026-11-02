import { afterEach, describe, expect, it } from 'vitest';
import { setLabelLanguage } from '../shared/labels-locale';
import { ITEM_TYPE_LABELS, LIFECYCLE_LABELS, STOCK_MODE_LABELS, VALUATION_METHOD_LABELS } from '../shared/product-erp';
import { BILLING_TRIGGER_LABELS, RENEWAL_MODE_LABELS, SERVICE_TYPE_LABELS } from '../shared/service';
import { ROLE_LABELS } from '../shared/domain';
import { CLIENT_DOCUMENT_LABELS, CLIENT_PAYMENT_TERM_LABELS } from '../shared/client-profile';

/**
 * H3: the business enums are French in `shared/` (the reference), and the same
 * maps answer in English once the interface language switches. The wrapper is
 * what lets ~100 existing `LABELS[value]` call sites translate without a second
 * dictionary at each screen.
 */
afterEach(() => setLabelLanguage('fr'));

describe('business enum labels (H3)', () => {
  it('reads French by default', () => {
    expect(ITEM_TYPE_LABELS.stockable).toBe('Marchandise / produit fini');
    expect(ROLE_LABELS.owner).toBe('Propriétaire');
  });

  it('answers in English once the interface switches', () => {
    setLabelLanguage('en');
    expect(ITEM_TYPE_LABELS.stockable).toBe('Goods / finished product');
    expect(LIFECYCLE_LABELS.blocked_purchase).toBe('Blocked for purchase');
    expect(STOCK_MODE_LABELS.fefo).toBe('FEFO (first expired, first out)');
    expect(VALUATION_METHOD_LABELS.landed).toBe('Landed cost in Tahiti');
    expect(SERVICE_TYPE_LABELS.subscription).toBe('Subscription / recurring contract');
    expect(BILLING_TRIGGER_LABELS.timesheet).toBe('On approved timesheet');
    expect(RENEWAL_MODE_LABELS.tacit).toBe('Tacit renewal');
    expect(ROLE_LABELS.viewer).toBe('Read-only');
    expect(CLIENT_PAYMENT_TERM_LABELS.NET_30_DAYS).toBe('Net 30 days');
    expect(CLIENT_DOCUMENT_LABELS.doc_tahiti).toBe('TAHITI certificate (ISPF)');
  });

  it('keeps the enum keys: the proxy must not change iteration', () => {
    setLabelLanguage('en');
    expect(Object.keys(ITEM_TYPE_LABELS).sort()).toEqual(['consumable', 'kit', 'service', 'stockable']);
    expect(Object.keys(ITEM_TYPE_LABELS)).toHaveLength(4);
  });

  it('returns to French when the language goes back', () => {
    setLabelLanguage('en');
    setLabelLanguage('fr');
    expect(STOCK_MODE_LABELS.lot).toBe('Par numéro de lot');
  });
});
