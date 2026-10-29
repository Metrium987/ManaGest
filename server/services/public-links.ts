import { nowISO } from '../db';
import { randomToken, sha256Hex } from '../lib/crypto';
import { safeLines } from './documents';
import type { CompanyRow } from '../types';

/**
 * T-103: secure public per-document links. A link grants read access to one
 * invoice, quote or credit note, and (for a quote that was sent) the ability
 * to accept it. There is no client account: the token is the whole credential.
 *
 * Rules kept here, so they can be unit-tested without a database:
 *  - the token itself is never stored, only its SHA-256 digest;
 *  - a link is either active, expired or revoked, and those three states are
 *    mutually exclusive;
 *  - a revoked link stays revoked even if it had not expired yet;
 *  - a quote can be accepted only while it is in the `sent` state.
 */

export type ShareEntity = 'invoice' | 'quote' | 'credit';

export const SHARE_ENTITIES: ShareEntity[] = ['invoice', 'quote', 'credit'];

export const DEFAULT_TTL_DAYS = 30;
export const MAX_TTL_DAYS = 365;

export type LinkState = 'active' | 'expired' | 'revoked';

export interface PublicLinkRow {
  id: string;
  token_hash: string;
  token_hint: string;
  entity_type: ShareEntity;
  entity_id: string;
  expires_at: string;
  revoked_at: string | null;
  created_by: string | null;
  created_at: string;
  access_count: number;
  last_access_at: string | null;
}

/** Expired, revoked or still usable — never two of them at once. */
export function linkState(
  link: { expires_at: string; revoked_at: string | null },
  now: string = nowISO(),
): LinkState {
  if (link.revoked_at) return 'revoked';
  return link.expires_at <= now ? 'expired' : 'active';
}

/** Keeps a requested lifetime inside the documented bounds. */
export function clampTtl(days: unknown): number {
  const parsed = Math.trunc(Number(days));
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_DAYS;
  return Math.min(MAX_TTL_DAYS, Math.max(1, parsed));
}

export function canAcceptQuote(kind: ShareEntity, status: string): boolean {
  return kind === 'quote' && status === 'sent';
}

export async function createPublicLink(
  database: D1Database,
  input: { entityType: ShareEntity; entityId: string; days?: unknown; userId: string | null },
): Promise<{ id: string; token: string; expires_at: string; hint: string }> {
  const token = randomToken(32);
  const hash = await sha256Hex(token);
  const id = crypto.randomUUID();
  const expires = new Date(Date.now() + clampTtl(input.days) * 86_400_000).toISOString();
  const hint = token.slice(0, 6);

  await database
    .prepare(
      `INSERT INTO public_links (id, token_hash, token_hint, entity_type, entity_id, expires_at, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, hash, hint, input.entityType, input.entityId, expires, input.userId, nowISO())
    .run();

  return { id, token, expires_at: expires, hint };
}

/** Resolves a raw token; returns the row whatever its state, so the caller can explain it. */
export async function findLinkByToken(
  database: D1Database,
  token: string,
): Promise<PublicLinkRow | null> {
  if (!token || token.length < 16 || token.length > 128) return null;
  const hash = await sha256Hex(token);
  return database
    .prepare(`SELECT * FROM public_links WHERE token_hash = ?`)
    .bind(hash)
    .first<PublicLinkRow>();
}

export async function recordAccess(
  database: D1Database,
  linkId: string,
  action: 'view' | 'pdf' | 'accept',
  ip: string | null,
  userAgent: string | null,
): Promise<void> {
  const now = nowISO();
  await database.batch([
    database
      .prepare(`INSERT INTO public_link_access (id, link_id, action, ip, user_agent, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), linkId, action, ip, userAgent?.slice(0, 250) ?? null, now),
    database
      .prepare(`UPDATE public_links SET access_count = access_count + 1, last_access_at = ? WHERE id = ?`)
      .bind(now, linkId),
  ]);
}

