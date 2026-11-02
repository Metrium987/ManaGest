import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROUTES_DIR = join(process.cwd(), 'server/routes');
const ROUTE = /(\w+Routes)\.(get|post|put|patch|delete)\(\s*'([^']*)'/;

/**
 * Handlers whose journal entry is written elsewhere, or that change no business
 * record. Every other POST/PUT/PATCH/DELETE must call `logActivity` inside its
 * own body: a new route cannot ship without an actor and a record in the journal.
 */
const ALLOWLIST = new Map<string, string>([
  ['approvals.ts /:id/approve', 'journalled by server/services/approvals.ts'],
  ['approvals.ts /:id/reject', 'journalled by server/services/approvals.ts'],
  ['auth.ts /mfa/setup', 'stores a pending secret; activation is journalled'],
  ['import.ts /preview/:entity', 'reads only, POST only for the payload'],
  ['runs.ts /daily', 'scheduled pass authenticated by token, no user involved'],
]);

function handlers(): { key: string; body: string }[] {
  const out: { key: string; body: string }[] = [];
  for (const file of readdirSync(ROUTES_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const lines = readFileSync(join(ROUTES_DIR, file), 'utf8').split('\n');
    const starts: { index: number; method: string; path: string }[] = [];
    lines.forEach((text, index) => {
      const match = text.match(ROUTE);
      if (match) starts.push({ index, method: match[2], path: match[3] });
    });
    starts.forEach((start, position) => {
      if (start.method === 'get') return;
      const end = starts[position + 1]?.index ?? lines.length;
      out.push({ key: `${file} ${start.path}`, body: lines.slice(start.index, end).join('\n') });
    });
  }
  return out;
}

describe('audit journal: every mutation leaves a trace', () => {
  const all = handlers();

  it('finds the mutating handlers', () => {
    expect(all.length).toBeGreaterThan(40);
  });

  it('calls logActivity inside each mutating handler, unless allowlisted', () => {
    const offenders = all
      .filter((handler) => !ALLOWLIST.has(handler.key) && !handler.body.includes('logActivity('))
      .map((handler) => handler.key);
    expect(offenders).toEqual([]);
  });
});
