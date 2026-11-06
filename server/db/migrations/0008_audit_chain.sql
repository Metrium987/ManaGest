-- A-19: total order for the audit chain.
ALTER TABLE activities ADD COLUMN seq INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_seq ON activities(seq);
CREATE TABLE IF NOT EXISTS audit_tail (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  seq INTEGER NOT NULL
);
INSERT OR IGNORE INTO audit_tail (id, seq) VALUES (1, 0);
