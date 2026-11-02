import { SYSTEM_ROLES, ensureSystemRoles } from '../services/roles';
import { SCHEMA_STATEMENTS, SCHEMA_VERSION } from './schema';

export type SqlValue = string | number | null;

/** Cached per isolate so a warm Worker never re-runs DDL. */
let schemaReady: Promise<void> | null = null;

export function ensureSchema(database: D1Database): Promise<void> {
  if (!schemaReady) {
    schemaReady = provision(database).then(() => seedSystemRoles(database)).catch((error) => {
      schemaReady = null;
      throw error;
    });
  }
  return schemaReady;
}

/**
 * Databases provisioned before the roles seam have no row for the five fixed
 * roles, which left the roles screen and the per-user assignment empty. Seeding
 * only when the table is empty keeps it to one read per isolate and never
 * resurrects a role an administrator deleted on purpose.
 */
async function seedSystemRoles(database: D1Database): Promise<void> {
  const row = await database
    .prepare(`SELECT COUNT(*) AS count FROM roles WHERE is_system = 1`)
    .first<{ count: number }>();
  if ((row?.count ?? 0) >= SYSTEM_ROLES.length) return;
  await ensureSystemRoles(database, nowISO());
}

async function provision(database: D1Database): Promise<void> {
  const existing = await database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'app_meta'`)
    .first<{ name: string }>();

  if (existing) {
    const version = await database
      .prepare(`SELECT value FROM app_meta WHERE key = 'schema_version'`)
      .first<{ value: string }>();
    if (version?.value === String(SCHEMA_VERSION)) return;
  }

  await database.batch(SCHEMA_STATEMENTS.map((statement) => database.prepare(statement)));
  await applyColumnMigrations(database);
  await grantCostPermission(database);

  await database
    .prepare(
      `INSERT INTO app_meta (key, value) VALUES ('schema_version', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .bind(String(SCHEMA_VERSION))
    .run();
}

/**
 * SQLite has no `ADD COLUMN IF NOT EXISTS`, so columns added to pre-existing
 * tables are checked against PRAGMA table_info first. Fresh installs already
 * carry them in CREATE TABLE, which makes these a no-op there.
 */
const COLUMN_MIGRATIONS: { table: string; column: string; definition: string }[] = [
  // B2: existing articles keep working untouched; only the ones switched to lot
  // or serial tracking start demanding a batch.
  { table: 'products', column: 'lot_tracking', definition: "TEXT NOT NULL DEFAULT 'none'" },
  // D1: existing customers start on the public grid; nothing reprices behind
  // their back.
  { table: 'clients', column: 'price_tier', definition: "TEXT NOT NULL DEFAULT 'public'" },
  // E1: a contract remembers the service it came from, its notice period and
  // whether it renews tacitly.
  { table: 'recurring_invoices', column: 'service_id', definition: 'TEXT' },
  { table: 'recurring_invoices', column: 'notice_days', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'recurring_invoices', column: 'renewal_mode', definition: "TEXT NOT NULL DEFAULT 'tacit'" },
  { table: 'recurring_invoices', column: 'contract_start', definition: 'TEXT' },
  // E2: the index that governs the contract's revision, copied from the sheet.
  { table: 'recurring_invoices', column: 'revision_index', definition: 'TEXT' },
  // F1: the CPS collected on a document, stored so the total needs no recompute.
  { table: 'invoices', column: 'cps_total', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'mfa_secret', definition: 'TEXT' },
  { table: 'users', column: 'mfa_enabled', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'users', column: 'mfa_codes', definition: 'TEXT' },
  // T-202b: a custom role is stored here; `role` keeps one of the five fixed
  // keys because SQLite cannot widen a CHECK constraint without rebuilding the
  // table — which is not a migration worth running on a user table.
  { table: 'users', column: 'role_key', definition: 'TEXT' },
  // T-205: a task remembers the invoice that billed it, so it can never be
  // billed twice and the kanban can show what is still owed to the client.
  { table: 'tasks', column: 'invoice_id', definition: 'TEXT' },
  // A5 (schema 22): a time entry tied to a catalogue service, its expertise
  // level, the day it was worked, the premium band it falls into, and what was
  // actually billed — frozen at the invoice so a later edit cannot rewrite it.
  { table: 'tasks', column: 'product_id', definition: 'TEXT' },
  { table: 'tasks', column: 'service_level', definition: 'TEXT' },
  { table: 'tasks', column: 'work_date', definition: 'TEXT' },
  { table: 'tasks', column: 'premium_label', definition: 'TEXT' },
  { table: 'tasks', column: 'premium_percent', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'tasks', column: 'billed_minutes', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'activities', column: 'before_json', definition: 'TEXT' },
  { table: 'activities', column: 'after_json', definition: 'TEXT' },
  { table: 'activities', column: 'ip', definition: 'TEXT' },
  { table: 'activities', column: 'prev_hash', definition: 'TEXT' },
  { table: 'activities', column: 'hash', definition: 'TEXT' },
  // Client legal profile (schema 17). Every column is nullable or defaulted so
  // existing rows, the demo seed and the CSV import keep working untouched.
  { table: 'clients', column: 'entity_category', definition: "TEXT NOT NULL DEFAULT 'PRIVATE_COMPANY'" },
  { table: 'clients', column: 'legal_name', definition: 'TEXT' },
  { table: 'clients', column: 'trade_name', definition: 'TEXT' },
  { table: 'clients', column: 'legal_form', definition: 'TEXT' },
  { table: 'clients', column: 'numero_rcs', definition: 'TEXT' },
  { table: 'clients', column: 'numero_tps', definition: 'TEXT' },
  { table: 'clients', column: 'vat_regime', definition: 'TEXT' },
  { table: 'clients', column: 'contact_role', definition: 'TEXT' },
  { table: 'clients', column: 'has_delegation_authority', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'clients', column: 'po_box_number', definition: 'TEXT' },
  { table: 'clients', column: 'po_box_municipality', definition: 'TEXT' },
  { table: 'clients', column: 'island', definition: 'TEXT' },
  { table: 'clients', column: 'physical_municipality', definition: 'TEXT' },
  { table: 'clients', column: 'district', definition: 'TEXT' },
  { table: 'clients', column: 'pk_landmark', definition: 'TEXT' },
  { table: 'clients', column: 'street_building_zone', definition: 'TEXT' },
  { table: 'clients', column: 'delivery_instructions', definition: 'TEXT' },
  { table: 'clients', column: 'payment_method', definition: 'TEXT' },
  { table: 'clients', column: 'payment_terms_code', definition: 'TEXT' },
  { table: 'clients', column: 'bank_name', definition: 'TEXT' },
  { table: 'clients', column: 'iban', definition: 'TEXT' },
  { table: 'clients', column: 'credit_limit', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'clients', column: 'tax_exemption_decree_num', definition: 'TEXT' },
  { table: 'clients', column: 'tax_exemption_expiry', definition: 'TEXT' },
  { table: 'clients', column: 'data_consent_accepted', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // Legacy rows already invoiced before the profile existed are treated as
  // approved: their missing papers are a historical gap, not a new blocker.
  // Every INSERT sets the column explicitly, so this default only covers them.
  { table: 'clients', column: 'account_status', definition: "TEXT NOT NULL DEFAULT 'APPROVED'" },
  // Workspace company profile (schema 18): the setup wizard collects the same
  // legal, address and commercial rubrics as a client record.
  { table: 'company', column: 'vat_regime_detail', definition: 'TEXT' },
  { table: 'company', column: 'entity_category', definition: "TEXT NOT NULL DEFAULT 'PRIVATE_COMPANY'" },
  { table: 'company', column: 'legal_form', definition: 'TEXT' },
  { table: 'company', column: 'numero_tps', definition: 'TEXT' },
  { table: 'company', column: 'contact_role', definition: 'TEXT' },
  { table: 'company', column: 'po_box_number', definition: 'TEXT' },
  { table: 'company', column: 'po_box_municipality', definition: 'TEXT' },
  { table: 'company', column: 'island', definition: 'TEXT' },
  { table: 'company', column: 'physical_municipality', definition: 'TEXT' },
  { table: 'company', column: 'district', definition: 'TEXT' },
  { table: 'company', column: 'pk_landmark', definition: 'TEXT' },
  { table: 'company', column: 'street_building_zone', definition: 'TEXT' },
  { table: 'company', column: 'delivery_instructions', definition: 'TEXT' },
  { table: 'company', column: 'payment_method', definition: 'TEXT' },
  { table: 'company', column: 'payment_terms_code', definition: 'TEXT' },
  { table: 'company', column: 'tax_exemption_decree_num', definition: 'TEXT' },
  { table: 'company', column: 'tax_exemption_expiry', definition: 'TEXT' },
  { table: 'company', column: 'data_consent_accepted', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // Fiche article ERP (schema 19). Every column is nullable or defaulted so the
  // catalogue, the CSV import and the demo seed keep working untouched: an item
  // created before the sheet existed is simply a plain stockable article.
  { table: 'products', column: 'item_type', definition: "TEXT NOT NULL DEFAULT 'stockable'" },
  { table: 'products', column: 'family', definition: 'TEXT' },
  { table: 'products', column: 'subfamily', definition: 'TEXT' },
  { table: 'products', column: 'lifecycle_status', definition: "TEXT NOT NULL DEFAULT 'active'" },
  { table: 'products', column: 'buyer', definition: 'TEXT' },
  { table: 'products', column: 'supplier_id', definition: 'TEXT' },
  { table: 'products', column: 'supplier_name', definition: 'TEXT' },
  { table: 'products', column: 'supplier_ref', definition: 'TEXT' },
  { table: 'products', column: 'purchase_price', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'purchase_currency', definition: "TEXT NOT NULL DEFAULT 'XPF'" },
  { table: 'products', column: 'moq_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'order_multiple_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'lead_time_days', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'stock_mode', definition: "TEXT NOT NULL DEFAULT 'simple'" },
  { table: 'products', column: 'weight_gross_g', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'weight_net_g', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'volume_cm3', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'warehouse_location', definition: 'TEXT' },
  { table: 'products', column: 'customs_code', definition: 'TEXT' },
  { table: 'products', column: 'valuation_method', definition: "TEXT NOT NULL DEFAULT 'cmp'" },
  { table: 'products', column: 'landed_cost', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'purchase_account', definition: 'TEXT' },
  { table: 'products', column: 'sales_account', definition: 'TEXT' },
  { table: 'products', column: 'stock_account', definition: 'TEXT' },
  { table: 'products', column: 'analytic_axis', definition: 'TEXT' },
  { table: 'products', column: 'price_pro', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'price_member', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'margin_target_bp', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'volume_discounts', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'products', column: 'bom_mode', definition: "TEXT NOT NULL DEFAULT 'on_order'" },
  { table: 'products', column: 'bom', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'products', column: 'substitutes', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'products', column: 'accessories', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'products', column: 'reorder_point_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'safety_stock_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'max_stock_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'replenish_mode', definition: "TEXT NOT NULL DEFAULT 'manual'" },
  { table: 'products', column: 'created_by', definition: 'TEXT' },
  { table: 'products', column: 'updated_by', definition: 'TEXT' },
  { table: 'products', column: 'revision', definition: 'INTEGER NOT NULL DEFAULT 1' },
  // Fiche service (schema 20). A service is the immaterial side of the same
  // catalogue: no stock, but time, planning, recurrence and deliverables. Every
  // column is nullable or defaulted so existing service rows stay valid, and a
  // product simply ignores them.
  { table: 'products', column: 'invoice_label', definition: 'TEXT' },
  { table: 'products', column: 'service_type', definition: "TEXT NOT NULL DEFAULT 'one_off'" },
  { table: 'products', column: 'billing_unit', definition: "TEXT NOT NULL DEFAULT 'hour'" },
  { table: 'products', column: 'billing_trigger', definition: "TEXT NOT NULL DEFAULT 'order'" },
  { table: 'products', column: 'min_billable_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'overtime_rules', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'products', column: 'expertise_levels', definition: "TEXT NOT NULL DEFAULT '[]'" },
  { table: 'products', column: 'cps_rate', definition: 'INTEGER NOT NULL DEFAULT 1' },
  { table: 'products', column: 'tax_exemption_note', definition: 'TEXT' },
  { table: 'products', column: 'skills', definition: 'TEXT' },
  { table: 'products', column: 'estimated_hours_milli', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'project_template', definition: 'TEXT' },
  { table: 'products', column: 'sla_response_hours', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'sla_resolution_hours', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'billing_frequency', definition: "TEXT NOT NULL DEFAULT 'monthly'" },
  { table: 'products', column: 'renewal_mode', definition: "TEXT NOT NULL DEFAULT 'tacit'" },
  { table: 'products', column: 'notice_days', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'price_revision_index', definition: 'TEXT' },
  { table: 'products', column: 'expense_mode', definition: "TEXT NOT NULL DEFAULT 'included'" },
  { table: 'products', column: 'travel_zone', definition: 'TEXT' },
  { table: 'products', column: 'deliverables', definition: 'TEXT' },
  { table: 'products', column: 'client_prerequisites', definition: 'TEXT' },
  { table: 'products', column: 'subcontract_account', definition: 'TEXT' },
  // Q1: where the disbursed import VAT is owed — the transitaire (401) or the
  // bank when the customs office was paid directly.
  { table: 'landed_cost_sheets', column: 'vat_settlement', definition: "TEXT NOT NULL DEFAULT 'supplier'" },
  // Q4: the proof of a 1 % archipelago sale, kept on the document itself.
  // Q6/Q7: what the landed cost sheet asked the customs engine, kept with the
  // figures so a six-month-old cost can still be recomputed.
  { table: 'landed_cost_sheets', column: 'transport', definition: "TEXT NOT NULL DEFAULT 'sea'" },
  { table: 'landed_cost_sheets', column: 'origin', definition: "TEXT NOT NULL DEFAULT 'standard'" },
  { table: 'landed_cost_sheets', column: 'weight_g', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'landed_cost_sheets', column: 'units', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'landed_cost_sheets', column: 'taxes_total', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'landed_cost_sheets', column: 'tax_lines', definition: "TEXT NOT NULL DEFAULT '[]'" },

  // Q9/Q10: a project keeps the template version it was made from, and the quote
  // that opened it, so an agreed estimate stays explainable months later.
  { table: 'projects', column: 'template_version_id', definition: 'TEXT' },
  { table: 'projects', column: 'quote_id', definition: 'TEXT' },
  { table: 'quotes', column: 'project_template_id', definition: 'TEXT' },
  { table: 'quotes', column: 'project_template_version', definition: 'INTEGER' },
  { table: 'invoices', column: 'archipelago', definition: 'TEXT' },
  { table: 'invoices', column: 'transport_reference', definition: 'TEXT' },
  { table: 'invoices', column: 'shipped_by_seller', definition: 'INTEGER NOT NULL DEFAULT 0' },
  { table: 'products', column: 'revenue_recognition', definition: "TEXT NOT NULL DEFAULT 'advance'" },
  // A3 (schema 21): whether a shortage blocks an emission. Off by default keeps
  // every existing item on the strict rule rather than silently allowing it.
  { table: 'products', column: 'allow_negative_stock', definition: 'INTEGER NOT NULL DEFAULT 0' },
  // Purchase price history (owner decision 2026-11-02): a price in the ledger is
  // either quoted by hand or paid on a receipt, and that source must stay
  // readable — otherwise a reception looks like someone retyped the price.
  { table: 'product_vendor_prices', column: 'source', definition: "TEXT NOT NULL DEFAULT 'manual'" },
  { table: 'product_vendor_prices', column: 'source_ref', definition: 'TEXT' },
];

async function applyColumnMigrations(database: D1Database): Promise<void> {
  for (const migration of COLUMN_MIGRATIONS) {
    const columns = await database.prepare(`PRAGMA table_info(${migration.table})`).all<{ name: string }>();
    if (!(columns.results ?? []).some((column) => column.name === migration.column)) {
      await database
        .prepare(`ALTER TABLE ${migration.table} ADD COLUMN ${migration.column} ${migration.definition}`)
        .run();
    }
  }
}

/**
 * D4: custom roles that could read the ledger keep their cost visibility, so the
 * change splits the two rights without silently blinding anyone. Idempotent.
 */
async function grantCostPermission(database: D1Database): Promise<void> {
  const rows = await database
    .prepare(`SELECT key, permissions FROM roles WHERE is_system = 0`)
    .all<{ key: string; permissions: string }>();
  const updates: D1PreparedStatement[] = [];
  for (const row of rows.results ?? []) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.permissions ?? '[]');
    } catch {
      continue;
    }
    if (!Array.isArray(parsed)) continue;
    const list = parsed.filter((entry): entry is string => typeof entry === 'string');
    if (!list.includes('accounting.read') || list.includes('products.cost.read')) continue;
    list.push('products.cost.read');
    updates.push(
      database
        .prepare(`UPDATE roles SET permissions = ?, updated_at = ? WHERE key = ?`)
        .bind(JSON.stringify(list), nowISO(), row.key),
    );
  }
  if (updates.length > 0) await database.batch(updates);
}

export async function one<T>(statement: D1PreparedStatement): Promise<T | null> {
  return (await statement.first<T>()) ?? null;
}

export async function many<T>(statement: D1PreparedStatement): Promise<T[]> {
  const result = await statement.all<T>();
  return result.results ?? [];
}

export async function scalar(statement: D1PreparedStatement): Promise<number> {
  const row = await statement.first<Record<string, number>>();
  if (!row) return 0;
  const value = Object.values(row)[0];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function nowISO(): string {
  return new Date().toISOString();
}
