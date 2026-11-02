import { Hono } from 'hono';
import { z } from 'zod';
import {
  BOM_MODES,
  ITEM_TYPES,
  LIFECYCLE_STATUSES,
  REPLENISH_MODES,
  STOCK_MODES,
  VALUATION_METHODS,
  kitAvailability,
  marginRate,
  stockAlert,
  suggestedReorder,
} from '../../shared/product-erp';
import { CURRENCIES, DEFAULT_TAX_RATE, FREQUENCIES } from '../../shared/domain';
import {
  BILLING_TRIGGERS,
  BILLING_UNITS,
  EXPENSE_MODES,
  RENEWAL_MODES,
  REVENUE_RECOGNITIONS,
  SERVICE_TYPES,
  TRAVEL_ZONES,
  cpsAmount,
} from '../../shared/service';
import { nowISO } from '../db';
import { assembleKit, disassembleKit } from '../services/stock';
import { postJournalEntry } from '../services/accounting';
import { listLots, receiveLot } from '../services/lots';
import { isExpired, lotTrackingMode, normaliseLotCode } from '../lib/lots';
import { locationBalances, locationTotal, validateTransfer } from '../lib/locations';
import { lotBalancesFromMovements } from '../lib/lot-balances';
import { attachProductLinks, groupProductLinks } from '../lib/product-links';
import { DEFAULT_VAT_RATE_BP, PORT_FEE_RATE_BP, computeLandedCost } from '../../shared/landed-cost';
import { importVatLines } from '../lib/import-vat';
import { getAccountCodes } from '../lib/settings-extra';
import {
  IMPORT_TRANSPORTS, tariffDutyRate, type ImportTaxRule, type TariffRow,
} from '../../shared/import-taxes';
import { familyAccountMap, resolveFamilyAccounts, type FamilyAccountRow } from '../lib/family-accounts';
import { preferredLink, type VendorLink } from '../lib/vendor-links';
import { openCountReference } from '../services/stock-counts';
import { stockValue, weightedAverageCost } from '../lib/valuation';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import {
  minorAmount,
  offsetOf,
  optionalText,
  paginationSchema,
  parseInput,
  percentRate,
} from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import type { AppEnv } from '../types';

/** Quantities travel in human units and are stored in thousandths, as elsewhere
 * in the app: 2.5 hours is 2500, never a floating point surprise. */
const milliQuantity = z.coerce.number().min(0).max(1_000_000).default(0);

const discountRule = z.object({
  min_quantity: z.coerce.number().min(1).max(1_000_000),
  percent: z.coerce.number().min(0).max(100),
});

const bomLine = z.object({
  product_id: z.string().min(1).max(60),
  quantity: z.coerce.number().min(0.001).max(100_000),
});

/**
 * The ERP item sheet. Two faces of one catalogue entry:
 *  - a stockable article (rubrics 1-9 of the article sheet), and
 *  - a service, which has no stock but has time, planning, recurrence and
 *    deliverables instead.
 * Both live on the same row so a service stays billable in quotes and invoices.
 */
const productSchema = z.object({
  product_key: optionalText(60),
  name: z.string().trim().min(1).max(160),
  description: optionalText(1000),

  // 1. Paramétrage général & typologie
  item_type: z.enum(ITEM_TYPES).default('stockable'),
  family: optionalText(80),
  subfamily: optionalText(80),
  lifecycle_status: z.enum(LIFECYCLE_STATUSES).default('active'),
  buyer: optionalText(120),

  // 2. Achats & sourcing fournisseur
  supplier_id: optionalText(60),
  supplier_name: optionalText(160),
  supplier_ref: optionalText(80),
  purchase_price: minorAmount.default(0),
  purchase_currency: z.enum(CURRENCIES).default('XPF'),
  moq: milliQuantity,
  order_multiple: milliQuantity,
  lead_time_days: z.coerce.number().int().min(0).max(730).default(0),

  // 3. Logistique avancée, WMS & traçabilité
  stock_mode: z.enum(STOCK_MODES).default('simple'),
  weight_gross_g: z.coerce.number().int().min(0).max(100_000_000).default(0),
  weight_net_g: z.coerce.number().int().min(0).max(100_000_000).default(0),
  volume_cm3: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
  warehouse_location: optionalText(80),
  customs_code: optionalText(20),

  // 4. Valorisation & comptabilité
  valuation_method: z.enum(VALUATION_METHODS).default('cmp'),
  landed_cost: minorAmount.default(0),
  purchase_account: optionalText(20),
  sales_account: optionalText(20),
  stock_account: optionalText(20),
  analytic_axis: optionalText(60),

  // 5. Politique tarifaire & grilles de vente
  unit_price: minorAmount,
  price_pro: minorAmount.default(0),
  price_member: minorAmount.default(0),
  margin_target: percentRate.default(0),
  volume_discounts: z.array(discountRule).max(20).default([]),

  // 6. Kits & nomenclature
  bom_mode: z.enum(BOM_MODES).default('on_order'),
  bom: z.array(bomLine).max(50).default([]),

  // 7. Produits liés
  substitutes: z.array(z.string().min(1).max(60)).max(20).default([]),
  accessories: z.array(z.string().min(1).max(60)).max(20).default([]),

  // 8. Réapprovisionnement & besoins
  reorder_point: milliQuantity,
  safety_stock: milliQuantity,
  max_stock: milliQuantity,
  replenish_mode: z.enum(REPLENISH_MODES).default('manual'),

  // Fiche service : identification & facturation
  invoice_label: optionalText(160),
  service_type: z.enum(SERVICE_TYPES).default('one_off'),
  billing_unit: z.enum(BILLING_UNITS).default('hour'),
  billing_trigger: z.enum(BILLING_TRIGGERS).default('order'),
  min_billable: milliQuantity,
  overtime_rules: z.array(z.object({
    label: z.string().trim().min(1).max(60),
    percent: z.coerce.number().min(0).max(300),
  })).max(10).default([]),
  expertise_levels: z.array(z.object({
    level: z.string().trim().min(1).max(60),
    price: minorAmount.default(0),
  })).max(10).default([]),
  // Fiscalité locale : CPS (1 %) et mention d'exonération éventuelle.
  // Legacy: the CPS (contribution pour la solidarité) was abolished on
  // 1 October 2023. The column stays for history, unused, and defaults to zero.
  cps_rate: z.coerce.number().min(0).max(20).default(0),
  tax_exemption_note: optionalText(300),

  // Fiche service : planification & ressources
  skills: optionalText(300),
  estimated_hours: z.coerce.number().min(0).max(100_000).default(0),
  project_template: optionalText(120),
  sla_response_hours: z.coerce.number().int().min(0).max(8760).default(0),
  sla_resolution_hours: z.coerce.number().int().min(0).max(8760).default(0),

  // Fiche service : contrat récurrent
  billing_frequency: z.enum(FREQUENCIES).default('monthly'),
  renewal_mode: z.enum(RENEWAL_MODES).default('tacit'),
  notice_days: z.coerce.number().int().min(0).max(730).default(0),
  price_revision_index: optionalText(80),

  // Fiche service : frais annexes & déplacements
  expense_mode: z.enum(EXPENSE_MODES).default('included'),
  travel_zone: z.union([z.enum(TRAVEL_ZONES), z.literal(''), z.null()]).optional()
    .transform((value) => (value ? value : null)),

  // Fiche service : livrables & prérequis
  deliverables: optionalText(2000),
  client_prerequisites: optionalText(2000),

  // Fiche service : comptabilité (reconnaissance du chiffre d'affaires)
  subcontract_account: optionalText(20),
  revenue_recognition: z.enum(REVENUE_RECOGNITIONS).default('advance'),

  // Stock courant et vente
  quantity: z.coerce.number().min(-1_000_000).max(1_000_000).default(0),
  track_quantity: z.boolean().default(false),
  // A shop that enters stock after the sale must not be blocked by a shortage.
  allow_negative_stock: z.boolean().default(false),
  // B2: a batch-tracked article must say which batch leaves on every movement.
  lot_tracking: z.enum(['none', 'lot', 'serial']).default('none'),
  cost: minorAmount.default(0),
  tax_rate: percentRate.default(DEFAULT_TAX_RATE),
});

