import { BASELINE } from './0001_baseline';
import { STATEMENTS as CREDIT_TAX_LINES } from './0002_credit_tax_lines';
import { STATEMENTS as APPROVALS_REVISION } from './0003_approvals_revision';
import { STATEMENTS as EXPENSE_PO_CURRENCY } from './0004_expense_po_currency';
import { STATEMENTS as INDEXES_AND_NUMBER_UNIQUENESS } from './0005_indexes_and_number_uniqueness';
import { STATEMENTS as INTEGRITY_CONSTRAINTS } from './0006_integrity_constraints';

export interface Migration {
  version: number;
  name: string;
  statements: string[];
}

/**
 * A-10: the schema is a list of dated, frozen migrations. A statement is never
 * edited once shipped — the baseline is a snapshot, and every later change is a
 * new file. `d1_migrations` records what has been applied, so a second run is a
 * no-op and an old database is upgraded in place without losing a row.
 */
export const MIGRATIONS: Migration[] = [
  { version: 1, name: 'baseline', statements: BASELINE },
  { version: 2, name: 'credit_tax_lines', statements: CREDIT_TAX_LINES },
  { version: 3, name: 'approvals_revision', statements: APPROVALS_REVISION },
  { version: 4, name: 'expense_po_currency', statements: EXPENSE_PO_CURRENCY },
  { version: 5, name: 'indexes_and_number_uniqueness', statements: INDEXES_AND_NUMBER_UNIQUENESS },
  { version: 6, name: 'integrity_constraints', statements: INTEGRITY_CONSTRAINTS },
];
