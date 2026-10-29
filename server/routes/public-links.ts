import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { assertPermission } from '../lib/permissions';
import { parseInput } from '../lib/validation';
import { getExtra } from '../lib/settings-extra';
import { clientIp, requireAuth, requirePermission } from '../middleware';
import { buildInvoicePdf } from '../services/pdf';
import { buildDocumentPdf } from '../services/pdf-documents';
import { resolveLayout } from '../services/pdf-style';
import {
  createPublicLink,
  findLinkByToken,
  linkState,
  loadSharedDocument,
  recordAccess,
  SHARE_ENTITIES,
  type PublicLinkRow,
  type ShareEntity,
} from '../services/public-links';
import type { AppEnv, CompanyRow } from '../types';
import type { Permission } from '../../shared/domain';

/**
 * T-103: public per-document links.
 *
 * Two route groups live here:
 *  - `publicLinkRoutes` (authenticated, /api/public-links): create, list and
 *    revoke a link, and read its access log;
 *  - `publicDocumentRoutes` (anonymous, /api/public/documents): what the token
 *    holder can see and do — view, download the PDF, accept a quote.
 *
 * A link is created and revoked only by a user holding the *write* permission of
 * the document's module: a read-only user may consult a document, but must not be
 * able to publish it to the internet.
 */

const ENTITY_PERMISSIONS: Record<ShareEntity, { read: Permission; write: Permission }> = {
  invoice: { read: 'invoices.read' as Permission, write: 'invoices.write' as Permission },
  quote: { read: 'quotes.read' as Permission, write: 'quotes.write' as Permission },
  credit: { read: 'credits.read' as Permission, write: 'credits.write' as Permission },
};

const ENTITY_TABLES: Record<ShareEntity, string> = {
  invoice: 'invoices',
  quote: 'quotes',
  credit: 'credits',
};

function assertEntity(value: string): ShareEntity {
  if (!(SHARE_ENTITIES as string[]).includes(value)) throw new Error('invalid entity');
  return value as ShareEntity;
}

export const publicLinkRoutes = new Hono<AppEnv>();
publicLinkRoutes.use('*', requireAuth);

publicLinkRoutes.get('/', requirePermission('invoices.read'), async (c) => {
  const entityType = assertEntity(c.req.query('entity_type') ?? '');
  const entityId = c.req.query('entity_id') ?? '';
  if (!entityId) return fail(422, 'VALIDATION_ERROR', { entity_id: 'required' });
  assertPermission(c.get('user')!.role, ENTITY_PERMISSIONS[entityType].read);

  const rows = await c.env.DB.prepare(
    `SELECT id, token_hint, entity_type, entity_id, expires_at, revoked_at, created_at, access_count, last_access_at
     FROM public_links WHERE entity_type = ? AND entity_id = ? ORDER BY created_at DESC`,
  )
    .bind(entityType, entityId)
    .all<PublicLinkRow>();

  return c.json({
    data: (rows.results ?? []).map((row) => ({
      ...row,
      state: linkState(row),
    })),
  });
});

