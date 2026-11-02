/**
 * Key/value workspace settings added by the build phases. Kept in one module so
 * the routes that read them (PDF layout, language, retention, franchise
 * ceiling) and the settings screen agree on the same keys and defaults.
 */
import {
  ACCOUNT_ROLES,
  ACCOUNT_SETTING_KEYS,
  DEFAULT_ACCOUNT_CODES,
  accountCodeError,
  accountCodesWith,
  type AccountCodes,
} from '../../shared/accounts';

export const EXTRA_KEYS = ['retention_years', 'ui_language', 'franchise_threshold', 'pdf_layout', 'attachment_max_mb', 'reminder_interval_days', 'api_token_lifetime_days', 'api_token_max_per_user', 'approval_credit_amount', 'approval_expense_amount', 'approval_discount_percent', 'separation_of_duties', 'item_accounts', 'archipelago_excluded_families', 'account_client', 'account_supplier', 'account_sales', 'account_deferred', 'account_bank', 'account_expense', 'account_vat_due', 'account_vat_deductible', 'account_retained_earnings'] as const;

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
  // Q2: posting a sale to the article's (or its family's) account stays off until
  // the workspace turns it on, so enabling it never rewrites a past reading by
  // surprise. Posted entries keep the account they were posted with.
  item_accounts: '0',
  // Q4: the 1 % archipelago rate never applies to alcohol, tobacco or the products
  // subject to the prevention tax. Families are free text, so the list is a
  // setting rather than a hard-coded match.
  archipelago_excluded_families: 'Alcools,Tabacs',
  // The chart the postings use. Shared defaults, not literals in the rules.
  account_client: DEFAULT_ACCOUNT_CODES.client,
  account_supplier: DEFAULT_ACCOUNT_CODES.supplier,
  account_sales: DEFAULT_ACCOUNT_CODES.sales,
  account_deferred: DEFAULT_ACCOUNT_CODES.deferred,
  account_bank: DEFAULT_ACCOUNT_CODES.bank,
  account_expense: DEFAULT_ACCOUNT_CODES.expense,
  account_vat_due: DEFAULT_ACCOUNT_CODES.vatDue,
  account_vat_deductible: DEFAULT_ACCOUNT_CODES.vatDeductible,
  account_retained_earnings: DEFAULT_ACCOUNT_CODES.retainedEarnings,
};

export function isExtraKey(value: string): value is ExtraKey {
  return (EXTRA_KEYS as readonly string[]).includes(value);
}

const intBetween = (value: string, min: number, max: number): boolean =>
  /^\d{1,7}$/.test(value) && Number(value) >= min && Number(value) <= max;

/**
 * Format of every setting, in one table. `0` is a valid value for the
 * thresholds: it means « this rule is off », so it must not be rejected.
 */
const EXTRA_RULES: Record<ExtraKey, (value: string) => boolean> = {
  retention_years: (value) => intBetween(value, 1, 50),
  ui_language: (value) => value === 'fr' || value === 'en',
  franchise_threshold: (value) => /^\d{1,12}$/.test(value),
  pdf_layout: (value) => value === 'classic' || value === 'compact',
  attachment_max_mb: (value) => intBetween(value, 1, 25),
  reminder_interval_days: (value) => intBetween(value, 1, 365),
  api_token_lifetime_days: (value) => intBetween(value, 1, 3650),
  api_token_max_per_user: (value) => intBetween(value, 1, 100),
  approval_credit_amount: (value) => /^\d{1,12}$/.test(value),
  approval_expense_amount: (value) => /^\d{1,12}$/.test(value),
  approval_discount_percent: (value) => intBetween(value, 0, 100),
  separation_of_duties: (value) => ['0', '1', 'true', 'false'].includes(value),
  item_accounts: (value) => ['0', '1', 'true', 'false'].includes(value),
  archipelago_excluded_families: (value) => value.length <= 300,
  // A PCG code: digits only, at least three. Uniqueness across the roles is
  // checked by the settings route, which is the only place that sees them all.
  account_client: (value) => accountCodeError(value) === null,
  account_supplier: (value) => accountCodeError(value) === null,
  account_sales: (value) => accountCodeError(value) === null,
  account_deferred: (value) => accountCodeError(value) === null,
  account_bank: (value) => accountCodeError(value) === null,
  account_expense: (value) => accountCodeError(value) === null,
  account_vat_due: (value) => accountCodeError(value) === null,
  account_vat_deductible: (value) => accountCodeError(value) === null,
  account_retained_earnings: (value) => accountCodeError(value) === null,
};

/**
 * One place decides whether a setting is writable, so the batch PATCH and the
 * single-key PUT cannot drift apart and a new key only adds one line.
 */
export function isValidExtraValue(key: ExtraKey, value: string): boolean {
  return EXTRA_RULES[key](value);
}

/** Reads a setting, falling back to its documented default. */
export async function getExtra(database: D1Database, key: ExtraKey): Promise<string> {
  const row = await database
    .prepare(`SELECT value FROM settings_extra WHERE key = ?`)
    .bind(key)
    .first<{ value: string }>();
  return row?.value ?? EXTRA_DEFAULTS[key];
}

/**
 * The chart codes the postings must use, in one read. A workspace that groups
 * its revenue differently changes the setting; the posting service passes the
 * result to the pure rules, so no code is a constant in a route.
 */
export async function getAccountCodes(database: D1Database): Promise<AccountCodes> {
  const keys = ACCOUNT_ROLES.map((role) => ACCOUNT_SETTING_KEYS[role]);
  const rows = await database
    .prepare(`SELECT key, value FROM settings_extra WHERE key IN (${keys.map(() => '?').join(',')})`)
    .bind(...keys)
    .all<{ key: string; value: string }>();
  const stored = new Map((rows.results ?? []).map((row) => [row.key, row.value]));
  const overrides: Partial<Record<keyof AccountCodes, string>> = {};
  for (const role of ACCOUNT_ROLES) overrides[role] = stored.get(ACCOUNT_SETTING_KEYS[role]);
  return accountCodesWith(overrides);
}
