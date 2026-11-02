/**
 * CSV import helpers (T-102a / OQ-015 / H4). Pure functions only so the rules can
 * be unit-tested: the route reads the file text, this module decides what is valid.
 *
 * A file from an older system rarely uses our exact headers. Detection therefore
 * works in three layers, strongest first: an explicit mapping chosen by the
 * operator, our canonical label, then declared aliases (French and English).
 * Values are normalised the same way (`1 500`, `2,5`, `01/03/2026`), so a legacy
 * export can be imported without editing it by hand.
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

/**
 * Header labels a legacy file may use for the same field. Accents, case and
 * punctuation are ignored before comparison, so "N° TAHITI", "numéro tahiti" and
 * "Numero-Tahiti" are the same header.
 */
export const IMPORT_ALIASES: Record<ImportEntity, Record<string, string[]>> = {
  clients: {
    number: ['numéro client', 'code client', 'n° client', 'client id', 'customer id', 'code'],
    display_name: ['nom du client', 'client', 'raison sociale', 'name', 'customer', 'company'],
    email: ['e-mail', 'mail', 'adresse email', 'adresse e-mail', 'adresse courriel', 'email address'],
    phone: ['téléphone', 'tel', 'tél', 'phone', 'n° téléphone'],
    address1: ['adresse', 'adresse ligne 1', 'address', 'address 1', 'rue'],
    address2: ['adresse ligne 2', 'complément', 'address 2'],
    city: ['ville', 'city', 'town'],
    postal_code: ['cp', 'zip', 'postal code', 'zip code'],
    country: ['pays', 'country'],
    tax_id: ['n° tahiti', 'num tahiti', 'numéro fiscal', 'tax id', 'nif', 'tahiti number'],
    payment_terms: ['délai de paiement', 'échéance', 'payment terms', 'terms', 'jours'],
    is_tax_exempt: ['exonéré de tva', 'exempt', 'tax exempt', 'exoneration'],
    currency: ['devise', 'currency'],
    notes: ['note', 'commentaire', 'comment'],
    archived: ['archivé', 'archived', 'inactif'],
  },
  products: {
    product_key: ['ref', 'réf', 'code article', 'sku', 'code', 'item code', 'product key'],
    name: ['désignation', 'libellé', 'name', 'product name', 'article', 'nom de l’article'],
    description: ['détails', 'détail', 'description longue', 'details'],
    unit_price: ['prix de vente', 'prix ht', 'prix', 'tarif', 'unit price', 'price', 'sale price'],
    cost: ['coût d’achat', 'prix d’achat', 'coût unitaire', 'cost', 'purchase price'],
    quantity_milli: ['stock', 'quantité', 'qté', 'quantity', 'stock qty'],
    track_quantity: ['suivi de stock', 'track quantity', 'track stock', 'gère le stock'],
    tax_rate: ['taux tva', 'tva (%)', 'taux de tva', 'tax rate', 'vat', 'vat rate'],
  },
};