type ProductBody = z.infer<typeof productSchema>;

interface ProductRow {
  [column: string]: unknown;
  id: string;
  name: string;
  item_type: string;
  quantity_milli: number;
  reorder_point_milli: number;
  safety_stock_milli: number;
  max_stock_milli: number;
  moq_milli: number;
  order_multiple_milli: number;
  track_quantity: number;
  unit_price: number;
  cost: number;
  margin_target_bp: number;
}

const milli = (value: number) => Math.round(value * 1000);
const units = (value: number) => value / 1000;

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * Cost, purchase price, landed cost, loaded hourly rate and margin are buying
 * information. A profile without accounting read access (sales, read-only) sees
 * the item and its selling price but not what it costs us: nulls, plus
 * `cost_masked`, never a silent zero.
 */
function toApi(row: ProductRow, canSeeCost: boolean) {
  const stock = {
    track_quantity: Number(row.track_quantity ?? 0),
    quantity_milli: Number(row.quantity_milli ?? 0),
    reorder_point_milli: Number(row.reorder_point_milli ?? 0),
    safety_stock_milli: Number(row.safety_stock_milli ?? 0),
    max_stock_milli: Number(row.max_stock_milli ?? 0),
    moq_milli: Number(row.moq_milli ?? 0),
    order_multiple_milli: Number(row.order_multiple_milli ?? 0),
  };
  const cpsRate = Number(row.cps_rate ?? 1);

  return {
    id: row.id,
    product_key: row.product_key ?? null,
    name: row.name,
    description: row.description ?? null,
    item_type: row.item_type ?? 'stockable',
    family: row.family ?? null,
    subfamily: row.subfamily ?? null,
    lifecycle_status: row.lifecycle_status ?? 'active',
    buyer: row.buyer ?? null,

    supplier_id: row.supplier_id ?? null,
    supplier_name: row.supplier_name ?? null,
    supplier_ref: row.supplier_ref ?? null,
    purchase_currency: row.purchase_currency ?? 'XPF',
    lead_time_days: Number(row.lead_time_days ?? 0),

    stock_mode: row.stock_mode ?? 'simple',
    weight_gross_g: Number(row.weight_gross_g ?? 0),
    weight_net_g: Number(row.weight_net_g ?? 0),
    volume_cm3: Number(row.volume_cm3 ?? 0),
    warehouse_location: row.warehouse_location ?? null,
    customs_code: row.customs_code ?? null,

    valuation_method: row.valuation_method ?? 'cmp',
    purchase_account: row.purchase_account ?? null,
    sales_account: row.sales_account ?? null,
    stock_account: row.stock_account ?? null,
    analytic_axis: row.analytic_axis ?? null,

    unit_price: Number(row.unit_price ?? 0),
    price_pro: Number(row.price_pro ?? 0),
    price_member: Number(row.price_member ?? 0),
    margin_target: Number(row.margin_target_bp ?? 0) / 100,
    volume_discounts: parseJson(row.volume_discounts, []),

    bom_mode: row.bom_mode ?? 'on_order',
    bom: parseJson(row.bom, []),
    substitutes: parseJson(row.substitutes, []),
    accessories: parseJson(row.accessories, []),

    moq: units(stock.moq_milli),
    order_multiple: units(stock.order_multiple_milli),
    reorder_point: units(stock.reorder_point_milli),
    safety_stock: units(stock.safety_stock_milli),
    max_stock: units(stock.max_stock_milli),
    replenish_mode: row.replenish_mode ?? 'manual',

    // Fiche service
    invoice_label: row.invoice_label ?? null,
    service_type: row.service_type ?? 'one_off',
    billing_unit: row.billing_unit ?? 'hour',
    billing_trigger: row.billing_trigger ?? 'order',
    min_billable: units(Number(row.min_billable_milli ?? 0)),
    overtime_rules: parseJson(row.overtime_rules, []),
    expertise_levels: parseJson(row.expertise_levels, []),
    cps_rate: cpsRate,
    cps_amount: cpsAmount(Number(row.unit_price ?? 0), cpsRate),
    tax_exemption_note: row.tax_exemption_note ?? null,
    skills: row.skills ?? null,
    estimated_hours: units(Number(row.estimated_hours_milli ?? 0)),
    project_template: row.project_template ?? null,
    sla_response_hours: Number(row.sla_response_hours ?? 0),
    sla_resolution_hours: Number(row.sla_resolution_hours ?? 0),
    billing_frequency: row.billing_frequency ?? 'monthly',
    renewal_mode: row.renewal_mode ?? 'tacit',
    notice_days: Number(row.notice_days ?? 0),
    price_revision_index: row.price_revision_index ?? null,
    expense_mode: row.expense_mode ?? 'included',
    travel_zone: row.travel_zone ?? null,
    deliverables: row.deliverables ?? null,
    client_prerequisites: row.client_prerequisites ?? null,
    subcontract_account: row.subcontract_account ?? null,
    revenue_recognition: row.revenue_recognition ?? 'advance',

    quantity_milli: stock.quantity_milli,
    quantity: units(stock.quantity_milli),
    track_quantity: stock.track_quantity,
    allow_negative_stock: Number(row.allow_negative_stock ?? 0),
    lot_tracking: lotTrackingMode(row.lot_tracking),
    tax_rate: Number(row.tax_rate ?? 0),
    stock_alert: stockAlert(stock),
    suggested_reorder: units(suggestedReorder(stock)),

    revision: Number(row.revision ?? 1),
    created_at: row.created_at ?? null,
    updated_at: row.updated_at ?? null,
    created_by: row.created_by ?? null,
    updated_by: row.updated_by ?? null,
    cost_masked: !canSeeCost,
    ...(canSeeCost
      ? {
        cost: Number(row.cost ?? 0),
        purchase_price: Number(row.purchase_price ?? 0),
        landed_cost: Number(row.landed_cost ?? 0),
        margin_rate: marginRate(Number(row.unit_price ?? 0), Number(row.cost ?? 0)),
        // What the shelf is worth at the current average cost (B3).
        stock_value: stockValue(stock.quantity_milli, Number(row.cost ?? 0)),
      }
      : { cost: null, purchase_price: null, landed_cost: null, margin_rate: null, stock_value: null }),
  };
}

/** Column list shared by INSERT and UPDATE so a new rubric cannot be forgotten
 * in one of them. */
