import { Hono } from 'hono';
import { getExtra } from '../lib/settings-extra';
import { hasPermission } from '../lib/permissions';
import type { Permission } from '../../shared/domain';
import { assertPeriodOpen } from '../lib/locks';
import { safeLines } from '../services/documents';
import { logActivity } from '../lib/audit';
import { buildInvoicePdf } from '../services/pdf';
import { buildDocumentPdf, type DocumentKind } from '../services/pdf-documents';
import { resolveLayout } from '../services/pdf-style';
import { sendDocumentEmail, type EmailedDocumentKind } from '../services/email-documents';
import { fail } from '../lib/errors';
import { nowISO } from '../db';
import { requireAuth } from '../middleware';
import type { AppEnv } from '../types';

export const emailRoutes = new Hono<AppEnv>();
emailRoutes.use('*', requireAuth);

const CONFIG = {
  invoice: { table: 'invoices', permission: 'invoices.write', kind: 'invoice' },
  quote: { table: 'quotes', permission: 'quotes.write', kind: 'quote' },
  credit: { table: 'credits', permission: 'credits.write', kind: 'credit' },
} as const;

emailRoutes.post('/:kind/:id', async (c) => {
  const kind = c.req.param('kind') as keyof typeof CONFIG;
  const definition = CONFIG[kind];
  if (!definition) return fail(404, 'NOT_FOUND');
  const actor = c.get('user')!;
  if (!hasPermission(actor.role, definition.permission as Permission)) return fail(403, 'FORBIDDEN');
  const company = c.get('company')!;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT d.*, cl.display_name AS client_name, cl.email AS client_email,
      cl.address1 AS client_address1, cl.address2 AS client_address2, cl.city AS client_city,
      cl.postal_code AS client_postal_code, cl.country AS client_country, cl.tax_id AS client_tax_id
     FROM ${definition.table} d JOIN clients cl ON cl.id = d.client_id
     WHERE d.id = ? AND d.deleted_at IS NULL`,
  ).bind(id).first<Record<string, unknown>>();
  if (!row) return fail(404, 'NOT_FOUND');

  const status = String(row.status);
  const allowed = kind === 'invoice'
    ? ['draft', 'sent', 'partial'].includes(status)
    : ['draft', 'sent'].includes(status);
  if (!allowed) return fail(409, kind === 'invoice' ? 'INVOICE_LOCKED' : 'INVALID_TRANSITION');
  if (kind === 'invoice' && status === 'draft') await assertPeriodOpen(c.env.DB, String(row.date));
  if (kind === 'credit' && status === 'draft') await assertPeriodOpen(c.env.DB, String(row.date));

  const layout = resolveLayout(c.req.query('layout'), await getExtra(c.env.DB, 'pdf_layout'));
  let pdf: Uint8Array;
  if (kind === 'invoice') {
    pdf = await buildInvoicePdf(company, row, safeLines(row.line_items), layout);
  } else {
    const documentKind: DocumentKind = kind === 'quote' ? 'quote' : 'credit';
    const creditLabels: Record<string, string> = {
      draft: 'Brouillon', sent: 'Envoyé', partial: 'Partiellement utilisé', applied: 'Utilisé',
    };
    pdf = await buildDocumentPdf(documentKind, company, {
      number: row.number as string | null,
      date: String(row.date),
      secondary: kind === 'quote'
        ? (row.valid_until as string | null) ?? null
        : creditLabels[status] ?? status,
      currency: String(row.currency ?? company.currency),
      line_items: safeLines(row.line_items),
      discount_type: String(row.discount_type ?? 'percent'),
      discount_value: Number(row.discount_value ?? 0),
      discount_total: Number(row.discount_total ?? 0),
      subtotal: Number(row.subtotal ?? 0),
      tax_total: Number(row.tax_total ?? 0),
      total: Number(row.total ?? 0),
      tax_exempt: Number(row.tax_exempt ?? 0),
      notes: (row.notes as string | null) ?? null,
      terms: (row.terms as string | null) ?? null,
      client: {
        name: String(row.client_name ?? ''),
        address1: (row.client_address1 as string | null) ?? null,
        address2: (row.client_address2 as string | null) ?? null,
        city: (row.client_city as string | null) ?? null,
        postal_code: (row.client_postal_code as string | null) ?? null,
        country: (row.client_country as string | null) ?? null,
        tax_id: (row.client_tax_id as string | null) ?? null,
      },
    }, layout);
  }

  const mailKind = definition.kind as EmailedDocumentKind;
  const clientEmail = (row.client_email as string | null) ?? null;
  const body = await c.req.json().catch(() => ({})) as { recipient?: unknown };
  const recipient = typeof body.recipient === 'string' ? body.recipient.trim() : clientEmail;
  if (typeof recipient !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return fail(422, 'VALIDATION_ERROR', { recipient: 'invalid' });
  const result = await sendDocumentEmail({
    db: c.env.DB,
    secrets: c.env,
    company,
    userId: actor.id,
    kind: mailKind,
    documentId: id,
    documentNumber: (row.number as string | null) ?? null,
    clientName: String(row.client_name ?? ''),
    recipient,
    pdf,
  });

  if (status === 'draft') {
    await c.env.DB.prepare(
      `UPDATE ${definition.table} SET status = 'sent', sent_at = COALESCE(sent_at, ?), updated_at = ? WHERE id = ? AND status = 'draft'`,
    ).bind(nowISO(), nowISO(), id).run();
    await logActivity(c.env.DB, {
      userId: actor.id, action: 'sent', entityType: kind, entityId: id,
      summary: `activity.${kind}_sent`, meta: { number: row.number },
    });
  }
  return c.json({ ok: true, message_id: result.messageId });
});
