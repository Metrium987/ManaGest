import { nowISO } from '../db';
import { ApiError } from '../lib/errors';
import { explodeKit } from '../../shared/product-erp';
import { convertToBase } from '../lib/fx';
import { landedUnitCost, stockValue, weightedAverageCost } from '../lib/valuation';
import { pickFefo, tracksLots, type LotPick, type StockLot } from '../lib/lots';
import { loadLots } from './lots';
import type { LineItem } from '../lib/tax';

export interface StockLine {
  product_id: string;
  quantity: number;
}

interface StockProduct {
  id: string;
  name: string;
  item_type: string;
  quantity_milli: number;
  track_quantity: number;
  allow_negative_stock: number;
  lot_tracking: string | null;
  warehouse_location: string | null;
  bom: string | null;
  bom_mode: string | null;
  cost: number;
}

const placeholdersOf = (ids: string[]) => ids.map(() => '?').join(', ');

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

/**
 * A-08: the XPF unit cost of a received line. A line price is in minor units of
 * the order's currency, so it is divided by the currency's decimals before the
 * frozen rate applies; a missing rate means an order entered in XPF.
 */
export function receiptUnitCost(unitPrice: unknown, fx?: { rate: number; decimals: number } | null): number {
  const amount = Math.round(Number(unitPrice ?? 0));
  return convertToBase(amount, Number(fx?.decimals ?? 0), Number(fx?.rate ?? 1));
}

/**
 * Receives a purchase order into stock.
 *
 * Only stockable items move: a service has no quantity to receive, and a line
 * without a catalogue reference is a free-text purchase that cannot be stocked.
 * The reference purchase price is refreshed with the price actually received;
 * the landed cost stays a manual figure until the valuation module computes it.
 *
 * A-08: `products.cost`, `products.purchase_price` and every movement/valuation
 * figure are in XPF. A receipt in a foreign currency is converted at the rate
 * frozen on the order *before* it enters the weighted average, so the stock is
 * never valued in two units at once.
 *
 * Returns what was actually received so the caller can report it (a reception
 * of a service-only order legitimately returns an empty list).
 */
