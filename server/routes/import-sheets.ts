import { Hono } from 'hono';
import { z } from 'zod';
import { CURRENCIES } from '../../shared/domain';
import { ALLOCATION_KEYS, computeImportSheet, type ImportSheetLineResult } from '../../shared/import-sheet';
import {
  IMPORT_TRANSPORTS,
  tariffDutyRate,
  type ImportTaxRule,
  type TariffRow,
} from '../../shared/import-taxes';
import { DEFAULT_VAT_RATE_BP } from '../../shared/landed-cost';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { importVatLines } from '../lib/import-vat';
import { getAccountCodes } from '../lib/settings-extra';
import { minorAmount, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { postJournalEntry } from '../services/accounting';
import type { AppEnv } from '../types';

/**
 * Q8 — the import declaration as a whole.
 *
 * A container carries several articles, but the freight, the transport insurance
 * and the customs broker invoice are paid once. The sheet splits them across the
 * lines with the largest-remainder method and computes duty, local taxes and import
 * VAT **per line**, because each article has its own heading, weight and unit count.
 * The split is stored line by line: a cost defended before the customs office needs
 * the arithmetic, not just its result.
 */
export const importSheetRoutes = new Hono<AppEnv>();
importSheetRoutes.use('*', requireAuth);

const ORIGINS = ['standard', 'eu', 'oceania'] as const;

const sheetLineSchema = z.object({
  product_id: z.string().min(1).max(64),
  quantity: z.coerce.number().min(0.001).max(1_000_000),
  /** Invoice value of the line, in the sheet currency's minor units. */
  goods_amount: minorAmount,
  duty_rate_bp: z.coerce.number().int().min(0).max(10_000).default(0),
  weight_kg: z.coerce.number().min(0).max(1_000_000).default(0),
  units: z.coerce.number().int().min(0).max(100_000).default(0),
});

const sheetSchema = z.object({
  reference: z.string().trim().max(60).optional(),
  currency: z.enum(CURRENCIES).default('XPF'),
  exchange_rate_micro: z.coerce.number().int().min(1).max(1_000_000_000).default(1_000_000),
  /** What the shared costs are split by: the invoice value, the weight or the quantity. */
  split_key: z.enum(ALLOCATION_KEYS).default('value'),
  freight: minorAmount.default(0),
  insurance: minorAmount.default(0),
  fixed_fees: minorAmount.default(0),
  /** Fallback duty rate for the lines whose article has no tariff heading. */
  duty_rate_bp: z.coerce.number().int().min(0).max(10_000).default(0),
  vat_rate_bp: z.coerce.number().int().min(0).max(10_000).default(DEFAULT_VAT_RATE_BP),
  vat_recoverable: z.boolean().default(true),
  vat_settlement: z.enum(['supplier', 'bank']).default('supplier'),
  transport: z.enum(IMPORT_TRANSPORTS).default('sea'),
  origin: z.enum(ORIGINS).default('standard'),
  declaration_date: z.string().max(10).optional(),
  lines: z.array(sheetLineSchema).min(1).max(50),
});

/** The sheets themselves are cost information: masked when the cost is masked. */
importSheetRoutes.get('/', requirePermission('products.read'), async (c) => {
  if (!c.get('user')!.permissions.includes('products.cost.read')) {
    return c.json({ data: [] });
  }
  const rows = await c.env.DB.prepare(
    `SELECT s.*, (SELECT COUNT(*) FROM import_sheet_lines l WHERE l.sheet_id = s.id) AS line_count
       FROM import_sheets s ORDER BY s.created_at DESC LIMIT 30`,
  ).all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((row) => ({
      ...row,
      vat_recoverable: Boolean(row.vat_recoverable),
      line_count: Number(row.line_count ?? 0),
    })),
  });
});

importSheetRoutes.get('/:id', requirePermission('products.read'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const sheet = await c.env.DB.prepare(`SELECT * FROM import_sheets WHERE id = ?`).bind(id).first<Record<string, unknown>>();
  if (!sheet) return fail(404, 'NOT_FOUND');
  if (!user.permissions.includes('products.cost.read')) {
    return c.json({ ...sheet, vat_recoverable: Boolean(sheet.vat_recoverable), lines: [] });
  }
  const lines = await c.env.DB.prepare(
    `SELECT l.*, p.name AS product_name
       FROM import_sheet_lines l LEFT JOIN products p ON p.id = l.product_id
      WHERE l.sheet_id = ? ORDER BY l.rowid ASC`,
  ).bind(id).all<Record<string, unknown>>();
  return c.json({
    ...sheet,
    vat_recoverable: Boolean(sheet.vat_recoverable),
    lines: (lines.results ?? []).map((line) => ({
      ...line,
      quantity: Number(line.quantity_milli ?? 0) / 1000,
      tax_lines: JSON.parse(String(line.tax_lines ?? '[]')),
    })),
  });
});

