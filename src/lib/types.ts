import type { Permission, Role } from '@shared/domain';
import type {
  ClientAccountStatus,
  ClientBank,
  ClientDocumentType,
  ClientPaymentMethod,
  ClientPaymentTerms,
  ClientVatRegime,
  EntityCategory,
  LegalForm,
} from '@shared/client-profile';

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
  vat_regime_detail: ClientVatRegime | null;
  entity_category: EntityCategory;
  legal_form: LegalForm | null;
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
  payment_method: ClientPaymentMethod | null;
  payment_terms_code: ClientPaymentTerms | null;
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
  entity_category: EntityCategory;
  legal_name: string | null;
  trade_name: string | null;
  legal_form: LegalForm | null;
  numero_rcs: string | null;
  numero_tps: string | null;
  vat_regime: ClientVatRegime | null;
  price_tier: 'public' | 'pro' | 'member';
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  contact_role: string | null;
  has_delegation_authority: number;
  address1: string | null;
  address2: string | null;
  po_box_number: string | null;
  po_box_municipality: string | null;
  city: string | null;
  postal_code: string | null;
  island: string | null;
  physical_municipality: string | null;
  district: string | null;
  pk_landmark: string | null;
  street_building_zone: string | null;
  delivery_instructions: string | null;
  country: string;
  tax_id: string | null;
  currency: string;
  payment_method: ClientPaymentMethod | null;
  payment_terms_code: ClientPaymentTerms | null;
  payment_terms: number;
  bank_name: ClientBank | null;
  iban: string | null;
  credit_limit: number;
  is_tax_exempt: number;
  tax_exemption_decree_num: string | null;
  tax_exemption_expiry: string | null;
  data_consent_accepted: number;
  account_status: ClientAccountStatus;
  notes: string | null;
  archived: number;
  balance: number;
  paid_to_date: number;
  invoice_count: number;
  credit_balance: number;
  created_at: string;
  updated_at: string;
}

export interface ClientDocument {
  id: string;
  doc_type: ClientDocumentType;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_name?: string | null;
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
  documents: ClientDocument[];
  required_documents: ClientDocumentType[];
  missing_documents: ClientDocumentType[];
}