export async function receivePurchaseOrder(
  database: D1Database,
  input: {
    reference: string | null;
    lines: LineItem[];
    userId: string;
    /** C2: the supplier of the order, so the price actually paid is recorded. */
    vendor_id?: string | null;
    /** A-08: rate and decimals of the order's currency, to value the goods in XPF. */
    fx?: { rate: number; decimals: number } | null;
  },
): Promise<StockLine[]> {
  const ids = [...new Set(
    input.lines.map((line) => line.product_id).filter((id): id is string => Boolean(id)),
  )];
  if (!ids.length) return [];

  const rows = await database
    .prepare(
      `SELECT id, item_type, warehouse_location, quantity_milli, cost, landed_cost, purchase_price
       FROM products
       WHERE id IN (${placeholdersOf(ids)}) AND deleted_at IS NULL`,
    )
    .bind(...ids)
    .all<{
      id: string;
      item_type: string;
      warehouse_location: string | null;
      quantity_milli: number;
      cost: number;
      landed_cost: number;
      purchase_price: number;
    }>();

  const byId = new Map((rows.results ?? []).map((row) => [row.id, row]));

  // Weighted average (B3): each reception re-prices the stock at what the goods
  // really cost, landed cost included. The running figures are kept per product
  // so two lines of the same item still average correctly in one reception.
  const running = new Map(
    (rows.results ?? []).map((row) => [
      row.id,
      { quantity_milli: Number(row.quantity_milli ?? 0), cost: Number(row.cost ?? 0) },
    ]),
  );

  const statements: D1PreparedStatement[] = [];
  const received: StockLine[] = [];
  const now = nowISO();

  for (const line of input.lines) {
    if (!line.product_id) continue;
    const product = byId.get(line.product_id);
    if (!product || product.item_type === 'service') continue;
    const quantityMilli = Math.round(Number(line.quantity) * 1000);
    if (quantityMilli <= 0) continue;

    const state = running.get(product.id) ?? {
      quantity_milli: Number(product.quantity_milli ?? 0),
      cost: Number(product.cost ?? 0),
    };
    const unitPriceXpf = receiptUnitCost(line.unit_price, input.fx);
    const unitCost = landedUnitCost({
      landed_cost: product.landed_cost,
      unit_price: unitPriceXpf,
    });
    const valued = weightedAverageCost({
      quantity_milli: state.quantity_milli,
      cost: state.cost,
      inbound_milli: quantityMilli,
      inbound_unit_cost: unitCost,
    });
    running.set(product.id, {
      quantity_milli: valued.quantity_after_milli,
      cost: valued.cost,
    });

    // C2: what was paid is a price with a date and a source. Only a change enters
    // the ledger — receiving the same price again must stay quiet — and the
    // comparison uses the purchase price, not the weighted average, because those
    // two answer different questions ("what did the supplier charge?" vs "what is
    // my stock worth?").
    const paidPrice = unitPriceXpf;
    if (input.vendor_id && paidPrice > 0 && paidPrice !== Number(product.purchase_price ?? 0)) {
      statements.push(
        database
          .prepare(
            `INSERT INTO product_vendor_prices
               (id, product_id, vendor_id, price, currency, recorded_at, source, source_ref)
             VALUES (?, ?, ?, ?,
               COALESCE((SELECT currency FROM product_vendors WHERE product_id = ? AND vendor_id = ?), 'XPF'),
               ?, 'receipt', ?)`,
          )
          .bind(
            crypto.randomUUID(), product.id, input.vendor_id, paidPrice,
            product.id, input.vendor_id, now, input.reference,
          ),
      );
    }

    const movementId = crypto.randomUUID();
    statements.push(
      database
        .prepare(
          `UPDATE products SET quantity_milli = quantity_milli + ?, cost = ?, purchase_price = ?,
             updated_at = ? WHERE id = ?`,
        )
        .bind(quantityMilli, valued.cost, unitPriceXpf, now, product.id),
      database
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, kind, quantity_milli, reason, reference, unit_cost, location, user_id, created_at)
           VALUES (?, ?, 'in', ?, 'purchase_receipt', ?, ?, ?, ?, ?)`,
        )
        .bind(
          movementId, product.id, quantityMilli, input.reference,
          unitCost, product.warehouse_location, input.userId, now,
        ),
      database
        .prepare(
          `INSERT INTO stock_valuations
             (id, product_id, movement_id, reason, quantity_before_milli, cost_before,
              inbound_milli, inbound_unit_cost, quantity_after_milli, cost_after, value_after, created_at)
           VALUES (?, ?, ?, 'purchase_receipt', ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(), product.id, movementId, state.quantity_milli, state.cost,
          quantityMilli, unitCost, valued.quantity_after_milli, valued.cost,
          stockValue(valued.quantity_after_milli, valued.cost), now,
        ),
    );
    received.push({ product_id: product.id, quantity: quantityMilli / 1000 });
  }

  if (statements.length) await database.batch(statements);
  return received;
}

interface Shortage {
  product_id: string;
  name: string;
  requested: number;
  available: number;
}

/**
 * Takes the sold goods out of stock when an invoice is issued.
 *
 * ManaGest has no delivery note, so the invoice plays the "direct sale" role
 * documented by ERPNext (`Update Stock` on a sales invoice) and by the usual
 * counter-sale practice: the financial document is also the physical one. If a
 * delivery note ever appears, this is the call that must move to it — and only
 * there — because posting both would take the goods twice.
 *
 * A service has nothing to pick, and an untracked item has no counter, so both
 * are skipped. A kit assembled to order is never stocked: its components are
 * picked instead, exactly as Odoo explodes a kit on the delivery document. An
 * in-stock kit is picked as a whole because it physically exists.
 *
 * A tracked item that is short is an explicit refusal (409 with the offending
 * lines) rather than a silent negative, unless its sheet allows negative stock.
 */
