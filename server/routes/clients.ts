import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import {
  attachmentMaxMb,
  decodeBase64Strict,
  encodeBase64,
  joinChunks,
  sha256Hex,
  splitChunks,
  validateAttachment,
} from '../lib/attachments';
import { fail } from '../lib/errors';
import { nextSimpleNumber } from '../lib/numbering';
import { getExtra } from '../lib/settings-extra';
import { offsetOf, optionalIsoDate, optionalText, paginationSchema, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { CLIENT_STATS_SQL } from '../services/documents';
import {
  CLIENT_ACCOUNT_STATUSES,
  CLIENT_BANKS,
  CLIENT_DOCUMENT_TYPES,
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_PAYMENT_TERM_DAYS,
  CLIENT_VAT_REGIMES,
  ENTITY_CATEGORIES,
  ENTITY_CATEGORY_PREFIX,
  LEGAL_FORMS,
  checklistFor,
  isLegalEntity,
  missingDocuments,
  type ClientDocumentType,
  type EntityCategory,
} from '../../shared/client-profile';
import { PRICE_TIERS } from '../../shared/product-erp';
import type { AppEnv } from '../types';

const taxIdPattern = /^([A-Z]\d{5}|\d{7})$/;

const clientSchema = z
  .object({
    display_name: z.string().trim().min(1).max(160),
    entity_category: z.enum(ENTITY_CATEGORIES).default('PRIVATE_COMPANY'),

    // Section 1 — legal profile.
    legal_name: optionalText(160),
    trade_name: optionalText(160),
    legal_form: z.enum(LEGAL_FORMS).nullish().transform((value) => value ?? null),
    tax_id: optionalText(20).transform((value) => (value ? value.toUpperCase() : null)),
    numero_rcs: optionalText(40),
    numero_tps: optionalText(40),
    vat_regime: z.enum(CLIENT_VAT_REGIMES).nullish().transform((value) => value ?? null),
    price_tier: z.enum(PRICE_TIERS).default('public'),

    // Section 2 — designated contact and signatory.
    first_name: optionalText(80),
    last_name: optionalText(80),
    email: z.union([z.string().trim().toLowerCase().email().max(190), z.literal(''), z.null()]).optional()
      .transform((v) => (v ? v : null)),
    phone: optionalText(40),
    contact_role: optionalText(80),
    has_delegation_authority: z.boolean().default(false),

    // Section 3 — billing and physical address.
    address1: optionalText(160),
    address2: optionalText(160),
    po_box_number: optionalText(40),
    po_box_municipality: optionalText(80),
    postal_code: optionalText(20),
    island: optionalText(80),
    physical_municipality: optionalText(80),
    district: optionalText(80),
    pk_landmark: optionalText(80),
    street_building_zone: optionalText(160),
    delivery_instructions: optionalText(500),
    city: optionalText(80),
    country: z.string().trim().max(80).default('Polynésie française'),

    // Section 4 — commercial and billing terms.
    payment_method: z.enum(CLIENT_PAYMENT_METHODS).nullish().transform((value) => value ?? null),
    payment_terms_code: z.enum(CLIENT_PAYMENT_TERMS).nullish().transform((value) => value ?? null),
    payment_terms: z.coerce.number().int().min(0).max(365).optional(),
    bank_name: z.enum(CLIENT_BANKS).nullish().transform((value) => value ?? null),
    iban: optionalText(60),
    credit_limit: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
    is_tax_exempt: z.boolean().default(false),
    tax_exemption_decree_num: optionalText(60),
    tax_exemption_expiry: optionalIsoDate,

    // Section 6 — compliance.
    data_consent_accepted: z.boolean().default(false),
    account_status: z.enum(CLIENT_ACCOUNT_STATUSES).optional(),

    notes: optionalText(4000),
  })
  .superRefine((body, ctx) => {
    const require = (field: keyof typeof body, path = String(field)) => {
      const value = body[field];
      if (value === null || value === undefined || value === '' || value === false) {
        ctx.addIssue({ code: 'custom', path: [path], message: 'required' });
      }
    };
    const legalEntity = isLegalEntity(body.entity_category);

    if (legalEntity) {
      require('legal_name');
      require('legal_form');
      require('vat_regime');
      require('po_box_number');
    }
    if (legalEntity || !body.last_name) require('last_name');
    if (legalEntity) {
      require('email');
      require('phone');
    }
    if (body.tax_id && !taxIdPattern.test(body.tax_id)) {
      ctx.addIssue({ code: 'custom', path: ['tax_id'], message: 'invalid_tahiti_number' });
    }
    require('po_box_municipality');
    require('postal_code');
    require('payment_method');
    require('payment_terms_code');
    if (!body.data_consent_accepted) {
      ctx.addIssue({ code: 'custom', path: ['data_consent_accepted'], message: 'consent_required' });
    }
  });

type ClientInput = z.infer<typeof clientSchema>;

/** The invoice/dunning engine reads `payment_terms` in days, the form an enum. */
function resolvePaymentDays(body: ClientInput, fallbackDays: number): number {
  if (body.payment_terms_code) return CLIENT_PAYMENT_TERM_DAYS[body.payment_terms_code];
  return body.payment_terms ?? fallbackDays;
}

/** Default term comes from the company settings, not from a constant in the code. */
async function defaultPaymentDays(database: D1Database): Promise<number> {
  const row = await database
    .prepare('SELECT payment_terms FROM company LIMIT 1')
    .first<{ payment_terms: number }>();
  return Number(row?.payment_terms ?? 0);
}

/** Documents on file for a client, required or not. */
async function uploadedDocumentTypes(database: D1Database, clientId: string): Promise<string[]> {
  const rows = await database
    .prepare(`SELECT DISTINCT doc_type FROM client_documents WHERE client_id = ? AND deleted_at IS NULL`)
    .bind(clientId)
    .all<{ doc_type: string }>();
  return (rows.results ?? []).map((row) => row.doc_type);
}

/**
 * Section 5: a client stays in PENDING_DOCUMENTS until every required document
 * is uploaded, then moves to UNDER_REVIEW. A manual APPROVED/REJECTED decision
 * is kept, unless the files backing it are gone.
 */
function resolveStatus(
  current: string,
  category: EntityCategory,
  uploaded: readonly string[],
  requested?: string,
): string {
  const missing = missingDocuments(category, uploaded);
  if (requested) {
    if (requested === 'APPROVED' && missing.length > 0) return current === 'APPROVED' ? 'APPROVED' : 'UNDER_REVIEW';
    return requested;
  }
  if (missing.length > 0) return 'PENDING_DOCUMENTS';
  return current === 'PENDING_DOCUMENTS' ? 'UNDER_REVIEW' : current;
}

async function documentMaxBytes(database: D1Database): Promise<number> {
  return attachmentMaxMb(await getExtra(database, 'attachment_max_mb')) * 1024 * 1024;
}

function syncLegacyAddress(body: ClientInput): { address1: string | null; city: string | null } {
  // Invoices and PDFs read address1/city: keep them fed from the physical site
  // address, falling back to the postal box, so a document is never blank.
  const address1 = body.street_building_zone
    ?? (body.po_box_number ? `B.P. ${body.po_box_number}` : body.address1);
  const city = body.physical_municipality ?? body.po_box_municipality ?? body.city;
  return { address1: address1 ?? null, city: city ?? null };
}

export const clientRoutes = new Hono<AppEnv>();
clientRoutes.use('*', requireAuth);

clientRoutes.get('/', requirePermission('clients.read'), async (c) => {
  const { page, per_page } = parseInput(z.object(paginationSchema), c.req.query());
  const search = (c.req.query('q') ?? '').trim();
  const archived = c.req.query('archived') === 'true';
  const category = c.req.query('entity_category') ?? '';
  const status = c.req.query('account_status') ?? '';

  const filters = ['c.deleted_at IS NULL', `c.archived = ${archived ? 1 : 0}`];
  const bindings: (string | number)[] = [];
  if (search) {
    filters.push('(c.display_name LIKE ? OR c.legal_name LIKE ? OR c.email LIKE ? OR c.city LIKE ? OR c.tax_id LIKE ? OR c.number LIKE ?)');
    bindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if ((ENTITY_CATEGORIES as readonly string[]).includes(category)) {
    filters.push('c.entity_category = ?');
    bindings.push(category);
  }
  if ((CLIENT_ACCOUNT_STATUSES as readonly string[]).includes(status)) {
    filters.push('c.account_status = ?');
    bindings.push(status);
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

clientRoutes.get('/:id/documents', requirePermission('clients.read'), async (c) => {
  const id = c.req.param('id');
  const client = await c.env.DB.prepare(
    `SELECT id, entity_category FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; entity_category: EntityCategory }>();
  if (!client) return fail(404, 'NOT_FOUND');

  const rows = await c.env.DB.prepare(
    `SELECT d.id, d.doc_type, d.filename, d.mime_type, d.size_bytes, d.created_at,
            u.first_name, u.last_name
       FROM client_documents d
       LEFT JOIN users u ON u.id = d.uploaded_by
      WHERE d.client_id = ? AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC`,
  )
    .bind(id)
    .all<Record<string, unknown>>();

  const uploaded = (rows.results ?? []).map((row) => String(row.doc_type));
  return c.json({
    documents: (rows.results ?? []).map((row) => ({
      id: row.id,
      doc_type: row.doc_type,
      filename: row.filename,
      mime_type: row.mime_type,
      size_bytes: row.size_bytes,
      created_at: row.created_at,
      uploaded_by_name: row.first_name ? `${row.first_name} ${row.last_name ?? ''}`.trim() : null,
    })),
    checklist: checklistFor(client.entity_category),
    uploaded,
    missing: missingDocuments(client.entity_category, uploaded),
  });
});

clientRoutes.post('/:id/documents', requirePermission('clients.write'), async (c) => {
  const actor = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(
    z.object({
      doc_type: z.enum(CLIENT_DOCUMENT_TYPES),
      filename: z.string().min(1).max(200),
      mime_type: z.string().min(1).max(100),
      content_base64: z.string().min(1),
    }),
    await c.req.json().catch(() => ({})),
  );

  const client = await c.env.DB.prepare(
    `SELECT id, display_name, entity_category, account_status FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{ id: string; display_name: string; entity_category: EntityCategory; account_status: string }>();
  if (!client) return fail(404, 'NOT_FOUND');

  // Only a document the client's own checklist asks for is accepted: the
  // category decides what proves the file, not the uploader.
  const allowed = checklistFor(client.entity_category).map((entry) => entry.type);
  if (!allowed.includes(body.doc_type)) {
    return fail(422, 'VALIDATION_ERROR', { doc_type: 'not_in_checklist' });
  }

  const bytes = decodeBase64Strict(body.content_base64);
  const { filename, mimeType } = validateAttachment({
    filename: body.filename,
    mimeType: body.mime_type,
    sizeBytes: bytes.length,
    maxBytes: await documentMaxBytes(c.env.DB),
  });

  const documentId = crypto.randomUUID();
  const createdAt = nowISO();
  const checksum = await sha256Hex(bytes);
  const chunks = splitChunks(bytes);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO client_documents (id, client_id, doc_type, filename, mime_type, size_bytes, checksum, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(documentId, id, body.doc_type, filename, mimeType, bytes.length, checksum, actor.id, createdAt),
    ...chunks.map((chunk, seq) =>
      c.env.DB.prepare(`INSERT INTO client_document_chunks (document_id, seq, content) VALUES (?, ?, ?)`)
        .bind(documentId, seq, encodeBase64(chunk)),
    ),
  ]);

  const uploaded = await uploadedDocumentTypes(c.env.DB, id);
  const status = resolveStatus(client.account_status, client.entity_category, uploaded);
  await c.env.DB.prepare(`UPDATE clients SET account_status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, nowISO(), id)
    .run();

  await logActivity(c.env.DB, {
    userId: actor.id,
    action: 'created',
    entityType: 'client',
    entityId: id,
    summary: 'activity.client_document_added',
    meta: { name: client.display_name, doc_type: body.doc_type, filename },
  });

  return c.json({ id: documentId, doc_type: body.doc_type, account_status: status }, 201);
});

clientRoutes.get('/documents/:documentId/download', requirePermission('clients.read'), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT * FROM client_documents WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('documentId'))
    .first<{
      id: string;
      filename: string;
      mime_type: string;
      size_bytes: number;
    }>();
  if (!row) return fail(404, 'NOT_FOUND');

  const chunks = await c.env.DB.prepare(
    `SELECT content FROM client_document_chunks WHERE document_id = ? ORDER BY seq`,
  )
    .bind(row.id)
    .all<{ content: string }>();
  const bytes = joinChunks((chunks.results ?? []).map((chunk) => decodeBase64Strict(chunk.content)));
  if (bytes.length !== row.size_bytes) return fail(409, 'ATTACHMENT_INCOMPLETE');

  const ascii = row.filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Length': String(bytes.length),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

clientRoutes.delete('/documents/:documentId', requirePermission('clients.write'), async (c) => {
  const actor = c.get('user')!;
  const row = await c.env.DB.prepare(
    `SELECT id, client_id, doc_type, filename FROM client_documents WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(c.req.param('documentId'))
    .first<{ id: string; client_id: string; doc_type: string; filename: string }>();
  if (!row) return fail(404, 'NOT_FOUND');

  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE client_documents SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`)
      .bind(nowISO(), row.id),
    c.env.DB.prepare(`DELETE FROM client_document_chunks WHERE document_id = ?`).bind(row.id),
  ]);

  const client = await c.env.DB.prepare(
    `SELECT display_name, entity_category, account_status FROM clients WHERE id = ?`,
  )
    .bind(row.client_id)
    .first<{ display_name: string; entity_category: EntityCategory; account_status: string }>();
  if (client) {
    const uploaded = await uploadedDocumentTypes(c.env.DB, row.client_id);
    const status = resolveStatus(client.account_status, client.entity_category, uploaded);
    await c.env.DB.prepare(`UPDATE clients SET account_status = ?, updated_at = ? WHERE id = ?`)
      .bind(status, nowISO(), row.client_id)
      .run();

    await logActivity(c.env.DB, {
      userId: actor.id,
      action: 'deleted',
      entityType: 'client',
      entityId: row.client_id,
      summary: 'activity.client_document_deleted',
      meta: { name: client.display_name, doc_type: row.doc_type, filename: row.filename },
    });
  }

  return c.body(null, 204);
});

clientRoutes.get('/:id', requirePermission('clients.read'), async (c) => {
  const id = c.req.param('id');
  const client = await c.env.DB.prepare(
    `SELECT c.*, ${CLIENT_STATS_SQL} FROM clients c WHERE c.id = ? AND c.deleted_at IS NULL`,
  )
    .bind(id)
    .first();
  if (!client) return fail(404, 'NOT_FOUND');

  const [invoices, quotes, payments, contacts, documents] = await Promise.all([
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
    c.env.DB.prepare(
      `SELECT id, doc_type, filename, mime_type, size_bytes, created_at FROM client_documents
       WHERE client_id = ? AND deleted_at IS NULL ORDER BY created_at DESC`,
    ).bind(id).all(),
  ]);

  const uploaded = (documents.results ?? []).map((row) => String((row as { doc_type: string }).doc_type));
  const category = ((client as { entity_category?: EntityCategory }).entity_category ?? 'PRIVATE_COMPANY');

  return c.json({
    ...client,
    invoices: invoices.results ?? [],
    quotes: quotes.results ?? [],
    payments: payments.results ?? [],
    contacts: contacts.results ?? [],
    documents: documents.results ?? [],
    required_documents: checklistFor(category).filter((entry) => entry.required).map((entry) => entry.type),
    missing_documents: missingDocuments(category, uploaded),
  });
});

clientRoutes.post('/', requirePermission('clients.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(clientSchema, await c.req.json().catch(() => ({})));
  const id = crypto.randomUUID();
  // Section 0: the client code follows the legal category (SOC, PAT, ADM, ASC, PAR).
  const prefix = ENTITY_CATEGORY_PREFIX[body.entity_category];
  const number = await nextSimpleNumber(c.env.DB, `client:${prefix}`, prefix);
  const address = syncLegacyAddress(body);
  const fallbackTerms = await defaultPaymentDays(c.env.DB);

  await c.env.DB.prepare(
    `INSERT INTO clients (id, number, display_name, entity_category, legal_name, trade_name, legal_form,
      tax_id, numero_rcs, numero_tps, vat_regime,
      first_name, last_name, email, phone, contact_role, has_delegation_authority,
      address1, address2, po_box_number, po_box_municipality, city, postal_code, island,
      physical_municipality, district, pk_landmark, street_building_zone, delivery_instructions,
      country, payment_method, payment_terms_code, payment_terms, bank_name, iban, credit_limit,
      is_tax_exempt, tax_exemption_decree_num, tax_exemption_expiry,
      data_consent_accepted, account_status, notes, created_at, updated_at, price_tier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, number, body.display_name, body.entity_category, body.legal_name, body.trade_name, body.legal_form,
      body.tax_id, body.numero_rcs, body.numero_tps, body.vat_regime,
      body.first_name, body.last_name, body.email, body.phone, body.contact_role,
      body.has_delegation_authority ? 1 : 0,
      address.address1, body.address2, body.po_box_number, body.po_box_municipality, address.city,
      body.postal_code, body.island, body.physical_municipality, body.district, body.pk_landmark,
      body.street_building_zone, body.delivery_instructions,
      body.country, body.payment_method, body.payment_terms_code, resolvePaymentDays(body, fallbackTerms),
      body.bank_name, body.iban, body.credit_limit,
      body.is_tax_exempt || body.vat_regime === 'EXONERE' ? 1 : 0,
      body.tax_exemption_decree_num, body.tax_exemption_expiry,
      body.data_consent_accepted ? 1 : 0, 'PENDING_DOCUMENTS', body.notes, nowISO(), nowISO(),
      body.price_tier,
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
    meta: { name: body.display_name, number, entity_category: body.entity_category },
  });

  return c.json({ id, number, account_status: 'PENDING_DOCUMENTS' }, 201);
});

clientRoutes.patch('/:id', requirePermission('clients.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(clientSchema, await c.req.json().catch(() => ({})));

  const existing = await c.env.DB.prepare(
    `SELECT id, number, display_name, entity_category, account_status, data_consent_accepted
       FROM clients WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(id)
    .first<{
      id: string;
      number: string | null;
      display_name: string;
      entity_category: EntityCategory;
      account_status: string;
      data_consent_accepted: number;
    }>();
  if (!existing) return fail(404, 'NOT_FOUND');

  const uploaded = await uploadedDocumentTypes(c.env.DB, id);
  const missing = missingDocuments(body.entity_category, uploaded);
  if (body.account_status === 'APPROVED' && missing.length > 0) {
    return fail(409, 'CLIENT_DOCUMENTS_MISSING', { missing: missing.join(',') });
  }
  const status = resolveStatus(
    existing.account_status,
    body.entity_category,
    uploaded,
    body.account_status ?? (existing.account_status === 'APPROVED' ? 'APPROVED' : undefined),
  );

  // The code encodes the category: if the category was corrected, the code follows
  // the new prefix instead of keeping a misleading one.
  const number = existing.entity_category === body.entity_category
    ? existing.number
    : await nextSimpleNumber(c.env.DB, `client:${ENTITY_CATEGORY_PREFIX[body.entity_category]}`, ENTITY_CATEGORY_PREFIX[body.entity_category]);

  const address = syncLegacyAddress(body);
  const fallbackTerms = await defaultPaymentDays(c.env.DB);

  await c.env.DB.prepare(
    `UPDATE clients SET display_name = ?, number = ?, entity_category = ?, legal_name = ?, trade_name = ?,
      legal_form = ?, tax_id = ?, numero_rcs = ?, numero_tps = ?, vat_regime = ?,
      first_name = ?, last_name = ?, email = ?, phone = ?, contact_role = ?, has_delegation_authority = ?,
      address1 = ?, address2 = ?, po_box_number = ?, po_box_municipality = ?, city = ?, postal_code = ?,
      island = ?, physical_municipality = ?, district = ?, pk_landmark = ?, street_building_zone = ?,
      delivery_instructions = ?, country = ?, payment_method = ?, payment_terms_code = ?, payment_terms = ?,
      bank_name = ?, iban = ?, credit_limit = ?, is_tax_exempt = ?, tax_exemption_decree_num = ?,
      tax_exemption_expiry = ?, data_consent_accepted = ?, account_status = ?, notes = ?, updated_at = ?,
      price_tier = ?
      WHERE id = ?`,
  )
    .bind(
      body.display_name, number, body.entity_category, body.legal_name, body.trade_name,
      body.legal_form, body.tax_id, body.numero_rcs, body.numero_tps, body.vat_regime,
      body.first_name, body.last_name, body.email, body.phone, body.contact_role,
      body.has_delegation_authority ? 1 : 0,
      address.address1, body.address2, body.po_box_number, body.po_box_municipality, address.city,
      body.postal_code, body.island, body.physical_municipality, body.district, body.pk_landmark,
      body.street_building_zone, body.delivery_instructions,
      body.country, body.payment_method, body.payment_terms_code, resolvePaymentDays(body, fallbackTerms),
      body.bank_name, body.iban, body.credit_limit,
      body.is_tax_exempt || body.vat_regime === 'EXONERE' ? 1 : 0,
      body.tax_exemption_decree_num, body.tax_exemption_expiry,
      body.data_consent_accepted ? 1 : 0, status, body.notes, nowISO(), body.price_tier, id,
    )
    .run();

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'client',
    entityId: id,
    summary: 'activity.client_updated',
    meta: { name: body.display_name, number },
  });

  return c.json({ ok: true, number, account_status: status });
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
  const user = c.get('user')!;
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
  await logActivity(c.env.DB, { userId: user.id, action: 'created', entityType: 'client_contact', entityId: id, summary: 'activity.client_contact_added', meta: { email: body.email } });
  return c.json({ ok: true }, 201);
});

export type { ClientDocumentType };