/** Lowercase, accent-free, punctuation-collapsed form used for comparison. */
export function normaliseHeader(label: string): string {
  return label
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export type ColumnMapping = Record<string, string>;

export interface ColumnResolution {
  /** Import column key -> the header actually found in the file. */
  mapping: ColumnMapping;
  /** Import column key -> its cell position. */
  positions: Map<string, number>;
  /** File headers that matched no column: kept visible, never guessed. */
  unknown: string[];
  /** Required column labels the file does not provide. */
  missing: string[];
}

/**
 * Resolves the file's headers against the entity's columns. An explicit mapping
 * always wins, which is what the preview screen sends once the operator has
 * chosen a column by hand.
 */
export function resolveColumns(
  columns: ImportColumn[],
  header: string[],
  explicit: ColumnMapping = {},
  aliases: Record<string, string[]> = {},
): ColumnResolution {
  const byHeader = new Map<string, { label: string; position: number }>();
  header.forEach((label, position) => {
    const key = normaliseHeader(label);
    if (key && !byHeader.has(key)) byHeader.set(key, { label, position });
  });

  const mapping: ColumnMapping = {};
  const positions = new Map<string, number>();
  const used = new Set<number>();
  const missing: string[] = [];

  for (const column of columns) {
    const candidates = [explicit[column.key], column.label, ...(aliases[column.key] ?? [])]
      .filter((candidate): candidate is string => Boolean(candidate && candidate.trim()));
    const found = candidates
      .map((candidate) => byHeader.get(normaliseHeader(candidate)))
      .find((hit): hit is { label: string; position: number } => Boolean(hit));
    if (found) {
      mapping[column.key] = found.label;
      positions.set(column.key, found.position);
      used.add(found.position);
    } else if (column.required) {
      missing.push(column.label);
    }
  }

  return {
    mapping,
    positions,
    unknown: header.filter((label, position) => label.trim() !== '' && !used.has(position)),
    missing,
  };
}

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
  /** Plain-language explanation, shown beside the row instead of a bare code. */
  message?: string;
}

/** What a code means to the person reading the preview. */
const ISSUE_MESSAGES: Record<string, string> = {
  required: 'valeur obligatoire',
  expected_boolean: 'attendu : oui/non (ou 0/1)',
  expected_integer: 'attendu : nombre entier',
  invalid_email: 'adresse de courriel invalide',
  unknown_tax_rate: 'taux de TVA absent des taux locaux (0, 1, 5, 13, 16)',
  duplicate_in_file: 'clé en double dans le fichier',
  invalid_date: 'attendu : date AAAA-MM-JJ ou JJ/MM/AAAA',
  expected_positive_number: 'attendu : nombre supérieur à zéro',
  expected_rate: 'attendu : taux entre 0 et 100',
  expected_tax_status: 'attendu : taxable ou exonéré',
  client_not_found: 'client introuvable (courriel, numéro ou nom exact)',
  number_exists: 'numéro déjà présent dans l’espace',
  header_conflict: 'en-tête différent de celui de la première ligne du document',
};

export function issueMessage(code: string): string {
  return ISSUE_MESSAGES[code] ?? code;
}

export function issue(row: number, field: string, code: string): ImportIssue {
  return { row, field, code, message: issueMessage(code) };
}

/**
 * `1 500`, `45 000 XPF`, `2,5` and `1,234.56` all become a plain number string.
 * The last decimal separator wins, so both French and English exports work.
 */
export function normaliseNumber(value: string): string {
  const cleaned = value
    .replace(/\u00a0|\u202f/g, ' ')
    .replace(/\s+/g, '')
    .replace(/[€$]/g, '')
    .replace(/(xpf|eur|usd|aud)$/i, '')
    .trim();
  if (cleaned === '') return '';
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma > lastDot) return cleaned.replace(/\./g, '').replace(',', '.');
  if (lastDot > lastComma) return cleaned.replace(/,/g, '');
  return cleaned;
}

/** Accepts `2026-03-01`, `01/03/2026` or `01-03-2026`; anything else is ''. */
export function normaliseDate(value: string): string {
  const text = value.trim();
  if (!text) return '';
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const french = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  const candidate = iso
    ? `${iso[1]}-${iso[2]}-${iso[3]}`
    : french
      ? `${french[3]}-${french[2].padStart(2, '0')}-${french[1].padStart(2, '0')}`
      : '';
  if (!candidate) return '';
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== candidate ? '' : candidate;
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
  mapping: ColumnMapping;
  unknownColumns: string[];
  rows: ValidatedRow[];
  errors: ImportIssue[];
  validCount: number;
  invalidCount: number;
}

/** The only VAT rates French Polynesia applies (H4.4): a rate outside this set
 * cannot be invoiced locally, so the row is refused instead of imported with a
 * silently wrong tax. */
