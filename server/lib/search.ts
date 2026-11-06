/**
 * A-15: D1 caps a `LIKE` pattern at 50 bytes (C-3). The term is trimmed and
 * lower-cased once, and an oversized one is refused with a clear 422 instead of
 * reaching the driver as an opaque error.
 */
export const MAX_SEARCH_BYTES = 50;

export type SearchTerm =
  | { ok: true; term: string }
  | { ok: false; fields: { q: 'too_long' } };

export function searchTerm(raw: string | null | undefined): SearchTerm {
  const term = (raw ?? '').trim().toLowerCase();
  if (new TextEncoder().encode(term).length > MAX_SEARCH_BYTES) {
    return { ok: false, fields: { q: 'too_long' } };
  }
  return { ok: true, term };
}
