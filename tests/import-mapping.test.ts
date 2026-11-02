import { describe, expect, it } from 'vitest';
import {
  normaliseDate,
  normaliseHeader,
  normaliseNumber,
  parseCsv,
  resolveColumns,
  validateImport,
} from '../server/lib/import';
import {
  validateInvoiceImport,
  type ClientIndexEntry,
} from '../server/lib/import-invoices';

/**
 * H4 — an import from an older system must not require editing the file first.
 * These fixtures are the shapes a legacy export plausibly has: accented French
 * headers, English headers, chosen columns, French dates and spaced numbers.
 */

const clients: ClientIndexEntry[] = [{
  id: 'c1',
  display_name: 'Hôtel Manava',
  email: 'compta@manava.pf',
  number: 'CLI-001',
  is_tax_exempt: 0,
  currency: 'XPF',
}];

describe('header detection and value normalisation (H4)', () => {
  it('compares headers without accents, case or punctuation', () => {
    expect(normaliseHeader('N° TAHITI')).toBe('n tahiti');
    expect(normaliseHeader('Délai de paiement')).toBe('delai de paiement');
    expect(normaliseHeader('  Prix  HT ')).toBe('prix ht');
    expect(normaliseHeader('E-mail')).toBe('e mail');
  });

  it('reads French and English numbers without losing the decimals', () => {
    expect(normaliseNumber('1 500')).toBe('1500');
    expect(normaliseNumber('45 000 XPF')).toBe('45000');
    expect(normaliseNumber('2,5')).toBe('2.5');
    expect(normaliseNumber('1,234.56')).toBe('1234.56');
    expect(normaliseNumber('1.234,56')).toBe('1234.56');
    expect(normaliseNumber('')).toBe('');
  });

  it('accepts ISO and French dates, and refuses an impossible one', () => {
    expect(normaliseDate('2026-03-01')).toBe('2026-03-01');
    expect(normaliseDate('01/03/2026')).toBe('2026-03-01');
    expect(normaliseDate('1-3-2026')).toBe('2026-03-01');
    expect(normaliseDate('31/02/2026')).toBe('');
  });

  it('reports a file header that matches no field instead of guessing', () => {
    const parsed = parseCsv('nom;courriel;colonne inconnue\nA;a@x.pf;valeur\n');
    const resolution = resolveColumns(
      [{ key: 'display_name', label: 'nom', example: '', required: true }, { key: 'email', label: 'courriel', example: '' }],
      parsed.header,
    );
    expect(resolution.mapping).toEqual({ display_name: 'nom', email: 'courriel' });
    expect(resolution.unknown).toEqual(['colonne inconnue']);
  });
});

describe('legacy client files (H4)', () => {
  it('imports accented French headers, aliases and yes/no booleans', () => {
    const csv = [
      'Code client;Raison sociale;Adresse e-mail;Téléphone;Ville;Code postal;N° Tahiti;Délai de paiement;Exonéré de TVA',
      'CLI-900;Hôtel Tiare;compta@tiare.pf;+689 40 00 00;Papeete;98714;12345;30;Non',
    ].join('\n');
    const result = validateImport('clients', parseCsv(csv));
    expect(result.missingColumns).toEqual([]);
    expect(result.validCount).toBe(1);
    expect(result.rows[0].values).toMatchObject({
      number: 'CLI-900',
      display_name: 'Hôtel Tiare',
      email: 'compta@tiare.pf',
      city: 'Papeete',
      tax_id: '12345',
      payment_terms: '30',
      is_tax_exempt: 'Non',
    });
    expect(result.mapping).toMatchObject({ display_name: 'Raison sociale', email: 'Adresse e-mail' });
  });

  it('imports an English comma-separated export', () => {
    const csv = [
      'Customer ID,Name,Email,Phone,City,Country',
      'CLI-901,Manava Lodge,contact@lodge.pf,+689 40 11 22,Tahiti,Polynésie française',
    ].join('\n');
    const result = validateImport('clients', parseCsv(csv));
    expect(result.validCount).toBe(1);
    expect(result.rows[0].values.display_name).toBe('Manava Lodge');
  });

  it('lets the operator map columns the aliases cannot recognise', () => {
    const parsed = parseCsv('A;B;C\nHôtel Mooréa;contact@moorea.pf;Moorea\n');
    const unmapped = validateImport('clients', parsed);
    expect(unmapped.missingColumns).toEqual(['nom']);

    const mapped = validateImport('clients', parsed, {
      mapping: { display_name: 'A', email: 'B', city: 'C' },
    });
    expect(mapped.missingColumns).toEqual([]);
    expect(mapped.validCount).toBe(1);
    expect(mapped.rows[0].values).toMatchObject({ display_name: 'Hôtel Mooréa', city: 'Moorea' });
    expect(mapped.mapping).toEqual({ display_name: 'A', email: 'B', city: 'C' });
  });

  it('gives each bad cell a readable reason, row by row', () => {
    const csv = 'nom;courriel;délai paiement\nA;pas-un-courriel;trente\n';
    const result = validateImport('clients', parseCsv(csv));
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].issues.map((entry) => entry.code)).toEqual(['expected_integer', 'invalid_email']);
    expect(result.rows[0].issues.every((entry) => Boolean(entry.message))).toBe(true);
  });
});

