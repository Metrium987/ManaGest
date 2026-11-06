/* A-04: the VAT mirror of credit notes. */
export const STATEMENTS: string[] = [
  "CREATE TABLE IF NOT EXISTS credit_tax_lines (id TEXT PRIMARY KEY, credit_id TEXT NOT NULL, rate INTEGER NOT NULL, base INTEGER NOT NULL, amount INTEGER NOT NULL, created_at TEXT NOT NULL, UNIQUE (credit_id, rate))",
  "CREATE INDEX IF NOT EXISTS idx_credit_tax_lines_credit ON credit_tax_lines(credit_id)"
];
