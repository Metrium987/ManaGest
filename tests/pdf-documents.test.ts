import { describe, expect, it } from 'vitest';
import { buildDocumentPdf } from '../server/services/pdf-documents';
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
} as unknown as CompanyRow;

const base = {
  number: 'DEV-2026-0001',
  date: '2026-10-29',
  secondary: '2026-11-28',
  currency: 'XPF',
  line_items: [
    { id: 'a', description: 'Prestation de conseil', quantity: 2, unit_price: 15000, tax_rate: 16 },
    { id: 'b', description: 'Frais de déplacement exonérés', quantity: 1, unit_price: 5000, tax_rate: 16, tax_status: 'exempt' as const },
  ],
  discount_type: 'percent',
  discount_value: 0,
  discount_total: 0,
  subtotal: 35000,
  tax_total: 4800,
  total: 39800,
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

describe('quote and credit PDFs (T-108a)', () => {
  it('builds a PDF for a quote', async () => {
    const bytes = await buildDocumentPdf('quote', company, base);
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('builds a PDF for a credit note', async () => {
    const bytes = await buildDocumentPdf('credit', company, { ...base, number: 'AV-2026-0001', secondary: 'Envoyé' });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
    expect(bytes.byteLength).toBeGreaterThan(1000);
  });

  it('survives a document with many lines (pagination path)', async () => {
    const lines = Array.from({ length: 40 }, (_, index) => ({
      id: `l${index}`,
      description: `Ligne ${index + 1} — prestation détaillée`,
      quantity: 1,
      unit_price: 1000,
      tax_rate: 16,
    }));
    const bytes = await buildDocumentPdf('quote', company, { ...base, line_items: lines });
    expect(Buffer.from(bytes.slice(0, 5)).toString()).toBe('%PDF-');
  });
});