export interface LineItem {
  id: string;
  product_id?: string | null;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_status?: 'taxable' | 'exempt';
  /** D2: the service level billed on this line. */
  expertise_level?: string | null;
  /** Q11: the profit centre as it was on the day the document was issued. */
  profit_center?: string | null;
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
  /** Q4: the proof of a 1 % archipelago sale, stored on the document. */
  archipelago: string | null;
  transport_reference: string | null;
  shipped_by_seller: number | boolean;
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

export interface StockMovement {
  id: string;
  product_id: string;
  kind: 'in' | 'out' | 'adjust' | 'transfer';
  quantity_milli: number;
  quantity: number;
  reason: string | null;
  reference: string | null;
  /** null when the profile may not see buying costs. */
  unit_cost: number | null;
  location: string | null;
  lot: string | null;
  user_name?: string | null;
  created_at: string;
}

/** The ERP item sheet. Costs and margin are null when `cost_masked` is true. */
export interface Product {
  id: string;
  product_key: string | null;
  name: string;
  description: string | null;
  unit_price: number;
  cost: number | null;
  purchase_price: number | null;
  landed_cost: number | null;
  margin_rate: number | null;
  cost_masked: boolean;
  stock_value: number | null;
  quantity_milli: number;
  quantity: number;
  track_quantity: number;
  allow_negative_stock: number;
  lot_tracking: string;
  tax_rate: number;
  item_type: string;
  family: string | null;
  subfamily: string | null;
  lifecycle_status: string;
  buyer: string | null;
  supplier_id: string | null;
  supplier_name: string | null;
  supplier_ref: string | null;
  purchase_currency: string;
  lead_time_days: number;
  stock_mode: string;
  weight_gross_g: number;
  weight_net_g: number;
  volume_cm3: number;
  warehouse_location: string | null;
  customs_code: string | null;
  valuation_method: string;
  purchase_account: string | null;
  sales_account: string | null;
  stock_account: string | null;
  analytic_axis: string | null;
  price_pro: number;
  price_member: number;
  /** D3: what replaces the article when empty, and what goes with it. */
  links?: { substitutes: LinkedProductRef[]; accessories: LinkedProductRef[] };
  margin_target: number;
  volume_discounts: { min_quantity: number; percent: number }[];
  bom_mode: string;
  bom: { product_id: string; quantity: number }[];
  substitutes: string[];
  accessories: string[];
  moq: number;
  order_multiple: number;
  reorder_point: number;
  safety_stock: number;
  max_stock: number;
  replenish_mode: string;
  stock_alert: 'out' | 'low' | 'ok' | 'none';
  suggested_reorder: number;
  // Fiche service
  invoice_label: string | null;
  service_type: string;
  billing_unit: string;
  billing_trigger: string;
  min_billable: number;
  overtime_rules: { label: string; percent: number }[];
  expertise_levels: { level: string; price: number }[];
  cps_rate: number;
  cps_amount: number;
  tax_exemption_note: string | null;
  skills: string | null;
  estimated_hours: number;
  project_template: string | null;
  sla_response_hours: number;
  sla_resolution_hours: number;
  billing_frequency: string;
  renewal_mode: string;
  notice_days: number;
  price_revision_index: string | null;
  expense_mode: string;
  travel_zone: string | null;
  deliverables: string | null;
  client_prerequisites: string | null;
  subcontract_account: string | null;
  revenue_recognition: string;
  revision: number;
  created_at: string;
  updated_at: string | null;
  created_by: string | null;
  updated_by: string | null;
}

export interface StockValuation {
  id: string;
  movement_id: string | null;
  reason: string | null;
  quantity_before_milli: number;
  cost_before: number;
  inbound_milli: number;
  inbound_unit_cost: number;
  quantity_after_milli: number;
  cost_after: number;
  value_after: number;
  created_at: string;
}

export interface LinkedProductRef {
  id: string;
  name: string;
  product_key: string | null;
  unit_price: number;
  quantity_milli: number;
  in_stock: boolean;
}

export interface ProductDetail extends Product {
  /** F2: the accounts the article would use once its family's default applies. */
  effective_accounts: {
    sales_account: string | null;
    purchase_account: string | null;
    stock_account: string | null;
  } | null;
  movements: StockMovement[];
  valuations: StockValuation[];
  components: { id: string; name: string; product_key: string | null; quantity_milli: number }[];
  kit_available: number | null;
}

export interface ProductListResponse extends ListResponse<Product> {
  families: string[];
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
  status: 'draft' | 'sent' | 'approved' | 'partially_received' | 'received' | 'cancelled';
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
  product_id?: string | null;
  service_level?: string | null;
  work_date?: string | null;
  premium_label?: string | null;
  premium_percent?: number;
  billed_minutes?: number;
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
  contract_notices?: {
    count: number;
    top: { id: string; client_name: string; end_date: string; notice_deadline: string; days_left: number; overdue: boolean }[];
  };
  stock_alerts?: {
    out: number;
    low: number;
    suggested_milli: number;
    top: {
      product_id: string;
      name: string;
      level: 'out' | 'low';
      quantity_milli: number;
      reorder_point_milli: number;
      suggested_milli: number;
      supplier_name: string | null;
    }[];
  };
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
  rows: Record<string, string | number | null>[];
  summary: Record<string, number | null>;
  /** Margin report only: true when cost and margin were hidden by permissions. */
  masked?: boolean;
  group_by?: string;
  documents?: number;
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
  /** Stable id of this run, used to show the activity trail of the import. */
  import_id: string;
}

// Cycle counting (B1)
export interface StockCount {
  id: string;
  reference: string;
  scope: string;
  scope_value: string | null;
  status: string;
  note: string | null;
  line_count: number;
  created_at: string;
  validated_at: string | null;
  cancelled_at: string | null;
}

export interface StockCountLine {
  id: string;
  product_id: string;
  name: string;
  product_key: string | null;
  expected_milli: number;
  counted_milli: number | null;
  current_milli: number | null;
  movement_id: string | null;
}

export interface StockCountDetail extends StockCount {
  lines: StockCountLine[];
  summary: {
    total: number;
    counted: number;
    pending: number;
    shortages: number;
    surpluses: number;
    net_delta_milli: number;
  };
  stale_product_ids: string[];
}
