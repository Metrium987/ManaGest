/**
 * A-02: one guard, three document kinds. An issued document refuses a rewrite
 * with the same code and the same payload; a draft stays fully editable.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { ApiError } from '../server/lib/errors';
import { loadDocumentForEdit } from '../server/services/immutability';
import { assertEditable, isEditable, type DocumentKind } from '../server/services/status';

type Row = Record<string, unknown>;

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
  return {
    prepare,
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

async function database() {
  const raw = new DatabaseSync(':memory:');
  const db = asD1(raw);
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return { raw, db };
}

const NOW = '2026-03-01T00:00:00.000Z';
const ISSUED = ['sent', 'partial', 'paid', 'cancelled'];
const QUOTE_ISSUED = ['sent', 'approved', 'rejected', 'converted'];
const CREDIT_ISSUED = ['sent', 'partial', 'applied'];

function refuse(document: DocumentKind, status: string) {
  try {
    assertEditable(status, document);
    throw new Error('the guard let an issued document through');
  } catch (error) {
    const api = error as ApiError;
    expect(api).toBeInstanceOf(ApiError);
    expect(api.status).toBe(409);
    expect(api.code).toBe('DOCUMENT_IMMUTABLE');
    expect(api.details).toEqual({ document, status });
  }
}

describe('document immutability — A-02', () => {
  it('refuses every issued state of every document kind, with the shared payload', () => {
    for (const status of ISSUED) refuse('invoice', status);
    for (const status of QUOTE_ISSUED) refuse('quote', status);
    for (const status of CREDIT_ISSUED) refuse('credit', status);
    for (const status of ['applied', 'cancelled']) refuse('credit', status);
  });

  it('keeps drafts editable for all three kinds', () => {
    for (const document of ['invoice', 'quote', 'credit'] as const) {
      expect(isEditable('draft')).toBe(true);
      expect(() => assertEditable('draft', document)).not.toThrow();
    }
  });

  it('reads the stored status and refuses before any write', async () => {
    const { raw, db } = await database();
    await db.prepare(
      `INSERT INTO invoices (id, client_id, number, status, date, currency, subtotal, discount_type,
        discount_value, discount_total, tax_total, total, tax_exempt, line_items, created_at, updated_at)
       VALUES ('inv-1', 'cli-1', 'FAC-1', 'sent', '2026-03-02', 'XPF', 100000, 'percent', 0, 0, 0, 100000, 0, '[]', ?, ?)`,
    ).bind(NOW, NOW).run();
    await expect(loadDocumentForEdit(db, 'invoice', 'inv-1')).rejects.toMatchObject({
      status: 409, code: 'DOCUMENT_IMMUTABLE', details: { document: 'invoice', status: 'sent' },
    });
    expect(raw.prepare('SELECT total FROM invoices WHERE id = ?').get('inv-1')).toMatchObject({ total: 100000 });

    await db.prepare(
      `INSERT INTO credits (id, client_id, number, status, date, currency, subtotal, discount_type,
        discount_value, discount_total, tax_total, total, applied_total, balance, tax_exempt, line_items, created_at, updated_at)
       VALUES ('cr-1', 'cli-1', 'AV-1', 'sent', '2026-03-03', 'XPF', 50000, 'percent', 0, 0, 6500, 56500, 0, 56500, 0, '[]', ?, ?)`,
    ).bind(NOW, NOW).run();
    await expect(loadDocumentForEdit(db, 'credit', 'cr-1')).rejects.toMatchObject({
      status: 409, code: 'DOCUMENT_IMMUTABLE', details: { document: 'credit', status: 'sent' },
    });
    expect(raw.prepare('SELECT status, total FROM credits WHERE id = ?').get('cr-1'))
      .toMatchObject({ status: 'sent', total: 56500 });

    raw.prepare(`UPDATE credits SET status = 'draft' WHERE id = 'cr-1'`).run();
    await expect(loadDocumentForEdit(db, 'credit', 'cr-1')).resolves.toMatchObject({ status: 'draft' });
    await expect(loadDocumentForEdit(db, 'quote', 'missing')).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
});