importSheetRoutes.post('/', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  // A cost computed where the cost is masked would be a blind write (D4).
  if (!user.permissions.includes('products.cost.read')) return fail(403, 'FORBIDDEN');

  const body = parseInput(sheetSchema, await c.req.json().catch(() => ({})));
  const emptyLine = body.lines.findIndex((line) => Number(line.goods_amount) <= 0);
  if (emptyLine >= 0) return fail(422, 'VALIDATION_ERROR', { [`lines.${emptyLine}.goods_amount`]: 'required' });

  const ids = [...new Set(body.lines.map((line) => line.product_id))];
  const placeholders = ids.map(() => '?').join(', ');
  const products = (await c.env.DB.prepare(
    `SELECT id, name, customs_code FROM products WHERE id IN (${placeholders}) AND deleted_at IS NULL`,
  ).bind(...ids).all<{ id: string; name: string; customs_code: string | null }>()).results ?? [];
  const byId = new Map(products.map((product) => [product.id, product]));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length) return fail(422, 'VALIDATION_ERROR', { product_id: unknown[0] });

  // Q6: the heading of each article decides its duty rate; the rate typed on the
  // line stays the fallback for an article without a heading.
  const codes = [...new Set(products.map((product) => product.customs_code).filter(Boolean))] as string[];
  const tariffs = codes.length
    ? (await c.env.DB.prepare(
      `SELECT code, duty_rate_bp, duty_rate_eu_bp, duty_rate_oceania_bp FROM tariff_codes
        WHERE code IN (${codes.map(() => '?').join(', ')}) AND is_active = 1`,
    ).bind(...codes).all<TariffRow>()).results ?? []
    : [];
  const tariffByCode = new Map(tariffs.map((row) => [row.code, row]));

  const taxRules = (await c.env.DB.prepare(
    `SELECT code, label, base, rate_bp, amount, transport, sort_order, is_active, valid_from, valid_to
       FROM import_tax_rules`,
  ).all<ImportTaxRule>()).results ?? [];

  const currency = body.currency;
  const exchangeRateMicro = currency === 'XPF' ? 1_000_000 : body.exchange_rate_micro;
  const declarationDate = body.declaration_date ?? nowISO().slice(0, 10);

  const rates = body.lines.map((line) => {
    const product = byId.get(line.product_id)!;
    const tariffRow = product.customs_code ? tariffByCode.get(product.customs_code) ?? null : null;
    return tariffDutyRate(tariffRow, body.origin) ?? body.duty_rate_bp;
  });

  const computed = computeImportSheet({
    currency,
    exchange_rate_micro: exchangeRateMicro,
    key: body.split_key,
    freight: Number(body.freight),
    insurance: Number(body.insurance),
    fixed_fees: Number(body.fixed_fees),
    vat_rate_bp: body.vat_rate_bp,
    vat_recoverable: body.vat_recoverable,
    transport: body.transport,
    date: declarationDate,
    tax_rules: taxRules,
    lines: body.lines.map((line, index) => ({
      product_id: line.product_id,
      product_name: byId.get(line.product_id)?.name ?? '',
      quantity_milli: Math.round(Number(line.quantity) * 1000),
      goods_amount: Number(line.goods_amount),
      duty_rate_bp: rates[index],
      weight_g: Math.round(Number(line.weight_kg) * 1000),
      units: line.units,
    })),
  });

  const sheetId = crypto.randomUUID();
  const now = nowISO();
  const reference = body.reference?.trim() || `IS-${sheetId.slice(0, 8).toUpperCase()}`;
  const statements = [
    c.env.DB.prepare(
      `INSERT INTO import_sheets
         (id, reference, currency, exchange_rate_micro, split_key, freight, insurance, fixed_fees,
          duty_rate_bp, vat_rate_bp, vat_recoverable, vat_settlement, transport, origin, declaration_date,
          goods_total, customs_value_total, duty_total, taxes_total, vat_total, total_in_cost, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      sheetId, reference, currency, exchangeRateMicro, body.split_key,
      computed.totals.freight, computed.totals.insurance, computed.totals.fixed_fees,
      body.duty_rate_bp, body.vat_rate_bp, body.vat_recoverable ? 1 : 0, body.vat_settlement,
      body.transport, body.origin, declarationDate,
      computed.totals.goods, computed.totals.customs_value, computed.totals.duty,
      computed.totals.taxes_total, computed.totals.vat, computed.totals.total_in_cost, user.id, now,
    ),
    ...computed.lines.map((line: ImportSheetLineResult, index: number) => c.env.DB.prepare(
      `INSERT INTO import_sheet_lines
         (id, sheet_id, product_id, quantity_milli, goods_amount, duty_rate_bp, weight_g, units,
          freight, insurance, fixed_fees, customs_value, duty, taxes_total, tax_lines, vat,
          total_in_cost, unit_cost, share_bp, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), sheetId, line.product_id, line.quantity_milli, line.goods,
      rates[index], Math.round(Number(body.lines[index].weight_kg) * 1000), body.lines[index].units,
      line.freight, line.insurance, line.fixed_fees, line.customs_value, line.duty,
      line.taxes_total, JSON.stringify(line.tax_lines), line.vat, line.total_in_cost,
      line.unit_cost, line.share_bp, now,
    )),
    ...computed.lines.map((line) => c.env.DB.prepare(
      `UPDATE products SET landed_cost = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(line.unit_cost, user.id, now, line.product_id)),
  ];
  await c.env.DB.batch(statements);

  // Q1: one entry for the declaration, like the customs office issues one.
  const vatLines = importVatLines({
    vat: computed.totals.vat,
    recoverable: body.vat_recoverable,
    settlement: body.vat_settlement,
    productName: reference,
    reference,
    accounts: await getAccountCodes(c.env.DB),
  });
  if (vatLines.length) {
    await postJournalEntry(c.env.DB, {
      sourceType: 'landed_cost',
      sourceId: sheetId,
      event: 'import_vat',
      date: declarationDate,
      reference,
      label: `TVA à l’import ${reference}`,
      journal: 'AC',
      lines: vatLines,
    });
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'import_sheet',
    entityId: sheetId,
    summary: 'activity.import_sheet_computed',
    meta: {
      reference,
      lines: computed.lines.length,
      split_key: body.split_key,
      total_in_cost: computed.totals.total_in_cost,
    },
  });

  return c.json({
    id: sheetId,
    reference,
    vat_posted: vatLines.length > 0,
    ...computed,
    lines: computed.lines.map((line) => ({ ...line, quantity: line.quantity_milli / 1000 })),
  }, 201);
});
