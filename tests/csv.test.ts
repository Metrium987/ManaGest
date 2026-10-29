
import { describe, expect, it } from 'vitest';
import { csvEscape, toCsv } from '../server/lib/csv';

describe('M7/T-006 CSV helper', () => {
  it('escapes quotes, semicolons and newlines; leaves plain values untouched', () => {
    expect(csvEscape('simple')).toBe('simple');
    expect(csvEscape('a"b')).toBe('"a""b"');
    expect(csvEscape('a;b')).toBe('"a;b"');
    expect(csvEscape('a\nb')).toBe('"a\nb"');
    expect(csvEscape(null)).toBe('');
    expect(csvEscape(12300)).toBe('12300');
  });

  it('numbers stay numbers for round-trip; objects serialise as JSON', () => {
    const csv = toCsv(
      [
        { key: 'amount', label: 'montant' },
        { key: 'meta', label: 'notes' },
      ],
      [
        { amount: 10000, meta: { note: 'a;b' } },
        { amount: 500, meta: null },
      ],
    );
    expect(csv.startsWith('\uFEFFmontant;notes')).toBe(true); // BOM before the first header cell (trim() strips it)
    const lines = csv.split('\r\n');
    expect(lines[1]).toBe('10000;"{""note"":""a;b""}"'); // CSV doubles inner quotes
    expect(lines[2]).toBe('500;');
  });
});
