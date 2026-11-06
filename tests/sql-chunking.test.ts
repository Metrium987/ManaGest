/**
 * A-15: a document may carry 200 lines, but D1 binds at most 100 parameters per
 * statement. These tests fail as soon as the chunking is removed: one statement
 * would carry 200 binds instead of 90/90/20.
 */
import { describe, expect, it } from 'vitest';
import { chunks, firstIn, placeholders, runInChunks, selectIn } from '../server/lib/sql';

function fakeDatabase() {
  const statements: number[] = [];
  const database = {
    prepare(sql: string) {
      let bound: readonly string[] = [];
      const statement = {
        bind(...params: readonly string[]) {
          bound = params;
          return statement;
        },
        all: async () => {
          statements.push(bound.length);
          return { results: bound.map((id) => ({ id })) };
        },
        first: async () => {
          statements.push(bound.length);
          return bound.length ? { id: bound[0] } : null;
        },
        run: async () => {
          statements.push(bound.length);
          return { success: true };
        },
      };
      void sql;
      return statement;
    },
  };
  return { database: database as unknown as D1Database, statements };
}

const ids = (count: number) => Array.from({ length: count }, (_, index) => `p${index}`);

describe('D1 chunking — A-15', () => {
  it('splits at 90 and keeps the order', () => {
    expect(chunks(ids(90)).map((chunk) => chunk.length)).toEqual([90]);
    expect(chunks(ids(91)).map((chunk) => chunk.length)).toEqual([90, 1]);
    expect(chunks(ids(200)).map((chunk) => chunk.length)).toEqual([90, 90, 20]);
    expect(chunks(ids(200)).flat()).toEqual(ids(200));
    expect(chunks([], 5)).toEqual([]);
    expect(() => chunks([1], 0)).toThrow(RangeError);
  });

  it('writes a placeholder list of the requested length', () => {
    expect(placeholders(0)).toBe('');
    expect(placeholders(3)).toBe('?, ?, ?');
  });

  it('reads 200 ids in three statements, concatenating the rows in order', async () => {
    const { database, statements } = fakeDatabase();
    const rows = await selectIn<{ id: string }>(ids(200), (list, chunk) =>
      database.prepare(`SELECT id FROM products WHERE id IN (${list})`).bind(...chunk),
    );
    expect(statements).toEqual([90, 90, 20]);
    expect(rows.map((row) => row.id)).toEqual(ids(200));
  });

  it('updates 200 rows in three statements', async () => {
    const { database, statements } = fakeDatabase();
    await runInChunks(ids(200), (list, chunk) =>
      database.prepare(`UPDATE tasks SET x = 1 WHERE id IN (${list})`).bind(...chunk),
    );
    expect(statements).toEqual([90, 90, 20]);
  });

  it('finds the first row even when it sits in the last chunk', async () => {
    const { database } = fakeDatabase();
    const row = await firstIn<{ id: string }>(ids(200), (list, chunk) =>
      database.prepare(`SELECT id FROM stock_count_lines WHERE product_id IN (${list}) LIMIT 1`).bind(...chunk),
    );
    expect(row?.id).toBe('p0');
  });
});
