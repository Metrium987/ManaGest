/* A-06: an approval covers a precise amount and can be requested again. */
export const STATEMENTS: string[] = [
  "CREATE TABLE approvals_v2 (\n  id TEXT PRIMARY KEY,\n  entity_type TEXT NOT NULL,\n  entity_id TEXT NOT NULL,\n  revision INTEGER NOT NULL DEFAULT 1,\n  amount INTEGER NOT NULL DEFAULT 0,\n  controlled_amount INTEGER NOT NULL DEFAULT 0,\n  controlled_discount INTEGER,\n  rule TEXT NOT NULL,\n  status TEXT NOT NULL DEFAULT 'pending',\n  requested_by TEXT,\n  decided_by TEXT,\n  note TEXT,\n  created_at TEXT NOT NULL,\n  decided_at TEXT,\n  superseded_at TEXT,\n  UNIQUE (entity_type, entity_id, revision)\n)",
  "INSERT INTO approvals_v2 (id, entity_type, entity_id, revision, amount, controlled_amount,\n  controlled_discount, rule, status, requested_by, decided_by, note, created_at, decided_at, superseded_at)\nSELECT id, entity_type, entity_id, 1, amount, amount, NULL, rule, status, requested_by, decided_by,\n  note, created_at, decided_at, NULL FROM approvals",
  "DROP TABLE approvals",
  "ALTER TABLE approvals_v2 RENAME TO approvals",
  "CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status)"
];
