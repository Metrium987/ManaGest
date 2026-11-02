/**
 * A journal entry is derived, never typed: `syncAccounting` posts it from a
 * document that already has its own activity entry. Its activity trace is
 * therefore the trace of that source, addressed by the same entity type the
 * server journals.
 *
 * - invoice / credit / payment / expense: the source id is the document id.
 * - opening: the import is journalled as `accounting` / `opening-balances`.
 *
 * Any other source returns null: better no trail than a misleading one.
 */
export interface TraceRef {
  entityType: string;
  entityId: string;
}

const DIRECT_SOURCES = new Set(['invoice', 'credit', 'payment', 'expense']);

export function entryTrace(entry: { source_type: string; source_id: string }): TraceRef | null {
  if (entry.source_type === 'opening') {
    return { entityType: 'accounting', entityId: 'opening-balances' };
  }
  if (DIRECT_SOURCES.has(entry.source_type)) {
    return { entityType: entry.source_type, entityId: entry.source_id };
  }
  return null;
}
