/**
 * Chart-of-accounts codes used by the postings. They are seeds, not rules: every
 * code is a workspace setting (Paramètres → Fiscalité), because a business that
 * groups its revenue or settlements differently must be able to say so without a
 * release. Posted entries keep the code they were posted with.
 *
 * The defaults follow the French PCG, as used in Polynésie française.
 */
export interface AccountCodes {
  client: string;
  supplier: string;
  sales: string;
  deferred: string;
  bank: string;
  expense: string;
  vatDue: string;
  vatDeductible: string;
  retainedEarnings: string;
}

export const DEFAULT_ACCOUNT_CODES: AccountCodes = {
  client: '411000',
  supplier: '401000',
  sales: '706000',
  deferred: '487000',
  bank: '512000',
  expense: '606000',
  vatDue: '445710',
  vatDeductible: '445660',
  retainedEarnings: '110000',
};

/** The workspace setting that overrides each code, in `settings_extra`. */
export const ACCOUNT_SETTING_KEYS: Record<keyof AccountCodes, string> = {
  client: 'account_client',
  supplier: 'account_supplier',
  sales: 'account_sales',
  deferred: 'account_deferred',
  bank: 'account_bank',
  expense: 'account_expense',
  vatDue: 'account_vat_due',
  vatDeductible: 'account_vat_deductible',
  retainedEarnings: 'account_retained_earnings',
};

export const ACCOUNT_ROLES = Object.keys(ACCOUNT_SETTING_KEYS) as (keyof AccountCodes)[];

const ACCOUNT_CODE_PATTERN = /^[0-9]{3,10}$/;

/** A PCG account code: digits only, at least three of them. */
export function accountCodeError(value: string): string | null {
  return ACCOUNT_CODE_PATTERN.test(value.trim()) ? null : 'invalid_code';
}

/**
 * Two roles may not share one code: a sale credited to the same account it is
 * deferred to would make the entry say nothing. The comparison is on trimmed
 * values so a stray space cannot slip a duplicate through.
 */
export function duplicateAccountCode(codes: Partial<Record<keyof AccountCodes, string>>): keyof AccountCodes | null {
  const seen = new Map<string, keyof AccountCodes>();
  for (const role of ACCOUNT_ROLES) {
    const raw = codes[role];
    if (raw === undefined) continue;
    const code = raw.trim();
    if (!code) continue;
    const previous = seen.get(code);
    if (previous && previous !== role) return role;
    seen.set(code, role);
  }
  return null;
}

/** The effective codes: a stored setting wins over the shared default. */
export function accountCodesWith(overrides: Partial<Record<keyof AccountCodes, string | null | undefined>>): AccountCodes {
  const codes = { ...DEFAULT_ACCOUNT_CODES };
  for (const role of ACCOUNT_ROLES) {
    const value = overrides[role]?.trim();
    if (value) codes[role] = value;
  }
  return codes;
}
