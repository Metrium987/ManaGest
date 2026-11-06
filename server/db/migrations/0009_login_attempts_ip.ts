/**
 * A-20: the IP quota of the login throttle reads `(ip, created_at)`, the account
 * quota already has its `(email, created_at)` index. The retention purge also
 * filters on `created_at`.
 */
export const STATEMENTS: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts(ip, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_created ON login_attempts(created_at)`,
];
