import { searchTerm } from '../lib/search';
import { Hono } from 'hono';
import { lastDailyRun } from '../services/daily-run';
import { loadStockAlerts } from '../services/stock-alerts';
import { alertCounts } from '../lib/stock-alerting';
import { addMonths, monthStart, todayIn } from '../lib/dates';
import { logActivity } from '../lib/audit';
import { integrityReport } from '../lib/integrity';
import { stockBalance } from '../lib/stock-balance';
import { csvResponse } from '../lib/csv';
import { fail } from '../lib/errors';
import {
  baseAmountSql,
  baseBalanceSql,
  mergeRevenue,
  mergeTvaRecap,
  revenueCsv,
  tvaRecapCsv,
  tvaRecapTotals,
  type ExemptRow,
  type TaxRow,
} from '../lib/reports';
import type { Permission } from '../../shared/domain';
import { requireAuth, requirePermission } from '../middleware';
import { ensureCreditTaxLines, ensureInvoiceTaxLines } from '../services/documents';
import {
  aggregateMargin,
  marginSummary,
  type CostLookup,
  type MarginDocument,
  type MarginGroup,
  type MarginSourceLine,
} from '../lib/margin';
import type { AppEnv } from '../types';
import { contractNotices, type NoticeContract } from '../lib/contracts';

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use('*', requireAuth);

interface MarginDocumentRow {
  id: string;
  date: string;
  discount_type: string | null;
  discount_value: number | null;
  line_items: string | null;
}

function toMarginDocument(row: MarginDocumentRow, kind: 'invoice' | 'credit'): MarginDocument {
  let lines: MarginSourceLine[] = [];
  try {
    const parsed = row.line_items ? JSON.parse(row.line_items) : [];
    if (Array.isArray(parsed)) lines = parsed as MarginSourceLine[];
  } catch {
    lines = [];
  }
  return {
    id: String(row.id),
    date: String(row.date),
    kind,
    discount_type: row.discount_type === 'amount' ? 'amount' : 'percent',
    discount_value: Number(row.discount_value ?? 0),
    lines,
  };
}

function monthRange(reference: string, offset: number): { start: string; end: string; key: string } {
  const start = addMonths(monthStart(reference), offset);
  const next = addMonths(start, 1);
  return { start, end: next, key: start.slice(0, 7) };
}