function columns(body: ProductBody) {
  return {
    product_key: body.product_key,
    name: body.name,
    description: body.description,
    item_type: body.item_type,
    family: body.family,
    subfamily: body.subfamily,
    lifecycle_status: body.lifecycle_status,
    buyer: body.buyer,
    supplier_id: body.supplier_id,
    supplier_name: body.supplier_name,
    supplier_ref: body.supplier_ref,
    purchase_price: body.purchase_price,
    purchase_currency: body.purchase_currency,
    moq_milli: milli(body.moq),
    order_multiple_milli: milli(body.order_multiple),
    lead_time_days: body.lead_time_days,
    stock_mode: body.stock_mode,
    weight_gross_g: body.weight_gross_g,
    weight_net_g: body.weight_net_g,
    volume_cm3: body.volume_cm3,
    warehouse_location: body.warehouse_location,
    customs_code: body.customs_code,
    valuation_method: body.valuation_method,
    landed_cost: body.landed_cost,
    purchase_account: body.purchase_account,
    sales_account: body.sales_account,
    stock_account: body.stock_account,
    analytic_axis: body.analytic_axis,
    unit_price: body.unit_price,
    price_pro: body.price_pro,
    price_member: body.price_member,
    margin_target_bp: Math.round(body.margin_target * 100),
    volume_discounts: JSON.stringify(body.volume_discounts),
    bom_mode: body.bom_mode,
    bom: JSON.stringify(body.bom),
    substitutes: JSON.stringify(body.substitutes),
    accessories: JSON.stringify(body.accessories),
    reorder_point_milli: milli(body.reorder_point),
    safety_stock_milli: milli(body.safety_stock),
    max_stock_milli: milli(body.max_stock),
    replenish_mode: body.replenish_mode,
    invoice_label: body.invoice_label,
    service_type: body.service_type,
    billing_unit: body.billing_unit,
    billing_trigger: body.billing_trigger,
    min_billable_milli: milli(body.min_billable),
    overtime_rules: JSON.stringify(body.overtime_rules),
    expertise_levels: JSON.stringify(body.expertise_levels),
    cps_rate: Math.round(body.cps_rate),
    tax_exemption_note: body.tax_exemption_note,
    skills: body.skills,
    estimated_hours_milli: milli(body.estimated_hours),
    project_template: body.project_template,
    sla_response_hours: body.sla_response_hours,
    sla_resolution_hours: body.sla_resolution_hours,
    billing_frequency: body.billing_frequency,
    renewal_mode: body.renewal_mode,
    notice_days: body.notice_days,
    price_revision_index: body.price_revision_index,
    expense_mode: body.expense_mode,
    travel_zone: body.travel_zone,
    deliverables: body.deliverables,
    client_prerequisites: body.client_prerequisites,
    subcontract_account: body.subcontract_account,
    revenue_recognition: body.revenue_recognition,
    quantity_milli: milli(body.quantity),
    track_quantity: body.track_quantity ? 1 : 0,
    allow_negative_stock: body.allow_negative_stock ? 1 : 0,
    lot_tracking: body.lot_tracking,
    cost: body.cost,
    tax_rate: body.tax_rate,
  };
}

export const productRoutes = new Hono<AppEnv>();
productRoutes.use('*', requireAuth);

