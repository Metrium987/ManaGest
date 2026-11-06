/* A-17: full-text search fed by triggers, indexed with external-content FTS5. */
import { SEARCH_DOCUMENT_STATEMENTS, SEARCH_INDEX_STATEMENTS } from '../search';

export const STATEMENTS: string[] = [...SEARCH_DOCUMENT_STATEMENTS, ...SEARCH_INDEX_STATEMENTS];
