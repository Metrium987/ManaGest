import { Hono } from 'hono';
import { lastDailyRun } from '../services/daily-run';
import { addMonths, monthStart, todayIn } from '../lib/dates';
import { logActivity } from '../lib/audit';
import { csvResponse } from '../lib/csv';
import { fail } from '../lib/errors';
import {
  mergeRevenue,
  mergeTvaRecap,
  revenueCsv,
  tvaRecapCsv,
  tvaRecapTotals,
  type ExemptRow,
  type TaxRow,
} from '../lib/reports';
import { requireAuth, requirePermission } from '../middleware';
import { ensureInvoiceTaxLines } from '../services/documents';
import type { AppEnv } from '../types';

export const dashboardRoutes = new Hono<AppEnv>();
dashboardRoutes.use('*', requireAuth);

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
    scalarQuery(`SELECT COALESCE(SUM(total),0) AS value FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date < ?`, [current.start, current.end]),
    scalarQuery(`SELECT COALESCE(SUM(amount),0) AS value FROM payments WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date < ?`, [current.start, current.end]),
    scalarQuery(`SELECT COALESCE(SUM(total),0) AS value FROM invoices WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date < ?`, [previous.start, previous.end]),
    scalarQuery(`SELECT COALESCE(SUM(amount),0) AS value FROM payments WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date < ?`, [previous.start, previous.end]),
    scalarQuery(`SELECT COALESCE(SUM(balance),0) AS value FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial')`),
    scalarQuery(`SELECT COALESCE(SUM(balance),0) AS value FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial') AND due_date IS NOT NULL AND due_date < ?`, [today]),
    scalarQuery(`SELECT COALESCE(SUM(amount),0) AS value FROM expenses WHERE deleted_at IS NULL AND date >= ? AND date < ?`, [current.start, current.end]),
    scalarQuery(`SELECT COUNT(*) AS value FROM clients WHERE deleted_at IS NULL`),
    scalarQuery(`SELECT COUNT(*) AS value FROM invoices WHERE deleted_at IS NULL AND status IN ('sent','partial')`),
  ]);

  const months = [5, 4, 3, 2, 1, 0].map((offset) => monthRange(today, -offset));
  const seriesStart = months[0].start;
  const seriesEnd = months[months.length - 1].end;

  const [invoiceSeries, paymentSeries, expenseSeries] = await Promise.all([
    db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(total) AS value FROM invoices
      WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date < ? GROUP BY bucket`)
      .bind(seriesStart, seriesEnd).all<{ bucket: string; value: number }>(),
    db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(amount) AS value FROM payments
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
    db.prepare(`SELECT c.id, c.display_name AS client_name, COALESCE(SUM(i.paid_total),0) AS revenue
      FROM clients c JOIN invoices i ON i.client_id = c.id AND i.deleted_at IS NULL
      WHERE c.deleted_at IS NULL GROUP BY c.id ORDER BY revenue DESC LIMIT 5`).all(),
    db.prepare(`SELECT a.id, a.summary, a.entity_type, a.created_at, a.meta, u.first_name, u.last_name
      FROM activities a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.created_at DESC LIMIT 8`).all(),
    db.prepare(`SELECT id, number, due_date, balance FROM invoices
      WHERE deleted_at IS NULL AND status IN ('sent','partial') AND due_date IS NOT NULL
      ORDER BY due_date ASC LIMIT 5`).all(),
  ]);

  return c.json({
    today,
    // T-104c: the dashboard says when the pass last ran, not only what it produced.
    last_run: await lastDailyRun(db),
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
    top_clients: topClients.results ?? [],
    activities: activities.results ?? [],
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
async function tvaRecapData(db: D1Database, from: string, to: string) {
  await ensureInvoiceTaxLines(db, from, to);
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
  const periods = mergeTvaRecap(tax.results ?? [], exempt.results ?? []);
  return { periods, totals: tvaRecapTotals(periods) };
}

async function revenueData(db: D1Database, from: string, to: string) {
  const [invoices, payments] = await Promise.all([
    db
      .prepare(
        `SELECT substr(date,1,7) AS period,
                SUM(CASE WHEN tax_exempt = 0 THEN total ELSE 0 END) AS taxable,
                SUM(CASE WHEN tax_exempt = 1 THEN total ELSE 0 END) AS exempt,
                SUM(total) AS total, COUNT(*) AS documents
         FROM invoices
         WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date <= ?
         GROUP BY period`,
      )
      .bind(from, to)
      .all<{ period: string; taxable: number; exempt: number; total: number; documents: number }>(),
    db
      .prepare(
        `SELECT substr(date,1,7) AS period, SUM(amount) AS collected
         FROM payments WHERE deleted_at IS NULL AND status = 'completed' AND date >= ? AND date <= ?
         GROUP BY period`,
      )
      .bind(from, to)
      .all<{ period: string; collected: number }>(),
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
      taxable: periods.reduce((sum, row) => sum + row.taxable, 0),
      exempt: periods.reduce((sum, row) => sum + row.exempt, 0),
      total: periods.reduce((sum, row) => sum + row.total, 0),
      collected: periods.reduce((sum, row) => sum + row.collected, 0),
    },
  });
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
      db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(total) AS value FROM invoices
        WHERE deleted_at IS NULL AND status <> 'cancelled' AND date >= ? AND date <= ? GROUP BY bucket`)
        .bind(months[0].start, to).all<{ bucket: string; value: number }>(),
      db.prepare(`SELECT substr(date,1,7) AS bucket, SUM(amount) AS value FROM payments
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

    return c.json({
      rows: (rows.results ?? []).filter((row) => Number(row.rate) > 0),
      summary: {
        base: summary?.base ?? 0,
        tax: summary?.tax ?? 0,
        exempt_base: summary?.exempt_base ?? 0,
        exempt_documents: summary?.exempt_documents ?? 0,
      },
    });
  }

  if (type === 'aging') {
    const invoices = await db.prepare(
      `SELECT i.id, i.number, i.due_date, i.balance, i.status, c.display_name AS client_name
       FROM invoices i JOIN clients c ON c.id = i.client_id
       WHERE i.deleted_at IS NULL AND i.status IN ('sent','partial') AND i.balance > 0
       ORDER BY i.due_date ASC`,
    ).all<{ id: string; number: string; due_date: string | null; balance: number; status: string; client_name: string }>();

    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, older: 0 };
    const rows = (invoices.results ?? []).map((invoice) => {
      const days = invoice.due_date
        ? Math.floor((new Date(today).getTime() - new Date(invoice.due_date).getTime()) / 86_400_000)
        : 0;
      const bucket = days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'older';
      buckets[bucket] += invoice.balance;
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
        COALESCE(SUM(i.total),0) AS invoiced, COALESCE(SUM(i.paid_total),0) AS paid,
        COALESCE(SUM(i.balance),0) AS balance
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
      `SELECT category, COUNT(*) AS entries, COALESCE(SUM(amount),0) AS amount,
        COALESCE(SUM(tax_amount),0) AS tax_amount
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
  const query = (c.req.query('q') ?? '').trim();
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
