/**
 * A-27 — the living documentation must match the repository.
 *
 * Three guards, all read-only and independent of test order: the schema figures
 * quoted by the 6 November audit are compared with the schema the project
 * declares, every relative link in the named living documents must resolve, and
 * the archived 28 October audit must stay archived with its obsolete sections
 * flagged.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';

const ROOT = process.cwd();

function declaredSchema(): { tables: string[]; indexes: string[] } {
  const database = new DatabaseSync(':memory:');
  for (const statement of SCHEMA_STATEMENTS) database.exec(statement);
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> 'd1_migrations'
       ORDER BY name`,
    )
    .all() as { name: string }[];
  const indexes = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'index' AND name NOT LIKE 'sqlite_autoindex%'
       ORDER BY name`,
    )
    .all() as { name: string }[];
  return { tables: tables.map((row) => row.name), indexes: indexes.map((row) => row.name) };
}

const LIVING_DOCS = [
  'README.md',
  'docs/ARCHITECTURE.md',
  'docs/SECURITE.md',
  'docs/build/PENDING.md',
  'docs/archive/README.md',
];

function relativeLinks(file: string): string[] {
  const text = readFileSync(resolve(ROOT, file), 'utf8');
  const links: string[] = [];
  for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const target = match[1].split('#')[0].trim();
    if (!target || /^(https?:|mailto:)/.test(target)) continue;
    links.push(target);
  }
  return links;
}

describe('living documentation integrity', () => {
  it('quotes the real table and index counts of the declared schema', () => {
    const { tables, indexes } = declaredSchema();

    const audit = readFileSync(resolve(ROOT, 'docs/AUDIT-2026-11-06.md'), 'utf8');
    const claimed = /(\d+)\s+tables,\s*(\d+)\s+index/.exec(audit);
    expect(claimed, 'le constat daté doit annoncer « N tables, M index »').not.toBeNull();
    expect(
      Number(claimed![1]),
      `tables déclarées : ${tables.length} — ${tables.join(', ')}`,
    ).toBe(tables.length);
    expect(
      Number(claimed![2]),
      `index déclarés : ${indexes.length} — ${indexes.join(', ')}`,
    ).toBe(indexes.length);
  });

  it('resolves every relative link of the living documents', () => {
    const missing: string[] = [];
    for (const file of LIVING_DOCS) {
      for (const link of relativeLinks(file)) {
        const target = resolve(ROOT, dirname(file), link);
        if (!existsSync(target)) missing.push(`${file} -> ${link}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('keeps the 28 October audit archived, unmodified in place, and flagged obsolete', () => {
    const archived = resolve(ROOT, 'docs/archive/audit-2026-10-28/AUDIT.md');
    expect(existsSync(archived)).toBe(true);
    const audit = readFileSync(archived, 'utf8');
    // The archived figures are the historical ones, not the current schema: the
    // note must name them and point at the living audit instead.
    expect(audit).toContain('**26 tables**');
    expect(audit).toContain('28 index au total');

    const note = readFileSync(resolve(ROOT, 'docs/archive/README.md'), 'utf8');
    expect(note).toMatch(/§5 et §6/);
    expect(note).toMatch(/26 tables/);
    expect(note).toMatch(/28 index/);
    expect(note).toContain('AUDIT-2026-11-06.md');
  });
});