export const LOCAL_TAX_RATES = [0, 1, 5, 13, 16] as const;

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

export interface ImportOptions {
  /** Operator-chosen column mapping, key -> source header. */
  mapping?: ColumnMapping;
}

/**
 * Validates the parsed file against the entity's columns. The first data row of
 * a template download is the annotation row; it is recognised by being a
 * "obligatoire/facultatif" description and skipped so templates import cleanly.
 */
export function validateImport(
  entity: ImportEntity,
  parsed: ParsedCsv,
  options: ImportOptions = {},
): ValidationResult {
  const columns = IMPORT_COLUMNS[entity];
  const resolution = resolveColumns(columns, parsed.header, options.mapping, IMPORT_ALIASES[entity]);
  const cell = (values: string[], key: string): string => {
    const position = resolution.positions.get(key);
    return position === undefined ? '' : (values[position] ?? '').trim();
  };

  const rows: ValidatedRow[] = [];
  const seenKeys = new Map<string, number>();

  parsed.rows.forEach((values, offset) => {
    const rowNumber = offset + 2;
    const cells = columns.map((column) => cell(values, column.key));
    // Template annotation row: every cell mentions "obligatoire" or "facultatif".
    if (cells.length > 0 && cells.filter(Boolean).every((entry) => /obligatoire|facultatif/i.test(entry))) {
      return;
    }

    const record: Record<string, string> = {};
    columns.forEach((column, position) => {
      const raw = cells[position] ?? '';
      record[column.key] = INTEGER_FIELDS.has(column.key) ? normaliseNumber(raw) : raw;
    });

    const issues: ImportIssue[] = [];
    for (const column of columns) {
      const value = record[column.key];
      if (column.required && value === '') {
        issues.push(issue(rowNumber, column.label, 'required'));
        continue;
      }
      if (value === '') continue;
      if (BOOLEAN_FIELDS.has(column.key) && !['0', '1', 'oui', 'non', 'true', 'false', 'vrai', 'faux', 'yes', 'no'].includes(value.toLowerCase())) {
        issues.push(issue(rowNumber, column.label, 'expected_boolean'));
      }
      if (INTEGER_FIELDS.has(column.key) && !Number.isInteger(Number(value))) {
        issues.push(issue(rowNumber, column.label, 'expected_integer'));
      }
    }

    if (entity === 'clients' && record.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(record.email)) {
      issues.push(issue(rowNumber, 'courriel', 'invalid_email'));
    }

    // H4.4: the owner chose to refuse a row whose VAT rate matches no local rate,
    // line by line, rather than importing it as exempt with a warning.
    if (entity === 'products' && record.tax_rate && !LOCAL_TAX_RATES.includes(Number(record.tax_rate) as never)) {
      issues.push(issue(rowNumber, 'tva', 'unknown_tax_rate'));
    }

    const key = entity === 'clients'
      ? (record.email ? record.email.toLowerCase() : record.number || null)
      : (record.product_key || null);

    if (key) {
      const previous = seenKeys.get(key);
      if (previous) {
        issues.push(issue(rowNumber, entity === 'clients' ? 'courriel / numéro' : 'référence', 'duplicate_in_file'));
        const first = rows.find((candidate) => candidate.row === previous);
        if (first && !first.issues.some((entry) => entry.code === 'duplicate_in_file')) {
          first.issues.push(issue(
            previous,
            entity === 'clients' ? 'courriel / numéro' : 'référence',
            'duplicate_in_file',
          ));
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
    missingColumns: resolution.missing,
    mapping: resolution.mapping,
    unknownColumns: resolution.unknown,
    rows,
    errors,
    validCount: rows.filter((row) => row.valid).length,
    invalidCount: rows.filter((row) => !row.valid).length,
  };
}

export function toBoolean(value: string): number {
  return ['1', 'oui', 'true', 'vrai', 'yes'].includes(value.trim().toLowerCase()) ? 1 : 0;
}
