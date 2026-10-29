/**
 * D1 schema. Statements are idempotent so the Worker can provision a fresh
 * database on its first request without an external migration step.
 */
export const SCHEMA_VERSION = 6;

export const SCHEMA_STATEMENTS: string[] = [
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
    timezone TEXT NOT NULL DEFAULT 'Pacific/Tahiti',
    currency TEXT NOT NULL DEFAULT 'XPF',
    locale TEXT NOT NULL DEFAULT 'fr-FR',
    tax_id TEXT,
    rcs TEXT,
    share_capital TEXT,
    vat_regime TEXT NOT NULL DEFAULT 'standard',
    logo_url TEXT,
    default_tax_rate INTEGER NOT NULL DEFAULT 16,
    payment_terms INTEGER NOT NULL DEFAULT 30,
    number_pattern TEXT NOT NULL DEFAULT '{prefix}-{YYYY}-{####}',
    invoice_terms TEXT,
    invoice_footer TEXT,
    legal_notes TEXT,
    bank_name TEXT,
    bank_holder TEXT,
    bank_iban TEXT,
    bank_bic TEXT,
    session_idle_minutes INTEGER NOT NULL DEFAULT 30,
    session_absolute_hours INTEGER NOT NULL DEFAULT 12,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
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

  `CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    number TEXT,
    display_name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    email TEXT,
    phone TEXT,
    address1 TEXT,
    address2 TEXT,
    city TEXT,
    postal_code TEXT,
    country TEXT NOT NULL DEFAULT 'Polynésie française',
    tax_id TEXT,
    currency TEXT NOT NULL DEFAULT 'XPF',
    payment_terms INTEGER NOT NULL DEFAULT 30,
    is_tax_exempt INTEGER NOT NULL DEFAULT 0,
    notes TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    deleted_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_clients_name ON clients(display_name)`,

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
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    paid_total INTEGER NOT NULL DEFAULT 0,
    balance INTEGER NOT NULL DEFAULT 0,
    tax_exempt INTEGER NOT NULL DEFAULT 0,
    po_number TEXT,
    line_items TEXT NOT NULL DEFAULT '[]',
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
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
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
    subtotal INTEGER NOT NULL DEFAULT 0,
    discount_type TEXT NOT NULL DEFAULT 'percent',
    discount_value INTEGER NOT NULL DEFAULT 0,
    discount_total INTEGER NOT NULL DEFAULT 0,
    tax_total INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
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
    deleted_at TEXT
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
    deleted_at TEXT
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
];
