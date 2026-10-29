/**
 * CSV export helper (T-006 / BK-011 / OQ-015 round-trip).
 * Delimiter: semicolon (French Excel convention); a UTF-8 BOM sits in front of
 * the first cell so accents survive Excel's naive open. The importer accepts
 * comma or semicolon, so exported files re-import unchanged.
 */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text =
    typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",;\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function toCsv(columns: { key: string; label: string }[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => c.label).join(';');
  const lines = rows.map((row) => columns.map((c) => csvEscape(row[c.key])).join(';'));
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}

export function csvResponse(body: string, filename: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
