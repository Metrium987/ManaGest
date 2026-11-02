import {
  issue,
  normaliseDate,
  normaliseNumber,
  resolveColumns,
  type ColumnMapping,
  type ImportColumn,
  type ImportIssue,
  type ParsedCsv,
} from './import';

/**
 * Invoices import (T-102c / OQ-015 / H4): one row per line item, document fields
 * repeated on every row of the same invoice number. Pure validation so the
 * grouping rules can be tested without D1. Headers may come from an older system:
 * aliases and an explicit mapping are resolved by the shared import helpers, and
 * dates/quantities are normalised (`01/03/2026`, `2,5`).
 */

export const INVOICE_COLUMNS: ImportColumn[] = [
  { key: 'number', label: 'numéro', required: true, example: 'FAC-2026-1001' },
  { key: 'client', label: 'client', required: true, example: 'compta@manava-tahiti.pf', hint: 'courriel, numéro client ou nom exact' },
  { key: 'date', label: 'date', required: true, example: '2026-03-01', hint: 'AAAA-MM-JJ ou JJ/MM/AAAA' },
  { key: 'due_date', label: 'échéance', example: '2026-03-31', hint: 'AAAA-MM-JJ ou JJ/MM/AAAA, facultatif' },
  { key: 'description', label: 'désignation', required: true, example: 'Prestation de conseil' },
  { key: 'quantity', label: 'quantité', example: '1' },
  { key: 'unit_price', label: 'prix unitaire', example: '45000', hint: 'XPF, entier' },
  { key: 'tax_rate', label: 'tva', example: '16' },
  { key: 'tax_status', label: 'statut tva', example: 'taxable', hint: 'taxable ou exonéré' },
  { key: 'notes', label: 'notes', example: '' },
];

export const INVOICE_ALIASES: Record<string, string[]> = {
  number: ['n° facture', 'numéro facture', 'facture', 'invoice', 'invoice number', 'bill number', 'pièce'],
  client: ['nom du client', 'customer', 'compte client', 'code client', 'client name'],
  date: ['date facture', 'invoice date', 'date emission', 'date d’émission'],
  due_date: ['date échéance', 'date d’échéance', 'due date', 'date limite'],
  description: ['description', 'libellé', 'article', 'item', 'product'],
  quantity: ['qté', 'qty'],
  unit_price: ['prix ht', 'prix', 'tarif', 'unit price', 'price'],
  tax_rate: ['taux tva', 'taux de tva', 'tax rate', 'vat', 'vat rate'],
  tax_status: ['régime tva', 'tax status', 'vat status', 'exonération'],
  notes: ['note', 'commentaire', 'comment'],
};

export function invoiceTemplateCsv(): string {
  const header = INVOICE_COLUMNS.map((column) => column.label).join(';');
  const hints = INVOICE_COLUMNS
    .map((column) => `${column.label} : ${column.required ? 'obligatoire' : 'facultatif'}${column.hint ? ` — ${column.hint}` : ''}`)
    .join(';');
  const first = INVOICE_COLUMNS.map((column) => column.example).join(';');
  const second = INVOICE_COLUMNS.map((column) => ({
    number: 'FAC-2026-1001',
    client: 'compta@manava-tahiti.pf',
    date: '2026-03-01',
    due_date: '2026-03-31',
    description: 'Location de matériel',
    quantity: '2',
    unit_price: '12000',
    tax_rate: '16',
    tax_status: 'taxable',
    notes: 'Deuxième ligne du même document',
  } as Record<string, string>)[column.key] ?? '').join(';');
  return `\uFEFF${[header, hints, first, second].join('\r\n')}\r\n`;
}

export interface ClientIndexEntry {
  id: string;
  display_name: string;
  email: string | null;
  number: string | null;
  is_tax_exempt: number;
  currency: string;
}

export interface InvoiceImportRow {
  row: number;
  values: Record<string, string>;
  valid: boolean;
  issues: ImportIssue[];
}

export interface InvoiceImportLine {
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_status: 'taxable' | 'exempt';
}

export interface InvoiceImportGroup {
  number: string;
  client: ClientIndexEntry | null;
  date: string;
  due_date: string | null;
  notes: string | null;
  lines: InvoiceImportLine[];
  rows: number[];
  valid: boolean;
  issues: ImportIssue[];
}

export interface InvoiceImportResult {
  missingColumns: string[];
  mapping: ColumnMapping;
  unknownColumns: string[];
  rows: InvoiceImportRow[];
  groups: InvoiceImportGroup[];
  errors: ImportIssue[];
  validCount: number;
  invalidCount: number;
}

function normaliseTaxStatus(value: string): 'taxable' | 'exempt' | null {
  const text = value.trim().toLowerCase();
  if (text === '' || text === 'taxable' || text === 'assujetti') return 'taxable';
  if (['exempt', 'exonéré', 'exonere', 'exempté'].includes(text)) return 'exempt';
  return null;
}

export function findClient(clients: ClientIndexEntry[], needle: string): ClientIndexEntry | null {
  const value = needle.trim().toLowerCase();
  if (!value) return null;
  return (
    clients.find((client) => client.email?.toLowerCase() === value)
    ?? clients.find((client) => client.number?.toLowerCase() === value)
    ?? clients.find((client) => client.display_name.toLowerCase() === value)
    ?? null
  );
}

