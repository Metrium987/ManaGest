import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { csvResponse, toCsv } from '../lib/csv';
import { fail } from '../lib/errors';
import {
  IMPORT_COLUMNS,
  parseCsv,
  templateCsv,
  toBoolean,
  validateImport,
  type ImportEntity,
  type ValidationResult,
} from '../lib/import';
import { hasPermission } from '../lib/permissions';
import { nextNumber } from '../lib/numbering';
import { parseInput } from '../lib/validation';
import { requireAuth } from '../middleware';
import type { MiddlewareHandler } from 'hono';
import type { AppEnv } from '../types';

/**
 * Import (T-102a / OQ-015): template download, preview with row-level errors,
 * and an all-or-nothing commit. The preview and the commit run the same
 * validation, so a client that skips the preview can never store unchecked rows.
 */

const ENTITIES: ImportEntity[] = ['clients', 'products'];

const bodySchema = z.object({
  text: z.string().min(1).max(2_000_000),
  /** Explicit user choice: rows still in error are excluded, never silently dropped. */
  skip_invalid: z.coerce.boolean().default(false),
});

function permissionFor(entity: ImportEntity) {
  return entity === 'clients' ? 'clients.write' : 'products.write';
}

function assertEntity(value: string): ImportEntity {
  if (!ENTITIES.includes(value as ImportEntity)) {
    fail(404, 'NOT_FOUND');
  }
  return value as ImportEntity;
}

/** Existing keys, so the preview can tell "create" from "update". */
async function existingKeys(database: D1Database, entity: ImportEntity): Promise<Set<string>> {
  const sql = entity === 'clients'
    ? `SELECT lower(email) AS key FROM clients WHERE deleted_at IS NULL AND email IS NOT NULL
       UNION SELECT number AS key FROM clients WHERE deleted_at IS NULL`
    : `SELECT product_key AS key FROM products WHERE deleted_at IS NULL AND product_key IS NOT NULL`;
  const rows = await database.prepare(sql).all<{ key: string }>();
  return new Set((rows.results ?? []).map((row) => String(row.key).toLowerCase()));
}

function report(result: ValidationResult, existing: Set<string>) {
  return {
    missing_columns: result.missingColumns,
    valid_count: result.validCount,
    invalid_count: result.invalidCount,
    rows: result.rows.map((row) => ({
      row: row.row,
      values: row.values,
      valid: row.valid,
      action: row.key && existing.has(row.key.toLowerCase()) ? 'update' : 'create',
      issues: row.issues,
    })),
  };
}

/** Per-entity permission guard, declared on each registration line. */
const entityGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  const entity = assertEntity(c.req.param('entity') ?? '');
  if (!hasPermission(c.get('user')!.role, permissionFor(entity))) return fail(403, 'FORBIDDEN');
  await next();
};

export const importRoutes = new Hono<AppEnv>();
importRoutes.use('*', requireAuth);

importRoutes.get('/template/:entity', requireAuth, entityGuard, async (c) => {
  const entity = assertEntity(c.req.param('entity'));
  return csvResponse(templateCsv(entity), `modele-${entity}.csv`);
});

importRoutes.get('/columns/:entity', requireAuth, entityGuard, async (c) => {
  const entity = assertEntity(c.req.param('entity'));
  return c.json({ columns: IMPORT_COLUMNS[entity] });
});

importRoutes.post('/preview/:entity', requireAuth, entityGuard, async (c) => {
  const entity = assertEntity(c.req.param('entity'));
  const body = parseInput(bodySchema, await c.req.json().catch(() => ({})));
  const parsed = parseCsv(body.text);
  const result = validateImport(entity, parsed);
  if (result.missingColumns.length > 0) {
    return fail(422, 'IMPORT_COLUMNS_MISSING', { columns: result.missingColumns.join(', ') });
  }
  const existing = await existingKeys(c.env.DB, entity);
  return c.json({ delimiter: parsed.delimiter, ...report(result, existing) });
});