dashboardRoutes.get('/', requirePermission('reports.read'), async (c) => {
  const company = c.get('company')!;
  const today = todayIn(company.timezone);
  const current = monthRange(today, 0);
  const previous = monthRange(today, -1);
  const db = c.env.DB;

  const scalarQuery = async (sql: string, binds: (string | number)[] = []) => {
    const row = await db.prepare(sql).bind(...binds).first<{ value: number }>();
    return row?.value ?? 0;
  };

  const [
    invoicedMonth,
    collectedMonth,
    invoicedPrev,
    collectedPrev,
    outstanding,
    overdue,
    expensesMonth,
    clientsCount,
    openInvoices,
  ] = await Promise.all([
    scalarQuery(`SELECT COALESCE(SUM(${baseAmountSql('total', 'total_xpf')}),0) AS value FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date < ?`, [current.start, current.end]),
    scalarQuery(`SELECT COALESCE(SUM(${baseAmountSql('amount', 'amount_xpf')}),0) AS value FROM payments WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date < ?`, [current.start, current.end]),
    scalarQuery(`SELECT COALESCE(SUM(${baseAmountSql('total', 'total_xpf')}),0) AS value FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date < ?`, [previous.start, previous.end]),
    scalarQuery(`SELECT COALESCE(SUM(${baseAmountSql('amount', 'amount_xpf')}),0) AS value FROM payments WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date < ?`, [previous.start, previous.end]),
    scalarQuery(`SELECT COALESCE(SUM(${baseBalanceSql('balance', 'total', 'total_xpf')}),0) AS value FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial')`),
    scalarQuery(`SELECT COALESCE(SUM(${baseBalanceSql('balance', 'total', 'total_xpf')}),0) AS value FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial') AND due_date IS NOT NULL AND due_date < ?`, [today]),
    scalarQuery(`SELECT COALESCE(SUM(amount),0) AS value FROM expenses WHERE deleted_at IS NULL AND date >= ? AND date < ?`, [current.start, current.end]),
    scalarQuery(`SELECT COUNT(*) AS value FROM clients WHERE deleted_at IS NULL`),
    scalarQuery(`SELECT COUNT(*) AS value FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial')`),
  ]);

  const months = [5, 4, 3, 2, 1, 0].map((offset) => monthRange(today, -offset));
  const seriesStart = months[0].start;
  const seriesEnd = months[months.length - 1].end;

  const [invoiceSeries, paymentSeries, expenseSeries] = await Promise.all([
    db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(${baseAmountSql('total', 'total_xpf')}) AS value FROM invoices
      WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date < ? GROUP BY bucket`)
      .bind(seriesStart, seriesEnd).all<{ bucket: string; value: number }>(),
    db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(${baseAmountSql('amount', 'amount_xpf')}) AS value FROM payments
      WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date < ? GROUP BY bucket`)
      .bind(seriesStart, seriesEnd).all<{ bucket: string; value: number }>(),
    db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(amount) AS value FROM expenses
      WHERE deleted_at IS NULL AND date >= ? AND date < ? GROUP BY bucket`)
      .bind(seriesStart, seriesEnd).all<{ bucket: string; value: number }>(),
  ]);

  const mapSeries = (rows: { bucket: string; value: number }[]) =>
    Object.fromEntries((rows ?? []).map((row) => [row.bucket, row.value]));

  const invoiceMap = mapSeries(invoiceSeries.results ?? []);
  const paymentMap = mapSeries(paymentSeries.results ?? []);
  const expenseMap = mapSeries(expenseSeries.results ?? []);

  const [recentInvoices, topClients, activities, upcoming] = await Promise.all([
    db.prepare(`SELECT i.id, i.number, i.date, i.total, i.balance, i.status, c.display_name AS client_name
      FROM invoices i JOIN clients c ON c.id = i.client_id WHERE i.deleted_at IS NULL
      ORDER BY i.created_at DESC LIMIT 6`).all(),
    db.prepare(`SELECT c.id, c.display_name AS client_name, COALESCE(SUM(${baseBalanceSql('i.paid_total', 'i.total', 'i.total_xpf')}),0) AS revenue
      FROM clients c JOIN invoices i ON i.client_id = c.id AND i.deleted_at IS NULL
      WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY revenue DESC LIMIT 5`).all(),
    db.prepare(`SELECT a.id, a.summary, a.entity_type, a.created_at, a.meta, u.first_name, u.last_name
      FROM activities a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 8`).all(),
    db.prepare(`SELECT id, number, due_date, balance FROM invoices
      WHERE deleted_at IS NULL AND status IN ('sent','partial') AND due_date IS NOT NULL
      ORDER BY due_date ASC LIMIT 5`).all(),
  ]);

  // Each role gets its own dashboard, and the shaping happens here as well as in
  // the interface: the activity journal and the automation status are control
  // evidence reserved for accounts holding `activity.read`. A sales or read-only
  // account must not receive them just because the endpoint is shared.
  const permissions = c.get('user')!.permissions;
  const canRead = (permission: Permission) => permissions.includes(permission);
  const internal = canRead('activity.read');

  // C4: the alerts are the article thresholds read back, not a second rule.
  const stockAlerts = await loadStockAlerts(db);
  const alertSummary = alertCounts(stockAlerts);

    // E4: a notice period is a deadline, so it belongs with the alerts a manager
  // already reads every morning.
  const noticeRows = await c.env.DB.prepare(
    `SELECT r.id, c.display_name AS client_name, r.end_date, r.notice_days, r.renewal_mode, r.status
       FROM recurring_invoices r JOIN clients c ON c.id = r.client_id
      WHERE r.deleted_at IS NULL AND r.end_date IS NOT NULL`,
  ).all<NoticeContract>();
  const notices = contractNotices(noticeRows.results ?? [], todayIn(company.timezone));

return c.json({
    contract_notices: { count: notices.length, top: notices.slice(0, 5) },
    today,
    stock_alerts: {
      out: alertSummary.out,
      low: alertSummary.low,
      suggested_milli: alertSummary.suggested_milli,
      top: stockAlerts.slice(0, 5),
    },
    // T-104c: the dashboard says when the pass last ran, not only what it produced.
    last_run: internal ? await lastDailyRun(db) : null,
    kpis: {
      invoiced_month: invoicedMonth,
      collected_month: collectedMonth,
      invoiced_previous: invoicedPrev,
      collected_previous: collectedPrev,
      outstanding,
      overdue,
      expenses_month: expensesMonth,
      clients: clientsCount,
      open_invoices: openInvoices,
    },
    series: months.map((month) => ({
      key: month.key,
      start: month.start,
      invoiced: invoiceMap[month.key] ?? 0,
      collected: paymentMap[month.key] ?? 0,
      expenses: expenseMap[month.key] ?? 0,
    })),
    recent_invoices: recentInvoices.results ?? [],
    top_clients: canRead('clients.read') ? (topClients.results ?? []) : [],
    activities: internal ? (activities.results ?? []) : [],
    upcoming: upcoming.results ?? [],
  });
});

export const reportRoutes = new Hono<AppEnv>();
reportRoutes.use('*', requireAuth);

/**
 * T-207: the two local outputs a Polynesian business has to produce — a monthly
 * VAT recap and a monthly turnover statement. Both read the same figures as the
 * invoices (tax mirror + totals), so no figure is re-keyed.
 */
export async function tvaRecapData(db: D1Database, from: string, to: string) {
  await ensureInvoiceTaxLines(db, from, to);
  await ensureCreditTaxLines(db, from, to);
  const [tax, exempt] = await Promise.all([
    db
      .prepare(
        `SELECT substr(i.date,1,7) AS period, l.rate AS rate, SUM(l.base) AS base,
                SUM(l.amount) AS tax, COUNT(DISTINCT l.invoice_id) AS documents
         FROM invoice_tax_lines l JOIN invoices i ON i.id = l.invoice_id
         WHERE i.deleted_at IS NULL AND i.status <> 'cancelled' AND i.date >= ? AND i.date <= ?
         GROUP BY period, rate`,
      )
      .bind(from, to)
      .all<TaxRow>(),
    db
      .prepare(
        `SELECT substr(date,1,7) AS period, SUM(subtotal - discount_total) AS exempt_base,
                COUNT(*) AS documents
         FROM invoices
         WHERE deleted_at IS NULL AND status <> 'cancelled' AND tax_exempt = 1
           AND date >= ? AND date <= ?
         GROUP BY period`,
      )
      .bind(from, to)
      .all<ExemptRow>(),
  ]);
  // A-04: a credit note reverses the VAT it collected. Its mirror is subtracted
  // here, and only for issued credits — a draft reverses nothing yet.
  const [creditTax, creditExempt] = await Promise.all([
    db
      .prepare(
        `SELECT substr(cr.date,1,7) AS period, cl.rate AS rate, -SUM(cl.base) AS base,
                -SUM(cl.amount) AS tax, 0 AS documents
         FROM credit_tax_lines cl JOIN credits cr ON cr.id = cl.credit_id
         WHERE cr.deleted_at IS NULL AND cr.status IN ('sent','partial','applied')
           AND cr.date >= ? AND cr.date <= ?
         GROUP BY period, rate`,
      )
      .bind(from, to)
      .all<TaxRow>(),
    db
      .prepare(
        `SELECT substr(cr.date,1,7) AS period, -SUM(cr.subtotal - cr.discount_total) AS exempt_base,
                0 AS documents
         FROM credits cr
         WHERE cr.deleted_at IS NULL AND cr.status IN ('sent','partial','applied') AND cr.tax_exempt = 1
           AND cr.date >= ? AND cr.date <= ?
         GROUP BY period`,
      )
      .bind(from, to)
      .all<ExemptRow>(),
  ]);
  const periods = mergeTvaRecap(
    [...(tax.results ?? []), ...(creditTax.results ?? [])],
    [...(exempt.results ?? []), ...(creditExempt.results ?? [])],
  );
  return { periods, totals: tvaRecapTotals(periods) };
}

async function revenueData(db: D1Database, from: string, to: string) {
  const [invoices, payments] = await Promise.all([
    db
      .prepare(
        `SELECT substr(date,1,7) AS period,
                SUM(CASE WHEN tax_exempt = 0 THEN ${baseAmountSql('total', 'total_xpf')} END) AS taxable_xpf,
                SUM(CASE WHEN tax_exempt = 1 THEN ${baseAmountSql('total', 'total_xpf')} END) AS exempt_xpf,
                SUM(${baseAmountSql('total', 'total_xpf')}) AS total_xpf, COUNT(*) AS documents
         FROM invoices
         WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date <= ?
         GROUP BY period`,
      )
      .bind(from, to)
      .all<{ period: string; taxable_xpf: number; exempt_xpf: number; total_xpf: number; documents: number }>(),
    db
      .prepare(
        `SELECT substr(date,1,7) AS period, SUM(${baseAmountSql('amount', 'amount_xpf')}) AS collected_xpf
         FROM payments WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date <= ?
         GROUP BY period`,
      )
      .bind(from, to)
      .all<{ period: string; collected_xpf: number }>(),
  ]);
  return mergeRevenue(invoices.results ?? [], payments.results ?? []);
}

function reportWindow(c: { req: { query: (name: string) => string | undefined }; get: (key: 'company') => { timezone: string } | null }) {
  const company = c.get('company')!;
  const today = todayIn(company.timezone);
  return {
    from: c.req.query('from') ?? addMonths(monthStart(today), -11),
    to: c.req.query('to') ?? today,
  };
}

/** In-app CSV export (owner-usable, no command line), journalled like any export. */
reportRoutes.get('/export/:type', requirePermission('reports.read'), async (c) => {
  const type = c.req.param('type');
  const { from, to } = reportWindow(c);
  const user = c.get('user')!;

  let body: string;
  let rows: number;
  let filename: string;
  if (type === 'tva-recap') {
    const { periods } = await tvaRecapData(c.env.DB, from, to);
    body = tvaRecapCsv(periods);
    rows = periods.length;
    filename = `managest-recap-tva-${from}-${to}.csv`;
  } else if (type === 'revenue-summary') {
    const periods = await revenueData(c.env.DB, from, to);
    body = revenueCsv(periods);
    rows = periods.length;
    filename = `managest-chiffre-affaires-${from}-${to}.csv`;
  } else {
    return fail(404, 'NOT_FOUND');
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'exported',
    entityType: 'report',
    entityId: type,
    summary: 'activity.data_exported',
    meta: { entity: type, rows },
  });
  return csvResponse(body, filename);
});

reportRoutes.get('/tva-recap', requirePermission('reports.read'), async (c) => {
  const { from, to } = reportWindow(c);
  const { periods, totals } = await tvaRecapData(c.env.DB, from, to);
  return c.json({ rows: periods, summary: totals });
});

reportRoutes.get('/revenue-summary', requirePermission('reports.read'), async (c) => {
  const { from, to } = reportWindow(c);
  const periods = await revenueData(c.env.DB, from, to);
  return c.json({
    rows: periods,
    summary: {
      taxable_xpf: periods.reduce((sum, row) => sum + row.taxable_xpf, 0),
      exempt_xpf: periods.reduce((sum, row) => sum + row.exempt_xpf, 0),
      total_xpf: periods.reduce((sum, row) => sum + row.total_xpf, 0),
      collected_xpf: periods.reduce((sum, row) => sum + row.collected_xpf, 0),
    },
  });
});

/**
 * Revenue and margin by family, axis or item (F3).
 *
 * Revenue is read exclusive of VAT and at invoice date, credit notes are
 * subtracted with the cost of the goods they take back, and the cost comes from
 * the product's current average (B3). Lines that cannot be costed leave the
 * margin null rather than pretending to a 100 % margin — the response says how
 * many, and the cost itself stays behind the accounting permission.
 */
/** The full alert list (C4): the dashboard card shows five, the buyer needs all
 * of them — a truncated list is how an article stays out of stock for a month. */
/**
 * A-12: referential integrity card. A non-zero total names the relation and a
 * few offending ids, so the gap is actionable instead of merely alarming.
 */
/**
 * A-14: stock reconciliation. Only the articles whose cache or shelf ledger
 * disagrees with the movements are returned, with both gaps, so the report is a
 * to-do list rather than a wall of correct rows.
 */
dashboardRoutes.get('/stock-balance', requirePermission('reports.read'), async (c) => {
  const report = await stockBalance(c.env.DB);
  return c.json({ total: report.total, gaps: report.gaps, rows: report.rows.length });
});

dashboardRoutes.get('/integrity', requirePermission('reports.read'), async (c) => {
  const report = await integrityReport(c.env.DB);
  return c.json(report);
});

dashboardRoutes.get('/stock-alerts', requirePermission('reports.read'), async (c) => {
  const alerts = await loadStockAlerts(c.env.DB);
  return c.json({ data: alerts, counts: alertCounts(alerts) });
});

reportRoutes.get('/margin', requirePermission('reports.read'), async (c) => {
  const company = c.get('company')!;
  const today = todayIn(company.timezone);
  const from = c.req.query('from') ?? addMonths(monthStart(today), -11);
  const to = c.req.query('to') ?? today;
  const requested = c.req.query('group_by') ?? 'family';
  const group: MarginGroup = requested === 'axis' || requested === 'product' ? requested : 'family';
  const canSeeCost = c.get('user')!.permissions.includes('products.cost.read');

  const [invoiceRows, creditRows, productRows] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, date, discount_type, discount_value, line_items FROM invoices
       WHERE deleted_at IS NULL AND status IN ('sent','partial','paid') AND date >= ? AND date <= ?`,
    ).bind(from, to).all<MarginDocumentRow>(),
    c.env.DB.prepare(
      `SELECT id, date, discount_type, discount_value, line_items FROM credits
       WHERE deleted_at IS NULL AND status IN ('sent','partial','applied') AND date >= ? AND date <= ?`,
    ).bind(from, to).all<MarginDocumentRow>(),
    c.env.DB.prepare(`SELECT id, cost, analytic_axis, family FROM products WHERE deleted_at IS NULL`)
      .all<{ id: string; cost: number; analytic_axis: string | null; family: string | null }>(),
  ]);

  const costs = new Map<string, CostLookup>(
    (productRows.results ?? []).map((row) => [
      row.id,
      { cost: Number(row.cost ?? 0), axis: row.analytic_axis, family: row.family },
    ]),
  );

  const documents: MarginDocument[] = [
    ...(invoiceRows.results ?? []).map((row) => toMarginDocument(row, 'invoice')),
    ...(creditRows.results ?? []).map((row) => toMarginDocument(row, 'credit')),
  ];

  const rows = aggregateMargin(documents, costs, group);
  const summary = marginSummary(rows);

  if (!canSeeCost) {
    return c.json({
      rows: rows.map((row) => ({ ...row, cost: null, margin: null, margin_bp: null })),
      summary: {
        revenue: summary.revenue,
        cost: null,
        margin: null,
        margin_bp: null,
        uncosted_lines: summary.uncosted_lines,
      },
      group_by: group,
      documents: documents.length,
      masked: true,
    });
  }

  return c.json({ rows, summary, group_by: group, documents: documents.length, masked: false });
});

