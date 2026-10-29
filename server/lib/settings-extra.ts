/**
 * Key/value workspace settings added by the build phases. Kept in one module so
 * the routes that read them (PDF layout, language, retention, franchise
 * ceiling) and the settings screen agree on the same keys and defaults.
 */
export const EXTRA_KEYS = ['retention_years', 'ui_language', 'franchise_threshold', 'pdf_layout', 'attachment_max_mb', 'reminder_interval_days', 'api_token_lifetime_days', 'api_token_max_per_user', 'approval_credit_amount', 'approval_expense_amount', 'approval_discount_percent', 'separation_of_duties'] as const;

export type ExtraKey = (typeof EXTRA_KEYS)[number];

/**
 * Standard defaults adopted while no accountant has reviewed them (owner
 * decision 2026-10-29): 10 years of retention, the DICP franchise ceiling of
 * 10 000 000 XPF, French UI, classic document layout. They are ordinary
 * settings, editable without code.
 */
export const EXTRA_DEFAULTS: Record<ExtraKey, string> = {
  retention_years: '10',
  franchise_threshold: '10000000',
  ui_language: 'fr',
  pdf_layout: 'classic',
  // T-101: receipts are capped at 10 MB until the workspace changes it (1–25).
  attachment_max_mb: '10',
  // T-105: a client is reminded after 1, 8 and 15 days overdue.
  reminder_interval_days: '7',
  // T-303: API tokens last a year by default and an account may hold ten. Both
  // are ordinary settings, editable without redeploying.
  api_token_lifetime_days: '365',
  api_token_max_per_user: '10',
  // T-302: approval thresholds. `0` disables a rule, so these defaults only
  // block the operations they are meant to block, and every one is editable.
  approval_credit_amount: '100000',
  approval_expense_amount: '250000',
  approval_discount_percent: '20',
  // Separation of duties stays off until a workspace has more than one person:
  // enabling it for a single-owner business would stop them collecting anything.
  separation_of_duties: '0',
};

export function isExtraKey(value: string): value is ExtraKey {
  return (EXTRA_KEYS as readonly string[]).includes(value);
}

/** Reads a setting, falling back to its documented default. */
export async function getExtra(database: D1Database, key: ExtraKey): Promise<string> {
  const row = await database
    .prepare(`SELECT value FROM settings_extra WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? EXTRA_DEFAULTS[key];
}
