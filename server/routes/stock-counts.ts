import { Hono } from 'hono';
import { z } from 'zod';
import { COUNT_SCOPES, adjustmentsOf, countSummary, pendingLines, staleLines } from '../lib/stock-count';
import { nowISO } from '../db';
import { nextNumber } from '../lib/numbering';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { offsetOf, optionalText, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import type { AppEnv } from '../types';

/**
 * Cycle counting (B1).
 *
 * A session photographs the expected quantity of the products in scope, a human
 * writes what is really on the shelf, and validation turns the differences into
 * `adjust` movements. Two rules keep it honest: a sheet cannot be validated
 * while a line is uncounted (an empty field is not a zero), and a line whose
 * book quantity moved after the sheet was opened is refused rather than
 * overwritten — the sale or reception that happened in between is real.
 *
 * One open session at a time, enforced by a partial unique index: two sheets
 * could both claim the same shelf.
 */
export const stockCountRoutes = new Hono<AppEnv>();
stockCountRoutes.use('*', requireAuth);

interface CountRow {
  id: string;
  reference: string;
  scope: string;
  scope_value: string | null;
  status: string;
  note: string | null;
  line_count: number;
  created_by: string | null;
  validated_by: string | null;
  created_at: string;
  validated_at: string | null;
  cancelled_at: string | null;
}

interface LineRow {
  id: string;
  count_id: string;
  product_id: string;
  expected_milli: number;
  counted_milli: number | null;
  expected_cost: number;
  movement_id: string | null;
  name: string;
  product_key: string | null;
  current_milli: number | null;
}

const createSchema = z.object({
  scope: z.enum(COUNT_SCOPES).default('all'),
  scope_value: optionalText(120),
  note: optionalText(500),
});

const countsSchema = z.object({
  counts: z
    .array(
      z.object({
        product_id: z.string().min(1).max(60),
        counted: z.union([z.coerce.number().min(0).max(1_000_000), z.null()]),
      }),
    )
    .max(500),
});

async function loadCount(database: D1Database, id: string): Promise<CountRow | null> {
  return database
    .prepare(`SELECT * FROM stock_counts WHERE id = ?`)
    .bind(id)
    .first<CountRow>();
}

async function loadLines(database: D1Database, id: string): Promise<LineRow[]> {
  const rows = await database
    .prepare(
      `SELECT l.*, p.name, p.product_key, p.quantity_milli AS current_milli
       FROM stock_count_lines l JOIN products p ON p.id = l.product_id
       WHERE l.count_id = ? ORDER BY p.name COLLATE NOCASE`,
    )
    .bind(id)
    .all<LineRow>();
  return rows.results ?? [];
}

stockCountRoutes.get('/', requirePermission('products.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const status = c.req.query('status') ?? '';
  const filters = ['1 = 1'];
  const bindings: string[] = [];
  if (status) {
    filters.push('status = ?');
    bindings.push(status);
  }
  const where = `WHERE ${filters.join(' AND ')}`;

  const total = await c.env.DB.prepare(`SELECT COUNT(*) AS count FROM stock_counts ${where}`)
    .bind(...bindings)
    .first<{ count: number }>();
  const rows = await c.env.DB.prepare(
    `SELECT * FROM stock_counts ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  )
    .bind(...bindings, per_page, offsetOf(page, per_page))
    .all<CountRow>();

  const count = total?.count ?? 0;
  return c.json({
    data: rows.results ?? [],
    meta: { page, per_page, total: count, total_pages: Math.max(1, Math.ceil(count / per_page)) },
  });
});

stockCountRoutes.post('/', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(createSchema, await c.req.json().catch(() => ({})));
  if (body.scope !== 'all' && !body.scope_value) {
    return fail(422, 'VALIDATION_ERROR', { scope_value: 'required' });
  }

  const open = await c.env.DB.prepare(
    `SELECT reference FROM stock_counts WHERE status = 'open' LIMIT 1`,
  ).first<{ reference: string }>();
  if (open) return fail(409, 'COUNT_ALREADY_OPEN', { reference: open.reference });

  // B2: a batch-tracked article is counted lot by lot, which this sheet cannot
  // express. Leaving it in would validate a stock figure the lots contradict.
  const filters = [`deleted_at IS NULL`, `item_type <> 'service'`, `track_quantity = 1`, `lot_tracking = 'none'`];
  const bindings: string[] = [];
  if (body.scope === 'location') {
    filters.push('warehouse_location = ?');
    bindings.push(body.scope_value as string);
  }
  if (body.scope === 'family') {
    filters.push('family = ?');
    bindings.push(body.scope_value as string);
  }

  const products = await c.env.DB.prepare(
    `SELECT id, quantity_milli, cost FROM products
     WHERE ${filters.join(' AND ')} ORDER BY name COLLATE NOCASE`,
  )
    .bind(...bindings)
    .all<{ id: string; quantity_milli: number; cost: number }>();
  const rows = products.results ?? [];
  if (!rows.length) return fail(422, 'COUNT_EMPTY');

  const today = nowISO().slice(0, 10);
  const reference = await nextNumber(c.env.DB, 'stock_count', 'INV', 'INV-{YYYY}-{####}', today);
  const id = crypto.randomUUID();
  const now = nowISO();

  await c.env.DB.prepare(
    `INSERT INTO stock_counts (id, reference, scope, scope_value, status, note, line_count, created_by, created_at)
     VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
  )
    .bind(id, reference, body.scope, body.scope_value, body.note, rows.length, user.id, now)
    .run();

  // D1 caps statements per batch, so a big shelf is written in chunks rather
  // than in one call that would fail only on the largest counts.
  for (let index = 0; index < rows.length; index += 40) {
    const chunk = rows.slice(index, index + 40);
    await c.env.DB.batch(
      chunk.map((product) =>
        c.env.DB.prepare(
          `INSERT INTO stock_count_lines (id, count_id, product_id, expected_milli, expected_cost)
           VALUES (?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), id, product.id,
          Number(product.quantity_milli ?? 0), Number(product.cost ?? 0),
        ),
      ),
    );
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'stock_count',
    entityId: id,
    summary: 'activity.stock_count_created',
    meta: { reference, scope: body.scope, scope_value: body.scope_value, lines: rows.length },
  });

  return c.json({ id, reference, line_count: rows.length }, 201);
});

stockCountRoutes.get('/:id', requirePermission('products.read'), async (c) => {
  const count = await loadCount(c.env.DB, c.req.param('id'));
  if (!count) return fail(404, 'NOT_FOUND');
  const lines = await loadLines(c.env.DB, count.id);

  const current = new Map(lines.map((line) => [line.product_id, Number(line.current_milli ?? 0)]));
  const stale = count.status === 'open'
    ? staleLines(
        lines.map((line) => ({
          product_id: line.product_id,
          expected_milli: Number(line.expected_milli),
          counted_milli: line.counted_milli === null ? null : Number(line.counted_milli),
        })),
        current,
      )
    : [];

  return c.json({
    ...count,
    lines,
    summary: countSummary(
      lines.map((line) => ({
        product_id: line.product_id,
        expected_milli: Number(line.expected_milli),
        counted_milli: line.counted_milli === null ? null : Number(line.counted_milli),
      })),
    ),
    stale_product_ids: stale.map((line) => line.product_id),
  });
});

stockCountRoutes.patch('/:id/lines', requirePermission('products.write'), async (c) => {
  const count = await loadCount(c.env.DB, c.req.param('id'));
  if (!count) return fail(404, 'NOT_FOUND');
  if (count.status !== 'open') return fail(409, 'COUNT_NOT_OPEN');

  const body = parseInput(countsSchema, await c.req.json().catch(() => ({})));
  const known = new Set((await loadLines(c.env.DB, count.id)).map((line) => line.product_id));
  const unknown = body.counts.filter((line) => !known.has(line.product_id));
  if (unknown.length) {
    return fail(422, 'VALIDATION_ERROR', { product_id: unknown[0].product_id });
  }

  const now = nowISO();
  const statements = body.counts.map((line) =>
    c.env.DB.prepare(
      `UPDATE stock_count_lines SET counted_milli = ? WHERE count_id = ? AND product_id = ?`,
    ).bind(line.counted === null ? null : Math.round(Number(line.counted)), count.id, line.product_id),
  );
  if (statements.length) await c.env.DB.batch(statements);
  await c.env.DB.prepare(`UPDATE stock_counts SET note = COALESCE(note, note) WHERE id = ?`).bind(count.id).run();

  return c.json({ ok: true, saved: body.counts.length, saved_at: now });
});

stockCountRoutes.post('/:id/validate', requirePermission('stock.adjust'), async (c) => {
  const user = c.get('user')!;
  const count = await loadCount(c.env.DB, c.req.param('id'));
  if (!count) return fail(404, 'NOT_FOUND');
  if (count.status !== 'open') return fail(409, 'COUNT_NOT_OPEN');

  const lines = await loadLines(c.env.DB, count.id);
  const shaped = lines.map((line) => ({
    product_id: line.product_id,
    expected_milli: Number(line.expected_milli),
    counted_milli: line.counted_milli === null ? null : Number(line.counted_milli),
  }));

  const pending = pendingLines(shaped);
  if (pending.length) {
    return fail(422, 'COUNT_INCOMPLETE', { pending: String(pending.length) });
  }

  const current = new Map(lines.map((line) => [line.product_id, Number(line.current_milli ?? 0)]));
  const stale = staleLines(shaped, current);
  if (stale.length) {
    const details: Record<string, string> = {};
    for (const line of stale) details[line.product_id] = `${line.expected_milli}>${line.current_milli}`;
    return fail(409, 'COUNT_STALE', details);
  }

  const adjustments = adjustmentsOf(shaped);
  const costs = new Map(lines.map((line) => [line.product_id, Number(line.expected_cost ?? 0)]));
  const locations = new Map(
    (
      await c.env.DB.prepare(
        `SELECT id, warehouse_location FROM products WHERE id IN (${lines.map(() => '?').join(', ') || 'NULL'})`,
      )
        .bind(...lines.map((line) => line.product_id))
        .all<{ id: string; warehouse_location: string | null }>()
    ).results?.map((row) => [row.id, row.warehouse_location]) ?? [],
  );
  const counted = new Map(lines.map((line) => [line.product_id, Number(line.counted_milli ?? 0)]));
  const now = nowISO();

  const statements: D1PreparedStatement[] = [];
  for (const adjustment of adjustments) {
    const movementId = crypto.randomUUID();
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO stock_movements
           (id, product_id, kind, quantity_milli, reason, reference, unit_cost, location, user_id, created_at)
         VALUES (?, ?, 'adjust', ?, 'stock_count', ?, ?, ?, ?, ?)`,
      ).bind(
        movementId, adjustment.product_id, adjustment.delta_milli, count.reference,
        costs.get(adjustment.product_id) ?? 0, locations.get(adjustment.product_id) ?? null, user.id, now,
      ),
      c.env.DB.prepare(
        `UPDATE products SET quantity_milli = ?, updated_at = ? WHERE id = ?`,
      ).bind(counted.get(adjustment.product_id) ?? 0, now, adjustment.product_id),
      c.env.DB.prepare(
        `UPDATE stock_count_lines SET movement_id = ? WHERE count_id = ? AND product_id = ?`,
      ).bind(movementId, count.id, adjustment.product_id),
    );
  }
  statements.push(
    c.env.DB.prepare(
      `UPDATE stock_counts SET status = 'validated', validated_by = ?, validated_at = ? WHERE id = ?`,
    ).bind(user.id, now, count.id),
  );
  await c.env.DB.batch(statements);

  const summary = countSummary(shaped);
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'validated',
    entityType: 'stock_count',
    entityId: count.id,
    summary: 'activity.stock_count_validated',
    meta: {
      reference: count.reference,
      lines: summary.total,
      shortages: summary.shortages,
      surpluses: summary.surpluses,
      adjusted: adjustments.length,
    },
  });

  return c.json({
    ok: true,
    reference: count.reference,
    adjusted_lines: adjustments.length,
    summary,
    validated_at: now,
  });
});

stockCountRoutes.post('/:id/cancel', requirePermission('products.write'), async (c) => {
  const user = c.get('user')!;
  const count = await loadCount(c.env.DB, c.req.param('id'));
  if (!count) return fail(404, 'NOT_FOUND');
  if (count.status !== 'open') return fail(409, 'COUNT_NOT_OPEN');

  const now = nowISO();
  await c.env.DB.prepare(
    `UPDATE stock_counts SET status = 'cancelled', cancelled_at = ? WHERE id = ?`,
  ).bind(now, count.id).run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'cancelled',
    entityType: 'stock_count',
    entityId: count.id,
    summary: 'activity.stock_count_cancelled',
    meta: { reference: count.reference },
  });

  return c.json({ ok: true, cancelled_at: now });
});