productRoutes.get('/', requirePermission('products.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const itemType = c.req.query('item_type') ?? '';
  const status = c.req.query('lifecycle_status') ?? '';
  const family = c.req.query('family') ?? '';
  const stockFilter = c.req.query('stock') ?? '';

  const filters = ['deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (search) {
    filters.push('(name LIKE ? OR product_key LIKE ? OR supplier_ref LIKE ? OR family LIKE ? OR invoice_label LIKE ?)');
    const like = `%${search}%`;
    bindings.push(like, like, like, like, like);
  }
  if (itemType) {
    filters.push('item_type = ?');
    bindings.push(itemType);
  }
  if (status) {
    filters.push('lifecycle_status = ?');
    bindings.push(status);
  }
  if (family) {
    filters.push('family = ?');
    bindings.push(family);
  }
  if (stockFilter === 'out') filters.push('track_quantity = 1 AND quantity_milli <= 0');
  if (stockFilter === 'low') filters.push('track_quantity = 1 AND quantity_milli > 0 AND quantity_milli <= reorder_point_milli');
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM products ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT * FROM products ${where} ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all<ProductRow>();

  const canSeeCost = c.get('user')!.permissions.includes('products.cost.read');
  const total = count?.count ?? 0;
  // F2: the list carries what the sheet stores, not the family's default. Writing
  // the inherited account into the list would make the edit form save it back and
  // freeze an inheritance the user never asked to break.
  const data = (rows.results ?? []).map((row) => toApi(row, canSeeCost));
  // D3: substitutes and accessories travel with the list so the quote editor can
  // suggest them without a request per line.
  await attachProductLinks(c.env.DB, data);

  // Families drive the filter, and they are free text on the sheet: collect the
  // ones in use from the matching rows so the dropdown never invents a value.
  const families = [...new Set(data.map((item) => item.family).filter(Boolean) as string[])]
    .sort((a, b) => a.localeCompare(b, 'fr'));

  return c.json({
    data,
    families,
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

/** The valuation journal behind the average cost (B3): buying information, so
 * it follows the same mask as the cost itself. */
productRoutes.get('/:id/valuation', requirePermission('products.read'), async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB.prepare(
    `SELECT id, quantity_milli, cost, deleted_at FROM products WHERE id = ?`,
  )
    .bind(id)
    .first<{ id: string; quantity_milli: number; cost: number; deleted_at: string | null }>();
  if (!product || product.deleted_at) return fail(404, 'NOT_FOUND');

  if (!c.get('user')!.permissions.includes('products.cost.read')) {
    return c.json({ cost: null, stock_value: null, quantity_milli: null, history: [] });
  }

  const rows = await c.env.DB.prepare(
    `SELECT * FROM stock_valuations WHERE product_id = ? ORDER BY created_at DESC LIMIT 100`,
  ).bind(id).all();
  const quantity = Number(product.quantity_milli ?? 0);
  const cost = Number(product.cost ?? 0);
  return c.json({
    cost,
    quantity_milli: quantity,
    stock_value: stockValue(quantity, cost),
    history: rows.results ?? [],
  });
});

/** -------------------------------------------------------- landed cost (F4) */

const landedCostSchema = z.object({
  currency: z.enum(CURRENCIES).default('XPF'),
  // XPF per unit of the invoice currency, in millionths: 119 331 700 for a euro
  // invoice, 1 000 000 for a one-to-one rate.
  exchange_rate_micro: z.coerce.number().int().min(1).max(1_000_000_000).default(1_000_000),
  quantity: z.coerce.number().min(0.001).max(1_000_000),
  goods_amount: minorAmount,
  freight: minorAmount.default(0),
  insurance: minorAmount.default(0),
  fixed_fees: minorAmount.default(0),
  duty_rate_bp: z.coerce.number().int().min(0).max(10_000).default(0),
  port_fee_rate_bp: z.coerce.number().int().min(0).max(10_000).default(PORT_FEE_RATE_BP),
  vat_rate_bp: z.coerce.number().int().min(0).max(10_000).default(DEFAULT_VAT_RATE_BP),
  vat_recoverable: z.boolean().default(true),
  // Q1: who advanced the disbursed VAT — the transitaire (401) or the customs
  // office paid directly from the bank (512).
  vat_settlement: z.enum(['supplier', 'bank']).default('supplier'),
  // The date of the customs declaration: the VAT is due then, not on the day the
  // sheet happens to be filled in.
  declaration_date: z.string().max(10).optional(),
  // Q7: each tax has its own base, and the port toll only applies to sea freight.
  transport: z.enum(IMPORT_TRANSPORTS).default('sea'),
  // Q6: the origin decides which tariff column applies (preferential rates need
  // a certificate; without one the standard rate is used).
  origin: z.enum(['standard', 'eu', 'oceania']).default('standard'),
  weight_kg: z.coerce.number().min(0).max(1_000_000).default(0),
  units: z.coerce.number().int().min(0).max(100_000).default(0),
});

/** The landed cost history of one article: cost information, masked like the cost. */
productRoutes.get('/:id/landed-cost', requirePermission('products.read'), async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB
    .prepare(`SELECT id, landed_cost FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string; landed_cost: number }>();
  if (!product) return fail(404, 'NOT_FOUND');

  if (!c.get('user')!.permissions.includes('products.cost.read')) {
    return c.json({ unit_cost: null, data: [] });
  }

  const rows = await c.env.DB
    .prepare(`SELECT * FROM landed_cost_sheets WHERE product_id = ? ORDER BY created_at DESC LIMIT 20`)
    .bind(id)
    .all<Record<string, unknown>>();

  return c.json({
    unit_cost: Number(product.landed_cost ?? 0),
    data: (rows.results ?? []).map((row) => ({
      ...row,
      quantity: Number(row.quantity_milli ?? 0) / 1000,
      exchange_rate: Number(row.exchange_rate_micro ?? 1_000_000) / 1_000_000,
      vat_recoverable: Boolean(row.vat_recoverable),
    })),
  });
});

/**
 * Compute and keep a landed cost. Each computation is its own row: a landed cost
 * that overwrote the previous one would leave no way to explain an old margin.
 */
productRoutes.post('/:id/landed-cost', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  // Writing a cost from a screen where the cost is masked would be a blind write
  // (D4): the permission to read buying information is a precondition here too.
  if (!user.permissions.includes('products.cost.read')) return fail(403, 'FORBIDDEN');

  const product = await c.env.DB
    .prepare(`SELECT id, name, customs_code FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string; name: string; customs_code: string | null }>();
  if (!product) return fail(404, 'NOT_FOUND');

  const body = parseInput(landedCostSchema, await c.req.json().catch(() => ({})));
  const quantityMilli = milli(body.quantity);
  if (Number(body.goods_amount) <= 0) {
    return fail(422, 'VALIDATION_ERROR', { goods_amount: 'required' });
  }

  const currency = body.currency;
  const exchangeRateMicro = currency === 'XPF' ? 1_000_000 : body.exchange_rate_micro;

  // Q6: the product's tariff heading decides the duty rate when it is known; the
  // rate typed on the sheet stays the fallback for an article without a heading.
  const tariffRow = product.customs_code
    ? await c.env.DB
      .prepare(`SELECT code, duty_rate_bp, duty_rate_eu_bp, duty_rate_oceania_bp FROM tariff_codes WHERE code = ? AND is_active = 1`)
      .bind(product.customs_code)
      .first<TariffRow>()
    : null;
  const dutyRateBp = tariffDutyRate(tariffRow, body.origin) ?? body.duty_rate_bp;

  // Q7: every active tax rule, filtered by transport and validity inside the engine.
  const taxRules = (await c.env.DB
    .prepare(`SELECT code, label, base, rate_bp, amount, transport, sort_order, is_active, valid_from, valid_to FROM import_tax_rules`)
    .all<ImportTaxRule>()).results ?? [];

  const breakdown = computeLandedCost({
    currency,
    exchange_rate_micro: exchangeRateMicro,
    quantity_milli: quantityMilli,
    goods_amount: Number(body.goods_amount),
    freight: Number(body.freight),
    insurance: Number(body.insurance),
    fixed_fees: Number(body.fixed_fees),
    duty_rate_bp: dutyRateBp,
    port_fee_rate_bp: body.port_fee_rate_bp,
    vat_rate_bp: body.vat_rate_bp,
    vat_recoverable: body.vat_recoverable,
    tax_rules: taxRules,
    weight_g: milli(body.weight_kg),
    units: body.units,
    transport: body.transport,
    date: body.declaration_date ?? nowISO().slice(0, 10),
  });

  const sheetId = crypto.randomUUID();
  const now = nowISO();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO landed_cost_sheets
         (id, product_id, currency, exchange_rate_micro, quantity_milli, goods_amount, freight, insurance,
          fixed_fees, duty_rate_bp, port_fee_rate_bp, vat_rate_bp, vat_recoverable, vat_settlement,
          transport, origin, weight_g, units, taxes_total, tax_lines,
          customs_value, duty, port_fee, vat, total_in_cost, unit_cost, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sheetId, id, currency, exchangeRateMicro, quantityMilli,
      breakdown.goods, breakdown.freight, breakdown.insurance, breakdown.fixed_fees,
      dutyRateBp, body.port_fee_rate_bp, body.vat_rate_bp, body.vat_recoverable ? 1 : 0,
      body.vat_settlement,
      body.transport, body.origin, milli(body.weight_kg), body.units,
      breakdown.taxes_total, JSON.stringify(breakdown.tax_lines),
      breakdown.customs_value, breakdown.duty, breakdown.port_fee, breakdown.vat,
      breakdown.total_in_cost, breakdown.unit_cost, user.id, now,
    ),
    // The stock leaves at the landed cost, not at the invoice price (B3).
    c.env.DB.prepare(`UPDATE products SET landed_cost = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
      .bind(breakdown.unit_cost, user.id, now, id),
  ]);

  // Q1: import VAT is due at clearance. Posting it is what puts it in the
  // deductible VAT of the period instead of leaving it out of the books; under the
  // franchise en base it is already in the cost and there is nothing to post.
  const reference = `LC-${sheetId.slice(0, 8).toUpperCase()}`;
  const vatLines = importVatLines({
    vat: breakdown.vat,
    recoverable: body.vat_recoverable,
    settlement: body.vat_settlement,
    productName: product.name,
    reference,
    accounts: await getAccountCodes(c.env.DB),
  });
  if (vatLines.length) {
    await postJournalEntry(c.env.DB, {
      sourceType: 'landed_cost',
      sourceId: sheetId,
      event: 'import_vat',
      date: body.declaration_date ?? now.slice(0, 10),
      reference,
      label: `TVA à l’import ${reference}`,
      journal: 'AC',
      lines: vatLines,
    });
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'product',
    entityId: id,
    summary: 'activity.landed_cost_computed',
    meta: {
      unit_cost: breakdown.unit_cost,
      total_in_cost: breakdown.total_in_cost,
      currency,
    },
  });

  return c.json({ id: sheetId, quantity_milli: quantityMilli, vat_posted: vatLines.length > 0, ...breakdown }, 201);
});

/** Lots of one article in shelf order: soonest expiry first, undated last. */
productRoutes.get('/:id/lots', requirePermission('products.read'), async (c) => {
  const rows = await listLots(c.env.DB, c.req.param('id'));
  const today = nowISO().slice(0, 10);
  return c.json({
    data: rows.map((row) => ({
      ...row,
      quantity: row.quantity_milli / 1000,
      expired: isExpired(row, today),
    })),
  });
});

/** Q12: where each batch really sits, shelf by shelf. */
productRoutes.get('/:id/lots/balances', requirePermission('products.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT b.lot_id, l.lot_code, l.expiry_date, b.location, b.quantity_milli
       FROM lot_balances b JOIN stock_lots l ON l.id = b.lot_id
      WHERE l.product_id = ? AND b.quantity_milli <> 0
      ORDER BY l.lot_code ASC, b.location ASC`,
  ).bind(c.req.param('id')).all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((row) => ({
      ...row,
      quantity: Number(row.quantity_milli ?? 0) / 1000,
      location: row.location === '' ? null : row.location,
    })),
  });
});

/**
 * Recompute the balances from the movement journal. The journal is the proof: if a
 * balance ever disagrees with it, this is the repair, and the disagreement is fixed
 * rather than hidden behind a counter nobody can audit.
 */