export async function consumeInvoiceStock(
  database: D1Database,
  input: { reference: string; lines: LineItem[]; userId: string },
): Promise<StockLine[]> {
  const lines = input.lines.filter((line) => line.product_id);
  if (!lines.length) return [];

  // One invoice is emitted once; a second pass would take the goods twice.
  const already = await database
    .prepare(`SELECT COUNT(*) AS count FROM stock_movements WHERE reference = ? AND reason = 'invoice'`)
    .bind(input.reference)
    .first<{ count: number }>();
  if ((already?.count ?? 0) > 0) return [];

  const soldIds = [...new Set(lines.map((line) => line.product_id as string))];
  const soldRows = await database
    .prepare(
      `SELECT id, name, item_type, quantity_milli, track_quantity, allow_negative_stock, lot_tracking,
              warehouse_location, bom, bom_mode, cost
       FROM products WHERE id IN (${placeholdersOf(soldIds)}) AND deleted_at IS NULL`,
    )
    .bind(...soldIds)
    .all<StockProduct>();
  const byId = new Map((soldRows.results ?? []).map((row) => [row.id, row]));

  const wanted = new Map<string, number>();
  for (const line of lines) {
    const productId = line.product_id as string;
    const quantityMilli = Math.round(Number(line.quantity) * 1000);
    if (quantityMilli <= 0) continue;
    const product = byId.get(productId);
    const bom = parseJson<{ product_id: string; quantity: number }[]>(product?.bom ?? null, []);
    // A kit assembled to order is a sales presentation, not a stock line: the
    // warehouse picks its components.
    if (product && product.item_type === 'kit' && product.bom_mode === 'on_order' && bom.length) {
      for (const component of explodeKit(bom, quantityMilli)) {
        wanted.set(component.product_id, (wanted.get(component.product_id) ?? 0) + component.quantity_milli);
      }
      continue;
    }
    wanted.set(productId, (wanted.get(productId) ?? 0) + quantityMilli);
  }

  // Components of a kit were not in the sold lines, so their rows are missing.
  const missingIds = [...wanted.keys()].filter((id) => !byId.has(id));
  if (missingIds.length) {
    const extra = await database
      .prepare(
        `SELECT id, name, item_type, quantity_milli, track_quantity, allow_negative_stock, lot_tracking,
                warehouse_location, bom, bom_mode, cost, deleted_at
         FROM products WHERE id IN (${placeholdersOf(missingIds)})`,
      )
      .bind(...missingIds)
      .all<StockProduct>();
    for (const row of extra.results ?? []) byId.set(row.id, row);
  }

  // A-14: a kit whose component vanished must be refused, not silently built
  // from the components that happen to remain. The message names the ids.
  const missingComponents = [...wanted.keys()].filter((id) => {
    const product = byId.get(id);
    return !product || Boolean((product as StockProduct & { deleted_at?: string | null }).deleted_at);
  });
  if (missingComponents.length) {
    throw new ApiError(422, 'KIT_COMPONENT_MISSING', { products: missingComponents.join(' | ') });
  }

  const shortages: Shortage[] = [];
  const picks: { product: StockProduct; quantityMilli: number }[] = [];

  for (const [productId, quantityMilli] of wanted) {
    const product = byId.get(productId);
    if (!product || product.item_type === 'service' || !Number(product.track_quantity)) continue;
    const available = Number(product.quantity_milli ?? 0);
    if (quantityMilli > available && !Number(product.allow_negative_stock)) {
      shortages.push({
        product_id: product.id,
        name: product.name,
        requested: quantityMilli / 1000,
        available: available / 1000,
      });
      continue;
    }
    picks.push({ product, quantityMilli });
  }

  if (shortages.length) throw shortageError(shortages);

  // B2: a batch-tracked article leaves the shelf batch by batch, soonest expiry
  // first. Taking the quantity from the article alone would make the traceability
  // claim hollow — nobody could say which batch reached the customer.
  const lotTracked = picks.filter(({ product }) => tracksLots(product.lot_tracking));
  const lotsByProduct: Map<string, StockLot[]> = lotTracked.length
    ? await loadLots(database, lotTracked.map(({ product }) => product.id))
    : new Map<string, StockLot[]>();
  const allocations = new Map<string, LotPick[]>();
  const lotShortages: Shortage[] = [];
  for (const { product, quantityMilli } of lotTracked) {
    const lots = lotsByProduct.get(product.id) ?? [];
    const { picks: taken, missing_milli } = pickFefo(lots, quantityMilli);
    if (missing_milli > 0 && !Number(product.allow_negative_stock)) {
      const available = lots.reduce((sum, lot) => sum + Math.max(0, Number(lot.quantity_milli ?? 0)), 0);
      lotShortages.push({
        product_id: product.id,
        name: product.name,
        requested: quantityMilli / 1000,
        available: available / 1000,
      });
      continue;
    }
    allocations.set(product.id, taken);
  }
  if (lotShortages.length) throw lotShortageError(lotShortages);

  const now = nowISO();
  const statements: D1PreparedStatement[] = [];
  const consumed: StockLine[] = [];

  for (const { product, quantityMilli } of picks) {
    statements.push(
      database
        .prepare(`UPDATE products SET quantity_milli = quantity_milli - ?, updated_at = ? WHERE id = ?`)
        .bind(quantityMilli, now, product.id),
    );
    const taken = allocations.get(product.id);
    if (taken?.length) {
      for (const pick of taken) {
        statements.push(
          database
            .prepare(`UPDATE stock_lots SET quantity_milli = MAX(0, quantity_milli - ?), updated_at = ? WHERE id = ?`)
            .bind(pick.quantity_milli, now, pick.lot_id),
          // Q12: relieve the shelf that actually holds the batch. A pick does not
          // name a location, so the fullest shelf of that lot is the one it left —
          // and the balance can never go negative.
          database
            .prepare(
              `UPDATE lot_balances SET quantity_milli = MAX(0, quantity_milli - ?), updated_at = ?
                WHERE lot_id = ? AND location = (
                  SELECT location FROM lot_balances
                   WHERE lot_id = ? AND quantity_milli > 0
                   ORDER BY quantity_milli DESC, location ASC LIMIT 1)`,
            )
            .bind(pick.quantity_milli, now, pick.lot_id, pick.lot_id),
          database
            .prepare(
              `INSERT INTO stock_movements
                 (id, product_id, kind, quantity_milli, reason, reference, location, lot, user_id, created_at)
               VALUES (?, ?, 'out', ?, 'invoice', ?, ?, ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(), product.id, pick.quantity_milli, input.reference,
              product.warehouse_location, pick.lot_code, input.userId, now,
            ),
        );
      }
      // Only reachable when the sheet allows negative stock: what the lots could
      // not cover is still sold, and the ledger says so without inventing a batch.
      const uncovered = quantityMilli - taken.reduce((sum, pick) => sum + pick.quantity_milli, 0);
      if (uncovered > 0) {
        statements.push(
          database
            .prepare(
              `INSERT INTO stock_movements
                 (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
               VALUES (?, ?, 'out', ?, 'invoice', ?, ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(), product.id, uncovered, input.reference,
              product.warehouse_location, input.userId, now,
            ),
        );
      }
    } else {
      statements.push(
        database
          .prepare(
            `INSERT INTO stock_movements
               (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
             VALUES (?, ?, 'out', ?, 'invoice', ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(), product.id, quantityMilli, input.reference,
            product.warehouse_location, input.userId, now,
          ),
      );
    }
    consumed.push({ product_id: product.id, quantity: quantityMilli / 1000 });
  }

  if (statements.length) await database.batch(statements);
  return consumed;
}

function shortageError(shortages: Shortage[]): ApiError {
  // Error details are flat strings by contract; the offending items are still
  // named so an API client can show what to receive or correct.
  return new ApiError(409, 'INSUFFICIENT_STOCK', {
    lines: shortages.map((row) => `${row.name}: ${row.requested} > ${row.available}`).join(' | '),
  });
}

function lotShortageError(shortages: Shortage[]): ApiError {
  // Named like the plain shortage, with its own code: "not enough of this batch"
  // is a picking problem, not a purchasing one.
  return new ApiError(409, 'INSUFFICIENT_LOT_STOCK', {
    lines: shortages.map((row) => `${row.name}: ${row.requested} > ${row.available}`).join(' | '),
  });
}

/** Assembly moves components and kits without naming a batch, so a lot-tracked
 * article is out of its reach until the assembly itself carries lots. */
function lotAssemblyError(names: string[]): ApiError {
  return new ApiError(422, 'LOT_ASSEMBLY_UNSUPPORTED', { products: names.join(' | ') });
}

interface KitRow extends StockProduct {
  item_type: string;
  bom_mode: string;
}

async function loadKit(
  database: D1Database,
  id: string,
): Promise<{ kit: KitRow; bom: { product_id: string; quantity: number }[]; components: StockProduct[] }> {
  const kit = await database
    .prepare(
      `SELECT id, name, item_type, quantity_milli, track_quantity, allow_negative_stock, lot_tracking,
              warehouse_location, bom, bom_mode, cost
       FROM products WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(id)
    .first<KitRow>();
  if (!kit) throw new ApiError(404, 'NOT_FOUND');
  const bom = parseJson<{ product_id: string; quantity: number }[]>(kit.bom, []);
  if (kit.item_type !== 'kit' || !bom.length) {
    throw new ApiError(422, 'VALIDATION_ERROR', { item_type: 'not_a_kit' });
  }
  const ids = [...new Set(bom.map((line) => line.product_id))];
  const rows = await database
    .prepare(
      `SELECT id, name, item_type, quantity_milli, track_quantity, allow_negative_stock, lot_tracking,
              warehouse_location, bom, bom_mode, cost
       FROM products WHERE id IN (${placeholdersOf(ids)}) AND deleted_at IS NULL`,
    )
    .bind(...ids)
    .all<StockProduct>();
  return { kit, bom, components: rows.results ?? [] };
}

/**
 * Assembles kits: components leave stock, the finished kit enters it, in one
 * batch under a shared reference (the ERPNext `Manufacture` / `Repack` entry).
 *
 * Only an in-stock kit can be assembled — an on-order kit is a phantom sold as
 * one line and picked as its components, so stocking it as well would count the
 * same goods twice. Every component must be available: assembly is a physical
 * act, not a promise, and Odoo gates it the same way. The kit's cost becomes the
 * cost of what went into it, otherwise its margin would be meaningless.
 */
export async function assembleKit(
  database: D1Database,
  input: { productId: string; quantityMilli: number; reference?: string | null; userId: string },
): Promise<{ reference: string; movements: StockLine[] }> {
  const { kit, bom, components } = await loadKit(database, input.productId);
  const lotTracked = [kit, ...components].filter((row) => tracksLots(row.lot_tracking));
  if (lotTracked.length) throw lotAssemblyError(lotTracked.map((row) => row.name));
  if (kit.bom_mode !== 'in_stock') {
    throw new ApiError(422, 'VALIDATION_ERROR', { bom_mode: 'assemble_on_order' });
  }
  const byId = new Map(components.map((row) => [row.id, row]));

  const needed = explodeKit(bom, input.quantityMilli);
  const shortages: Shortage[] = [];
  for (const line of needed) {
    const component = byId.get(line.product_id);
    if (!component || component.item_type === 'service') continue;
    const available = Number(component.quantity_milli ?? 0);
    if (line.quantity_milli > available) {
      shortages.push({
        product_id: component.id,
        name: component.name,
        requested: line.quantity_milli / 1000,
        available: available / 1000,
      });
    }
  }
  if (shortages.length) throw shortageError(shortages);

  const reference = input.reference?.trim() || `ASM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = nowISO();
  const statements: D1PreparedStatement[] = [];
  const movements: StockLine[] = [];
  let unitCost = 0;

  for (const line of needed) {
    const component = byId.get(line.product_id);
    if (!component || line.quantity_milli <= 0) continue;
    unitCost += Number(component.cost ?? 0) * (line.quantity_milli / 1000) / (input.quantityMilli / 1000);
    statements.push(
      database
        .prepare(`UPDATE products SET quantity_milli = quantity_milli - ?, updated_at = ? WHERE id = ?`)
        .bind(line.quantity_milli, now, component.id),
      database
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
           VALUES (?, ?, 'out', ?, 'kit_assembly', ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(), component.id, line.quantity_milli, reference,
          component.warehouse_location, input.userId, now,
        ),
    );
    movements.push({ product_id: component.id, quantity: line.quantity_milli / 1000 });
  }

  statements.push(
    database
      .prepare(`UPDATE products SET quantity_milli = quantity_milli + ?, cost = ?, updated_at = ? WHERE id = ?`)
      .bind(input.quantityMilli, Math.round(unitCost), now, kit.id),
    database
      .prepare(
        `INSERT INTO stock_movements
           (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
         VALUES (?, ?, 'in', ?, 'kit_assembly', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(), kit.id, input.quantityMilli, reference,
        kit.warehouse_location, input.userId, now,
      ),
  );
  movements.push({ product_id: kit.id, quantity: input.quantityMilli / 1000 });

  await database.batch(statements);
  return { reference, movements };
}

/**
 * Disassembles kits: the kit leaves stock and its components come back, under a
 * shared reference. This is the reverse of an assembly, not a correction of it —
 * the assembly stays in the ledger, exactly as an unbuild order does next to the
 * manufacturing order it reverses.
 */
export async function disassembleKit(
  database: D1Database,
  input: { productId: string; quantityMilli: number; reference?: string | null; userId: string },
): Promise<{ reference: string; movements: StockLine[] }> {
  const { kit, bom, components } = await loadKit(database, input.productId);
  const lotTracked = [kit, ...components].filter((row) => tracksLots(row.lot_tracking));
  if (lotTracked.length) throw lotAssemblyError(lotTracked.map((row) => row.name));
  const available = Number(kit.quantity_milli ?? 0);
  if (input.quantityMilli > available) {
    throw shortageError([{
      product_id: kit.id,
      name: kit.name,
      requested: input.quantityMilli / 1000,
      available: available / 1000,
    }]);
  }
  const byId = new Map(components.map((row) => [row.id, row]));
  const reference = input.reference?.trim() || `UNB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const now = nowISO();
  const statements: D1PreparedStatement[] = [
    database
      .prepare(`UPDATE products SET quantity_milli = quantity_milli - ?, updated_at = ? WHERE id = ?`)
      .bind(input.quantityMilli, now, kit.id),
    database
      .prepare(
        `INSERT INTO stock_movements
           (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
         VALUES (?, ?, 'out', ?, 'kit_unbuild', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(), kit.id, input.quantityMilli, reference,
        kit.warehouse_location, input.userId, now,
      ),
  ];
  const movements: StockLine[] = [{ product_id: kit.id, quantity: input.quantityMilli / 1000 }];

  for (const line of explodeKit(bom, input.quantityMilli)) {
    const component = byId.get(line.product_id);
    if (!component || line.quantity_milli <= 0) continue;
    statements.push(
      database
        .prepare(`UPDATE products SET quantity_milli = quantity_milli + ?, updated_at = ? WHERE id = ?`)
        .bind(line.quantity_milli, now, component.id),
      database
        .prepare(
          `INSERT INTO stock_movements
             (id, product_id, kind, quantity_milli, reason, reference, location, user_id, created_at)
           VALUES (?, ?, 'in', ?, 'kit_unbuild', ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(), component.id, line.quantity_milli, reference,
          component.warehouse_location, input.userId, now,
        ),
    );
    movements.push({ product_id: component.id, quantity: line.quantity_milli / 1000 });
  }

  await database.batch(statements);
  return { reference, movements };
}