reportRoutes.get('/:type', requirePermission('reports.read'), async (c) => {
  const company = c.get('company')!;
  const type = c.req.param('type');
  const today = todayIn(company.timezone);
  const defaultFrom = addMonths(monthStart(today), -11);
  const from = c.req.query('from') ?? defaultFrom;
  const to = c.req.query('to') ?? today;
  const db = c.env.DB;

  if (type === 'revenue' || type === 'profit-loss') {
    const months = [];
    for (let offset = 0; offset < 12; offset += 1) {
      const range = monthRange(addMonths(monthStart(today), offset - 11), 0);
      months.push(range);
    }
    const [invoices, payments, expenses] = await Promise.all([
      db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(${baseAmountSql('total', 'total_xpf')}) AS value FROM invoices
        WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date <= ? GROUP BY bucket`)
        .bind(months[0].start, to).all<{ bucket: string; value: number }>(),
      db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(${baseAmountSql('amount', 'amount_xpf')}) AS value FROM payments
        WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date <= ? GROUP BY bucket`)
        .bind(months[0].start, to).all<{ bucket: string; value: number }>(),
      db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(amount) AS value FROM expenses
        WHERE deleted_at IS NULL AND date >= ? AND date <= ? GROUP BY bucket`)
        .bind(months[0].start, to).all<{ bucket: string; value: number }>(),
    ]);
    const map = (rows: { bucket: string; value: number }[]) => Object.fromEntries((rows ?? []).map((r) => [r.bucket, r.value]));
    const invoiceMap = map(invoices.results ?? []);
    const paymentMap = map(payments.results ?? []);
    const expenseMap = map(expenses.results ?? []);

    const rows = months.map((month) => {
      const revenue = invoiceMap[month.key] ?? 0;
      const collected = paymentMap[month.key] ?? 0;
      const expense = expenseMap[month.key] ?? 0;
      return { period: month.key, revenue, collected, expenses: expense, result: collected - expense };
    });

    return c.json({
      rows,
      summary: {
        revenue: rows.reduce((s, r) => s + r.revenue, 0),
        collected: rows.reduce((s, r) => s + r.collected, 0),
        expenses: rows.reduce((s, r) => s + r.expenses, 0),
        result: rows.reduce((s, r) => s + r.result, 0),
      },
    });
  }

  if (type === 'tax') {
    // The tax mirror is written whenever an invoice is; invoices written
    // before it existed (or restored from backup) are repaired here first, then
    // the whole return aggregates in SQL instead of replaying JSON line items.
    await ensureInvoiceTaxLines(db, from, to);
    await ensureCreditTaxLines(db, from, to);

    const rows = await db.prepare(
      `SELECT l.rate, SUM(l.base) AS base, SUM(l.amount) AS tax,
              COUNT(DISTINCT l.invoice_id) AS documents
       FROM invoice_tax_lines l JOIN invoices i ON i.id = l.invoice_id
       WHERE i.deleted_at IS NULL AND i.status <> 'cancelled'
         AND i.date >= ? AND i.date <= ?
       GROUP BY l.rate ORDER BY l.rate DESC`,
    )
      .bind(from, to)
      .all<{ rate: number; base: number; tax: number; documents: number }>();

    // A-04: the reversal, per rate. Netting here keeps the return honest without a
    // second code path: the same rows the recap uses, with the credit sign flipped.
    const creditRows = await db
      .prepare(
        `SELECT cl.rate AS rate, -SUM(cl.base) AS base, -SUM(cl.amount) AS tax, 0 AS documents
         FROM credit_tax_lines cl JOIN credits cr ON cr.id = cl.credit_id
         WHERE cr.deleted_at IS NULL AND cr.status IN ('sent','partial','applied')
           AND cr.date >= ? AND cr.date <= ?
         GROUP BY cl.rate`,
      )
      .bind(from, to)
      .all<{ rate: number; base: number; tax: number; documents: number }>();
    const byRate = new Map<number, { rate: number; base: number; tax: number; documents: number }>();
    for (const row of [...(rows.results ?? []), ...(creditRows.results ?? [])]) {
      const rate = Number(row.rate);
      const current = byRate.get(rate) ?? { rate, base: 0, tax: 0, documents: 0 };
      current.base += Number(row.base);
      current.tax += Number(row.tax);
      current.documents += Number(row.documents);
      byRate.set(rate, current);
    }
    const netRows = [...byRate.values()].sort((a, b) => b.rate - a.rate);

    // T-002d (BK-001): an exempt invoice must never contribute to the taxable
    // base or appear as a 0 % VAT bucket. Taxable and exempt totals are kept
    // apart and reported side by side.
    const summary = await db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN tax_exempt = 0 THEN subtotal - discount_total END), 0) AS base,
              COALESCE(SUM(CASE WHEN tax_exempt = 0 THEN tax_total END), 0) AS tax,
              COALESCE(SUM(CASE WHEN tax_exempt = 1 THEN subtotal - discount_total END), 0) AS exempt_base,
              SUM(CASE WHEN tax_exempt = 1 THEN 1 ELSE 0 END) AS exempt_documents
       FROM invoices
       WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date <= ?`,
    )
      .bind(from, to)
      .first<{ base: number; tax: number; exempt_base: number; exempt_documents: number }>();

    const creditSummary = await db.prepare(
      `SELECT COALESCE(SUM(CASE WHEN tax_exempt = 0 THEN subtotal - discount_total END), 0) AS base,
              COALESCE(SUM(CASE WHEN tax_exempt = 0 THEN tax_total END), 0) AS tax,
              COALESCE(SUM(CASE WHEN tax_exempt = 1 THEN subtotal - discount_total END), 0) AS exempt_base,
              SUM(CASE WHEN tax_exempt = 1 THEN 1 ELSE 0 END) AS exempt_documents
       FROM credits
       WHERE deleted_at IS NULL AND status IN ('sent','partial','applied') AND date >= ? AND date <= ?`,
    )
      .bind(from, to)
      .first<{ base: number; tax: number; exempt_base: number; exempt_documents: number }>();

    return c.json({
      rows: netRows.filter((row) => Number(row.rate) > 0),
      summary: {
        base: (summary?.base ?? 0) - (creditSummary?.base ?? 0),
        tax: (summary?.tax ?? 0) - (creditSummary?.tax ?? 0),
        exempt_base: (summary?.exempt_base ?? 0) - (creditSummary?.exempt_base ?? 0),
        exempt_documents: (summary?.exempt_documents ?? 0) - (creditSummary?.exempt_documents ?? 0),
      },
    });
  }

  if (type === 'aging') {
    const invoices = await db.prepare(
      `SELECT i.id, i.number, i.due_date, i.balance, ${baseBalanceSql('i.balance', 'i.total', 'i.total_xpf')} AS balance_xpf, i.currency, i.status, c.display_name AS client_name
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial') AND i.balance > 0
       ORDER BY i.due_date ASC`,
    ).all<{ id: string; number: string; due_date: string | null; balance: number; balance_xpf: number; currency: string; status: string; client_name: string }>();

    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
    const rows = (invoices.results ?? []).map((invoice) => {
      const days = invoice.due_date
        ? Math.floor((new Date(today).getTime() - new Date(invoice.due_date).getTime()) / 86_400_000)
        : 0;
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'older';
      buckets[bucket] += invoice.balance_xpf;
      return { ...invoice, days_overdue: Math.max(0, days), bucket };
    });

    return c.json({
      rows,
      summary: { ...buckets, total: Object.values(buckets).reduce((s, v) => s + v, 0) },
    });
  }

  if (type === 'client-sales') {
    const rows = await db.prepare(
      `SELECT c.id, c.display_name AS client_name, COUNT(i.id) AS invoices,
        COALESCE(SUM(${baseAmountSql('i.total', 'i.total_xpf')}),0) AS invoiced,
        COALESCE(SUM(${baseBalanceSql('i.paid_total', 'i.total', 'i.total_xpf')}),0) AS paid,
        COALESCE(SUM(${baseBalanceSql('i.balance', 'i.total', 'i.total_xpf')}),0) AS balance_xpf, COALESCE(SUM(i.balance),0) AS balance
       FROM clients c LEFT JOIN invoices i ON i.client_id = c.id AND i.deleted_at IS NULL AND i.date >= ? AND i.date <= ?
       WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY invoiced DESC`,
    ).bind(from, to).all();
    return c.json({
      rows: rows.results ?? [],
      summary: {
        invoiced: (rows.results ?? []).reduce((s, r) => s + Number((r as { invoiced: number }).invoiced), 0),
        paid: (rows.results ?? []).reduce((s, r) => s + Number((r as { paid: number }).paid), 0),
      },
    });
  }

  if (type === 'expenses') {
    const rows = await db.prepare(
      `SELECT category, COUNT(*) AS entries,
        COALESCE(SUM(${baseAmountSql('amount', 'amount_xpf')}),0) AS amount,
        COALESCE(SUM(${baseAmountSql('tax_amount', 'tax_amount_xpf')}),0) AS tax_amount
       FROM expenses WHERE deleted_at IS NULL AND date >= ? AND date <= ?
       GROUP BY category ORDER BY amount DESC`,
    ).bind(from, to).all();
    return c.json({
      rows: rows.results ?? [],
      summary: { amount: (rows.results ?? []).reduce((s, r) => s + Number((r as { amount: number }).amount), 0) },
    });
  }

  return c.json({ rows: [], summary: {} });
});

export const searchRoutes = new Hono<AppEnv>();
searchRoutes.use('*', requireAuth);

searchRoutes.get('/', async (c) => {
  const search = searchTerm(c.req.query('q'));
  if (!search.ok) return fail(422, 'VALIDATION_ERROR', search.fields);
  const query = search.term;
  if (query.length < 2) return c.json({ clients: [], invoices: [], quotes: [] });
  const like = `%${query}%`;
  const [clients, invoices, quotes] = await Promise.all([
    c.env.DB.prepare(`SELECT id, display_name, email FROM clients WHERE deleted_at IS NULL AND (display_name LIKE ? OR email LIKE ?) LIMIT 5`)
      .bind(like, like).all(),
    c.env.DB.prepare(`SELECT id, number, total, status FROM invoices WHERE deleted_at IS NULL AND number LIKE ? LIMIT 5`)
      .bind(like).all(),
    c.env.DB.prepare(`SELECT id, number, total, status FROM quotes WHERE deleted_at IS NULL AND number LIKE ? LIMIT 5`)
      .bind(like).all(),
  ]);
  return c.json({
    clients: clients.results ?? [],
    invoices: invoices.results ?? [],
    quotes: quotes.results ?? [],
  });
});
