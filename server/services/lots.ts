import { nowISO } from '../db';
import { ApiError } from '../lib/errors';
import {
  lotTrackingMode,
  normaliseExpiryDate,
  normaliseLotCode,
  type StockLot,
} from '../lib/lots';
import { stockValue, weightedAverageCost } from '../lib/valuation';

/**
 * Lots and serial numbers (B2).
 *
 * A lot is a batch of one article — same delivery, same expiry — and a serial
 * number is a batch of exactly one unit. Odoo models both the same way, which is
 * why one table and one mode flag serve the two.
 *
 * Reception is the only place a lot is created: goods enter with a batch, never
 * by guessing one afterwards. The quantity is added to the lot and to the article
 * in the same batch of statements, so "on hand = sum of lots" holds without a
 * reconciliation job.
 */

export interface LotRow {
  id: string;
  lot_code: string;
  expiry_date: string | null;
  location: string | null;
  quantity_milli: number;
  created_at: string;
  updated_at: string;
}

export async function listLots(database: D1Database, productId: string): Promise<LotRow[]> {
  const rows = await database
    .prepare(
      `SELECT id, lot_code, expiry_date, location, quantity_milli, created_at, updated_at
       FROM stock_lots WHERE product_id = ?
       ORDER BY expiry_date IS NULL, expiry_date ASC, created_at ASC, lot_code ASC`,
    )
    .bind(productId)
    .all<LotRow>();
  return rows.results ?? [];
}

/**
 * Lots of several articles at once: an invoice must not run one query per line.
 * Empty lots are left out — they cannot be picked, and the report of what is on
 * the shelf is already the lot list.
 */
export async function loadLots(
  database: D1Database,
  productIds: string[],
): Promise<Map<string, StockLot[]>> {
  const byProduct = new Map<string, StockLot[]>();
  if (!productIds.length) return byProduct;
  const rows = await database
    .prepare(
      `SELECT id, product_id, lot_code, expiry_date, quantity_milli, created_at FROM stock_lots
       WHERE product_id IN (${productIds.map(() => '?').join(', ')}) AND quantity_milli > 0`,
    )
    .bind(...productIds)
    .all<StockLot & { product_id: string }>();
  for (const row of rows.results ?? []) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push(row);
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}

export interface ReceiveLotInput {
  productId: string;
  lotCode: unknown;
  expiryDate: unknown;
  location: string | null;
  quantityMilli: number;
  unitCost: number;
  reference: string | null;
  userId: string;
}

export interface ReceivedLot {
  id: string;
  product_id: string;
  lot_code: string;
  expiry_date: string | null;
  quantity_milli: number;
  movement_id: string;
}

