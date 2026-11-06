/**
 * A-19: the audit chain gets a total order. `seq` numbers every entry and
 * `audit_tail` holds the last claimed number, so a claim is a single atomic
 * statement instead of a read-then-write race. Existing entries keep a NULL
 * `seq`: they predate the chain and are verified in creation order.
 */
export const STATEMENTS: string[] = [
  `ALTER TABLE activities ADD COLUMN seq INTEGER`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_seq ON activities(seq)`,
  `CREATE TABLE IF NOT EXISTS audit_tail (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    seq INTEGER NOT NULL
  )`,
  `INSERT OR IGNORE INTO audit_tail (id, seq) VALUES (1, 0)`,
];
