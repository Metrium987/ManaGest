/**
 * Key/value workspace settings added by the build phases. Kept in one module so
 * the routes that read them (PDF layout, language, retention, franchise
 * ceiling) and the settings screen agree on the same keys and defaults.
 */
export const EXTRA_KEYS = ['retention_years', 'ui_language', 'franchise_threshold', 'pdf_layout', 'attachment_max_mb', 'reminder_interval_days'] as const;

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
