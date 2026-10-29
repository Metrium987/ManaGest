/**
 * CSV import helpers (T-102a / OQ-015). Pure functions only so the rules can be
 * unit-tested: the route reads the file text, this module decides what is valid.
 * Column labels are the exact export headers, so an exported file re-imports
 * unchanged (round-trip requirement).
 */

export type ImportEntity = 'clients' | 'products';

export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  /** Value used in the downloadable template's example row. */
  example: string;
  hint?: string;
}

export const IMPORT_COLUMNS: Record<ImportEntity, ImportColumn[]> = {
  clients: [
    { key: 'number', label: 'numéro', example: '', hint: 'laisser vide pour numérotation automatique' },
    { key: 'display_name', label: 'nom', required: true, example: 'Hôtel Manava Tahiti' },
    { key: 'email', label: 'courriel', example: 'compta@manava-tahiti.pf', hint: 'clé de rapprochement si renseignée' },
    { key: 'phone', label: 'téléphone', example: '+689 40 86 12 00' },
    { key: 'address1', label: 'adresse 1', example: 'Boulevard Pomare' },
    { key: 'address2', label: 'adresse 2', example: '' },
    { key: 'city', label: 'commune', example: 'Papeete' },
    { key: 'postal_code', label: 'code postal', example: '98714' },
    { key: 'country', label: 'pays', example: 'Polynésie française' },
    { key: 'tax_id', label: 'numéro tahiti', example: '12345' },
    { key: 'payment_terms', label: 'délai paiement', example: '30', hint: 'jours, entier' },
    { key: 'is_tax_exempt', label: 'exonéré', example: '0', hint: '0 ou 1' },
    { key: 'currency', label: 'devise', example: 'XPF' },
    { key: 'notes', label: 'notes', example: '' },
    { key: 'archived', label: 'archivé', example: '0', hint: '0 ou 1' },
  ],
  products: [
    { key: 'product_key', label: 'référence', example: 'PREST-001', hint: 'clé de rapprochement' },
    { key: 'name', label: 'nom', required: true, example: 'Journée de conseil' },
    { key: 'description', label: 'description', example: 'Prestation de conseil, demi-journée' },
    { key: 'unit_price', label: 'prix unitaire', example: '45000', hint: 'XPF, entier' },
    { key: 'cost', label: 'coût', example: '0' },
    { key: 'quantity_milli', label: 'stock (millièmes)', example: '0', hint: 'stock × 1000' },
    { key: 'track_quantity', label: 'suivi stock', example: '0', hint: '0 ou 1' },
    { key: 'tax_rate', label: 'tva', example: '16', hint: 'taux appliqué si aucune ligne ne le surcharge' },
  ],
};

export interface ParsedCsv {
  header: string[];
  rows: string[][];
  delimiter: ',' | ';';
}

export function detectDelimiter(headerLine: string): ',' | ';' {
  const semicolons = (headerLine.match(/;/g) ?? []).length;
  const commas = (headerLine.match(/,/g) ?? []).length;
  return semicolons >= commas ? ';' : ',';
}

/** Minimal RFC-4180 parser: quoted cells, doubled quotes, CRLF or LF. */
export function parseCsv(input: string): ParsedCsv {
  const text = input.replace(/^\uFEFF/, '');
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = detectDelimiter(firstLine);
  const cells: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === delimiter) {
      row.push(cell);
      cell = '';
    } else if (char === '\n') {
      row.push(cell);
      cells.push(row);
      row = [];
      cell = '';
    } else if (char !== '\r') {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    cells.push(row);
  }

  const [headerRow = [], ...dataRows] = cells;
  return {
    header: headerRow.map((value) => value.trim()),
    // Drop blank trailing lines produced by a final newline.
    rows: dataRows.filter((values) => values.some((value) => value.trim() !== '')),
    delimiter,
  };
}

export interface ImportIssue {
  row: number;
  field: string;
  code: string;
}

export interface ValidatedRow {
  /** 1-based line number in the file, header being line 1. */
  row: number;
  values: Record<string, string>;
  key: string | null;
  valid: boolean;
  issues: ImportIssue[];
}

export interface ValidationResult {
  missingColumns: string[];
  rows: ValidatedRow[];
  errors: ImportIssue[];
  validCount: number;
  invalidCount: number;
}