export interface InvoiceImportOptions {
  mapping?: ColumnMapping;
}

export function validateInvoiceImport(
  parsed: ParsedCsv,
  clients: ClientIndexEntry[],
  existingNumbers: Set<string>,
  options: InvoiceImportOptions = {},
): InvoiceImportResult {
  const resolution = resolveColumns(INVOICE_COLUMNS, parsed.header, options.mapping, INVOICE_ALIASES);
  const cell = (values: string[], key: string): string => {
    const position = resolution.positions.get(key);
    return position === undefined ? '' : (values[position] ?? '').trim();
  };

  const rows: InvoiceImportRow[] = [];
  const groups = new Map<string, InvoiceImportGroup>();

  parsed.rows.forEach((valuesInFile, offset) => {
    const rowNumber = offset + 2;
    const raw: Record<string, string> = {};
    for (const column of INVOICE_COLUMNS) raw[column.key] = cell(valuesInFile, column.key);
    if (raw.number === '' && raw.client === '' && raw.description === '') return;
    // Template annotation row: every cell says "obligatoire" or "facultatif".
    const filled = INVOICE_COLUMNS.map((column) => raw[column.key]).filter(Boolean);
    if (filled.length > 0 && filled.every((entry) => /obligatoire|facultatif/i.test(entry))) return;

    const values: Record<string, string> = {
      ...raw,
      date: normaliseDate(raw.date),
      due_date: raw.due_date ? normaliseDate(raw.due_date) : '',
      quantity: normaliseNumber(raw.quantity),
      unit_price: normaliseNumber(raw.unit_price),
      tax_rate: normaliseNumber(raw.tax_rate),
    };

    const issues: ImportIssue[] = [];
    if (!values.number) issues.push(issue(rowNumber, 'numéro', 'required'));
    if (!values.client) issues.push(issue(rowNumber, 'client', 'required'));
    if (!values.description) issues.push(issue(rowNumber, 'désignation', 'required'));
    if (!values.date) issues.push(issue(rowNumber, 'date', 'invalid_date'));
    if (raw.due_date && !values.due_date) {
      issues.push(issue(rowNumber, 'échéance', 'invalid_date'));
    }

    const client = values.client ? findClient(clients, values.client) : null;
    if (values.client && !client) {
      issues.push(issue(rowNumber, 'client', 'client_not_found'));
    }

    const quantity = values.quantity === '' ? 1 : Number(values.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      issues.push(issue(rowNumber, 'quantité', 'expected_positive_number'));
    }
    const unitPrice = values.unit_price === '' ? 0 : Number(values.unit_price);
    if (!Number.isInteger(unitPrice)) {
      issues.push(issue(rowNumber, 'prix unitaire', 'expected_integer'));
    }
    const taxRate = values.tax_rate === '' ? 0 : Number(values.tax_rate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      issues.push(issue(rowNumber, 'tva', 'expected_rate'));
    }
    const taxStatus = normaliseTaxStatus(values.tax_status);
    if (taxStatus === null) {
      issues.push(issue(rowNumber, 'statut tva', 'expected_tax_status'));
    }

    rows.push({ row: rowNumber, values, valid: issues.length === 0, issues });
    if (!values.number) return;

    let group = groups.get(values.number);
    if (!group) {
      group = {
        number: values.number,
        client,
        date: values.date,
        due_date: values.due_date || null,
        notes: values.notes || null,
        lines: [],
        rows: [rowNumber],
        valid: true,
        issues: [],
      };
      if (existingNumbers.has(values.number.toLowerCase())) {
        group.issues.push(issue(rowNumber, 'numéro', 'number_exists'));
        group.valid = false;
      }
      groups.set(values.number, group);
    } else {
      group.rows.push(rowNumber);
      if (client && group.client && group.client.id !== client.id) {
        group.issues.push(issue(rowNumber, 'client', 'header_conflict'));
        group.valid = false;
      }
      if (values.date && group.date && values.date !== group.date) {
        group.issues.push(issue(rowNumber, 'date', 'header_conflict'));
        group.valid = false;
      }
      if (values.due_date && group.due_date && values.due_date !== group.due_date) {
        group.issues.push(issue(rowNumber, 'échéance', 'header_conflict'));
        group.valid = false;
      }
      if (!group.client && client) group.client = client;
    }

    if (issues.length > 0) group.valid = false;
    if (issues.length === 0 && group.client) {
      group.lines.push({
        description: values.description,
        quantity,
        unit_price: unitPrice,
        tax_rate: taxStatus === 'exempt' ? 0 : taxRate,
        tax_status: taxStatus ?? 'taxable',
      });
    }
  });

  const groupsList = [...groups.values()];
  groupsList.forEach((group) => {
    if (group.lines.length === 0) group.valid = false;
  });
  const errors = [...rows.flatMap((row) => row.issues), ...groupsList.flatMap((group) => group.issues)];
  return {
    missingColumns: resolution.missing,
    mapping: resolution.mapping,
    unknownColumns: resolution.unknown,
    rows,
    groups: groupsList,
    errors,
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length,
  };
}