productRoutes.post('/:id/lots/balances/rebuild', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const movements = await c.env.DB.prepare(
    `SELECT lot, location, kind, quantity_milli FROM stock_movements
      WHERE product_id = ? AND lot IS NOT NULL AND lot <> ''`,
  ).bind(id).all<{ lot: string; location: string | null; kind: string; quantity_milli: number }>();
  const balances = lotBalancesFromMovements(movements.results ?? []);
  const lots = await c.env.DB.prepare(`SELECT id, lot_code FROM stock_lots WHERE product_id = ?`)
    .bind(id).all<{ id: string; lot_code: string }>();
  const byCode = new Map((lots.results ?? []).map((row) => [row.lot_code, row.id]));
  const now = nowISO();

  const statements = [
    c.env.DB.prepare(
      `DELETE FROM lot_balances WHERE lot_id IN (SELECT id FROM stock_lots WHERE product_id = ?)`,
    ).bind(id),
  ];
  for (const balance of balances) {
    const lotId = byCode.get(balance.lot_code);
    if (!lotId) continue;
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO lot_balances (lot_id, location, quantity_milli, updated_at) VALUES (?, ?, ?, ?)`,
      ).bind(lotId, balance.location ?? '', balance.quantity_milli, now),
    );
  }
  await c.env.DB.batch(statements);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'product',
    entityId: id,
    summary: 'activity.lot_balances_rebuilt',
    meta: { rows: balances.length },
  });

  return c.json({ ok: true, rows: balances.length });
});

/**
 * Q12: moving a batch is two movements, never a field update. Writing one movement
 * with the new location would leave the shelf it left still holding it.
 */
productRoutes.post('/:id/lots/:lotId/transfer', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const lotId = c.req.param('lotId');
  const body = parseInput(
    z.object({
      from_location: z.string().trim().max(60).nullish(),
      to_location: z.string().trim().min(1).max(60),
      quantity: z.coerce.number().min(0.001).max(1_000_000),
      reference: z.string().trim().max(60).nullish(),
    }),
    await c.req.json().catch(() => ({})),
  );

  const lot = await c.env.DB.prepare(
    `SELECT id, lot_code, location FROM stock_lots WHERE id = ? AND product_id = ?`,
  ).bind(lotId, id).first<{ id: string; lot_code: string; location: string | null }>();
  if (!lot) return fail(404, 'NOT_FOUND');

  const balances = await c.env.DB.prepare(
    `SELECT location, quantity_milli FROM lot_balances WHERE lot_id = ?`,
  ).bind(lotId).all<{ location: string; quantity_milli: number }>();
  const from = (body.from_location ?? lot.location ?? '').trim();
  const available = (balances.results ?? [])
    .find((row) => row.location === from)?.quantity_milli ?? 0;
  const quantityMilli = Math.round(Number(body.quantity) * 1000);

  const check = validateTransfer({
    from, to: body.to_location, quantity_milli: quantityMilli, available_milli: available,
  });
  if (!check.ok) return fail(check.status, check.code, check.details);

  const now = nowISO();
  const reference = body.reference || `TR-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO stock_movements
         (id, product_id, kind, quantity_milli, reason, reference, location, lot, user_id, created_at)
       VALUES (?, ?, 'out', ?, 'lot_transfer', ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, quantityMilli, reference, from, lot.lot_code, user.id, now),
    c.env.DB.prepare(
      `INSERT INTO stock_movements
         (id, product_id, kind, quantity_milli, reason, reference, location, lot, user_id, created_at)
       VALUES (?, ?, 'in', ?, 'lot_transfer', ?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, quantityMilli, reference, body.to_location, lot.lot_code, user.id, now),
    c.env.DB.prepare(
      `INSERT INTO lot_balances (lot_id, location, quantity_milli, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(lot_id, location) DO UPDATE SET
         quantity_milli = lot_balances.quantity_milli - ?, updated_at = excluded.updated_at`,
    ).bind(lotId, from, -quantityMilli, now, quantityMilli),
    c.env.DB.prepare(
      `INSERT INTO lot_balances (lot_id, location, quantity_milli, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(lot_id, location) DO UPDATE SET
         quantity_milli = lot_balances.quantity_milli + ?, updated_at = excluded.updated_at`,
    ).bind(lotId, body.to_location, quantityMilli, now, quantityMilli),
  ]);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'product',
    entityId: id,
    summary: 'activity.lot_transferred',
    meta: { lot: lot.lot_code, from, to: body.to_location, quantity_milli: quantityMilli, reference },
  });

  return c.json({ ok: true, lot: lot.lot_code, from, to: body.to_location, quantity_milli: quantityMilli, reference });
});

/** Reception of a batch: the only way a lot is ever created. */
productRoutes.post('/:id/lots', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({
      lot_code: z.string().min(1).max(60),
      expiry_date: z.string().max(10).nullable().optional(),
      location: optionalText(80),
      quantity: z.coerce.number().min(0.001).max(1_000_000),
      unit_cost: minorAmount.default(0),
      reference: optionalText(60),
    }),
    await c.req.json().catch(() => ({})),
  );
  const lot = await receiveLot(c.env.DB, {
    productId: c.req.param('id'),
    lotCode: body.lot_code,
    expiryDate: body.expiry_date ?? null,
    location: body.location ?? null,
    quantityMilli: milli(body.quantity),
    unitCost: Number(body.unit_cost ?? 0),
    reference: body.reference ?? null,
    userId: user.id,
  });
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'received',
    entityType: 'product',
    entityId: lot.product_id,
    summary: 'activity.lot_received',
    meta: { lot: lot.lot_code, quantity: lot.quantity_milli / 1000 },
  });
  return c.json({ ...lot, quantity: lot.quantity_milli / 1000 }, 201);
});

/** The shelf, location by location: the ledger already records where each
 * movement happened, so this is a reading rather than a second truth to keep. */
async function ledgerBalances(database: D1Database, productId: string) {
  const rows = await database
    .prepare(`SELECT location, kind, quantity_milli FROM stock_movements WHERE product_id = ?`)
    .bind(productId)
    .all<{ location: string | null; kind: string; quantity_milli: number }>();
  return locationBalances(rows.results ?? []);
}

productRoutes.get('/:id/locations', requirePermission('products.read'), async (c) => {
  const id = c.req.param('id');
  const product = await c.env.DB
    .prepare(`SELECT id FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string }>();
  if (!product) return fail(404, 'NOT_FOUND');

  const balances = await ledgerBalances(c.env.DB, id);
  const registry = await c.env.DB
    .prepare(`SELECT code, name FROM stock_locations WHERE is_active = 1 ORDER BY code COLLATE NOCASE`)
    .all<{ code: string; name: string | null }>();
  return c.json({
    data: balances.map((row) => ({
      location: row.location,
      quantity: row.quantity_milli / 1000,
    })),
    total: locationTotal(balances) / 1000,
    locations: registry.results ?? [],
  });
});

/**
 * Internal transfer (B4): two ledger rows, one out of the source shelf and one
 * into the target. The article's total does not move, and so does not its
 * valuation — exactly what Odoo calls an internal transfer.
 */
productRoutes.post('/:id/transfer', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      from_location: z.string().min(1).max(80),
      to_location: z.string().min(1).max(80),
      quantity: z.coerce.number().min(0.001).max(1_000_000),
      reason: optionalText(200),
    }),
    await c.req.json().catch(() => ({})),
  );

  const product = await c.env.DB
    .prepare(
      `SELECT id, name, track_quantity, lot_tracking, allow_negative_stock
       FROM products WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(id)
    .first<{
      id: string; name: string; track_quantity: number; lot_tracking: string | null;
      allow_negative_stock: number;
    }>();
  if (!product) return fail(404, 'NOT_FOUND');
  if (!Number(product.track_quantity)) {
    return fail(422, 'VALIDATION_ERROR', { track_quantity: 'not_tracked' });
  }
  if (lotTrackingMode(product.lot_tracking) !== 'none') {
    // A lot has one location on its own row: splitting it across shelves is a
    // later problem, and pretending otherwise would break the lot balances.
    return fail(422, 'LOT_TRANSFER_UNSUPPORTED', { product: product.name });
  }

  const balances = await ledgerBalances(c.env.DB, id);
  const quantityMilli = milli(body.quantity);
  const validation = validateTransfer({
    from: body.from_location,
    to: body.to_location,
    quantity_milli: quantityMilli,
    available_milli: balances
      .filter((row) => row.location === body.from_location.trim())
      .reduce((sum, row) => sum + row.quantity_milli, 0),
    allow_negative: Boolean(product.allow_negative_stock),
  });
  if (!validation.ok) {
    return fail(validation.status, validation.code, validation.details);
  }

  const from = body.from_location.trim();
  const to = body.to_location.trim();
  const reference = `TRF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = nowISO();
  const register = (code: string) => c.env.DB.prepare(
    `INSERT INTO stock_locations (id, code, name, is_active, created_at)
     VALUES (?, ?, ?, 1, ?)
     ON CONFLICT(code) DO UPDATE SET is_active = 1`,
  ).bind(crypto.randomUUID(), code, code, now);

  await c.env.DB.batch([
    register(from),
    register(to),
    c.env.DB.prepare(
      `INSERT INTO stock_movements
         (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
       VALUES (?, ?, 'out', ?, 'transfer', ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, quantityMilli, reference, from, user.id, now),
    c.env.DB.prepare(
      `INSERT INTO stock_movements
         (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
       VALUES (?, ?, 'in', ?, 'transfer', ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, quantityMilli, reference, to, user.id, now),
  ]);

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'transferred',
    entityType: 'product',
    entityId: id,
    summary: 'activity.stock_transferred',
    meta: { reference, from, to, quantity: quantityMilli / 1000, reason: body.reason ?? null },
  });

  return c.json({ ok: true, reference, from, to, quantity: quantityMilli / 1000 });
});

