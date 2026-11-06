/**
 * A-15: the search term is refused above 50 bytes and a document above 200
 * lines, so neither reaches D1 as a driver error. Removing either guard makes
 * the corresponding case fail.
 */
import { describe, expect, it } from 'vitest';
import { MAX_SEARCH_BYTES, searchTerm } from '../server/lib/search';
import { MAX_LINE_ITEMS, lineItemsSchema } from '../server/lib/validation';

const line = (index: number) => ({
  id: `line-${index}`,
  description: 'Article',
  quantity: 1,
  unit_price: 100,
  tax_rate: 0,
});

describe('search and line-item limits — A-15', () => {
  it('trims and lower-cases the term', () => {
    expect(searchTerm('  Dupont ')).toEqual({ ok: true, term: 'dupont' });
    expect(searchTerm(null)).toEqual({ ok: true, term: '' });
  });

  it('accepts a term of exactly 50 bytes and refuses one more', () => {
    expect(searchTerm('a'.repeat(MAX_SEARCH_BYTES))).toEqual({ ok: true, term: 'a'.repeat(MAX_SEARCH_BYTES) });
    expect(searchTerm('a'.repeat(MAX_SEARCH_BYTES + 1))).toEqual({ ok: false, fields: { q: 'too_long' } });
  });

  it('counts bytes, not characters, so accents cannot slip past the cap', () => {
    // 'é' is two bytes: 26 characters are 52 bytes and must be refused.
    expect(searchTerm('é'.repeat(26))).toEqual({ ok: false, fields: { q: 'too_long' } });
  });

  it('refuses a 120-character search with a clear field, not a D1 error', () => {
    expect(searchTerm('x'.repeat(120))).toEqual({ ok: false, fields: { q: 'too_long' } });
  });

  it('accepts 200 lines and refuses the 201st', () => {
    const maximum = Array.from({ length: MAX_LINE_ITEMS }, (_, index) => line(index));
    expect(lineItemsSchema.safeParse(maximum).success).toBe(true);
    expect(lineItemsSchema.safeParse([...maximum, line(MAX_LINE_ITEMS)]).success).toBe(false);
    // The accepted maximum stays far below the 2 MB D1 row limit.
    expect(JSON.stringify(maximum).length).toBeLessThan(2_000_000);
  });
});