describe('legacy product files (H4)', () => {
  it('reads spaced prices and stock from a French export', () => {
    const csv = [
      'Réf;Désignation;Prix de vente;Coût d’achat;Stock;Suivi de stock;TVA (%)',
      'PRD-9;Chaise toitane;1 500;900;12;oui;16',
    ].join('\n');
    const result = validateImport('products', parseCsv(csv));
    expect(result.validCount).toBe(1);
    expect(result.rows[0].values).toMatchObject({
      product_key: 'PRD-9',
      name: 'Chaise toitane',
      unit_price: '1500',
      cost: '900',
      quantity_milli: '12',
      tax_rate: '16',
    });
  });

  it('keeps refusing a VAT rate that exists nowhere locally', () => {
    const csv = 'SKU,Product Name,Sale Price,Tax Rate\nPRD-10,Table,2 000,8\n';
    const result = validateImport('products', parseCsv(csv));
    expect(result.rows[0].valid).toBe(false);
    expect(result.rows[0].issues[0]).toMatchObject({ code: 'unknown_tax_rate' });
  });
});

describe('legacy invoice files (H4)', () => {
  it('imports French dates, decimals and repeated document headers', () => {
    const csv = [
      'N° facture;Client;Date facture;Échéance;Désignation;Quantité;Prix unitaire;TVA;Statut TVA',
      'FAC-2026-9001;compta@manava.pf;01/03/2026;31/03/2026;Conseil;2,5;12 000;16;taxable',
      'FAC-2026-9001;compta@manava.pf;01/03/2026;31/03/2026;Déplacement;1;3 500;16;taxable',
    ].join('\n');
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set());
    expect(result.missingColumns).toEqual([]);
    expect(result.groups).toHaveLength(1);
    const group = result.groups[0];
    expect(group.date).toBe('2026-03-01');
    expect(group.due_date).toBe('2026-03-31');
    expect(group.lines).toEqual([
      { description: 'Conseil', quantity: 2.5, unit_price: 12000, tax_rate: 16, tax_status: 'taxable' },
      { description: 'Déplacement', quantity: 1, unit_price: 3500, tax_rate: 16, tax_status: 'taxable' },
    ]);
    expect(group.valid).toBe(true);
  });

  it('maps invoice columns chosen by hand', () => {
    const csv = 'Doc;Compte;Le;Libellé;Montant\nFAC-2026-9002;CLI-001;05/04/2026;Audit;80 000\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set(), {
      mapping: { number: 'Doc', client: 'Compte', date: 'Le', description: 'Libellé', unit_price: 'Montant' },
    });
    expect(result.missingColumns).toEqual([]);
    expect(result.groups[0]).toMatchObject({ number: 'FAC-2026-9002', date: '2026-04-05', valid: true });
    expect(result.groups[0].lines[0]).toMatchObject({ unit_price: 80000 });
  });

  it('explains a bad date instead of only naming a code', () => {
    const csv = 'numéro;client;date;désignation\nFAC-1;compta@manava.pf;2026-13-40;Conseil\n';
    const result = validateInvoiceImport(parseCsv(csv), clients, new Set());
    expect(result.rows[0].issues).toEqual([{
      row: 2,
      field: 'date',
      code: 'invalid_date',
      message: 'attendu : date AAAA-MM-JJ ou JJ/MM/AAAA',
    }]);
  });
});
