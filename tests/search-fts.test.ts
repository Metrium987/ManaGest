/**
 * A-17: triggers keep `search_documents` in step with the source rows, FTS5
 * answers with MATCH/bm25/snippet, the backup carries the documents but never
 * the virtual table, and a build without FTS5 still answers from the documents.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { SEARCH_DOCUMENT_STATEMENTS, SEARCH_INDEX_STATEMENTS, rebuildSearchIndex } from '../server/db/search';
import { exportDatabase, listWorkspaceTables, restoreDatabase } from '../server/lib/backup';
import { matchExpression, searchDocuments } from '../server/lib/search';

type Row = Record<string, unknown>;
const NOW = '2026-01-01T00:00:00.000Z';

function asD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => ({ results: database.prepare(sql).all(...(params as never[])) as Row[] }),
      first: async () => (database.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null,
      run: async () => {
        database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: {} };
      },
    });
    return bind([]);
  };
  return { prepare, batch: async () => [] } as unknown as D1Database;
}

function database() {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  for (const statement of [...SEARCH_DOCUMENT_STATEMENTS, ...SEARCH_INDEX_STATEMENTS]) raw.exec(statement);
  return { raw, db: asD1(raw) };
}

function client(raw: DatabaseSync, id: string, name: string) {
  raw.prepare(`INSERT INTO clients (id, number, display_name, email, city, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, `C-${id}`, name, 'contact@example.com', 'Papeete', NOW, NOW);
}

const source = (raw: DatabaseSync) => ({
  all: async (sql: string) => raw.prepare(sql).all() as Row[],
  run: async (sql: string, bindings: unknown[] = []) => { raw.prepare(sql).run(...(bindings as never[])); },
  batch: async (statements: { sql: string; bindings: unknown[] }[]) => {
    for (const statement of statements) raw.prepare(statement.sql).run(...(statement.bindings as never[]));
  },
}) as unknown as Parameters<typeof exportDatabase>[0];

const ids = (hits: { ref_id: string }[]) => hits.map((hit) => hit.ref_id);

describe('full-text search — A-17', () => {
  it('finds an accented name whatever the case', async () => {
    const { raw, db } = database();
    client(raw, 'c1', 'Société Générale');
    expect(ids(await searchDocuments(db, 'société', ['client']))).toEqual(['c1']);
    expect(ids(await searchDocuments(db, 'SOCIÉTÉ', ['client']))).toEqual(['c1']);
  });

  it('ignores diacritics: "cafe" finds "café"', async () => {
    const { raw, db } = database();
    client(raw, 'c2', 'Café de la Place');
    expect(ids(await searchDocuments(db, 'cafe', ['client']))).toEqual(['c2']);
  });

  it('returns nothing for an unknown term, without failing', async () => {
    const { raw, db } = database();
    client(raw, 'c3', 'Boulangerie');
    expect(await searchDocuments(db, 'zzzzz', ['client'])).toEqual([]);
  });

  it('survives quotes, stars, colons and dashes in the term', () => {
    expect(matchExpression('dupont "frères" - noir*')).toBe('"dupont" "frères" "noir"');
    expect(matchExpression(':::')).toBe('');
  });

  it('follows an insert, an update and a delete of the source row', async () => {
    const { raw, db } = database();
    client(raw, 'c4', 'Ancien Nom');
    expect(ids(await searchDocuments(db, 'ancien', ['client']))).toEqual(['c4']);

    raw.prepare(`UPDATE clients SET display_name = 'Nouveau Nom' WHERE id = 'c4'`).run();
    expect(await searchDocuments(db, 'ancien', ['client'])).toEqual([]);
    expect(ids(await searchDocuments(db, 'nouveau', ['client']))).toEqual(['c4']);

    raw.prepare(`DELETE FROM clients WHERE id = 'c4'`).run();
    expect(await searchDocuments(db, 'nouveau', ['client'])).toEqual([]);
  });

  it('indexes products through their own trigger', async () => {
    const { raw, db } = database();
    raw.prepare(`INSERT INTO products (id, name, product_key, description, created_at, updated_at)
      VALUES ('p1', 'Marteau', 'MRT-1', 'Marteau de charpentier', ?, ?)`).run(NOW, NOW);
    expect(ids(await searchDocuments(db, 'charpentier', ['product']))).toEqual(['p1']);
  });

  it('keeps documents in the backup, never the virtual table, and searches after restore', async () => {
    const { raw } = database();
    client(raw, 'c5', 'Société Sauvegardée');
    const tables = await listWorkspaceTables(source(raw));
    expect(tables).toContain('search_documents');
    expect(tables.some((name) => /^search_index/.test(name))).toBe(false);

    const dump = await exportDatabase(source(raw));
    const target = database();
    await restoreDatabase(source(target.raw), dump, { allow_overwrite: true });
    expect(ids(await searchDocuments(target.db, 'sauvegardée', ['client']))).toEqual(['c5']);
    expect(await rebuildSearchIndex({ run: async (sql: string) => target.raw.exec(sql) })).toBe(true);
  });

  it('still answers from the documents when FTS5 is unavailable', async () => {
    const raw = new DatabaseSync(':memory:');
    for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
    for (const statement of SEARCH_DOCUMENT_STATEMENTS) raw.exec(statement);
    const db = asD1(raw);
    client(raw, 'c6', 'Recherche Dégradée');
    expect(ids(await searchDocuments(db, 'dégradée', ['client']))).toEqual(['c6']);
  });
});