const BOOLEAN_FIELDS = new Set(['is_tax_exempt', 'archived', 'track_quantity']);
const INTEGER_FIELDS = new Set([
  'payment_terms', 'unit_price', 'cost', 'quantity_milli', 'tax_rate',
]);

export function templateCsv(entity: ImportEntity): string {
  const columns = IMPORT_COLUMNS[entity];
  const header = columns.map((c) => c.label).join(';');
  const hints = columns
    .map((c) => `${c.label} : ${c.required ? 'obligatoire' : 'facultatif'}${c.hint ? ` — ${c.hint}` : ''}`)
    .join(';');
  const example = columns.map((c) => c.example).join(';');
  return `\uFEFF${[header, hints, example].join('\r\n')}\r\n`;
}

/**
 * Validates the parsed file against the entity's columns. The first data row of
 * a template download is the annotation row; it is recognised by being a
 * "obligatoire/facultatif" description and skipped so templates import cleanly.
 */
export function validateImport(entity: ImportEntity, parsed: ParsedCsv): ValidationResult {
  const columns = IMPORT_COLUMNS[entity];
  const index = new Map(parsed.header.map((label, position) => [label.toLowerCase(), position]));
  // Only required columns must be present; omitting an optional column simply
  // leaves its default in place, which keeps hand-made files usable.
  const missingColumns = columns
    .filter((column) => column.required && !index.has(column.label.toLowerCase()))
    .map((column) => column.label);

  const rows: ValidatedRow[] = [];
  const seenKeys = new Map<string, number>();

  parsed.rows.forEach((values, offset) => {
    const rowNumber = offset + 2;
    const cells = columns.map((column) => (index.get(column.label.toLowerCase()) !== undefined
      ? (values[index.get(column.label.toLowerCase())!] ?? '').trim()
      : ''));
    // Template annotation row: every cell mentions "obligatoire" or "facultatif".
    if (cells.length > 0 && cells.filter(Boolean).every((cell) => /obligatoire|facultatif/i.test(cell))) {
      return;
    }

    const record: Record<string, string> = {};
    columns.forEach((column, position) => {
      record[column.key] = cells[position] ?? '';
    });

    const issues: ImportIssue[] = [];
    for (const column of columns) {
      const value = record[column.key];
      if (column.required && value === '') {
        issues.push({ row: rowNumber, field: column.label, code: 'required' });
        continue;
      }
      if (value === '') continue;
      if (BOOLEAN_FIELDS.has(column.key) && !['0', '1', 'oui', 'non', 'true', 'false'].includes(value.toLowerCase())) {
        issues.push({ row: rowNumber, field: column.label, code: 'expected_boolean' });
      }
      if (INTEGER_FIELDS.has(column.key) && !Number.isInteger(Number(value))) {
        issues.push({ row: rowNumber, field: column.label, code: 'expected_integer' });
      }
    }

    if (entity === 'clients' && record.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email)) {
      issues.push({ row: rowNumber, field: 'courriel', code: 'invalid_email' });
    }

    const key = entity === 'clients'
      ? (record.email ? record.email.toLowerCase() : record.number || null)
      : (record.product_key || null);

    if (key) {
      const previous = seenKeys.get(key);
      if (previous) {
        issues.push({ row: rowNumber, field: entity === 'clients' ? 'courriel / numéro' : 'référence', code: 'duplicate_in_file' });
        const first = rows.find((candidate) => candidate.row === previous);
        if (first && !first.issues.some((issue) => issue.code === 'duplicate_in_file')) {
          first.issues.push({
            row: previous,
            field: entity === 'clients' ? 'courriel / numéro' : 'référence',
            code: 'duplicate_in_file',
          });
          first.valid = false;
        }
      } else {
        seenKeys.set(key, rowNumber);
      }
    }

    rows.push({ row: rowNumber, values: record, key, valid: issues.length === 0, issues });
  });

  const errors = rows.flatMap((row) => row.issues);
  return {
    missingColumns,
    rows,
    errors,
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length,
  };
}

export function toBoolean(value: string): number {
  return ['1', 'oui', 'true'].includes(value.trim().toLowerCase()) ? 1 : 0;
}
