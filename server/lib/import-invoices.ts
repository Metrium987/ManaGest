import type { ImportColumn, ImportIssue, ParsedCsv } from './import';

/**
 * Invoices import (T-102c / OQ-015): one row per line item, document fields
 * repeated on every row of the same invoice number. Pure validation so the
 * grouping rules can be tested without D1.
 */

export const INVOICE_COLUMNS: ImportColumn[] = [
  { key: 'number', label: 'numéro', required: true, example: 'FAC-2026-1001' },
  { key: 'client', label: 'client', required: true, example: 'compta@manava-tahiti.pf', hint: 'courriel, numéro client ou nom exact' },
  { key: 'date', label: 'date', required: true, example: '2026-03-01', hint: 'AAAA-MM-JJ' },
  { key: 'due_date', label: 'échéance', example: '2026-03-31', hint: 'AAAA-MM-JJ, facultatif' },
  { key: 'description', label: 'désignation', required: true, example: 'Prestation de conseil' },
  { key: 'quantity', label: 'quantité', example: '1' },
  { key: 'unit_price', label: 'prix unitaire', example: '45000', hint: 'XPF, entier' },
  { key: 'tax_rate', label: 'tva', example: '16' },
  { key: 'tax_status', label: 'statut tva', example: 'taxable', hint: 'taxable ou exonéré' },
  { key: 'notes', label: 'notes', example: '' },
];

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

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
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

export function validateInvoiceImport(
  parsed: ParsedCsv,
  clients: ClientIndexEntry[],
  existingNumbers: Set<string>,
): InvoiceImportResult {
  const index = new Map(parsed.header.map((label, position) => [label.trim().toLowerCase(), position]));
  const missingColumns = INVOICE_COLUMNS
    .filter((column) => column.required && !index.has(column.label.toLowerCase()))
    .map((column) => column.label);

  const rows: InvoiceImportRow[] = [];
  const groups = new Map<string, InvoiceImportGroup>();

  parsed.rows.forEach((cells, offset) => {
    const rowNumber = offset + 2;
    const values: Record<string, string> = {};
    for (const column of INVOICE_COLUMNS) {
      const position = index.get(column.label.toLowerCase());
      values[column.key] = position === undefined ? '' : (cells[position] ?? '').trim();
    }
    if (values.number === '' && values.client === '' && values.description === '') return;
    // Template annotation row: every cell says "obligatoire" or "facultatif".
    const filled = INVOICE_COLUMNS.map((column) => (index.get(column.label.toLowerCase()) !== undefined
      ? (cells[index.get(column.label.toLowerCase())!] ?? '').trim()
      : '')).filter(Boolean);
    if (filled.length > 0 && filled.every((cell) => /obligatoire|facultatif/i.test(cell))) return;

    const issues: ImportIssue[] = [];
    if (!values.number) issues.push({ row: rowNumber, field: 'numéro', code: 'required' });
    if (!values.client) issues.push({ row: rowNumber, field: 'client', code: 'required' });
    if (!values.description) issues.push({ row: rowNumber, field: 'désignation', code: 'required' });
    if (!isIsoDate(values.date)) issues.push({ row: rowNumber, field: 'date', code: 'invalid_date' });
    if (values.due_date && !isIsoDate(values.due_date)) {
      issues.push({ row: rowNumber, field: 'échéance', code: 'invalid_date' });
    }

    const client = values.client ? findClient(clients, values.client) : null;
    if (values.client && !client) {
      issues.push({ row: rowNumber, field: 'client', code: 'client_not_found' });
    }

    const quantity = values.quantity === '' ? 1 : Number(values.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      issues.push({ row: rowNumber, field: 'quantité', code: 'expected_positive_number' });
    }
    const unitPrice = values.unit_price === '' ? 0 : Number(values.unit_price);
    if (!Number.isInteger(unitPrice)) {
      issues.push({ row: rowNumber, field: 'prix unitaire', code: 'expected_integer' });
    }
    const taxRate = values.tax_rate === '' ? 0 : Number(values.tax_rate);
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      issues.push({ row: rowNumber, field: 'tva', code: 'expected_rate' });
    }
    const taxStatus = normaliseTaxStatus(values.tax_status);
    if (taxStatus === null) {
      issues.push({ row: rowNumber, field: 'statut tva', code: 'expected_tax_status' });
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
        group.issues.push({ row: rowNumber, field: 'numéro', code: 'number_exists' });
        group.valid = false;
      }
      groups.set(values.number, group);
    } else {
      group.rows.push(rowNumber);
      if (client && group.client && group.client.id !== client.id) {
        group.issues.push({ row: rowNumber, field: 'client', code: 'header_conflict' });
        group.valid = false;
      }
      if (values.date && group.date && values.date !== group.date) {
        group.issues.push({ row: rowNumber, field: 'date', code: 'header_conflict' });
        group.valid = false;
      }
      if (values.due_date && group.due_date && values.due_date !== group.due_date) {
        group.issues.push({ row: rowNumber, field: 'échéance', code: 'header_conflict' });
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
    missingColumns,
    rows,
    groups: groupsList,
    errors,
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length,
  };
}
