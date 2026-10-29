import { describe, expect, it } from 'vitest';
import { buildDocumentPdf } from '../server/services/pdf-documents';
import { buildInvoicePdf } from '../server/services/pdf';
import { resolveLayout, styleFor } from '../server/services/pdf-style';
import type { CompanyRow } from '../server/types';

const company = {
  name: 'Fenua Services',
  address1: 'Boulevard Pomare',
  postal_code: '98714',
  city: 'Papeete',
  country: 'Polynésie française',
  email: 'contact@fenua.pf',
  tax_id: '12345',
  currency: 'XPF',
  legal_notes: 'TVA non applicable, franchise en base.',
  invoice_footer: 'Merci de votre confiance.',
  invoice_terms: 'Paiement à 30 jours.',
} as unknown as CompanyRow;

const doc = {
  number: 'DEV-2026-0001',
  date: '2026-10-29',
  secondary: '2026-11-28',
  currency: 'XPF',
  line_items: [
    { id: 'a', description: 'Prestation de conseil', quantity: 2, unit_price: 15000, tax_rate: 16 },
  ],
  discount_type: 'percent',
  discount_value: 0,
  discount_total: 0,
  subtotal: 30000,
  tax_total: 4800,
  total: 34800,
  tax_exempt: 0,
  notes: null,
  terms: 'Devis valable 30 jours.',
  client: {
    name: 'Hôtel Manava Tahiti',
    address1: 'Boulevard Pomare',
    address2: null,
    city: 'Papeete',
    postal_code: '98714',
    country: 'Polynésie française',
    tax_id: '54321',
  },
};

describe('document layout choice (T-108)', () => {
  it('lets the per-document request win over the workspace default', () => {
    expect(resolveLayout('compact', 'classic')).toBe('compact');
    expect(resolveLayout('classic', 'compact')).toBe('classic');
    expect(resolveLayout('COMPACT', 'classic')).toBe('compact');
  });

  it('falls back to the workspace default, then to classic', () => {
    expect(resolveLayout(undefined, 'compact')).toBe('compact');
    expect(resolveLayout('', 'compact')).toBe('compact');
    expect(resolveLayout('fancy', 'compact')).toBe('compact');
    expect(resolveLayout('fancy', 'unknown')).toBe('classic');
    expect(resolveLayout(null, null)).toBe('classic');
  });

  it('describes the two styles distinctly', () => {
    expect(styleFor('classic').band).toBe(true);
    expect(styleFor('compact').band).toBe(false);
    expect(styleFor('compact').tableHeaderFill).toBe(false);
    expect(styleFor('compact').totalsBlock).toBe(false);
  });

  it('produces a different, valid PDF for each layout', async () => {
    const classic = await buildDocumentPdf('quote', company, doc, 'classic');
    const compact = await buildDocumentPdf('quote', company, doc, 'compact');
    expect(Buffer.from(classic.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.from(compact.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.compare(Buffer.from(classic), Buffer.from(compact))).not.toBe(0);
  });

  it('applies the layout to invoices too, and defaults to classic', async () => {
    const invoice = {
      number: 'FAC-2026-0001',
      date: '2026-10-29',
      due_date: '2026-11-28',
      currency: 'XPF',
      discount_type: 'percent',
      discount_value: 0,
      paid_total: 0,
      balance: 34800,
      tax_exempt: 0,
      client_name: 'Hôtel Manava Tahiti',
    };
    const plain = await buildInvoicePdf(company, invoice, doc.line_items);
    const dense = await buildInvoicePdf(company, invoice, doc.line_items, 'compact');
    expect(Buffer.from(plain.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.from(dense.slice(0, 5)).toString()).toBe('%PDF-');
    expect(Buffer.compare(Buffer.from(plain), Buffer.from(dense))).not.toBe(0);
  });
});