importRoutes.post('/commit/:entity', requireAuth, entityGuard, async (c) => {
  const entity = assertEntity(c.req.param('entity'));
  const company = c.get('company')!;
  const user = c.get('user')!;
  const body = parseInput(bodySchema, await c.req.json().catch(() => ({})));
  const parsed = parseCsv(body.text);
  const result = validateImport(entity, parsed);

  if (result.missingColumns.length > 0) {
    return fail(422, 'IMPORT_COLUMNS_MISSING', { columns: result.missingColumns.join(', ') });
  }
  if (result.invalidCount > 0 && !body.skip_invalid) {
    return fail(409, 'IMPORT_ROWS_INVALID', { rows: String(result.invalidCount) });
  }
  if (result.rows.length === 0) {
    return fail(422, 'IMPORT_EMPTY');
  }

  const existing = await existingKeys(c.env.DB, entity);
  const now = nowISO();
  const statements: D1PreparedStatement[] = [];
  const created: string[] = [];
  const updated: string[] = [];
  const today = new Date(now).toISOString().slice(0, 10);

  for (const row of result.rows) {
    if (!row.valid) continue;
    const values = row.values;
    const isUpdate = row.key ? existing.has(row.key.toLowerCase()) : false;

    if (entity === 'clients') {
      const fields = {
        display_name: values.display_name,
        email: values.email || null,
        phone: values.phone || null,
        address1: values.address1 || null,
        address2: values.address2 || null,
        city: values.city || null,
        postal_code: values.postal_code || null,
        // `country` is NOT NULL in the schema: island businesses default to the local territory.
        country: values.country || 'Polynésie française',
        tax_id: values.tax_id || null,
        payment_terms: values.payment_terms ? Number(values.payment_terms) : 30,
        is_tax_exempt: values.is_tax_exempt ? toBoolean(values.is_tax_exempt) : 0,
        currency: values.currency || company.currency,
        notes: values.notes || null,
        archived: values.archived ? toBoolean(values.archived) : 0,
      };
      if (isUpdate) {
        statements.push(
          c.env.DB.prepare(
            `UPDATE clients SET display_name = ?, email = ?, phone = ?, address1 = ?, address2 = ?, city = ?,
               postal_code = ?, country = ?, tax_id = ?, payment_terms = ?, is_tax_exempt = ?, currency = ?,
               notes = ?, archived = ?, updated_at = ?
             WHERE deleted_at IS NULL AND (lower(email) = lower(?) OR number = ?)`,
          ).bind(
            fields.display_name, fields.email, fields.phone, fields.address1, fields.address2, fields.city,
            fields.postal_code, fields.country, fields.tax_id, fields.payment_terms, fields.is_tax_exempt,
            fields.currency, fields.notes, fields.archived, now, row.key, values.number || row.key,
          ),
        );
        updated.push(fields.display_name);
      } else {
        const number = values.number
          || await nextNumber(c.env.DB, 'client', 'CLI', company.number_pattern, today);
        statements.push(
          c.env.DB.prepare(
            `INSERT INTO clients (id, number, display_name, email, phone, address1, address2, city, postal_code,
               country, tax_id, payment_terms, is_tax_exempt, currency, notes, archived, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).bind(
            crypto.randomUUID(), number, fields.display_name, fields.email, fields.phone, fields.address1,
            fields.address2, fields.city, fields.postal_code, fields.country, fields.tax_id,
            fields.payment_terms, fields.is_tax_exempt, fields.currency, fields.notes, fields.archived, now, now,
          ),
        );
        created.push(number);
      }
      continue;
    }

    const productKey = values.product_key || `PRD-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const fields = {
      product_key: productKey,
      name: values.name,
      description: values.description || null,
      unit_price: values.unit_price ? Number(values.unit_price) : 0,
      cost: values.cost ? Number(values.cost) : 0,
      quantity_milli: values.quantity_milli ? Number(values.quantity_milli) : 0,
      track_quantity: values.track_quantity ? toBoolean(values.track_quantity) : 0,
      tax_rate: values.tax_rate ? Number(values.tax_rate) : (company.default_tax_rate ?? 0),
    };
    if (isUpdate) {
      statements.push(
        c.env.DB.prepare(
          `UPDATE products SET name = ?, description = ?, unit_price = ?, cost = ?, quantity_milli = ?,
             track_quantity = ?, tax_rate = ?, updated_at = ?
           WHERE deleted_at IS NULL AND product_key = ?`,
        ).bind(
          fields.name, fields.description, fields.unit_price, fields.cost, fields.quantity_milli,
          fields.track_quantity, fields.tax_rate, now, productKey,
        ),
      );
      updated.push(productKey);
    } else {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO products (id, product_key, name, description, unit_price, cost, quantity_milli,
             track_quantity, tax_rate, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          crypto.randomUUID(), productKey, fields.name, fields.description, fields.unit_price, fields.cost,
          fields.quantity_milli, fields.track_quantity, fields.tax_rate, now, now,
        ),
      );
      created.push(productKey);
    }
  }

  if (statements.length > 0) {
    // D1 runs a batch as one transaction: either every row lands or none does.
    await c.env.DB.batch(statements);
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'imported',
    entityType: entity,
    entityId: null,
    summary: 'activity.data_imported',
    meta: { entity, created: created.length, updated: updated.length, skipped: result.invalidCount },
  });

  return c.json({
    created: created.length,
    updated: updated.length,
    skipped: result.invalidCount,
    invalid_count: result.invalidCount,
    identifiers: [...created, ...updated],
    csv: toCsv([{ key: 'identifier', label: 'identifiant' }], [...created, ...updated].map((identifier) => ({ identifier }))),
  }, 201);
});
