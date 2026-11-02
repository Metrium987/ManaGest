import type { Permission, Role } from '../shared/domain';

export interface Env {
  DB: D1Database;
  ASSETS?: Fetcher;
  ENVIRONMENT?: string;
  MAIL_CONFIG_ENCRYPTION_KEY?: string;
  RESEND_API_KEY?: string;
  BREVO_API_KEY?: string;
  SMTP_PASSWORD?: string;
  /** Secret the external scheduler presents to POST /api/runs/daily (T-104a). */
  DAILY_RUN_TOKEN?: string;
  /**
   * Break-glass secret for POST /api/setup/recover-owner: a workspace whose only
   * administrator lost access can be given a new owner account once. Absent by
   * default, so the route is closed unless an operator provisions it.
   */
  OWNER_RECOVERY_TOKEN?: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  legal_name: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  timezone: string;
  currency: string;
  locale: string;
  tax_id: string | null;
  rcs: string | null;
  share_capital: string | null;
  vat_regime: string;
  vat_regime_detail: string | null;
  entity_category: string;
  legal_form: string | null;
  numero_tps: string | null;
  contact_role: string | null;
  po_box_number: string | null;
  po_box_municipality: string | null;
  island: string | null;
  physical_municipality: string | null;
  district: string | null;
  pk_landmark: string | null;
  street_building_zone: string | null;
  delivery_instructions: string | null;
  payment_method: string | null;
  payment_terms_code: string | null;
  tax_exemption_decree_num: string | null;
  tax_exemption_expiry: string | null;
  data_consent_accepted: number;
  logo_url: string | null;
  default_tax_rate: number;
  payment_terms: number;
  number_pattern: string;
  invoice_terms: string | null;
  invoice_footer: string | null;
  legal_notes: string | null;
  bank_name: string | null;
  bank_holder: string | null;
  bank_iban: string | null;
  bank_bic: string | null;
  session_idle_minutes: number;
  session_absolute_hours: number;
  created_at: string;
  updated_at: string;
}

export interface UserRow {
  id: string;
  email: string;
  password_hash: string;
  first_name: string;
  last_name: string;
  role: Role;
  /** T-202b: custom role key, when the account holds one. */
  role_key: string | null;
  is_active: number;
  mfa_secret: string | null;
  mfa_enabled: number;
  mfa_codes: string | null;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  permissions: Permission[];
}

export interface SessionRow {
  id: string;
  user_id: string;
  csrf_secret: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  absolute_expires_at: string;
}

export interface AppSession {
  id: string;
  token: string;
  csrf_secret: string;
  user: AuthenticatedUser;
  created_at: string;
  expires_at: string;
  absolute_expires_at: string;
}

export interface AppContext {
  db: D1Database;
  company: CompanyRow | null;
  user: AuthenticatedUser | null;
  session: AppSession | null;
}

export type AppEnv = {
  Bindings: Env;
  Variables: {
    db: D1Database;
    company: CompanyRow | null;
    user: AuthenticatedUser | null;
    session: AppSession | null;
    /** Set when the request authenticated with a named API token. */
    api_token: { id: string; name: string } | null;
  };
};

export interface ListResult<T> {
  data: T[];
  meta: { page: number; per_page: number; total: number; total_pages: number };
}
