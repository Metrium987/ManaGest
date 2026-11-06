/**
 * D1 schema. Statements are idempotent so the Worker can provision a fresh
 * database on its first request without an external migration step.
 */
import { DEFAULT_LOCALE, DEFAULT_TAX_RATE, DEFAULT_TIMEZONE } from '../../shared/domain';
import {
  DEFAULT_PAYMENT_TERMS_DAYS,
  DEFAULT_SESSION_ABSOLUTE_HOURS,
  DEFAULT_SESSION_IDLE_MINUTES,
} from '../../shared/company-defaults';
import { SLA_DEFAULT_POLICIES } from '../../shared/planning';

export const SCHEMA_VERSION = 52;

export const SCHEMA_STATEMENTS: string[] = [

  // Multi-currency (schema 51): the owner types currencies and rates because no
  // local bank provides a feed. XPF is the unit of account and never depends on
  // a rate; every document freezes the rate it was issued with.
  `CREATE TABLE IF NOT EXISTS currencies (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    symbol TEXT NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 2,
    is_base INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `INSERT OR IGNORE INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
   VALUES ('XPF', 'Franc Pacifique', 'F', 0, 1, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
  `CREATE TABLE IF NOT EXISTS exchange_rates (
    id TEXT PRIMARY KEY,
    currency TEXT NOT NULL,
    rate REAL NOT NULL,
    effective_date TEXT NOT NULL,
    note TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (currency, effective_date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency ON exchange_rates(currency, effective_date)`,
  `CREATE TABLE IF NOT EXISTS expense_categories (
    key TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  // Seed the categories that used to be a fixed enumeration, so existing
  // expenses keep resolving and the list becomes editable (R-A, T-107).
  `INSERT OR IGNORE INTO expense_categories (key, label, archived, created_at) VALUES
    ('supplies', 'Fournitures', 0, '2026-01-01T00:00:00.000Z'),
    ('rent', 'Loyer', 0, '2026-01-01T00:00:00.000Z'),
    ('utilities', 'Énergie & eau', 0, '2026-01-01T00:00:00.000Z'),
    ('transport', 'Transport', 0, '2026-01-01T00:00:00.000Z'),
    ('travel', 'Déplacements', 0, '2026-01-01T00:00:00.000Z'),
    ('meals', 'Restauration', 0, '2026-01-01T00:00:00.000Z'),
    ('services', 'Services', 0, '2026-01-01T00:00:00.000Z'),
    ('insurance', 'Assurances', 0, '2026-01-01T00:00:00.000Z'),
    ('taxes', 'Taxes & impôts', 0, '2026-01-01T00:00:00.000Z'),
    ('salary', 'Salaires', 0, '2026-01-01T00:00:00.000Z'),
    ('equipment', 'Équipement', 0, '2026-01-01T00:00:00.000Z'),
    ('other', 'Autre', 0, '2026-01-01T00:00:00.000Z')`,


  // T-103: public per-document links. Only the SHA-256 digest of the token is
  // stored, so a database dump never yields a working link.
  `CREATE TABLE IF NOT EXISTS public_links (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    token_hint TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    revoked_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    access_count INTEGER NOT NULL DEFAULT 0,
    last_access_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_public_links_entity ON public_links(entity_type, entity_id)`,

  `CREATE TABLE IF NOT EXISTS public_link_access (
    id TEXT PRIMARY KEY,
    link_id TEXT NOT NULL,
    action TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_public_link_access_link ON public_link_access(link_id, created_at)`,

  `CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS company (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    legal_name TEXT,
    email TEXT,
    phone TEXT,
    address1 TEXT,
    address2 TEXT,
    city TEXT,
    postal_code TEXT,
    country TEXT NOT NULL DEFAULT 'Polynésie française',
    timezone TEXT NOT NULL DEFAULT '${DEFAULT_TIMEZONE}',
    currency TEXT NOT NULL DEFAULT 'XPF',
    locale TEXT NOT NULL DEFAULT '${DEFAULT_LOCALE}',
    tax_id TEXT,
    rcs TEXT,
    share_capital TEXT,
    vat_regime TEXT NOT NULL DEFAULT 'standard',
    vat_regime_detail TEXT,
    entity_category TEXT NOT NULL DEFAULT 'PRIVATE_COMPANY',
    legal_form TEXT,
    numero_tps TEXT,
    contact_role TEXT,
    po_box_number TEXT,
    po_box_municipality TEXT,
    island TEXT,
    physical_municipality TEXT,
    district TEXT,
    pk_landmark TEXT,
    street_building_zone TEXT,
    delivery_instructions TEXT,
    payment_method TEXT,
    payment_terms_code TEXT,
    tax_exemption_decree_num TEXT,
    tax_exemption_expiry TEXT,
    data_consent_accepted INTEGER NOT NULL DEFAULT 0,
    logo_url TEXT,
    default_tax_rate INTEGER NOT NULL DEFAULT ${DEFAULT_TAX_RATE},
    payment_terms INTEGER NOT NULL DEFAULT ${DEFAULT_PAYMENT_TERMS_DAYS},
    number_pattern TEXT NOT NULL DEFAULT '{prefix}-{YYYY}-{####}',
    invoice_terms TEXT,
    invoice_footer TEXT,
    legal_notes TEXT,
    bank_name TEXT,
    bank_holder TEXT,
    bank_iban TEXT,
    bank_bic TEXT,
    session_idle_minutes INTEGER NOT NULL DEFAULT ${DEFAULT_SESSION_IDLE_MINUTES},
    session_absolute_hours INTEGER NOT NULL DEFAULT ${DEFAULT_SESSION_ABSOLUTE_HOURS},
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1)
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'viewer',
    is_active INTEGER NOT NULL DEFAULT 1,
    mfa_secret TEXT,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_codes TEXT,
    last_login_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    csrf_secret TEXT NOT NULL,
    ip TEXT,
    user_agent TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    absolute_expires_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)`,

  `CREATE TABLE IF NOT EXISTS login_attempts (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    ip TEXT,
    successful INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email, created_at)`,

  `CREATE TABLE IF NOT EXISTS number_sequences (
    entity TEXT NOT NULL,
    period TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (entity, period)
  )`,

  // Per-entity numbering configuration (R-A: editable pattern + prefix per
  // document type; falls back to company.number_pattern when absent).
  `CREATE TABLE IF NOT EXISTS entity_numbering (
    entity TEXT PRIMARY KEY,
    prefix TEXT NOT NULL,
    pattern TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Gap register (BK-005 / OQ-005): every consumed number that has no live
  // document behind it is traced here with the reason and the acting user.
  `CREATE TABLE IF NOT EXISTS number_gaps (
    id TEXT PRIMARY KEY,
    entity TEXT NOT NULL,
    number TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT 'deleted',
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,

  // Generic key/value extension settings (R-A: no hard-coded limits —
  // retention years, UI language variant, login attempts, etc.).
  `CREATE TABLE IF NOT EXISTS settings_extra (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  )`,

  // Workspace email-delivery configuration. Provider credentials are stored
  // only as authenticated ciphertext; the encryption key is a Worker secret.
  `CREATE TABLE IF NOT EXISTS email_settings (
    id TEXT PRIMARY KEY CHECK (id = 'workspace'),
    provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('manual','resend','brevo','smtp')),
    sender_name TEXT NOT NULL DEFAULT '',
    sender_email TEXT NOT NULL DEFAULT '',
    reply_to TEXT NOT NULL DEFAULT '',
    api_key_ciphertext TEXT,
    api_key_provider TEXT,
    smtp_host TEXT NOT NULL DEFAULT '',
    smtp_port INTEGER NOT NULL DEFAULT 587,
    smtp_security TEXT NOT NULL DEFAULT 'starttls' CHECK (smtp_security IN ('starttls','implicit_tls')),
    smtp_username TEXT NOT NULL DEFAULT '',
    smtp_password_ciphertext TEXT,
    invoice_subject TEXT NOT NULL,
    invoice_body TEXT NOT NULL,
    quote_subject TEXT NOT NULL,
    quote_body TEXT NOT NULL,
    credit_subject TEXT NOT NULL,
    credit_body TEXT NOT NULL,
    updated_by TEXT,
    updated_at TEXT NOT NULL
  )`,

  // Legal profile of a client (Section 1 to 6 of the client record). The
  // category decides the client-code prefix and the required documents, so it
  // is stored next to the identity rather than derived from the display name.
  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    number TEXT,
    display_name TEXT NOT NULL,
    entity_category TEXT NOT NULL DEFAULT 'PRIVATE_COMPANY',
    legal_name TEXT,
    trade_name TEXT,
    legal_form TEXT,
    numero_rcs TEXT,
    numero_tps TEXT,
    vat_regime TEXT,
    price_tier TEXT NOT NULL DEFAULT 'public',
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    contact_role TEXT,
    has_delegation_authority INTEGER NOT NULL DEFAULT 0,
    address1 TEXT,
    address2 TEXT,
    po_box_number TEXT,
    po_box_municipality TEXT,
    city TEXT,
    postal_code TEXT,
    island TEXT,
    physical_municipality TEXT,
    district TEXT,
    pk_landmark TEXT,
    street_building_zone TEXT,
    delivery_instructions TEXT,
    country TEXT NOT NULL DEFAULT 'Polynésie française',
    tax_id TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    payment_method TEXT,
    payment_terms_code TEXT,
    payment_terms INTEGER NOT NULL DEFAULT ${DEFAULT_PAYMENT_TERMS_DAYS},
    bank_name TEXT,
    iban TEXT,
    credit_limit INTEGER NOT NULL DEFAULT 0,
    is_tax_exempt INTEGER NOT NULL DEFAULT 0,
    tax_exemption_decree_num TEXT,
    tax_exemption_expiry TEXT,
    data_consent_accepted INTEGER NOT NULL DEFAULT 0,
    account_status TEXT NOT NULL DEFAULT 'PENDING_DOCUMENTS',
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(display_name)`,
  `CREATE INDEX IF NOT EXISTS idx_clients_number ON clients(number)`,

  // Section 5: official verification documents. The bytes are chunked in the
  // database, exactly like expense receipts, so no object bucket is required.
  `CREATE TABLE IF NOT EXISTS client_documents (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    doc_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    uploaded_by TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_client_documents_client ON client_documents(client_id, doc_type)`,
  `CREATE TABLE IF NOT EXISTS client_document_chunks (
    document_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (document_id, seq)
  )`,

  `CREATE TABLE IF NOT EXISTS client_contacts (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    product_key TEXT,
    name TEXT NOT NULL,
    description TEXT,
    unit_price INTEGER NOT NULL DEFAULT 0,
    cost INTEGER NOT NULL DEFAULT 0,
    quantity_milli INTEGER NOT NULL DEFAULT 0,
    track_quantity INTEGER NOT NULL DEFAULT 0,
    allow_negative_stock INTEGER NOT NULL DEFAULT 0,
    -- B2: 'none' | 'lot' | 'serial'. A batch-tracked article cannot move without
    -- saying which batch it is.
    lot_tracking TEXT NOT NULL DEFAULT 'none',
    tax_rate INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS tax_rates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rate INTEGER NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS invoices (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    date TEXT NOT NULL,
    due_date TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate REAL NOT NULL DEFAULT 1,
    currency_decimals INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    cps_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    subtotal_xpf INTEGER NOT NULL DEFAULT 0,
    tax_total_xpf INTEGER NOT NULL DEFAULT 0,
    total_xpf INTEGER NOT NULL DEFAULT 0,
    paid_total INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    tax_exempt INTEGER NOT NULL DEFAULT 0,
    po_number TEXT,
    line_items TEXT NOT NULL DEFAULT '[]',
    archipelago TEXT,
    transport_reference TEXT,
    shipped_by_seller INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    terms TEXT,
    footer TEXT,
    recurring_id TEXT,
    sent_at TEXT,
    paid_at TEXT,
    cancelled_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_number ON invoices(number)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_client ON invoices(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status, date)`,

  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    number TEXT,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate REAL NOT NULL DEFAULT 1,
    amount_xpf INTEGER NOT NULL DEFAULT 0,
    fx_difference INTEGER NOT NULL DEFAULT 0,
    method TEXT NOT NULL DEFAULT 'transfer',
    reference TEXT,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'completed',
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_payments_client ON payments(client_id)`,

  `CREATE TABLE IF NOT EXISTS payment_allocations (
    id TEXT PRIMARY KEY,
    payment_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    amount_xpf INTEGER NOT NULL DEFAULT 0,
    exchange_rate REAL NOT NULL DEFAULT 1,
    fx_difference INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_allocations_payment ON payment_allocations(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_allocations_invoice ON payment_allocations(invoice_id)`,

  `CREATE TABLE IF NOT EXISTS quotes (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    date TEXT NOT NULL,
    valid_until TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate REAL NOT NULL DEFAULT 1,
    currency_decimals INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    subtotal_xpf INTEGER NOT NULL DEFAULT 0,
    tax_total_xpf INTEGER NOT NULL DEFAULT 0,
    total_xpf INTEGER NOT NULL DEFAULT 0,
    tax_exempt INTEGER NOT NULL DEFAULT 0,
    line_items TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    terms TEXT,
    converted_invoice_id TEXT,
    sent_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_quotes_number ON quotes(number)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_client ON quotes(client_id)`,

  `CREATE TABLE IF NOT EXISTS credits (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    date TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate REAL NOT NULL DEFAULT 1,
    currency_decimals INTEGER NOT NULL DEFAULT 0,
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    subtotal_xpf INTEGER NOT NULL DEFAULT 0,
    tax_total_xpf INTEGER NOT NULL DEFAULT 0,
    total_xpf INTEGER NOT NULL DEFAULT 0,
    applied_total INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    tax_exempt INTEGER NOT NULL DEFAULT 0,
    line_items TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    terms TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_credits_number ON credits(number)`,

  `CREATE TABLE IF NOT EXISTS credit_allocations (
    id TEXT PRIMARY KEY,
    credit_id TEXT NOT NULL,
    invoice_id TEXT NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS recurring_invoices (
    id TEXT PRIMARY KEY,
    client_id TEXT NOT NULL,
    number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    frequency TEXT NOT NULL DEFAULT 'monthly',
    interval_count INTEGER NOT NULL DEFAULT 1,
    next_run_date TEXT NOT NULL,
    end_date TEXT,
    remaining_cycles INTEGER,
    auto_send INTEGER NOT NULL DEFAULT 0,
    service_id TEXT,
    notice_days INTEGER NOT NULL DEFAULT 0,
    renewal_mode TEXT NOT NULL DEFAULT 'tacit',
    contract_start TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    tax_exempt INTEGER NOT NULL DEFAULT 0,
    line_items TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    terms TEXT,
    last_generated_at TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS expenses (
    id TEXT PRIMARY KEY,
    vendor_id TEXT,
    client_id TEXT,
    category TEXT NOT NULL DEFAULT 'other',
    date TEXT NOT NULL,
    amount INTEGER NOT NULL,
    tax_amount INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'transfer',
    reference TEXT,
    notes TEXT,
    is_billable INTEGER NOT NULL DEFAULT 0,
    invoice_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate REAL NOT NULL DEFAULT 1,
    amount_xpf INTEGER NOT NULL DEFAULT 0,
    tax_amount_xpf INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date)`,

  `CREATE TABLE IF NOT EXISTS vendors (
    id TEXT PRIMARY KEY,
    number TEXT,
    name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    address1 TEXT,
    city TEXT,
    postal_code TEXT,
    country TEXT NOT NULL DEFAULT 'Polynésie française',
    tax_id TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS purchase_orders (
    id TEXT PRIMARY KEY,
    vendor_id TEXT NOT NULL,
    number TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    date TEXT NOT NULL,
    expected_date TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    line_items TEXT NOT NULL DEFAULT '[]',
    notes TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT,
    exchange_rate REAL NOT NULL DEFAULT 1,
    subtotal_xpf INTEGER NOT NULL DEFAULT 0,
    tax_total_xpf INTEGER NOT NULL DEFAULT 0,
    total_xpf INTEGER NOT NULL DEFAULT 0
  )`,

  `CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    client_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    budget INTEGER NOT NULL DEFAULT 0,
    start_date TEXT,
    deadline TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    client_id TEXT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    minutes INTEGER NOT NULL DEFAULT 0,
    hourly_rate INTEGER NOT NULL DEFAULT 0,
    billable INTEGER NOT NULL DEFAULT 1,
    invoice_id TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    bank_name TEXT,
    iban TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    opening_balance INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS bank_transactions (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL,
    date TEXT NOT NULL,
    label TEXT NOT NULL,
    amount INTEGER NOT NULL,
    reference TEXT,
    status TEXT NOT NULL DEFAULT 'unmatched',
    matched_payment_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bank_tx_date ON bank_transactions(date)`,

  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT,
    summary TEXT NOT NULL,
    meta TEXT,
    before_json TEXT,
    after_json TEXT,
    ip TEXT,
    prev_hash TEXT,
    hash TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_activities_created ON activities(created_at)`,

  // Short-lived second-factor challenge issued between password and TOTP check.
  `CREATE TABLE IF NOT EXISTS mfa_challenges (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mfa_challenges_user ON mfa_challenges(user_id)`,

  // Single-use password reset links: only the SHA-256 of the token is stored,
  // so a database read cannot be replayed against a real account.
  `CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TEXT NOT NULL,
    used_at TEXT,
    requested_ip TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user ON password_reset_tokens(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_ip ON password_reset_tokens(requested_ip, created_at)`,

  // Closed accounting periods: no document dated inside may be written.
  `CREATE TABLE IF NOT EXISTS period_locks (
    period TEXT PRIMARY KEY,
    note TEXT,
    closed_at TEXT NOT NULL,
    closed_by TEXT,
    FOREIGN KEY (closed_by) REFERENCES users(id)
  )`,

  // One row per tax rate and invoice, kept in step with the invoice totals so
  // the VAT return aggregates in SQL instead of replaying JSON line items.
  `CREATE TABLE IF NOT EXISTS invoice_tax_lines (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    rate INTEGER NOT NULL,
    base INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (invoice_id, rate)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_tax_lines_invoice ON invoice_tax_lines(invoice_id)`,

  // A-04: the same mirror for credit notes, so the VAT return subtracts the tax a
  // credit reversed instead of declaring VAT the business never kept.
  `CREATE TABLE IF NOT EXISTS credit_tax_lines (
    id TEXT PRIMARY KEY,
    credit_id TEXT NOT NULL,
    rate INTEGER NOT NULL,
    base INTEGER NOT NULL,
    amount INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (credit_id, rate)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_credit_tax_lines_credit ON credit_tax_lines(credit_id)`,

  // Dropped: company settings live on the company row, this table was never used.
  `DROP TABLE IF EXISTS company_settings`,

  // Secondary indexes for the list, report and reconciliation queries.
  `CREATE INDEX IF NOT EXISTS idx_invoices_client_status ON invoices(client_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_date ON invoices(date)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_due ON invoices(status, due_date)`,
  `CREATE INDEX IF NOT EXISTS idx_quotes_status ON quotes(status, date)`,
  `CREATE INDEX IF NOT EXISTS idx_credits_client ON credits(client_id)`,
  `CREATE INDEX IF NOT EXISTS idx_credit_allocations_invoice ON credit_allocations(invoice_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_status_date ON payments(status, date)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_status_date ON expenses(category, date)`,
  `CREATE INDEX IF NOT EXISTS idx_expenses_vendor ON expenses(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_purchase_orders_vendor ON purchase_orders(vendor_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_user ON activities(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_recurring_next_run ON recurring_invoices(status, next_run_date)`,

  // Receipts for expenses and proofs for payments (T-101). The bytes are kept
  // in the database, chunked, so the feature works without an object bucket.
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL CHECK (entity_type IN ('expense','payment')),
    entity_id TEXT NOT NULL,
    filename TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    checksum TEXT NOT NULL,
    storage TEXT NOT NULL DEFAULT 'database' CHECK (storage IN ('database')),
    uploaded_by TEXT,
    created_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_entity ON attachments(entity_type, entity_id)`,
  `CREATE TABLE IF NOT EXISTS attachment_chunks (
    attachment_id TEXT NOT NULL,
    seq INTEGER NOT NULL,
    content TEXT NOT NULL,
    PRIMARY KEY (attachment_id, seq)
  )`,

  // One row per Tahiti business day (T-104a): the primary key is what makes a
  // second scheduler call the same day a no-op instead of a duplicate run.
  `CREATE TABLE IF NOT EXISTS daily_runs (
    day TEXT PRIMARY KEY,
    status TEXT NOT NULL CHECK (status IN ('running','success','partial','failed','skipped')),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    trigger_ip TEXT,
    summary_json TEXT,
    error_code TEXT
  )`,

  // Attempt counter for the daily endpoint: a leaked token must not become an
  // unlimited lever on the workspace.
  `CREATE TABLE IF NOT EXISTS daily_run_attempts (
    id TEXT PRIMARY KEY,
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_daily_run_attempts_at ON daily_run_attempts(created_at)`,

  // One row per invoice and reminder level (T-105). The unique pair is what
  // stops the daily pass from nagging the same client every morning.
  `CREATE TABLE IF NOT EXISTS invoice_reminders (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    level INTEGER NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('manual','automatic')),
    days_overdue INTEGER NOT NULL,
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (invoice_id, level)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_invoice_reminders_invoice ON invoice_reminders(invoice_id)`,

  // Roles seam (T-202a): the five fixed roles stay in code, and a custom role is
  // a row whose permission list is filtered against the declared permissions.
  `CREATE TABLE IF NOT EXISTS roles (
    key TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    permissions TEXT NOT NULL DEFAULT '[]',
    is_system INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // E2: every price revision is a dated fact, so a contract's price can be
  // explained months later without guessing.
  `CREATE TABLE IF NOT EXISTS contract_revisions (
    id TEXT PRIMARY KEY,
    recurring_id TEXT NOT NULL,
    effective_date TEXT NOT NULL,
    percent_bp INTEGER NOT NULL,
    index_label TEXT,
    old_total INTEGER NOT NULL DEFAULT 0,
    new_total INTEGER NOT NULL DEFAULT 0,
    reason TEXT,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_contract_revisions_contract ON contract_revisions(recurring_id, effective_date)`,

  // F2: the accounts a family uses by default, so an article does not have to
  // repeat them.
  `CREATE TABLE IF NOT EXISTS family_accounts (
    family TEXT PRIMARY KEY,
    sales_account TEXT,
    purchase_account TEXT,
    stock_account TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,

  // Q6/Q7: the import tariff and the taxes that ride on it are data, not code. A
  // rate change is a settings change, and an old landed cost stays explainable
  // because each rule keeps its source and its validity window.
  `CREATE TABLE IF NOT EXISTS tariff_codes (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    duty_rate_bp INTEGER NOT NULL DEFAULT 0,
    duty_rate_eu_bp INTEGER,
    duty_rate_oceania_bp INTEGER,
    vat_rate_bp INTEGER NOT NULL DEFAULT 1600,
    is_active INTEGER NOT NULL DEFAULT 1,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS import_tax_rules (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    base TEXT NOT NULL,
    rate_bp INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0,
    transport TEXT NOT NULL DEFAULT 'any',
    sort_order INTEGER NOT NULL DEFAULT 100,
    is_active INTEGER NOT NULL DEFAULT 1,
    valid_from TEXT,
    valid_to TEXT,
    source TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // The taxes the customs FAQ publishes explicitly. Seeded once, then ordinary
  // rows: a rate change is an edition, not a deployment.
  `INSERT OR IGNORE INTO import_tax_rules
     (code, label, base, rate_bp, amount, transport, sort_order, is_active, source, created_at, updated_at)
   VALUES ('TEA', 'Taxe pour l’environnement (TEA)', 'caf', 200, 0, 'any', 10, 1,
           'FAQ douane PF — 2 % de la valeur CAF', '2026-11-01', '2026-11-01')`,
  `INSERT OR IGNORE INTO import_tax_rules
     (code, label, base, rate_bp, amount, transport, sort_order, is_active, source, created_at, updated_at)
   VALUES ('PID', 'Participation informatique douanière (PID)', 'article', 0, 85, 'any', 20, 1,
           'FAQ douane PF — 85 XPF par article déclaré', '2026-11-01', '2026-11-01')`,
  `INSERT OR IGNORE INTO import_tax_rules
     (code, label, base, rate_bp, amount, transport, sort_order, is_active, source, created_at, updated_at)
   VALUES ('STAT', 'Taxe statistique', 'quintal', 0, 50, 'any', 30, 1,
           'FAQ douane PF — 50 XPF par quintal', '2026-11-01', '2026-11-01')`,
  `INSERT OR IGNORE INTO import_tax_rules
     (code, label, base, rate_bp, amount, transport, sort_order, is_active, source, created_at, updated_at)
   VALUES ('PAP', 'Péage du Port autonome de Papeete', 'caf', 125, 0, 'sea', 40, 1,
           'FAQ douane PF — 1,25 % de la valeur CAF, fret maritime', '2026-11-01', '2026-11-01')`,

  // F4: what an imported article really costs once freight, insurance, duty and
  // clearance are paid. One row per computation, never rewritten — the history is
  // what makes a cost defensible six months later. Amounts are in XPF; the invoice
  // currency and its rate are kept next to them so the figure stays explainable.
  `CREATE TABLE IF NOT EXISTS landed_cost_sheets (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate_micro INTEGER NOT NULL DEFAULT 1000000,
    quantity_milli INTEGER NOT NULL DEFAULT 0,
    goods_amount INTEGER NOT NULL DEFAULT 0,
    freight INTEGER NOT NULL DEFAULT 0,
    insurance INTEGER NOT NULL DEFAULT 0,
    fixed_fees INTEGER NOT NULL DEFAULT 0,
    duty_rate_bp INTEGER NOT NULL DEFAULT 0,
    port_fee_rate_bp INTEGER NOT NULL DEFAULT 0,
    vat_rate_bp INTEGER NOT NULL DEFAULT 0,
    vat_recoverable INTEGER NOT NULL DEFAULT 1,
    vat_settlement TEXT NOT NULL DEFAULT 'supplier',
    customs_value INTEGER NOT NULL DEFAULT 0,
    duty INTEGER NOT NULL DEFAULT 0,
    port_fee INTEGER NOT NULL DEFAULT 0,
    vat INTEGER NOT NULL DEFAULT 0,
    total_in_cost INTEGER NOT NULL DEFAULT 0,
    unit_cost INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_landed_cost_sheets_product ON landed_cost_sheets(product_id, created_at)`,

  // Q8: one import declaration, several articles. The shared costs belong to the
  // header (they were paid once) and each line keeps what the split gave it, so the
  // sum of the lines always equals what left the bank.
  `CREATE TABLE IF NOT EXISTS import_sheets (
    id TEXT PRIMARY KEY,
    reference TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    exchange_rate_micro INTEGER NOT NULL DEFAULT 1000000,
    split_key TEXT NOT NULL DEFAULT 'value',
    freight INTEGER NOT NULL DEFAULT 0,
    insurance INTEGER NOT NULL DEFAULT 0,
    fixed_fees INTEGER NOT NULL DEFAULT 0,
    duty_rate_bp INTEGER NOT NULL DEFAULT 0,
    vat_rate_bp INTEGER NOT NULL DEFAULT 0,
    vat_recoverable INTEGER NOT NULL DEFAULT 1,
    vat_settlement TEXT NOT NULL DEFAULT 'supplier',
    transport TEXT NOT NULL DEFAULT 'sea',
    origin TEXT NOT NULL DEFAULT 'standard',
    declaration_date TEXT,
    goods_total INTEGER NOT NULL DEFAULT 0,
    customs_value_total INTEGER NOT NULL DEFAULT 0,
    duty_total INTEGER NOT NULL DEFAULT 0,
    taxes_total INTEGER NOT NULL DEFAULT 0,
    vat_total INTEGER NOT NULL DEFAULT 0,
    total_in_cost INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS import_sheet_lines (
    id TEXT PRIMARY KEY,
    sheet_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL DEFAULT 0,
    goods_amount INTEGER NOT NULL DEFAULT 0,
    duty_rate_bp INTEGER NOT NULL DEFAULT 0,
    weight_g INTEGER NOT NULL DEFAULT 0,
    units INTEGER NOT NULL DEFAULT 0,
    freight INTEGER NOT NULL DEFAULT 0,
    insurance INTEGER NOT NULL DEFAULT 0,
    fixed_fees INTEGER NOT NULL DEFAULT 0,
    customs_value INTEGER NOT NULL DEFAULT 0,
    duty INTEGER NOT NULL DEFAULT 0,
    taxes_total INTEGER NOT NULL DEFAULT 0,
    tax_lines TEXT NOT NULL DEFAULT '[]',
    vat INTEGER NOT NULL DEFAULT 0,
    total_in_cost INTEGER NOT NULL DEFAULT 0,
    unit_cost INTEGER NOT NULL DEFAULT 0,
    share_bp INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_import_sheet_lines_sheet ON import_sheet_lines(sheet_id)`,
  `CREATE INDEX IF NOT EXISTS idx_import_sheet_lines_product ON import_sheet_lines(product_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_import_sheets_created ON import_sheets(created_at)`,

  // Q9: a project template is versioned. An edit stores a new version instead of
  // rewriting the old one, and a project keeps the version it was created from, so a
  // price agreed months ago stays explainable.
  `CREATE TABLE IF NOT EXISTS project_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_template_versions (
    id TEXT PRIMARY KEY,
    template_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    notes TEXT,
    task_count INTEGER NOT NULL DEFAULT 0,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (template_id, version)
  )`,
  `CREATE TABLE IF NOT EXISTS project_template_tasks (
    id TEXT PRIMARY KEY,
    version_id TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    minutes INTEGER NOT NULL DEFAULT 0,
    hourly_rate INTEGER NOT NULL DEFAULT 0,
    billable INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE INDEX IF NOT EXISTS idx_project_template_versions_template ON project_template_versions(template_id, version)`,
  `CREATE INDEX IF NOT EXISTS idx_project_template_tasks_version ON project_template_tasks(version_id, sort_order)`,

  // Q11: profit centres. The code is copied onto the invoice line, so a rename or an
  // archive never rewrites an issued document — the report reads the documents.
  `CREATE TABLE IF NOT EXISTS profit_centers (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Q12: a batch can sit on several shelves at once. One row per (lot, location),
  // '' meaning the unassigned shelf — a primary key cannot hold NULL.
  `CREATE TABLE IF NOT EXISTS lot_balances (
    lot_id TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT '',
    quantity_milli INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (lot_id, location)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_lot_balances_lot ON lot_balances(lot_id)`,

  // E3: an invoice billed in advance is spread over its period; the schedule is
  // what turns "we invoiced" into "we earned".
  `CREATE TABLE IF NOT EXISTS revenue_schedules (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    period_start TEXT NOT NULL,
    period_end TEXT NOT NULL,
    total INTEGER NOT NULL DEFAULT 0,
    recognized_total INTEGER NOT NULL DEFAULT 0,
    last_rate_bp INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (invoice_id)
  )`,
  `CREATE TABLE IF NOT EXISTS revenue_recognitions (
    id TEXT PRIMARY KEY,
    schedule_id TEXT NOT NULL,
    date TEXT NOT NULL,
    amount INTEGER NOT NULL DEFAULT 0,
    rate_bp INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    UNIQUE (schedule_id, date)
  )`,

  // Saved filters (T-206): one named query string per list, per workspace.
  `CREATE TABLE IF NOT EXISTS saved_filters (
    id TEXT PRIMARY KEY,
    list_key TEXT NOT NULL,
    name TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (list_key, name)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_saved_filters_list ON saved_filters(list_key)`,

  // Accounting core (AUDIT §7 P0.1–P0.2): a chart of accounts, journals and
  // double-entry lines derived from the documents. The journal is derived, never
  // entered twice, so it cannot disagree with what was issued.
  `CREATE TABLE IF NOT EXISTS accounts (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('asset','liability','equity','income','expense')),
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    journal TEXT NOT NULL,
    reference TEXT NOT NULL,
    label TEXT NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    event TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (source_type, source_id, event)
  )`,
  `CREATE TABLE IF NOT EXISTS journal_lines (
    id TEXT PRIMARY KEY,
    entry_id TEXT NOT NULL,
    account_code TEXT NOT NULL,
    label TEXT NOT NULL,
    debit INTEGER NOT NULL DEFAULT 0 CHECK (debit >= 0),
    credit INTEGER NOT NULL DEFAULT 0 CHECK (credit >= 0),
    currency TEXT,
    original_amount INTEGER,
    exchange_rate REAL,
    created_at TEXT NOT NULL,
    CHECK (debit = 0 OR credit = 0)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_journal_entries_date ON journal_entries(date)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_lines_entry ON journal_lines(entry_id)`,
  `CREATE INDEX IF NOT EXISTS idx_journal_lines_account ON journal_lines(account_code)`,

  // Named API tokens (AUDIT §7 P0.6). Only the SHA-256 digest is stored, the value
  // is shown once at creation, and revocation is a timestamp so the journal keeps
  // the fact that the credential existed.
  `CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    prefix TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    abilities TEXT NOT NULL DEFAULT '[]',
    created_by TEXT,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    expires_at TEXT,
    revoked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_tokens(user_id)`,

  // Approvals by threshold (AUDIT §7 P0.5). One row per document that crossed a
  // configured threshold; the decision is a second person's act, kept in the row.
  `CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL DEFAULT 1,
    amount INTEGER NOT NULL DEFAULT 0,
    controlled_amount INTEGER NOT NULL DEFAULT 0,
    controlled_discount INTEGER,
    rule TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    requested_by TEXT,
    decided_by TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    decided_at TEXT,
    superseded_at TEXT,
    UNIQUE (entity_type, entity_id, revision)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status)`,

  // Stock ledger (fiche article ERP). Every quantity change — reception, sale,
  // adjustment, transfer — leaves a row, so the on-hand figure is always the sum
  // of a traceable history rather than a mutable counter nobody can audit.
  `CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('in','out','adjust','transfer')),
    quantity_milli INTEGER NOT NULL,
    reason TEXT,
    reference TEXT,
    unit_cost INTEGER NOT NULL DEFAULT 0,
    location TEXT,
    lot TEXT,
    user_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_movements_product ON stock_movements(product_id, created_at)`,

  // Cycle counting (B1). A session freezes the expected quantity per line; the
  // counted quantity is filled by hand and only the difference becomes an
  // adjustment movement. The partial unique index is the rule "one count at a
  // time": two open sheets could both overwrite the same shelf.
  `CREATE TABLE IF NOT EXISTS stock_counts (
    id TEXT PRIMARY KEY,
    reference TEXT NOT NULL UNIQUE,
    scope TEXT NOT NULL CHECK (scope IN ('all','location','family')),
    scope_value TEXT,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','validated','cancelled')),
    note TEXT,
    line_count INTEGER NOT NULL DEFAULT 0,
    created_by TEXT,
    validated_by TEXT,
    created_at TEXT NOT NULL,
    validated_at TEXT,
    cancelled_at TEXT
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_stock_counts_open ON stock_counts(status) WHERE status = 'open'`,
  `CREATE TABLE IF NOT EXISTS stock_count_lines (
    id TEXT PRIMARY KEY,
    count_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    expected_milli INTEGER NOT NULL,
    counted_milli INTEGER,
    expected_cost INTEGER NOT NULL DEFAULT 0,
    movement_id TEXT,
    UNIQUE (count_id, product_id)
  )`,
  // Valuation journal (B3): one row per inbound movement that carried a cost,
  // recording the average before and after. The product's `cost` is the current
  // average; this table is why that number can be explained instead of trusted.
  `CREATE TABLE IF NOT EXISTS stock_valuations (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    movement_id TEXT,
    reason TEXT,
    quantity_before_milli INTEGER NOT NULL,
    cost_before INTEGER NOT NULL,
    inbound_milli INTEGER NOT NULL,
    inbound_unit_cost INTEGER NOT NULL,
    quantity_after_milli INTEGER NOT NULL,
    cost_after INTEGER NOT NULL,
    value_after INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_valuations_product ON stock_valuations(product_id, created_at)`,
  // Lots and serial numbers (B2): one row per batch of one article. A serial
  // number is a batch of exactly one unit, which is why one table serves both
  // modes. `expiry_date` is what the FEFO pick sorts on.
  `CREATE TABLE IF NOT EXISTS stock_lots (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    lot_code TEXT NOT NULL,
    expiry_date TEXT,
    location TEXT,
    quantity_milli INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (product_id, lot_code)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_lots_product ON stock_lots(product_id, expiry_date)`,
  // Locations (B4): a registry of shelves, so a code is spelled one way. The
  // quantity per location is not stored here — it is the sum of the ledger rows
  // that carry that code, which is why a transfer cannot drift from the stock.
  `CREATE TABLE IF NOT EXISTS stock_locations (
    id TEXT PRIMARY KEY,
    code TEXT NOT NULL UNIQUE,
    name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  )`,
  // Secondary vendors (C2): the Odoo vendor pricelist. One row per article and
  // supplier, because a price is only true for the supplier who quoted it.
  `CREATE TABLE IF NOT EXISTS product_vendors (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'XPF',
    moq_milli INTEGER NOT NULL DEFAULT 0,
    lead_time_days INTEGER NOT NULL DEFAULT 0,
    vendor_ref TEXT,
    is_preferred INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (product_id, vendor_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_product_vendors_product ON product_vendors(product_id)`,
  `CREATE TABLE IF NOT EXISTS product_links (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    linked_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (product_id, linked_id, kind)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_product_links_product ON product_links(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_vendors_vendor ON product_vendors(vendor_id)`,
  // C2 price history: the current vendor price is overwritten in place, so a
  // separate ledger keeps what was quoted before. A price is a fact with a date;
  // without the ledger a supplier increase would leave no trace to argue over.
  `CREATE TABLE IF NOT EXISTS product_vendor_prices (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    vendor_id TEXT NOT NULL,
    price INTEGER NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'XPF',
    recorded_at TEXT NOT NULL,
    -- 'manual' when quoted on the sheet, 'receipt' when paid on a purchase order.
    source TEXT NOT NULL DEFAULT 'manual',
    source_ref TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vendor_prices_link ON product_vendor_prices(product_id, vendor_id, recorded_at)`,
  // H1: before the split, any role able to write products could also change a
  // quantity. Backfilling the new permission into those stored custom roles keeps
  // that right instead of removing it silently; the owner can narrow it in
  // « Rôles & permissions » afterwards.
  // G2/G3: planning and SLA are configuration, never columns on the task. A task
  // can be re-planned without rewriting it, and a policy can change without
  // touching the tasks it already served.
  `CREATE TABLE IF NOT EXISTS task_planning (
    task_id TEXT PRIMARY KEY,
    assignee_id TEXT,
    planned_start TEXT,
    planned_end TEXT,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_planning_assignee ON task_planning(assignee_id, planned_start)`,
  `CREATE TABLE IF NOT EXISTS non_working_days (
    day TEXT PRIMARY KEY,
    label TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_capacities (
    user_id TEXT PRIMARY KEY,
    weekly_minutes INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sla_policies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    scope TEXT NOT NULL DEFAULT 'client',
    client_id TEXT,
    contract_id TEXT,
    priority TEXT NOT NULL DEFAULT '${SLA_DEFAULT_POLICIES[1].priority}',
    response_minutes INTEGER NOT NULL DEFAULT 0,
    resolution_minutes INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sla_policies_scope ON sla_policies(scope, client_id, contract_id)`,
  `CREATE TABLE IF NOT EXISTS task_sla (
    task_id TEXT PRIMARY KEY,
    policy_id TEXT NOT NULL,
    priority TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    response_due TEXT,
    resolution_due TEXT,
    acknowledged_at TEXT,
    closed_at TEXT
  )`,
  `UPDATE roles SET permissions = (
     SELECT json_group_array(value) FROM (
       SELECT DISTINCT value FROM (
         SELECT value FROM json_each(roles.permissions)
         UNION ALL SELECT 'stock.adjust'
       )
     )
   )
   WHERE is_system = 0
     AND EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'products.write')
     AND NOT EXISTS (SELECT 1 FROM json_each(roles.permissions) WHERE value = 'stock.adjust')`,
  // Partial receipts (C3): what actually arrived, line by line. The remaining
  // quantity is derived from this history, so a backorder cannot be invented and
  // an over-receipt cannot hide. `price_gap` keeps the difference between what was
  // paid and what the stock was worth at that moment.
  `CREATE TABLE IF NOT EXISTS purchase_order_receipts (
    id TEXT PRIMARY KEY,
    purchase_order_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    quantity_milli INTEGER NOT NULL,
    unit_price INTEGER NOT NULL DEFAULT 0,
    cost_before INTEGER NOT NULL DEFAULT 0,
    price_gap INTEGER NOT NULL DEFAULT 0,
    user_id TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_po_receipts_order ON purchase_order_receipts(purchase_order_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_count_lines_count ON stock_count_lines(count_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_count_lines_product ON stock_count_lines(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference, reason)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_client_active ON invoices(client_id, date) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_payments_client_active ON payments(client_id, date) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_credits_client_active ON credits(client_id, date) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_number ON payments(number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_number ON purchase_orders(number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_number ON recurring_invoices(number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_currencies_single_base ON currencies(is_base) WHERE is_base = 1`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_company_singleton ON company(singleton)`,
  `CREATE TRIGGER IF NOT EXISTS trg_payments_amount_insert BEFORE INSERT ON payments
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'PAYMENT_AMOUNT_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_payments_amount_update BEFORE UPDATE ON payments
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'PAYMENT_AMOUNT_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoices_balance_insert BEFORE INSERT ON invoices
WHEN NEW.balance < 0 BEGIN SELECT RAISE(ABORT, 'INVOICE_BALANCE_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_invoices_balance_update BEFORE UPDATE ON invoices
WHEN NEW.balance < 0 BEGIN SELECT RAISE(ABORT, 'INVOICE_BALANCE_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_credits_total_insert BEFORE INSERT ON credits
WHEN NEW.total < 0 BEGIN SELECT RAISE(ABORT, 'CREDIT_TOTAL_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_credits_total_update BEFORE UPDATE ON credits
WHEN NEW.total < 0 BEGIN SELECT RAISE(ABORT, 'CREDIT_TOTAL_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_expenses_amount_insert BEFORE INSERT ON expenses
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'EXPENSE_AMOUNT_NEGATIVE'); END`,
  `CREATE TRIGGER IF NOT EXISTS trg_expenses_amount_update BEFORE UPDATE ON expenses
WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT, 'EXPENSE_AMOUNT_NEGATIVE'); END`,
];