/** ------------------------------------------------------- vendor links (C2) */

const vendorLinkSchema = z.object({
  vendor_id: z.string().min(8).max(60),
  price: minorAmount.default(0),
  currency: z.string().trim().length(3).default('XPF'),
  moq: z.coerce.number().min(0).max(1_000_000).default(0),
  lead_time_days: z.coerce.number().int().min(0).max(365).default(0),
  vendor_ref: optionalText(80),
  is_preferred: z.boolean().default(false),
});

async function ensureProduct(database: D1Database, id: string): Promise<boolean> {
  const row = await database
    .prepare(`SELECT id FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string }>();
  return Boolean(row);
}

productRoutes.get('/:id/vendors', requirePermission('products.read'), async (c) => {
  const id = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT pv.*, v.name AS vendor_name
       FROM product_vendors pv JOIN vendors v ON v.id = pv.vendor_id
       WHERE pv.product_id = ? AND v.deleted_at IS NULL
       ORDER BY pv.is_preferred DESC, pv.price ASC, v.name COLLATE NOCASE`,
    )
    .bind(id)
    .all<Record<string, unknown>>();
  // C2: the price ledger travels with the list, so the sheet can show what the
  // supplier quoted before without a second round trip.
  const history = await c.env.DB
    .prepare(
      `SELECT vendor_id, price, currency, recorded_at FROM product_vendor_prices
       WHERE product_id = ? ORDER BY recorded_at DESC`,
    )
    .bind(id)
    .all<{ vendor_id: string; price: number; currency: string; recorded_at: string }>();
  const byVendor = new Map<string, { price: number; currency: string; recorded_at: string }[]>();
  for (const row of history.results ?? []) {
    const list = byVendor.get(row.vendor_id) ?? [];
    if (list.length < 6) list.push({ price: row.price, currency: row.currency, recorded_at: row.recorded_at });
    byVendor.set(row.vendor_id, list);
  }
  const data = (rows.results ?? []).map((row) => ({
    ...row,
    moq: Number(row.moq_milli ?? 0) / 1000,
    is_preferred: Boolean(row.is_preferred),
    history: byVendor.get(String(row.vendor_id)) ?? [],
  }));
  const preferred = preferredLink(data as unknown as VendorLink[]);
  return c.json({ data, preferred_vendor_id: preferred?.vendor_id ?? null });
});

productRoutes.post('/:id/vendors', requirePermission('products.write'), async (c) => {
  const id = c.req.param('id');
  if (!(await ensureProduct(c.env.DB, id))) return fail(404, 'NOT_FOUND');
  const body = parseInput(vendorLinkSchema, await c.req.json().catch(() => ({})));

  const vendor = await c.env.DB
    .prepare(`SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL`)
    .bind(body.vendor_id)
    .first<{ id: string }>();
  if (!vendor) return fail(422, 'VALIDATION_ERROR', { vendor_id: 'not_found' });

  const now = nowISO();
  const existing = await c.env.DB
    .prepare(`SELECT id, price, currency FROM product_vendors WHERE product_id = ? AND vendor_id = ?`)
    .bind(id, body.vendor_id)
    .first<{ id: string; price: number; currency: string }>();
  const linkId = existing?.id ?? crypto.randomUUID();

  const statements: D1PreparedStatement[] = [];
  if (body.is_preferred) {
    statements.push(
      c.env.DB.prepare(`UPDATE product_vendors SET is_preferred = 0, updated_at = ? WHERE product_id = ?`)
        .bind(now, id),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `INSERT INTO product_vendors
         (id, product_id, vendor_id, price, currency, moq_milli, lead_time_days, vendor_ref, is_preferred, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id, vendor_id) DO UPDATE SET
         price = excluded.price, currency = excluded.currency, moq_milli = excluded.moq_milli,
         lead_time_days = excluded.lead_time_days, vendor_ref = excluded.vendor_ref,
         is_preferred = excluded.is_preferred, updated_at = excluded.updated_at`,
    ).bind(
      linkId, id, body.vendor_id, body.price, body.currency, milli(body.moq),
      body.lead_time_days, body.vendor_ref, body.is_preferred ? 1 : 0, now, now,
    ),
  );
  // C2: only a real change enters the ledger — saving the same price twice must
  // not invent a movement, otherwise the history becomes noise.
  if (!existing || existing.price !== body.price || existing.currency !== body.currency) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO product_vendor_prices (id, product_id, vendor_id, price, currency, recorded_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind(crypto.randomUUID(), id, body.vendor_id, body.price, body.currency, now),
    );
  }
  await c.env.DB.batch(statements);

  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'updated',
    entityType: 'product',
    entityId: id,
    summary: 'activity.vendor_linked',
    meta: { vendor_id: body.vendor_id, price: body.price, preferred: body.is_preferred },
  });
  return c.json({ id: linkId }, existing ? 200 : 201);
});

productRoutes.delete('/:id/vendors/:linkId', requirePermission('products.write'), async (c) => {
  const id = c.req.param('id');
  const result = await c.env.DB
    .prepare(`DELETE FROM product_vendors WHERE id = ? AND product_id = ?`)
    .bind(c.req.param('linkId'), id)
    .run();
  if (!result.meta.changes) return fail(404, 'NOT_FOUND');
  return c.json({ ok: true });
});

/** F2: which accounts a family gives its articles by default. */
productRoutes.get('/families/accounts', requirePermission('products.read'), async (c) => {
  const rows = await c.env.DB
    .prepare(`SELECT family, sales_account, purchase_account, stock_account, updated_at FROM family_accounts
              ORDER BY family COLLATE NOCASE`)
    .all();
  const used = await c.env.DB
    .prepare(`SELECT family, COUNT(*) AS count FROM products
               WHERE deleted_at IS NULL AND family IS NOT NULL AND family <> '' GROUP BY family`)
    .all<{ family: string; count: number }>();
  return c.json({ data: rows.results ?? [], families: used.results ?? [] });
});

productRoutes.put('/families/:family/accounts', requirePermission('products.write'), async (c) => {
  const family = decodeURIComponent(c.req.param('family')).trim();
  if (!family || family.length > 80) return fail(422, 'VALIDATION_ERROR', { family: 'invalid' });
  const body = parseInput(
    z.object({
      sales_account: z.string().trim().regex(/^\d{3,8}$/).nullish(),
      purchase_account: z.string().trim().regex(/^\d{3,8}$/).nullish(),
      stock_account: z.string().trim().regex(/^\d{3,8}$/).nullish(),
    }),
    await c.req.json().catch(() => ({})),
  );

  const now = nowISO();
  await c.env.DB.prepare(
    `INSERT INTO family_accounts (family, sales_account, purchase_account, stock_account, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(family) DO UPDATE SET
       sales_account = excluded.sales_account,
       purchase_account = excluded.purchase_account,
       stock_account = excluded.stock_account,
       updated_at = excluded.updated_at`,
  )
    .bind(family, body.sales_account ?? null, body.purchase_account ?? null, body.stock_account ?? null, now, now)
    .run();

  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'updated',
    entityType: 'product_family',
    entityId: family,
    summary: 'activity.family_accounts',
    meta: { sales_account: body.sales_account ?? null, purchase_account: body.purchase_account ?? null },
  });

  return c.json({ ok: true });
});

