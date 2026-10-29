import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { diffSnapshot, logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { assertPeriodOpen } from '../lib/locks';
import { nextSimpleNumber } from '../lib/numbering';
import { computeTotals } from '../lib/tax';
import {
  lineItemsSchema, offsetOf, optionalIsoDate, optionalText, paginationSchema, parseInput,
} from '../lib/validation';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import { safeLines, serialiseLines } from '../services/documents';
import type { AppEnv } from '../types';

/* ------------------------------------------------------------------ expenses */

const expenseSchema = z.object({
  vendor_id: z.string().max(60).nullish(),
  client_id: z.string().max(60).nullish(),
  // T-107: the list is editable, so the value is checked against the table below.
  category: z.string().trim().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.coerce.number().int().min(0).max(9_999_999_999),
  tax_amount: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
  payment_method: z.enum(['transfer', 'cash', 'cheque', 'card', 'direct_debit', 'credit', 'other']).default('transfer'),
  reference: optionalText(160),
  notes: optionalText(2000),
  is_billable: z.boolean().default(false),
});

export const expenseRoutes = new Hono<AppEnv>();
expenseRoutes.use('*', requireAuth);

expenseRoutes.get('/', requirePermission('expenses.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const from = c.req.query('from') ?? '';
  const to = c.req.query('to') ?? '';
  const category = c.req.query('category') ?? '';

  const filters = ['e.deleted_at IS NULL'];
  const bindings: (string | number)[] = [];
  if (from) { filters.push('e.date >= ?'); bindings.push(from); }
  if (to) { filters.push('e.date <= ?'); bindings.push(to); }
  if (category) { filters.push('e.category = ?'); bindings.push(category); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM expenses e ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT e.*, v.name AS vendor_name, c.display_name AS client_name
     FROM expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN clients c ON c.id = e.client_id
     ${where} ORDER BY e.date DESC, e.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;

  return c.json({
    data: rows.results ?? [],
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

expenseRoutes.post('/', requirePermission('expenses.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(expenseSchema, await c.req.json().catch(() => ({})));
  const knownCategory = await c.env.DB
    .prepare(`SELECT key FROM expense_categories WHERE key = ? AND archived = 0`)
    .bind(body.category).first();
  if (!knownCategory) return fail(422, 'VALIDATION_ERROR', { category: 'unknown' });
  await assertPeriodOpen(c.env.DB, body.date);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO expenses (id, vendor_id, client_id, category, date, amount, tax_amount, payment_method, reference, notes,
      is_billable, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.vendor_id || null, body.client_id || null, body.category, body.date, body.amount, body.tax_amount,
    body.payment_method, body.reference, body.notes, body.is_billable ? 1 : 0, user.id, nowISO(), nowISO(),
  ).run();
  await logActivity(c.env.DB, {
    userId: user.id, action: 'created', entityType: 'expense', entityId: id,
    summary: 'activity.expense_created', meta: { amount: body.amount, category: body.category },
  });
  return c.json({ id }, 201);
});

expenseRoutes.patch('/:id', requirePermission('expenses.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(expenseSchema, await c.req.json().catch(() => ({})));
  const knownCategory = await c.env.DB
    .prepare(`SELECT key FROM expense_categories WHERE key = ? AND archived = 0`)
    .bind(body.category).first();
  if (!knownCategory) return fail(422, 'VALIDATION_ERROR', { category: 'unknown' });
  const existing = await c.env.DB.prepare(
    `SELECT id, vendor_id, client_id, category, date, amount, tax_amount, payment_method, reference, notes, is_billable
     FROM expenses WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!existing) return fail(404, 'NOT_FOUND');
  await assertPeriodOpen(c.env.DB, existing.date as string, body.date);
  await c.env.DB.prepare(
    `UPDATE expenses SET vendor_id = ?, client_id = ?, category = ?, date = ?, amount = ?, tax_amount = ?,
      payment_method = ?, reference = ?, notes = ?, is_billable = ?, updated_at = ? WHERE id = ?`,
  ).bind(
    body.vendor_id || null, body.client_id || null, body.category, body.date, body.amount, body.tax_amount,
    body.payment_method, body.reference, body.notes, body.is_billable ? 1 : 0, nowISO(), id,
  ).run();

  const changes = diffSnapshot(existing, {
    ...body,
    vendor_id: body.vendor_id || null,
    client_id: body.client_id || null,
    is_billable: body.is_billable ? 1 : 0,
  }, ['vendor_id', 'client_id', 'category', 'date', 'amount', 'tax_amount', 'reference', 'is_billable']);
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id, action: 'updated', entityType: 'expense', entityId: id,
    summary: 'activity.expense_updated',
    before: changes?.before ?? null, after: changes?.after ?? null, ip: clientIp(c),
  });
  return c.json({ ok: true });
});

expenseRoutes.delete('/:id', requirePermission('expenses.delete'), async (c) => {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, date, amount, category FROM expenses WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; date: string; amount: number; category: string }>();
  if (!existing) return fail(404, 'NOT_FOUND');
  await assertPeriodOpen(c.env.DB, existing.date);
  await c.env.DB.prepare(`UPDATE expenses SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id).run();
  await logActivity(c.env.DB, {
    userId: c.get('user')!.id, action: 'deleted', entityType: 'expense', entityId: id,
    summary: 'activity.expense_deleted',
    before: { date: existing.date, amount: existing.amount, category: existing.category },
    ip: clientIp(c),
  });
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------- vendors */

const vendorSchema = z.object({
  name: z.string().trim().min(1).max(160),
  email: z.union([z.string().trim().email().max(190), z.literal(''), z.null()]).optional().transform((v) => (v ? v : null)),
  phone: optionalText(40),
  address1: optionalText(160),
  city: optionalText(80),
  postal_code: optionalText(20),
  country: z.string().trim().max(80).default('Polynésie française'),
  tax_id: optionalText(20),
  notes: optionalText(2000),
});

export const vendorRoutes = new Hono<AppEnv>();
vendorRoutes.use('*', requireAuth);

vendorRoutes.get('/', requirePermission('vendors.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const filters = ['v.deleted_at IS NULL'];
  const bindings: string[] = [];
  if (search) { filters.push('(v.name LIKE ? OR v.email LIKE ?)'); bindings.push(`%${search}%`, `%${search}%`); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM vendors v ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT v.*, (SELECT COUNT(*) FROM purchase_orders po WHERE po.vendor_id = v.id AND po.deleted_at IS NULL) AS po_count,
      (SELECT COALESCE(SUM(po.total), 0) FROM purchase_orders po WHERE po.vendor_id = v.id AND po.deleted_at IS NULL) AS po_total
     FROM vendors v ${where} ORDER BY v.name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;

  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

vendorRoutes.post('/', requirePermission('vendors.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(vendorSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  const number = await nextSimpleNumber(c.env.DB, 'vendor', 'FOU');
  await c.env.DB.prepare(
    `INSERT INTO vendors (id, number, name, email, phone, address1, city, postal_code, country, tax_id, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, number, body.name, body.email, body.phone, body.address1, body.city, body.postal_code, body.country, body.tax_id, body.notes, nowISO(), nowISO()).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'vendor', entityId: id, summary: 'activity.vendor_created', meta: { name: body.name } });
  return c.json({ id, number }, 201);
});

vendorRoutes.patch('/:id', requirePermission('vendors.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(vendorSchema, await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(`SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL`).bind(id).first();
  if (!existing) return fail(404, 'NOT_FOUND');
  await c.env.DB.prepare(
    `UPDATE vendors SET name = ?, email = ?, phone = ?, address1 = ?, city = ?, postal_code = ?, country = ?, tax_id = ?, notes = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.name, body.email, body.phone, body.address1, body.city, body.postal_code, body.country, body.tax_id, body.notes, nowISO(), id).run();
  return c.json({ ok: true });
});

vendorRoutes.delete('/:id', requirePermission('vendors.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE vendors SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  return c.json({ ok: true });
});

/* ------------------------------------------------------------ purchase orders */

const purchaseOrderSchema = z.object({
  vendor_id: z.string().min(8).max(60),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expected_date: optionalIsoDate,
  line_items: lineItemsSchema,
  discount_type: z.enum(['percent', 'amount']).default('percent'),
  discount_value: z.coerce.number().int().min(0).default(0),
  notes: optionalText(2000),
});

export const purchaseOrderRoutes = new Hono<AppEnv>();
purchaseOrderRoutes.use('*', requireAuth);

purchaseOrderRoutes.get('/', requirePermission('purchase_orders.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const status = c.req.query('status') ?? '';
  const filters = ['po.deleted_at IS NULL'];
  const bindings: string[] = [];
  if (status) { filters.push('po.status = ?'); bindings.push(status); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM purchase_orders po ${where}`)
    .bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT po.*, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
     ${where} ORDER BY po.date DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;

  return c.json({
    data: (rows.results ?? []).map((row) => ({ ...row, line_items: safeLines(row.line_items) })),
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

purchaseOrderRoutes.get('/:id', requirePermission('purchase_orders.read'), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT po.*, v.name AS vendor_name FROM purchase_orders po JOIN vendors v ON v.id = po.vendor_id
     WHERE po.id = ? AND po.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!row) return fail(404, 'NOT_FOUND');
  return c.json({ ...row, line_items: safeLines(row.line_items) });
});

purchaseOrderRoutes.post('/', requirePermission('purchase_orders.write'), async (c) => {
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(purchaseOrderSchema, await c.req.json().catch(() => ({})));
  const vendor = await c.env.DB.prepare(`SELECT id FROM vendors WHERE id = ? AND deleted_at IS NULL`).bind(body.vendor_id).first();
  if (!vendor) return fail(422, 'VALIDATION_ERROR', { vendor_id: 'not_found' });

  const totals = computeTotals(body.line_items, { discount_type: body.discount_type, discount_value: body.discount_value }, false);
  const id = crypto.randomUUID();
  const number = await nextSimpleNumber(c.env.DB, 'purchase_order', 'BC');
  await c.env.DB.prepare(
    `INSERT INTO purchase_orders (id, vendor_id, number, status, date, expected_date, currency, subtotal, discount_type,
      discount_value, discount_total, tax_total, total, line_items, notes, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, body.vendor_id, number, body.date, body.expected_date, company.currency, totals.subtotal, body.discount_type,
    body.discount_value, totals.discount_total, totals.tax_total, totals.total, serialiseLines(body.line_items),
    body.notes, user.id, nowISO(), nowISO(),
  ).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'purchase_order', entityId: id, summary: 'activity.po_created', meta: { number, total: totals.total } });
  return c.json({ id, number }, 201);
});

purchaseOrderRoutes.post('/:id/status', requirePermission('purchase_orders.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(
    z.object({ status: z.enum(['sent', 'approved', 'received', 'cancelled']) }),
    await c.req.json().catch(() => ({})),
  );
  const po = await c.env.DB.prepare(`SELECT status FROM purchase_orders WHERE id = ? AND deleted_at IS NULL`).bind(id).first<{ status: string }>();
  if (!po) return fail(404, 'NOT_FOUND');
  await c.env.DB.prepare(`UPDATE purchase_orders SET status = ?, updated_at = ? WHERE id = ?`).bind(body.status, nowISO(), id).run();
  return c.json({ ok: true });
});

purchaseOrderRoutes.delete('/:id', requirePermission('purchase_orders.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE purchase_orders SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  return c.json({ ok: true });
});

/* ------------------------------------------------------------------ projects */

const projectSchema = z.object({
  client_id: z.string().max(60).nullish(),
  name: z.string().trim().min(1).max(160),
  description: optionalText(2000),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
  budget: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
  start_date: optionalIsoDate,
  deadline: optionalIsoDate,
});

export const projectRoutes = new Hono<AppEnv>();
projectRoutes.use('*', requireAuth);

projectRoutes.get('/', requirePermission('projects.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM projects WHERE deleted_at IS NULL`).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT p.*, c.display_name AS client_name,
      (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS task_count,
      (SELECT COALESCE(SUM(t.minutes), 0) FROM tasks t WHERE t.project_id = p.id AND t.deleted_at IS NULL) AS total_minutes
     FROM projects p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.deleted_at IS NULL ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;
  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

projectRoutes.get('/:id', requirePermission('projects.read'), async (c) => {
  const project = await c.env.DB.prepare(
    `SELECT p.*, c.display_name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id
     WHERE p.id = ? AND p.deleted_at IS NULL`,
  ).bind(c.req.param('id')).first();
  if (!project) return fail(404, 'NOT_FOUND');
  const tasks = await c.env.DB.prepare(
    `SELECT * FROM tasks WHERE project_id = ? AND deleted_at IS NULL ORDER BY created_at ASC`,
  ).bind(c.req.param('id')).all();
  return c.json({ ...project, tasks: tasks.results ?? [] });
});

projectRoutes.post('/', requirePermission('projects.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(projectSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO projects (id, client_id, name, description, status, budget, start_date, deadline, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.client_id || null, body.name, body.description, body.status, body.budget, body.start_date, body.deadline, user.id, nowISO(), nowISO()).run();
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'project', entityId: id, summary: 'activity.project_created', meta: { name: body.name } });
  return c.json({ id }, 201);
});

projectRoutes.patch('/:id', requirePermission('projects.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(projectSchema, await c.req.json().catch(() => ({})));
  await c.env.DB.prepare(
    `UPDATE projects SET client_id = ?, name = ?, description = ?, status = ?, budget = ?, start_date = ?, deadline = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.client_id || null, body.name, body.description, body.status, body.budget, body.start_date, body.deadline, nowISO(), id).run();
  return c.json({ ok: true });
});

projectRoutes.delete('/:id', requirePermission('projects.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE projects SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  return c.json({ ok: true });
});

/* --------------------------------------------------------------------- tasks */

const taskSchema = z.object({
  project_id: z.string().max(60).nullish(),
  client_id: z.string().max(60).nullish(),
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  status: z.enum(['todo', 'in_progress', 'done']).default('todo'),
  minutes: z.coerce.number().int().min(0).max(100_000).default(0),
  hourly_rate: z.coerce.number().int().min(0).max(9_999_999).default(0),
  billable: z.boolean().default(true),
});

export const taskRoutes = new Hono<AppEnv>();
taskRoutes.use('*', requireAuth);

taskRoutes.get('/', requirePermission('tasks.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const projectId = c.req.query('project_id') ?? '';
  const filters = ['t.deleted_at IS NULL'];
  const bindings: string[] = [];
  if (projectId) { filters.push('t.project_id = ?'); bindings.push(projectId); }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM tasks t ${where}`).bind(...bindings).first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT t.*, p.name AS project_name, c.display_name AS client_name FROM tasks t
     LEFT JOIN projects p ON p.id = t.project_id LEFT JOIN clients c ON c.id = t.client_id
     ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...bindings, per_page, offsetOf(page, per_page)).all();
  const total = count?.count ?? 0;
  return c.json({ data: rows.results ?? [], meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) } });
});

taskRoutes.post('/', requirePermission('tasks.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(taskSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO tasks (id, project_id, client_id, title, description, status, minutes, hourly_rate, billable, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(id, body.project_id || null, body.client_id || null, body.title, body.description, body.status, body.minutes, body.hourly_rate, body.billable ? 1 : 0, user.id, nowISO(), nowISO()).run();
  return c.json({ id }, 201);
});

taskRoutes.patch('/:id', requirePermission('tasks.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(taskSchema, await c.req.json().catch(() => ({})));
  await c.env.DB.prepare(
    `UPDATE tasks SET project_id = ?, client_id = ?, title = ?, description = ?, status = ?, minutes = ?, hourly_rate = ?, billable = ?, updated_at = ? WHERE id = ?`,
  ).bind(body.project_id || null, body.client_id || null, body.title, body.description, body.status, body.minutes, body.hourly_rate, body.billable ? 1 : 0, nowISO(), id).run();
  return c.json({ ok: true });
});

taskRoutes.delete('/:id', requirePermission('tasks.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE tasks SET deleted_at = ?, updated_at = ? WHERE id = ?`).bind(nowISO(), nowISO(), id).run();
  return c.json({ ok: true });
});
