import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { nextSimpleNumber } from '../lib/numbering';
import { offsetOf, optionalText, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { CLIENT_STATS_SQL } from '../services/documents';
import type { AppEnv } from '../types';

const clientSchema = z.object({
  display_name: z.string().trim().min(1).max(160),
  first_name: optionalText(80),
  last_name: optionalText(80),
  email: z.union([z.string().trim().toLowerCase().email().max(190), z.literal(''), z.null()]).optional()
    .transform((v) => (v ? v : null)),
  phone: optionalText(40),
  address1: optionalText(160),
  address2: optionalText(160),
  city: optionalText(80),
  postal_code: optionalText(20),
  country: z.string().trim().max(80).default('Polynésie française'),
  tax_id: optionalText(20),
  payment_terms: z.coerce.number().int().min(0).max(365).default(30),
  is_tax_exempt: z.boolean().default(false),
  notes: optionalText(4000),
});

export const clientRoutes = new Hono<AppEnv>();
clientRoutes.use('*', requireAuth);

clientRoutes.get('/', requirePermission('clients.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const archived = c.req.query('archived') === 'true';

  const filters = ['c.deleted_at IS NULL', `c.archived = ${archived ? 1 : 0}`];
  const bindings: (string | number)[] = [];
  if (search) {
    filters.push('(c.display_name LIKE ? OR c.email LIKE ? OR c.city LIKE ? OR c.tax_id LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM clients c ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT c.*, ${CLIENT_STATS_SQL} FROM clients c ${where}
     ORDER BY c.display_name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all();

  const total = count?.count ?? 0;
  return c.json({
    data: rows.results ?? [],
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

clientRoutes.get('/:id', requirePermission('clients.read'), async (c) => {
  const id = c.req.param('id');
  const client = await c.env.DB.prepare(
    `SELECT c.*, ${CLIENT_STATS_SQL} FROM clients c WHERE c.id = ? AND c.deleted_at IS NULL`,
  )
    .bind(id)
    .first();
  if (!client) return fail(404, 'NOT_FOUND');

  const [invoices, quotes, payments, contacts] = await Promise.all([
    c.env.DB.prepare(
      `SELECT id, number, status, date, due_date, total, balance FROM invoices
       WHERE client_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 15`,
    ).bind(id).all(),
    c.env.DB.prepare(
      `SELECT id, number, status, date, total FROM quotes
       WHERE client_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 10`,
    ).bind(id).all(),
    c.env.DB.prepare(
      `SELECT id, number, date, amount, method FROM payments
       WHERE client_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 10`,
    ).bind(id).all(),
    c.env.DB.prepare(`SELECT * FROM client_contacts WHERE client_id = ? ORDER BY is_primary DESC`)
      .bind(id)
      .all(),
  ]);

  return c.json({
    ...client,
    invoices: invoices.results ?? [],
    quotes: quotes.results ?? [],
    payments: payments.results ?? [],
    contacts: contacts.results ?? [],
  });
});

clientRoutes.post('/', requirePermission('clients.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(clientSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  const number = await nextSimpleNumber(c.env.DB, 'client', 'CLI');

  await c.env.DB.prepare(
    `INSERT INTO clients (id, number, display_name, first_name, last_name, email, phone, address1, address2,
      city, postal_code, country, tax_id, payment_terms, is_tax_exempt, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, number, body.display_name, body.first_name, body.last_name, body.email, body.phone,
      body.address1, body.address2, body.city, body.postal_code, body.country, body.tax_id,
      body.payment_terms, body.is_tax_exempt ? 1 : 0, body.notes, nowISO(), nowISO(),
    )
    .run();

  if (body.email) {
    await c.env.DB.prepare(
      `INSERT INTO client_contacts (id, client_id, first_name, last_name, email, phone, is_primary, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
      .bind(crypto.randomUUID(), id, body.first_name ?? '', body.last_name ?? '', body.email, body.phone, nowISO())
      .run();
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'client',
    entityId: id,
    summary: 'activity.client_created',
    meta: { name: body.display_name },
  });

  return c.json({ id, number }, 201);
});

clientRoutes.patch('/:id', requirePermission('clients.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(clientSchema, await c.req.json().catch(() => ({})));

  const existing = await c.env.DB.prepare(
    `SELECT id, display_name FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; display_name: string }>();
  if (!existing) return fail(404, 'NOT_FOUND');

  await c.env.DB.prepare(
    `UPDATE clients SET display_name = ?, first_name = ?, last_name = ?, email = ?, phone = ?, address1 = ?,
      address2 = ?, city = ?, postal_code = ?, country = ?, tax_id = ?, payment_terms = ?, is_tax_exempt = ?,
      notes = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.display_name, body.first_name, body.last_name, body.email, body.phone, body.address1,
      body.address2, body.city, body.postal_code, body.country, body.tax_id, body.payment_terms,
      body.is_tax_exempt ? 1 : 0, body.notes, nowISO(), id,
    )
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'client',
    entityId: id,
    summary: 'activity.client_updated',
    meta: { name: body.display_name },
  });

  return c.json({ ok: true });
});

clientRoutes.delete('/:id', requirePermission('clients.delete'), async (c) => {
  const id = c.req.param('id');
  const user = c.get('user')!;
  const open = await c.env.DB.prepare(
    `SELECT COUNT(*) AS count FROM invoices WHERE client_id = ? AND deleted_at IS NULL AND status IN ('sent','partial')`,
  )
    .bind(id)
    .first<{ count: number }>();
  if ((open?.count ?? 0) > 0) return fail(409, 'CLIENT_HAS_OPEN_INVOICES');

  await c.env.DB.prepare(`UPDATE clients SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'deleted',
    entityType: 'client',
    entityId: id,
    summary: 'activity.client_deleted',
  });
  return c.json({ ok: true });
});

clientRoutes.get('/:id/statement', requirePermission('clients.read'), async (c) => {
  const id = c.req.param('id');
  const from = c.req.query('from') ?? '0000-01-01';
  const to = c.req.query('to') ?? '9999-12-31';

  const client = await c.env.DB.prepare(`SELECT * FROM clients WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first();
  if (!client) return fail(404, 'NOT_FOUND');

  const invoices = await c.env.DB.prepare(
    `SELECT id, number, date, due_date, total, paid_total, balance, status FROM invoices
     WHERE client_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date ASC`,
  )
    .bind(id, from, to)
    .all<{ total: number; paid_total: number; balance: number }>();

  const payments = await c.env.DB.prepare(
    `SELECT id, number, date, amount FROM payments WHERE client_id = ? AND deleted_at IS NULL AND date BETWEEN ? AND ? ORDER BY date ASC`,
  )
    .bind(id, from, to)
    .all();

  const rows = invoices.results ?? [];
  return c.json({
    client,
    invoices: rows,
    payments: payments.results ?? [],
    totals: {
      invoiced: rows.reduce((sum, row) => sum + row.total, 0),
      paid: rows.reduce((sum, row) => sum + row.paid_total, 0),
      balance: rows.reduce((sum, row) => sum + row.balance, 0),
    },
  });
});

clientRoutes.post('/:id/contacts', requirePermission('clients.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      first_name: optionalText(80),
      last_name: optionalText(80),
      email: z.string().trim().toLowerCase().email().max(190),
      phone: optionalText(40),
      is_primary: z.boolean().default(false),
    }),
    await c.req.json().catch(() => ({})),
  );
  await c.env.DB.prepare(
    `INSERT INTO client_contacts (id, client_id, first_name, last_name, email, phone, is_primary, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(crypto.randomUUID(), id, body.first_name, body.last_name, body.email, body.phone, body.is_primary ? 1 : 0, nowISO())
    .run();
  return c.json({ ok: true }, 201);
});
