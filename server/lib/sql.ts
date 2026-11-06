/**
 * A-15: D1 accepts at most 100 bound parameters per statement, and a `LIKE`
 * pattern is capped at 50 bytes (C-3). Every `… IN (…)` built from
 * user-supplied lines therefore goes through these helpers instead of joining
 * an unbounded list into one query.
 */
export const MAX_BOUND_PARAMS = 90;

export function chunks<T>(items: readonly T[], size: number = MAX_BOUND_PARAMS): T[][] {
  if (!Number.isInteger(size) || size < 1) {
    throw new RangeError('chunk size must be a positive integer');
  }
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Builds one statement for a chunk of ids; the driver binds the chunk. */
export type ChunkStatement = (placeholders: string, chunk: readonly string[]) => D1PreparedStatement;

function uniqueIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length > 0))];
}

/** Runs one id query per chunk and concatenates the rows, order preserved. */
export async function selectIn<T>(
  ids: readonly string[],
  prepare: ChunkStatement,
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunk of chunks(uniqueIds(ids))) {
    const page = await prepare(placeholders(chunk.length), chunk).all<T>();
    rows.push(...(page.results ?? []));
  }
  return rows;
}

/** Runs one write per chunk, so a 200-line document stays under the cap. */
export async function runInChunks(ids: readonly string[], prepare: ChunkStatement): Promise<void> {
  for (const chunk of chunks(uniqueIds(ids))) {
    await prepare(placeholders(chunk.length), chunk).run();
  }
}

/** First row found across chunks, for `LIMIT 1` lookups. */
export async function firstIn<T>(
  ids: readonly string[],
  prepare: ChunkStatement,
): Promise<T | null> {
  for (const chunk of chunks(uniqueIds(ids))) {
    const row = await prepare(placeholders(chunk.length), chunk).first<T>();
    if (row) return row;
  }
  return null;
}