export interface SharedDocument {
  kind: ShareEntity;
  status: string;
  number: string | null;
  date: string;
  secondary_label: string | null;
  secondary: string | null;
  currency: string;
  subtotal: number;
  discount_type: string;
  discount_value: number;
  discount_total: number;
  tax_total: number;
  total: number;
  paid_total: number;
  balance: number;
  tax_exempt: number;
  line_items: ReturnType<typeof safeLines>;
  notes: string | null;
  terms: string | null;
  client: {
    name: string;
    address1: string | null;
    address2: string | null;
    city: string | null;
    postal_code: string | null;
    country: string | null;
    tax_id: string | null;
  };
  can_accept: boolean;
}

const QUERIES: Record<ShareEntity, string> = {
  invoice: `SELECT i.*, c.display_name AS client_name, c.address1 AS client_address1, c.address2 AS client_address2,
                   c.city AS client_city, c.postal_code AS client_postal_code, c.country AS client_country,
                   c.tax_id AS client_tax_id
            FROM invoices i JOIN clients c ON c.id = i.client_id
            WHERE i.id = ? AND i.deleted_at IS NULL`,
  quote: `SELECT q.*, c.display_name AS client_name, c.address1 AS client_address1, c.address2 AS client_address2,
                 c.city AS client_city, c.postal_code AS client_postal_code, c.country AS client_country,
                 c.tax_id AS client_tax_id
          FROM quotes q JOIN clients c ON c.id = q.client_id
          WHERE q.id = ? AND q.deleted_at IS NULL`,
  credit: `SELECT cr.*, c.display_name AS client_name, c.address1 AS client_address1, c.address2 AS client_address2,
                  c.city AS client_city, c.postal_code AS client_postal_code, c.country AS client_country,
                  c.tax_id AS client_tax_id
           FROM credits cr JOIN clients c ON c.id = cr.client_id
           WHERE cr.id = ? AND cr.deleted_at IS NULL`,
};

/**
 * Loads the document behind a link. A cancelled invoice and a rejected quote are
 * still shown (the client may legitimately want the record), but they cannot be
 * paid or accepted.
 */
export async function loadSharedDocument(
  database: D1Database,
  link: PublicLinkRow,
): Promise<SharedDocument | null> {
  const row = await database
    .prepare(QUERIES[link.entity_type])
    .bind(link.entity_id)
    .first<Record<string, unknown>>();
  if (!row) return null;

  const kind = link.entity_type;
  const status = String(row.status ?? '');
  const secondary =
    kind === 'invoice'
      ? ((row.due_date as string | null) ?? null)
      : kind === 'quote'
        ? ((row.valid_until as string | null) ?? null)
        : null;

  return {
    kind,
    status,
    number: (row.number as string | null) ?? null,
    date: String(row.date ?? ''),
    secondary_label:
      kind === 'invoice' ? 'ÉCHÉANCE' : kind === 'quote' ? 'VALABLE JUSQU’AU' : 'STATUT',
    secondary:
      kind === 'credit'
        ? ({ draft: 'Brouillon', sent: 'Envoyé', partial: 'Partiellement utilisé', applied: 'Utilisé' } as Record<string, string>)[status] ?? status
        : secondary,
    currency: String(row.currency ?? 'XPF'),
    subtotal: Number(row.subtotal ?? 0),
    discount_type: String(row.discount_type ?? 'percent'),
    discount_value: Number(row.discount_value ?? 0),
    discount_total: Number(row.discount_total ?? 0),
    tax_total: Number(row.tax_total ?? 0),
    total: Number(row.total ?? 0),
    paid_total: Number(row.paid_total ?? 0),
    balance: Number(row.balance ?? row.total ?? 0),
    tax_exempt: Number(row.tax_exempt ?? 0),
    line_items: safeLines(row.line_items),
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
    can_accept: canAcceptQuote(kind, status),
  };
}

export type { CompanyRow };
