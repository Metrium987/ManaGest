/**
 * A-24: the retention purge filters every table on a date column, so each one
 * gets the index that keeps the `DELETE … LIMIT` cheap as the history grows.
 * `activities(created_at)` already exists; `sessions` only had `(user_id)`.
 */
export const STATEMENTS: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_public_link_access_created ON public_link_access(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_mfa_challenges_created ON mfa_challenges(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_created ON password_reset_tokens(created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_deleted ON attachments(deleted_at)`,
];
