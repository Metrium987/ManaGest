import { ApiError } from '../lib/errors';
import { assertEditable, type DocumentKind } from './status';

/** The tables a document may live in; the name is never interpolated from input. */
const TABLES = { invoice: 'invoices', quote: 'quotes', credit: 'credits' } as const;

/**
 * A-02: reads a document and refuses the edit before anything is written. The
 * route calls this first, so a refused `PATCH` cannot leave a partial update
 * behind — the guard runs on the stored status, not on what the client sent.
 */
export async function loadDocumentForEdit(
  database: D1Database,
  document: DocumentKind,
  id: string,
): Promise<Record<string, unknown>> {
  const row = await database
    .prepare(`SELECT * FROM ${TABLES[document]} WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<Record<string, unknown>>();
  if (!row) throw new ApiError(404, 'NOT_FOUND');
  assertEditable(String(row.status), document);
  return row;
}