productRoutes.get('/:id/links', requirePermission('products.read'), async (c) => {
  const id = c.req.param('id');
  if (!(await ensureProduct(c.env.DB, id))) return fail(404, 'NOT_FOUND');

  const rows = await c.env.DB
    .prepare(
      `SELECT pl.product_id, pl.kind, p.id, p.name, p.product_key, p.unit_price, p.quantity_milli, p.track_quantity
         FROM product_links pl JOIN products p ON p.id = pl.linked_id
        WHERE pl.product_id = ? AND p.deleted_at IS NULL
        ORDER BY p.name COLLATE NOCASE`,
    )
    .bind(id)
    .all<Parameters<typeof groupProductLinks>[0][number]>();

  return c.json(groupProductLinks(rows.results ?? []));
});

productRoutes.put('/:id/links', requirePermission('products.write'), async (c) => {
  const id = c.req.param('id');
  if (!(await ensureProduct(c.env.DB, id))) return fail(404, 'NOT_FOUND');

  const body = parseInput(
    z.object({
      substitutes: z.array(z.string().min(1).max(60)).max(50).default([]),
      accessories: z.array(z.string().min(1).max(60)).max(50).default([]),
    }),
    await c.req.json().catch(() => ({})),
  );

  const wanted = [...new Set([...body.substitutes, ...body.accessories])];
  if (wanted.includes(id)) return fail(422, 'VALIDATION_ERROR', { links: 'self' });
  if (wanted.length > 0) {
    const found = await c.env.DB
      .prepare(`SELECT id FROM products WHERE id IN (${wanted.map(() => '?').join(',')}) AND deleted_at IS NULL`)
      .bind(...wanted)
      .all<{ id: string }>();
    const known = new Set((found.results ?? []).map((row) => row.id));
    const missing = wanted.filter((ref) => !known.has(ref));
    if (missing.length > 0) return fail(422, 'VALIDATION_ERROR', { links: 'not_found' });
  }

  const now = nowISO();
  const insert = (kind: 'substitute' | 'accessory', linked: string) =>
    c.env.DB.prepare(
      `INSERT OR IGNORE INTO product_links (id, product_id, linked_id, kind, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(crypto.randomUUID(), id, linked, kind, now);

  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM product_links WHERE product_id = ?`).bind(id),
    ...[...new Set(body.substitutes)].map((linked) => insert('substitute', linked)),
    ...[...new Set(body.accessories)].map((linked) => insert('accessory', linked)),
  ]);

  await logActivity(c.env.DB, {
    userId: c.get('user')!.id,
    action: 'updated',
    entityType: 'product',
    entityId: id,
    summary: 'activity.product_links',
    meta: { substitutes: body.substitutes.length, accessories: body.accessories.length },
  });
  return c.json({ ok: true });
});

productRoutes.get('/:id', requirePermission('products.read'), async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(`SELECT * FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<ProductRow>();
  if (!row) return fail(404, 'NOT_FOUND');

  const canSeeCost = c.get('user')!.permissions.includes('products.cost.read');
  const product = toApi(row, canSeeCost);

  const movements = await c.env.DB.prepare(
    `SELECT m.id, m.product_id, m.kind, m.quantity_milli, m.reason, m.reference, m.unit_cost,
            m.location, m.lot, m.created_at,
            TRIM(COALESCE(u.first_name, '') || ' ' || COALESCE(u.last_name, '')) AS user_name
     FROM stock_movements m
     LEFT JOIN users u ON u.id = m.user_id
     WHERE m.product_id = ? ORDER BY m.created_at DESC LIMIT 50`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  const bom = product.bom as { product_id: string; quantity: number }[];
  const componentIds = [...new Set(bom.map((line) => line.product_id))];
  let components: Record<string, unknown>[] = [];
  if (componentIds.length) {
    const placeholders = componentIds.map(() => '?').join(', ');
    const componentRows = await c.env.DB.prepare(
      `SELECT id, name, product_key, quantity_milli FROM products WHERE id IN (${placeholders})`,
    )
      .bind(...componentIds)
      .all<Record<string, unknown>>();
    components = componentRows.results ?? [];
  }
  const stockMilli: Record<string, number> = {};
  for (const component of components) {
    stockMilli[String(component.id)] = Number(component.quantity_milli ?? 0);
  }

  const valuations = canSeeCost
    ? await c.env.DB.prepare(
      `SELECT id, movement_id, reason, quantity_before_milli, cost_before, inbound_milli, inbound_unit_cost,
              quantity_after_milli, cost_after, value_after, created_at
       FROM stock_valuations WHERE product_id = ? ORDER BY created_at DESC LIMIT 20`,
    ).bind(id).all<Record<string, unknown>>()
    : { results: [] as Record<string, unknown>[] };

  // F2: what the accounts would be once the family default applies. Sent next to
  // the stored value so the sheet can show what it inherits without writing it
  // onto the article — the inheritance stays live until someone overrides it.
  const family = typeof product.family === 'string' ? product.family.trim() : '';
  const familyRow = family
    ? await c.env.DB
      .prepare(`SELECT family, sales_account, purchase_account, stock_account FROM family_accounts WHERE family = ?`)
      .bind(family)
      .first<FamilyAccountRow>()
    : null;
  const effective = resolveFamilyAccounts(product, familyAccountMap(familyRow ? [familyRow] : []));

  return c.json({
    ...product,
    effective_accounts: {
      sales_account: effective.sales_account,
      purchase_account: effective.purchase_account,
      stock_account: effective.stock_account,
    },
    valuations: valuations.results ?? [],
    movements: (movements.results ?? []).map((movement) => ({
      ...movement,
      quantity: Number(movement.quantity_milli ?? 0) / 1000,
      // Movement cost is buying information too.
      unit_cost: canSeeCost ? Number(movement.unit_cost ?? 0) : null,
    })),
    components: components.map((component) => ({
      ...component,
      quantity_milli: Number(component.quantity_milli ?? 0),
    })),
    kit_available: kitAvailability(bom, stockMilli),
  });
});

productRoutes.post('/', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(productSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  if (body.bom.some((line) => line.product_id === id)) {
    return fail(422, 'VALIDATION_ERROR', { bom: 'self_reference' });
  }

  const values = columns(body);
  const now = nowISO();
  const record: Record<string, unknown> = {
    ...values, id, created_by: user.id, updated_by: user.id, revision: 1,
    created_at: now, updated_at: now,
  };
  const names = Object.keys(record);
  await c.env.DB.prepare(
    `INSERT INTO products (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})`,
  )
    .bind(...names.map((name) => record[name]))
    .run();

  // An opening balance is a stock movement like any other: the ledger explains
  // the on-hand figure from the first unit. A service has no stock, so nothing
  // is written for it.
  if (Number(values.quantity_milli) !== 0) {
    await c.env.DB.prepare(
      `INSERT INTO stock_movements (id, product_id, kind, quantity_milli, reason, location, user_id, created_at)
       VALUES (?, ?, 'in', ?, 'opening_balance', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), id, Number(values.quantity_milli), body.warehouse_location, user.id, now)
      .run();
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'product',
    entityId: id,
    summary: 'activity.product_created',
    meta: { name: body.name },
  });
  return c.json({ id }, 201);
});

productRoutes.patch('/:id', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(productSchema, await c.req.json().catch(() => ({})));
  if (body.bom.some((line) => line.product_id === id)) {
    return fail(422, 'VALIDATION_ERROR', { bom: 'self_reference' });
  }
  const existing = await c.env.DB.prepare(
    `SELECT id, quantity_milli, revision FROM products WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; quantity_milli: number; revision: number }>();
  if (!existing) return fail(404, 'NOT_FOUND');

  const values = columns(body);
  const names = Object.keys(values);

  // A quantity typed in the sheet is still a stock change: record the difference
  // instead of silently overwriting the counter. While a count is open on this
  // item the figure is frozen, otherwise the person counting would adjust the
  // books under the sheet they are filling in.
  const delta = Number(values.quantity_milli) - Number(existing.quantity_milli ?? 0);
  if (delta !== 0) {
    const counting = await openCountReference(c.env.DB, [id]);
    if (counting) return fail(409, 'STOCK_COUNT_IN_PROGRESS', { reference: counting });
  }

  await c.env.DB.prepare(
    `UPDATE products SET ${names.map((name) => `${name} = ?`).join(', ')},
       updated_by = ?, revision = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      ...names.map((name) => (values as Record<string, unknown>)[name]),
      user.id, Number(existing.revision ?? 1) + 1, nowISO(), id,
    )
    .run();

  if (delta !== 0) {
    await c.env.DB.prepare(
      `INSERT INTO stock_movements (id, product_id, kind, quantity_milli, reason, location, user_id, created_at)
       VALUES (?, ?, 'adjust', ?, 'sheet_edit', ?, ?, ?)`,
    )
      .bind(crypto.randomUUID(), id, delta, body.warehouse_location, user.id, nowISO())
      .run();
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'product',
    entityId: id,
    summary: 'activity.product_updated',
    meta: { name: body.name },
  });
  return c.json({ ok: true });
});

