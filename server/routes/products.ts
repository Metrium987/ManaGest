import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { offsetOf, optionalText, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import type { AppEnv } from '../types';

const productSchema = z.object({
  product_key: optionalText(60),
  name: z.string().trim().min(1).max(160),
  description: optionalText(1000),
  unit_price: z.coerce.number().int().min(0).max(999_999_999),
  cost: z.coerce.number().int().min(0).max(999_999_999).default(0),
  quantity: z.coerce.number().min(-1_000_000).max(1_000_000).default(0),
  track_quantity: z.boolean().default(false),
  tax_rate: z.coerce.number().int().min(0).max(100).default(16),
});

export const productRoutes = new Hono<AppEnv>();
productRoutes.use('*', requireAuth);

productRoutes.get('/', requirePermission('products.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const filters = ['deleted_at IS NULL'];
  const bindings: string[] = [];
  if (search) {
    filters.push('(name LIKE ? OR product_key LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const count = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM products ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT * FROM products ${where} ORDER BY name COLLATE NOCASE ASC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all();

  const total = count?.count ?? 0;
  return c.json({
    data: rows.results ?? [],
    meta: { page, per_page, total, total_pages: Math.max(1, Math.ceil(total / per_page)) },
  });
});

productRoutes.post('/', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(productSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO products (id, product_key, name, description, unit_price, cost, quantity_milli, track_quantity, tax_rate, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, body.product_key, body.name, body.description, body.unit_price, body.cost,
      Math.round(body.quantity * 1000), body.track_quantity ? 1 : 0, body.tax_rate, nowISO(), nowISO(),
    )
    .run();

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
  const id = c.req.param('id');
  const body = parseInput(productSchema, await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(`SELECT id FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first();
  if (!existing) return fail(404, 'NOT_FOUND');

  await c.env.DB.prepare(
    `UPDATE products SET product_key = ?, name = ?, description = ?, unit_price = ?, cost = ?, quantity_milli = ?,
      track_quantity = ?, tax_rate = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      body.product_key, body.name, body.description, body.unit_price, body.cost,
      Math.round(body.quantity * 1000), body.track_quantity ? 1 : 0, body.tax_rate, nowISO(), id,
    )
    .run();
  return c.json({ ok: true });
});

productRoutes.delete('/:id', requirePermission('products.delete'), async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare(`UPDATE products SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), nowISO(), id)
    .run();
  return c.json({ ok: true });
});

productRoutes.post('/:id/adjust-stock', requirePermission('products.write'), async (c) => {
  const id = c.req.param('id');
  const body = parseInput(
    z.object({ delta: z.coerce.number().min(-100_000).max(100_000) }),
    await c.req.json().catch(() => ({})),
  );
  const product = await c.env.DB.prepare(`SELECT quantity_milli FROM products WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ quantity_milli: number }>();
  if (!product) return fail(404, 'NOT_FOUND');
  const next = Math.max(0, product.quantity_milli + Math.round(body.delta * 1000));
  await c.env.DB.prepare(`UPDATE products SET quantity_milli = ?, updated_at = ? WHERE id = ?`)
    .bind(next, nowISO(), id)
    .run();
  return c.json({ quantity: next / 1000 });
});
