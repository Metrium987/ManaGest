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

export interface SearchHit {
  kind: string;
  ref_id: string;
  title: string;
  snippet: string;
}

/**
 * FTS5 treats `"`, `*`, `:`, `-` and `^` as syntax. Each word is quoted, so a
 * user typing punctuation gets results (or none), never a driver error.
 */
export function matchExpression(term: string): string {
  const tokens = term
    .split(/\s+/)
    .map((token) => token.replace(/["'*:^()-]/g, ' ').trim())
    .filter(Boolean);
  return tokens.map((token) => `"${token}"`).join(' ');
}

/**
 * A-17: `MATCH` + `bm25()` + `snippet()`, restricted to the kinds the caller may
 * read. On a build without FTS5 the documents table answers with `LIKE`, so the
 * route degrades instead of failing.
 */
export async function searchDocuments(
  database: D1Database,
  term: string,
  kinds: readonly string[],
): Promise<SearchHit[]> {
  if (!kinds.length) return [];
  const match = matchExpression(term);
  if (!match) return [];
  const list = kinds.map(() => '?').join(', ');
  try {
    const rows = await database
      .prepare(
        `SELECT d.kind, d.ref_id, d.title,
                snippet(search_index, 1, '<mark>', '</mark>', '…', 8) AS snippet
           FROM search_index JOIN search_documents d ON d.rowid = search_index.rowid
          WHERE search_index MATCH ? AND d.kind IN (${list})
          ORDER BY bm25(search_index) LIMIT 20`,
      )
      .bind(match, ...kinds)
      .all<SearchHit>();
    return rows.results ?? [];
  } catch {
    const rows = await database
      .prepare(
        `SELECT kind, ref_id, title, '' AS snippet FROM search_documents
          WHERE (title LIKE ? OR body LIKE ?) AND kind IN (${list})
          ORDER BY title LIMIT 20`,
      )
      .bind(`%${term}%`, `%${term}%`, ...kinds)
      .all<SearchHit>();
    return rows.results ?? [];
  }
}