productRoutes.delete('/:id', requirePermission('products.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  return c.json({ ok: true });
});

/** Every manual stock change is a ledger entry with a reason, never a naked
 * counter update: that is what makes the on-hand figure auditable. */
productRoutes.post('/:id/adjust-stock', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      delta: z.coerce.number().min(-100_000).max(100_000),
      reason: optionalText(200),
      kind: z.enum(['in', 'out', 'adjust', 'transfer']).default('adjust'),
      location: optionalText(80),
      lot: optionalText(60),
      unit_cost: minorAmount.default(0),
    }),
    await c.req.json().catch(() => ({})),
  );
  const product = await c.env.DB.prepare(
    `SELECT quantity_milli, cost, reorder_point_milli, safety_stock_milli, max_stock_milli, moq_milli,
            order_multiple_milli, track_quantity, lot_tracking, warehouse_location
     FROM products WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<ProductRow>();
  if (!product) return fail(404, 'NOT_FOUND');

  const counting = await openCountReference(c.env.DB, [id]);
  if (counting) return fail(409, 'STOCK_COUNT_IN_PROGRESS', { reference: counting });

  const deltaMilli = milli(body.delta);
  const next = Math.max(0, Number(product.quantity_milli ?? 0) + deltaMilli);
  const now = nowISO();
  const movementId = crypto.randomUUID();

  // An inbound adjustment with a stated cost re-prices the stock, exactly like a
  // reception: otherwise the average would quietly drift away from reality.
  const valuation = deltaMilli > 0 && Number(body.unit_cost) > 0
    ? weightedAverageCost({
      quantity_milli: Number(product.quantity_milli ?? 0),
      cost: Number(product.cost ?? 0),
      inbound_milli: deltaMilli,
      inbound_unit_cost: Number(body.unit_cost),
    })
    : null;

  const statements: D1PreparedStatement[] = [
    valuation
      ? c.env.DB.prepare(`UPDATE products SET quantity_milli = ?, cost = ?, updated_at = ? WHERE id = ?`)
        .bind(next, valuation.cost, now, id)
      : c.env.DB.prepare(`UPDATE products SET quantity_milli = ?, updated_at = ? WHERE id = ?`)
        .bind(next, now, id),
    c.env.DB.prepare(
      `INSERT INTO stock_movements (id, product_id, kind, quantity_milli, reason, location, lot, unit_cost, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      movementId, id, body.kind, deltaMilli, body.reason, body.location,
      normaliseLotCode(body.lot), body.unit_cost, user.id, now,
    ),
  ];
  if (valuation) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stock_valuations
           (id, product_id, movement_id, reason, quantity_before_milli, cost_before,
            inbound_milli, inbound_unit_cost, quantity_after_milli, cost_after, value_after, created_at)
         VALUES (?, ?, ?, 'manual_adjustment', ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(), id, movementId, Number(product.quantity_milli ?? 0),
        Number(product.cost ?? 0), deltaMilli, Number(body.unit_cost),
        valuation.quantity_after_milli, valuation.cost, valuation.value_after, now,
      ),
    );
  }
  // B2: a batch-tracked article only moves through a named lot. Letting a stock
  // change stay lot-less would break "on hand = sum of lots" with no error to
  // point at later.
  const lotCode = normaliseLotCode(body.lot);
  if (lotTrackingMode(product.lot_tracking) !== 'none') {
    if (!lotCode) return fail(422, 'VALIDATION_ERROR', { lot: 'required' });
    if (deltaMilli > 0) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO stock_lots (id, product_id, lot_code, expiry_date, location, quantity_milli, created_at, updated_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?)
           ON CONFLICT(product_id, lot_code) DO UPDATE SET
             quantity_milli = stock_lots.quantity_milli + excluded.quantity_milli,
             updated_at = excluded.updated_at`,
        ).bind(
          crypto.randomUUID(), id, lotCode, body.location ?? product.warehouse_location ?? null,
          deltaMilli, now, now,
        ),
      );
    } else if (deltaMilli < 0) {
      const lot = await c.env.DB.prepare(`SELECT id FROM stock_lots WHERE product_id = ? AND lot_code = ?`)
        .bind(id, lotCode)
        .first<{ id: string }>();
      if (!lot) return fail(422, 'VALIDATION_ERROR', { lot: 'unknown' });
      statements.push(
        c.env.DB.prepare(`UPDATE stock_lots SET quantity_milli = MAX(0, quantity_milli + ?), updated_at = ? WHERE id = ?`)
          .bind(deltaMilli, now, lot.id),
      );
    }
  }

  await c.env.DB.batch(statements);

  const updated = { ...product, quantity_milli: next };
  return c.json({
    quantity: units(next),
    quantity_milli: next,
    stock_alert: stockAlert(updated),
    suggested_reorder: units(suggestedReorder(updated)),
  });
});

const assemblySchema = z.object({
  quantity: z.coerce.number().min(0.001).max(100_000),
  reference: optionalText(60),
});

/** An assembly moves the kit and every component, so a count freezes the whole
 * family rather than the kit alone. */
async function assemblyProductIds(database: D1Database, id: string): Promise<string[]> {
  const row = await database
    .prepare(`SELECT bom FROM products WHERE id = ?`)
    .bind(id)
    .first<{ bom: string | null }>();
  let components: { product_id?: string }[] = [];
  try {
    components = JSON.parse(row?.bom ?? '[]') as { product_id?: string }[];
  } catch {
    components = [];
  }
  return [
    id,
    ...components.map((component) => component.product_id).filter((value): value is string => Boolean(value)),
  ];
}

/** Assembly is a physical act: components must be there, and an on-order kit is
 * a sales presentation (its components are picked on the invoice), not a stock
 * item to build in advance. */
productRoutes.post('/:id/assemble', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(assemblySchema, await c.req.json().catch(() => ({})));
  const counting = await openCountReference(c.env.DB, await assemblyProductIds(c.env.DB, id));
  if (counting) return fail(409, 'STOCK_COUNT_IN_PROGRESS', { reference: counting });
  const result = await assembleKit(c.env.DB, {
    productId: id,
    quantityMilli: milli(body.quantity),
    reference: body.reference,
    userId: user.id,
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'assembled',
    entityType: 'product',
    entityId: id,
    summary: 'activity.kit_assembled',
    meta: { quantity: body.quantity, reference: result.reference },
  });

  return c.json({ ok: true, ...result });
});

productRoutes.post('/:id/disassemble', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(assemblySchema, await c.req.json().catch(() => ({})));
  const counting = await openCountReference(c.env.DB, await assemblyProductIds(c.env.DB, id));
  if (counting) return fail(409, 'STOCK_COUNT_IN_PROGRESS', { reference: counting });
  const result = await disassembleKit(c.env.DB, {
    productId: id,
    quantityMilli: milli(body.quantity),
    reference: body.reference,
    userId: user.id,
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'disassembled',
    entityType: 'product',
    entityId: id,
    summary: 'activity.kit_disassembled',
    meta: { quantity: body.quantity, reference: result.reference },
  });

  return c.json({ ok: true, ...result });
});
