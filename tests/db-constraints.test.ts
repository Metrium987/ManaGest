/** A-13: the database refuses what the code must never write. */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';

const NOW = '2026-01-01T00:00:00.000Z';

function database() {
  const raw = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) raw.exec(statement);
  return raw;
}

function journalLine(raw: DatabaseSync, id: string, debit: number, credit: number) {
  raw.prepare(`INSERT INTO journal_lines (id, entry_id, account_code, label, debit, credit, created_at)
               VALUES (?, 'e1', '411', 'Client', ?, ?, ?)`).run(id, debit, credit, NOW);
}

describe('database constraints — A-13', () => {
  it('refuses a journal line debiting and crediting at once', () => {
    const raw = database();
    expect(() => journalLine(raw, 'l1', 100, 100)).toThrow(/CHECK/i);
    expect(() => journalLine(raw, 'l2', -1, 0)).toThrow(/CHECK/i);
    expect(() => journalLine(raw, 'l3', 0, -1)).toThrow(/CHECK/i);
    // A zero-amount reversal line stays legal.
    journalLine(raw, 'l4', 0, 0);
    journalLine(raw, 'l5', 100, 0);
    expect((raw.prepare(`SELECT COUNT(*) AS n FROM journal_lines`).get() as { n: number }).n).toBe(2);
  });

  it('refuses a second base currency', () => {
    const raw = database();
    expect(() => raw.exec(`INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
      VALUES ('EUR', 'Euro', '€', 2, 1, 1, '${NOW}', '${NOW}')`)).toThrow(/UNIQUE/i);
    expect(() => raw.exec(`INSERT INTO currencies (code, label, symbol, decimals, is_base, active, created_at, updated_at)
      VALUES ('USD', 'Dollar', '$', 2, 0, 1, '${NOW}', '${NOW}')`)).not.toThrow();
  });

  it('refuses a second company row', () => {
    const raw = database();
    raw.exec(`INSERT INTO company (id, name, created_at, updated_at) VALUES ('c1', 'Société', '${NOW}', '${NOW}')`);
    expect(() => raw.exec(`INSERT INTO company (id, name, created_at, updated_at)
      VALUES ('c2', 'Autre', '${NOW}', '${NOW}')`)).toThrow(/UNIQUE/i);
  });

  it('refuses a negative payment, invoice balance, credit total or expense', () => {
    const raw = database();
    const payment = (id: string, amount: number) => raw.prepare(
      `INSERT INTO payments (id, client_id, date, amount, created_at, updated_at) VALUES (?, 'c1', '2026-01-10', ?, ?, ?)`,
    ).run(id, amount, NOW, NOW);
    expect(() => payment('p-neg', -1)).toThrow(/NEGATIVE/);
    payment('p-zero', 0);

    expect(() => raw.exec(`INSERT INTO invoices (id, client_id, number, date, total, balance, created_at, updated_at)
      VALUES ('i-neg', 'c1', 'F-1', '2026-01-10', 1000, -5, '${NOW}', '${NOW}')`)).toThrow(/NEGATIVE/);
    expect(() => raw.exec(`INSERT INTO credits (id, client_id, number, date, total, created_at, updated_at)
      VALUES ('cr-neg', 'c1', 'A-1', '2026-01-10', -1, '${NOW}', '${NOW}')`)).toThrow(/NEGATIVE/);
    expect(() => raw.exec(`INSERT INTO expenses (id, category, date, amount, created_at, updated_at)
      VALUES ('e-neg', 'other', '2026-01-10', -1, '${NOW}', '${NOW}')`)).toThrow(/NEGATIVE/);
  });
});
