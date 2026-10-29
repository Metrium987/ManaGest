import type { Permission, Role } from '@shared/domain';

export interface Pagination {
  page: number;
  per_page: number;
  total: number;
  total_pages: number;
}

export interface ListResponse<T> {
  data: T[];
  meta: Pagination;
}

export interface Company {
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
  vat_regime: 'standard' | 'franchise';
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

export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  permissions: Permission[];
  is_active?: number;
  mfa_enabled?: boolean;
  last_login_at?: string | null;
  created_at?: string;
}

export interface MeResponse {
  user: User;
  company: Company;
  permissions: Permission[];
}

export interface Client {
  id: string;
  number: string | null;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  tax_id: string | null;
  currency: string;
  payment_terms: number;
  is_tax_exempt: number;
  notes: string | null;
  archived: number;
  balance: number;
  paid_to_date: number;
  invoice_count: number;
  credit_balance: number;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  is_primary: number;
}

export interface ClientDetail extends Client {
  contacts: Contact[];
  invoices: InvoiceSummary[];
  quotes: QuoteSummary[];
  payments: PaymentSummary[];
}

export interface LineItem {
  id: string;
  product_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_status?: 'taxable' | 'exempt';
}

export interface TaxBucket {
  rate: number;
  base: number;
  amount: number;
}

export type DocumentStatus = 'draft' | 'sent' | 'partial' | 'paid' | 'cancelled';

export interface InvoiceSummary {
  id: string;
  number: string | null;
  client_id: string;
  client_name: string;
  status: DocumentStatus;
  date: string;
  due_date: string | null;
  total: number;
  paid_total: number;
  balance: number;
  overdue?: boolean;
  line_items?: LineItem[];
}

export interface Invoice extends InvoiceSummary {
  currency: string;
  subtotal: number;
  discount_type: 'percent' | 'amount';
  discount_value: number;
  discount_total: number;
  tax_total: number;
  tax_exempt: number;
  po_number: string | null;
  notes: string | null;
  terms: string | null;
  footer: string | null;
  line_items: LineItem[];
  tax_buckets: TaxBucket[];
  client_email?: string | null;
  client_address1?: string | null;
  client_city?: string | null;
  client_postal_code?: string | null;
  client_country?: string | null;
  client_tax_id?: string | null;
  payments: {
    id: string;
    amount: number;
    payment_number: string;
    date: string;
    method: string;
    reference: string | null;
  }[];
  created_at: string;
}

export type QuoteStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'converted' | 'expired';

export interface QuoteSummary {
  id: string;
  number: string | null;
  client_id: string;
  client_name: string;
  status: QuoteStatus;
  date: string;
  valid_until: string | null;
  total: number;
  /** Computed by the API: past valid_until and not approved/converted. */
  expired?: boolean;
}

export interface Quote extends QuoteSummary {
  currency: string;
  subtotal: number;
  discount_type: 'percent' | 'amount';
  discount_value: number;
  discount_total: number;
  tax_total: number;
  tax_exempt: number;
  line_items: LineItem[];
  notes: string | null;
  terms: string | null;
  client_email?: string | null;
  converted_invoice_id?: string | null;
  created_at: string;
}

export interface CreditSummary {
  id: string;
  number: string | null;
  client_id: string;
  client_name: string;
  status: 'draft' | 'sent' | 'partial' | 'applied';
  date: string;
  total: number;
  applied_total: number;
  balance: number;
}

export interface Credit extends CreditSummary {
  currency: string;
  subtotal: number;
  tax_total: number;
  line_items: LineItem[];
  notes: string | null;
  created_at: string;
}

export interface PaymentSummary {
  id: string;
  number: string | null;
  client_id: string;
  client_name: string;
  date: string;
  amount: number;
  method: string;
  reference: string | null;
  status: string;
  applied?: number;
  invoice_count?: number;
}

export interface Product {
  id: string;
  product_key: string | null;
  name: string;
  description: string | null;
  unit_price: number;
  cost: number;
  quantity_milli: number;
  track_quantity: number;
  tax_rate: number;
  created_at: string;
}

export interface Expense {
  id: string;
  vendor_id: string | null;
  vendor_name: string | null;
  client_id: string | null;
  client_name?: string | null;
  category: string;
  date: string;
  amount: number;
  tax_amount: number;
  payment_method: string;
  reference: string | null;
  notes: string | null;
  is_billable: number;
}

export interface Vendor {
  id: string;
  number: string | null;
  name: string;
  email: string | null;
  phone: string | null;
  address1: string | null;
  city: string | null;
  postal_code: string | null;
  country: string;
  tax_id: string | null;
  notes: string | null;
  po_count?: number;
  po_total?: number;
}

