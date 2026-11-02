/**
 * Q4 — the 1 % VAT for the archipelagos other than the Society islands.
 *
 * Created by the loi du pays of 9 December 2025 and in force since 1 July 2026
 * (DICP). It is **not** a normal rate: it only applies to operations to or from
 * Tuamotu, Marquises, Australes and Gambier, and only when the seller ships the
 * goods himself and the transport document names both parties' Tahiti numbers.
 * Applying it without that evidence means paying the missing VAT back, so the
 * checks below are blocking rather than warnings.
 *
 * Excluded: alcohol, tobacco and the products subject to the consumption tax for
 * prevention. The list is a workspace setting, because families are free text and
 * a hard-coded list would silently miss a business's own wording.
 */

export const ARCHIPELAGOS = ['tuamotu', 'marquises', 'australes', 'gambier'] as const;
export type Archipelago = (typeof ARCHIPELAGOS)[number];

export const ARCHIPELAGO_LABELS: Record<Archipelago, string> = {
  tuamotu: 'Tuamotu',
  marquises: 'Marquises',
  australes: 'Australes',
  gambier: 'Gambier',
};

/** The reduced rate itself, in percent. */
export const ARCHIPELAGO_VAT_RATE = 1;

export interface ArchipelagoLine {
  tax_rate: number;
  tax_status?: string | null;
  product_family?: string | null;
}

export interface ArchipelagoEvidence {
  /** The customer's Tahiti number: the transport contract must carry it. */
  client_tax_id?: string | null;
  archipelago?: string | null;
  transport_reference?: string | null;
  shipped_by_seller?: boolean;
}

export type ArchipelagoCheck =
  | { ok: true }
  | { ok: false; code: 'ARCHIPELAGO_VAT_EVIDENCE' | 'ARCHIPELAGO_VAT_EXCLUDED'; details: Record<string, string> };

/** True as soon as one taxable line carries the 1 % rate. */
export function usesArchipelagoRate(lines: ArchipelagoLine[]): boolean {
  return lines.some((line) => (
    line.tax_status !== 'exempt' && Number(line.tax_rate) === ARCHIPELAGO_VAT_RATE
  ));
}

function excluded(line: ArchipelagoLine, families: string[]): string | null {
  const family = (line.product_family ?? '').trim().toLowerCase();
  if (!family) return null;
  const match = families
    .map((value) => value.trim().toLowerCase())
    .find((value) => value && family === value);
  return match ? (line.product_family ?? '').trim() : null;
}

export function validateArchipelagoVat(input: {
  lines: ArchipelagoLine[];
  evidence: ArchipelagoEvidence;
  excluded_families: string[];
}): ArchipelagoCheck {
  if (!usesArchipelagoRate(input.lines)) return { ok: true };

  const missing: string[] = [];
  if (!(input.evidence.client_tax_id ?? '').trim()) missing.push('client_tax_id');
  if (!ARCHIPELAGOS.includes((input.evidence.archipelago ?? '') as Archipelago)) missing.push('archipelago');
  if (!(input.evidence.transport_reference ?? '').trim()) missing.push('transport_reference');
  if (!input.evidence.shipped_by_seller) missing.push('shipped_by_seller');
  if (missing.length) {
    return { ok: false, code: 'ARCHIPELAGO_VAT_EVIDENCE', details: { missing: missing.join(',') } };
  }

  const blocked = input.lines
    .map((line) => excluded(line, input.excluded_families))
    .filter((value): value is string => Boolean(value));
  if (blocked.length) {
    return {
      ok: false,
      code: 'ARCHIPELAGO_VAT_EXCLUDED',
      details: { family: [...new Set(blocked)].join(',') },
    };
  }

  return { ok: true };
}
