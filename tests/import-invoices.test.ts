import { describe, expect, it } from 'vitest';
import { parseCsv } from '../server/lib/import';
import { findClient, invoiceTemplateCsv, validateInvoiceImport, type ClientIndexEntry } from '../server/lib/import-invoices';

const clients: ClientIndexEntry[] = [
  { id: 'c1', display_name: 'Hôtel Manava Tahiti', email: 'compta@manava.pf', number: 'CLI-0001', is_tax_exempt: 0, currency: 'XPF' },
  { id: 'c2', display_name: 'Perlerie Teva', email: null, number: 'CLI-0002', is_tax_exempt: 1, currency: 'XPF' },
];

const head = 'numéro;client;date;échéance;désignation;quantité;prix unitaire;tva;statut tva;notes\n';

describe('invoices import (T-102c)', () => {
  it('groups line rows into one document per invoice number', () => {
    const csv = head
      + 'FAC-1;compta@manava.pf;2026-03-01;2026-03-31;Conseil;1;45000;16;taxable;\n'
      + 'FAC-1;compta@manava.pf;2026-03-01;2026-03-31;Matériel;2;12000;16;taxable;\n'
      + 'FAC-2;CLI-0002;2026-03-02;;Perles;3;5000;0;exonéré;\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set());
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].lines).toHaveLength(2);
    expect(result.groups[0].lines[1]).toMatchObject({ description: 'Matériel', quantity: 2, unit_price: 12000 });
    expect(result.groups[1].lines[0].tax_status).toBe('exempt');
    expect(result.groups.every((group) => group.valid)).toBe(true);
  });

  it('resolves the client by email, client number or exact name', () => {
    expect(findClient(clients, 'COMPTA@MANAVA.PF')?.id).toBe('c1');
    expect(findClient(clients, 'cli-0002')?.id).toBe('c2');
    expect(findClient(clients, 'Perlerie Teva')?.id).toBe('c2');
    expect(findClient(clients, 'inconnu@nulle-part.pf')).toBeNull();
  });

  it('GIVEN an unknown client WHEN previewed THEN the row names the client issue', () => {
    const csv = head + 'FAC-3;fantome@nulle-part.pf;2026-03-01;;Conseil;1;1000;16;taxable;\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set());
    expect(result.errors.some((issue) => issue.code === 'client_not_found')).toBe(true);
  });

  it('GIVEN disagreeing document fields on one number WHEN previewed THEN the document is refused', () => {
    const csv = head
      + 'FAC-4;compta@manava.pf;2026-03-01;;Conseil;1;1000;16;taxable;\n'
      + 'FAC-4;compta@manava.pf;2026-03-02;;Conseil;1;1000;16;taxable;\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set());
    expect(result.groups[0].valid).toBe(false);
    expect(result.groups[0].issues[0].code).toBe('header_conflict');
  });

  it('GIVEN an invoice number that already exists WHEN previewed THEN it is refused', () => {
    const csv = head + 'FAC-5;compta@manava.pf;2026-03-01;;Conseil;1;1000;16;taxable;\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set(['fac-5']));
    expect(result.groups[0].issues[0].code).toBe('number_exists');
  });

  it('GIVEN a non ISO date WHEN previewed THEN the date is refused', () => {
    const csv = head + 'FAC-6;compta@manava.pf;01/03/2026;;Conseil;1;1000;16;taxable;\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set());
    expect(result.errors.some((issue) => issue.code === 'invalid_date')).toBe(true);
  });

  it('the invoice template contains two valid rows of the same document', () => {
    // The template's example rows use a placeholder client; give it a home.
    const withExample = [...clients, { id: 'c3', display_name: 'Hôtel Manava Tahiti', email: 'compta@manava-tahiti.pf', number: 'CLI-0003', is_tax_exempt: 0, currency: 'XPF' }];
    const result = validateInvoiceImport(parseCsv(invoiceTemplateCsv()), withExample, new Set());
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].lines).toHaveLength(2);
    expect(result.rows.every((row) => row.valid)).toBe(true);
  });
});