export async function receiveLot(
  database: D1Database,
  input: ReceiveLotInput,
): Promise<ReceivedLot> {
  const product = await database
    .prepare(
      `SELECT id, name, track_quantity, lot_tracking, quantity_milli, cost, warehouse_location
       FROM products WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(input.productId)
    .first<{
      id: string;
      name: string;
      track_quantity: number;
      lot_tracking: string | null;
      quantity_milli: number;
      cost: number;
      warehouse_location: string | null;
    }>();
  if (!product) throw new ApiError(404, 'NOT_FOUND');

  const mode = lotTrackingMode(product.lot_tracking);
  if (!Number(product.track_quantity) || mode === 'none') {
    // A lot on an article nobody tracks would be a batch with no shelf behind it.
    throw new ApiError(422, 'VALIDATION_ERROR', { lot_tracking: 'not_enabled' });
  }

  const code = normaliseLotCode(input.lotCode);
  if (!code) throw new ApiError(422, 'VALIDATION_ERROR', { lot_code: 'required' });

  const quantityMilli = Math.round(Number(input.quantityMilli));
  if (!Number.isFinite(quantityMilli) || quantityMilli <= 0) {
    throw new ApiError(422, 'VALIDATION_ERROR', { quantity: 'positive' });
  }
  if (mode === 'serial' && quantityMilli !== 1000) {
    // A serial number is one physical unit; receiving two under one serial would
    // make every later traceability answer wrong.
    throw new ApiError(422, 'VALIDATION_ERROR', { quantity: 'serial_single_unit' });
  }

  const expiry = normaliseExpiryDate(input.expiryDate);
  if (input.expiryDate && !expiry) {
    throw new ApiError(422, 'VALIDATION_ERROR', { expiry_date: 'invalid' });
  }

  const existing = await database
    .prepare(`SELECT id FROM stock_lots WHERE product_id = ? AND lot_code = ?`)
    .bind(product.id, code)
    .first<{ id: string }>();
  if (existing && mode === 'serial') {
    throw new ApiError(409, 'LOT_ALREADY_EXISTS', { lot_code: code });
  }

  const now = nowISO();
  const lotId = existing?.id ?? crypto.randomUUID();
  const unitCost = Math.max(0, Math.round(Number(input.unitCost ?? 0)));
  const quantityBefore = Number(product.quantity_milli ?? 0);
  const costBefore = Number(product.cost ?? 0);
  const valued = unitCost > 0
    ? weightedAverageCost({
      quantity_milli: quantityBefore,
      cost: costBefore,
      inbound_milli: quantityMilli,
      inbound_unit_cost: unitCost,
    })
    : null;
  const movementId = crypto.randomUUID();
  const location = input.location ?? product.warehouse_location ?? null;

  const statements: D1PreparedStatement[] = [
    database
      .prepare(
        `INSERT INTO stock_lots (id, product_id, lot_code, expiry_date, location, quantity_milli, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(product_id, lot_code) DO UPDATE SET
           quantity_milli = stock_lots.quantity_milli + excluded.quantity_milli,
           expiry_date = COALESCE(excluded.expiry_date, stock_lots.expiry_date),
           location = COALESCE(excluded.location, stock_lots.location),
           updated_at = excluded.updated_at`,
      )
      .bind(lotId, product.id, code, expiry, location, quantityMilli, now, now),
    valued
      ? database
        .prepare(`UPDATE products SET quantity_milli = quantity_milli + ?, cost = ?, updated_at = ? WHERE id = ?`)
        .bind(quantityMilli, valued.cost, now, product.id)
      : database
        .prepare(`UPDATE products SET quantity_milli = quantity_milli + ?, updated_at = ? WHERE id = ?`)
        .bind(quantityMilli, now, product.id),
    database
      .prepare(
        `INSERT INTO stock_movements
           (id, product_id, kind, quantity_milli, reason, reference, unit_cost, location, lot, user_id, created_at)
         VALUES (?, ?, 'in', ?, 'lot_receipt', ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        movementId, product.id, quantityMilli, input.reference, unitCost, location, code,
        input.userId, now,
      ),
    // Q12: the batch lands on a shelf, so the shelf receives it too.
    database
      .prepare(
        `INSERT INTO lot_balances (lot_id, location, quantity_milli, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(lot_id, location) DO UPDATE SET
           quantity_milli = lot_balances.quantity_milli + excluded.quantity_milli,
           updated_at = excluded.updated_at`,
      )
      .bind(lotId, location ?? '', quantityMilli, now),
  ];

  if (valued) {
    statements.push(
      database
        .prepare(
          `INSERT INTO stock_valuations
             (id, product_id, movement_id, reason, quantity_before_milli, cost_before,
              inbound_milli, inbound_unit_cost, quantity_after_milli, cost_after, value_after, created_at)
           VALUES (?, ?, ?, 'lot_receipt', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(), product.id, movementId, quantityBefore, costBefore,
          quantityMilli, unitCost, valued.quantity_after_milli, valued.cost,
          stockValue(valued.quantity_after_milli, valued.cost), now,
        ),
    );
  }

  await database.batch(statements);
  return {
    id: lotId,
    product_id: product.id,
    lot_code: code,
    expiry_date: expiry,
    quantity_milli: quantityMilli,
    movement_id: movementId,
  };
}