publicLinkRoutes.post('/', async (c) => {
  const body = parseInput(
    z.object({
      entity_type: z.enum(['invoice', 'quote', 'credit']),
      entity_id: z.string().min(8).max(60),
      days: z.coerce.number().int().min(1).max(365).optional(),
    }),
    await c.req.json().catch(() => ({})),
  );
  const user = c.get('user')!;
  assertPermission(user.role, ENTITY_PERMISSIONS[body.entity_type].write);

  // The document must exist and not be deleted: a link to nothing would only
  // produce a confusing 404 for the client.
  const exists = await c.env.DB.prepare(
    `SELECT 1 AS ok FROM ${ENTITY_TABLES[body.entity_type]} WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(body.entity_id)
    .first<{ ok: number }>();
  if (!exists) return fail(404, 'NOT_FOUND');

  const link = await createPublicLink(c.env.DB, {
    entityType: body.entity_type,
    entityId: body.entity_id,
    days: body.days,
    userId: user.id,
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'public_link',
    entityId: link.id,
    summary: 'activity.public_link_created',
    meta: { entity: body.entity_type, expires_at: link.expires_at },
  });

  const origin = new URL(c.req.url).origin;
  return c.json(
    { id: link.id, token: link.token, url: `${origin}/p/${link.token}`, expires_at: link.expires_at },
    201,
  );
});

publicLinkRoutes.get('/:id/access', requirePermission('invoices.read'), async (c) => {
  const link = await c.env.DB.prepare(`SELECT * FROM public_links WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<PublicLinkRow>();
  if (!link) return fail(404, 'NOT_FOUND');
  assertPermission(c.get('user')!.role, ENTITY_PERMISSIONS[link.entity_type].read);

  const rows = await c.env.DB.prepare(
    `SELECT id, action, ip, user_agent, created_at FROM public_link_access
     WHERE link_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(link.id)
    .all();

  return c.json({ data: rows.results ?? [] });
});

publicLinkRoutes.delete('/:id', requirePermission('invoices.read'), async (c) => {
  const link = await c.env.DB.prepare(`SELECT * FROM public_links WHERE id = ?`)
    .bind(c.req.param('id'))
    .first<PublicLinkRow>();
  if (!link) return fail(404, 'NOT_FOUND');
  const user = c.get('user')!;
  assertPermission(user.role, ENTITY_PERMISSIONS[link.entity_type].write);

  if (!link.revoked_at) {
    await c.env.DB.prepare(`UPDATE public_links SET revoked_at = ? WHERE id = ?`)
      .bind(nowISO(), link.id)
      .run();
    await logActivity(c.env.DB, {
      userId: user.id,
      action: 'revoked',
      entityType: 'public_link',
      entityId: link.id,
      summary: 'activity.public_link_revoked',
      meta: { entity: link.entity_type },
    });
  }
  return c.json({ ok: true });
});

/** Anonymous routes: the token is the credential, nothing else is accepted. */
export const publicDocumentRoutes = new Hono<AppEnv>();

type LinkResolution =
  | { ok: true; link: PublicLinkRow }
  | { ok: false; error: 'LINK_NOT_FOUND' | 'LINK_EXPIRED' | 'LINK_REVOKED' };

async function resolveLink(c: {
  env: AppEnv['Bindings'];
  req: { param: (name: string) => string };
}): Promise<LinkResolution> {
  const link = await findLinkByToken(c.env.DB, c.req.param('token'));
  if (!link) return { ok: false, error: 'LINK_NOT_FOUND' };
  const state = linkState(link);
  if (state === 'revoked') return { ok: false, error: 'LINK_REVOKED' };
  if (state === 'expired') return { ok: false, error: 'LINK_EXPIRED' };
  return { ok: true, link };
}

function publicCompany(company: CompanyRow) {
  return {
    name: company.name,
    legal_name: company.legal_name,
    address1: company.address1,
    city: company.city,
    postal_code: company.postal_code,
    country: company.country,
    email: company.email,
    phone: company.phone,
    tax_id: company.tax_id,
    rcs: company.rcs,
    legal_notes: company.legal_notes,
    bank_name: company.bank_name,
    bank_iban: company.bank_iban,
    bank_bic: company.bank_bic,
  };
}

publicDocumentRoutes.get('/:token', async (c) => {
  const company = await c.env.DB.prepare(`SELECT * FROM company LIMIT 1`).first<CompanyRow>();
  if (!company) return fail(404, 'NOT_FOUND');

  const resolved = await resolveLink(c);
  if (!resolved.ok) return fail(410, resolved.error);

  const document = await loadSharedDocument(c.env.DB, resolved.link);
  if (!document) return fail(404, 'NOT_FOUND');

  await recordAccess(c.env.DB, resolved.link.id, 'view', clientIp(c), c.req.header('user-agent') ?? null);

  return c.json({
    document,
    company: publicCompany(company),
    expires_at: resolved.link.expires_at,
  });
});

publicDocumentRoutes.get('/:token/pdf', async (c) => {
  const company = await c.env.DB.prepare(`SELECT * FROM company LIMIT 1`).first<CompanyRow>();
  if (!company) return fail(404, 'NOT_FOUND');

  const resolved = await resolveLink(c);
  if (!resolved.ok) return fail(410, resolved.error);

  const document = await loadSharedDocument(c.env.DB, resolved.link);
  if (!document) return fail(404, 'NOT_FOUND');

  const layout = resolveLayout(null, await getExtra(c.env.DB, 'pdf_layout'));
  const bytes =
    document.kind === 'invoice'
      ? await buildInvoicePdf(
          company,
          {
            number: document.number,
            date: document.date,
            due_date: document.secondary,
            currency: document.currency,
            discount_type: document.discount_type,
            discount_value: document.discount_value,
            paid_total: document.paid_total,
            balance: document.balance,
            tax_exempt: document.tax_exempt,
            notes: document.notes,
            terms: document.terms,
            client_name: document.client.name,
            client_address1: document.client.address1,
            client_address2: document.client.address2,
            client_city: document.client.city,
            client_postal_code: document.client.postal_code,
            client_country: document.client.country,
            client_tax_id: document.client.tax_id,
          },
          document.line_items,
          layout,
        )
      : await buildDocumentPdf(
          document.kind === 'quote' ? 'quote' : 'credit',
          company,
          {
            number: document.number,
            date: document.date,
            secondary: document.secondary,
            currency: document.currency,
            line_items: document.line_items,
            discount_type: document.discount_type,
            discount_value: document.discount_value,
            discount_total: document.discount_total,
            subtotal: document.subtotal,
            tax_total: document.tax_total,
            total: document.total,
            tax_exempt: document.tax_exempt,
            notes: document.notes,
            terms: document.terms,
            client: document.client,
          },
          layout,
        );

  await recordAccess(c.env.DB, resolved.link.id, 'pdf', clientIp(c), c.req.header('user-agent') ?? null);

  return new Response(bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${document.number ?? 'document'}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
});

publicDocumentRoutes.post('/:token/accept', async (c) => {
  const resolved = await resolveLink(c);
  if (!resolved.ok) return fail(410, resolved.error);

  const link = resolved.link;
  const document = await loadSharedDocument(c.env.DB, link);
  if (!document) return fail(404, 'NOT_FOUND');
  if (document.kind !== 'quote') return fail(409, 'INVALID_TRANSITION');
  if (!document.can_accept) return fail(409, 'INVALID_TRANSITION');

  const body = parseInput(
    z.object({ name: z.string().trim().max(120).nullish() }).default({}),
    await c.req.json().catch(() => ({})),
  );

  // Only a quote that is still `sent` can move to `approved`: the update is
  // conditional, so two simultaneous clicks cannot both succeed.
  const updated = await c.env.DB.prepare(
    `UPDATE quotes SET status = 'approved', updated_at = ? WHERE id = ? AND status = 'sent' AND deleted_at IS NULL`,
  )
    .bind(nowISO(), link.entity_id)
    .run();

  if (!updated.meta.changes) return fail(409, 'INVALID_TRANSITION');

  await logActivity(c.env.DB, {
    userId: link.created_by,
    action: 'approved',
    entityType: 'quote',
    entityId: link.entity_id,
    summary: 'activity.quote_accepted_public',
    meta: { number: document.number, by: body.name ?? null },
  });
  await recordAccess(c.env.DB, link.id, 'accept', clientIp(c), c.req.header('user-agent') ?? null);

  return c.json({ ok: true, status: 'approved' });
});
