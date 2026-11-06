CREATE TABLE approvals_v2 (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  amount INTEGER NOT NULL DEFAULT 0,
  controlled_amount INTEGER NOT NULL DEFAULT 0,
  controlled_discount INTEGER,
  rule TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_by TEXT,
  decided_by TEXT,
  note TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  superseded_at TEXT,
  UNIQUE (entity_type, entity_id, revision)
);

INSERT INTO approvals_v2 (id, entity_type, entity_id, revision, amount, controlled_amount,
  controlled_discount, rule, status, requested_by, decided_by, note, created_at, decided_at, superseded_at)
SELECT id, entity_type, entity_id, 1, amount, amount, NULL, rule, status, requested_by, decided_by,
  note, created_at, decided_at, NULL FROM approvals;

DROP TABLE approvals;

ALTER TABLE approvals_v2 RENAME TO approvals;

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
