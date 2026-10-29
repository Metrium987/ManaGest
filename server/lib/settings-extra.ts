/**
 * Key/value workspace settings added by the build phases. Kept in one module so
 * the routes that read them (PDF layout, language, retention, franchise
 * ceiling) and the settings screen agree on the same keys and defaults.
 */
export const EXTRA_KEYS = ['retention_years', 'ui_language', 'franchise_threshold', 'pdf_layout'] as const;

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