export interface PurchaseOrder {
  id: string;
  number: string | null;
  vendor_id: string;
  vendor_name: string;
  status: 'draft' | 'sent' | 'approved' | 'received' | 'cancelled';
  date: string;
  expected_date: string | null;
  total: number;
  line_items: LineItem[];
}

export interface Project {
  id: string;
  client_id: string | null;
  client_name: string | null;
  name: string;
  description: string | null;
  status: 'active' | 'completed' | 'archived';
  budget: number;
  start_date: string | null;
  deadline: string | null;
  task_count?: number;
  total_minutes?: number;
}

export interface Task {
  id: string;
  project_id: string | null;
  project_name: string | null;
  client_id: string | null;
  client_name: string | null;
  title: string;
  description: string | null;
  status: 'todo' | 'in_progress' | 'done';
  minutes: number;
  hourly_rate: number;
  billable: number;
  invoice_id?: string | null;
}

export interface RecurringInvoice {
  id: string;
  client_id: string;
  client_name: string;
  number: string | null;
  status: 'draft' | 'active' | 'paused' | 'completed';
  frequency: 'weekly' | 'monthly' | 'quarterly' | 'semiannual' | 'yearly';
  interval_count: number;
  next_run_date: string;
  end_date: string | null;
  remaining_cycles: number | null;
  auto_send: number;
  currency: string;
  discount_type: 'percent' | 'amount';
  discount_value: number;
  tax_exempt: number;
  line_items: LineItem[];
  notes: string | null;
  terms: string | null;
  generated_count?: number;
  generated_total?: number;
}

export interface DailyRunSummary {
  day: string;
  generated: string[];
  failed: { id: string; code: string }[];
  templates: number;
  reminders?: number;
  skipped_reason?: string;
  truncated?: boolean;
}

export interface DailyRun {
  day: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error_code: string | null;
  summary: DailyRunSummary | null;
}

export interface DashboardData {
  today: string;
  last_run?: DailyRun | null;
  kpis: {
    invoiced_month: number;
    collected_month: number;
    invoiced_previous: number;
    collected_previous: number;
    outstanding: number;
    overdue: number;
    expenses_month: number;
    clients: number;
    open_invoices: number;
  };
  series: { key: string; start: string; invoiced: number; collected: number; expenses: number }[];
  recent_invoices: {
    id: string;
    number: string;
    date: string;
    total: number;
    balance: number;
    status: DocumentStatus;
    client_name: string;
  }[];
  top_clients: { id: string; client_name: string; revenue: number }[];
  activities: {
    id: string;
    summary: string;
    entity_type: string;
    created_at: string;
    meta: string | null;
    first_name: string | null;
    last_name: string | null;
  }[];
  upcoming: { id: string; number: string; due_date: string; balance: number }[];
}

export interface BankAccount {
  id: string;
  name: string;
  bank_name: string | null;
  iban: string | null;
  currency: string;
  opening_balance: number;
  current_balance: number;
  unmatched_count: number;
}

export interface BankTransaction {
  id: string;
  account_id: string;
  date: string;
  label: string;
  amount: number;
  reference: string | null;
  status: 'unmatched' | 'matched' | 'ignored';
  matched_payment_id: string | null;
}

export interface SettingsPayload {
  company: Company;
  tax_rates: { id: string; name: string; rate: number; is_default: number }[];
  sequences: { entity: string; period: string; last_number: number }[];
}

export interface ReportResponse {
  rows: Record<string, string | number>[];
  summary: Record<string, number>;
}

export interface ActivityEntry {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  meta: string | null;
  before_json: string | null;
  after_json: string | null;
  ip: string | null;
  hash: string | null;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
}

export interface PeriodLock {
  period: string;
  note: string | null;
  closed_at: string;
  closed_by: string | null;
  first_name: string | null;
  last_name: string | null;
}

// Import wizard (T-102b / OQ-015)
export interface ImportColumn {
  key: string;
  label: string;
  required?: boolean;
  example: string;
  hint?: string;
}

export interface ImportIssue {
  row: number;
  field: string;
  code: string;
}

export interface ImportPreviewRow {
  row: number;
  values: Record<string, string>;
  valid: boolean;
  action: 'create' | 'update';
  issues: ImportIssue[];
}

export interface ImportPreview {
  delimiter: string;
  missing_columns: string[];
  valid_count: number;
  invalid_count: number;
  rows: ImportPreviewRow[];
}

export interface ImportResult {
  created: number;
  updated: number;
  skipped: number;
  invalid_count: number;
  identifiers: string[];
}
