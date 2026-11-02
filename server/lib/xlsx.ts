/**
 * P-05 — read an .xlsx workbook without a dependency.
 *
 * An .xlsx is a ZIP of XML parts. The worker has `DecompressionStream`, so the
 * reader inflates the two parts that matter (`sharedStrings.xml` and the first
 * worksheet), rebuilds the grid from cell references and returns CSV text that
 * reuses the existing import pipeline verbatim: same header detection, same
 * aliases, same validation, same preview.
 *
 * Dates are the one thing a spreadsheet keeps as a number: Excel stores them as
 * days since 1899-12-30 and marks the cell with a date style. The style table is
 * read so a date cell becomes `YYYY-MM-DD`, exactly like the CSV importer
 * expects, instead of `45292`.
 */

export class XlsxError extends Error {
  constructor(readonly code: string, readonly detail?: string) {
    super(code);
    this.name = 'XlsxError';
  }
}

const decoder = new TextDecoder();

const u16 = (view: DataView, offset: number): number => view.getUint16(offset, true);
const u32 = (view: DataView, offset: number): number => view.getUint32(offset, true);

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Entry name -> bytes, read from the ZIP central directory. */
export async function unzip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  const lowest = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= lowest; offset -= 1) {
    if (u32(view, offset) === 0x06054b50) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new XlsxError('XLSX_NOT_ZIP');

  const files = new Map<string, Uint8Array>();
  let offset = u32(view, end + 16);
  const count = u16(view, end + 10);
  for (let index = 0; index < count; index += 1) {
    if (u32(view, offset) !== 0x02014b50) throw new XlsxError('XLSX_BAD_DIRECTORY');
    const method = u16(view, offset + 10);
    const compressedSize = u32(view, offset + 20);
    const nameLength = u16(view, offset + 28);
    const extraLength = u16(view, offset + 30);
    const commentLength = u16(view, offset + 32);
    const localOffset = u32(view, offset + 42);
    const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLength));

    const localNameLength = u16(view, localOffset + 26);
    const localExtraLength = u16(view, localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = bytes.subarray(start, start + compressedSize);
    files.set(name, method === 0 ? raw : await inflateRaw(raw));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function decodeXml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Shared strings: one `<si>` may hold several `<t>` runs. */
export function sharedStringsOf(xml: string | undefined): string[] {
  if (!xml) return [];
  const values: string[] = [];
  for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
    const parts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((run) => decodeXml(run[1]));
    values.push(parts.join(''));
  }
  return values;
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);

/** Style indices whose number format displays a date. */
export function dateStylesOf(xml: string | undefined): Set<number> {
  const dates = new Set<number>();
  if (!xml) return dates;
  const custom = new Map<string, string>();
  for (const match of xml.matchAll(/<numFmt\b[^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)) {
    custom.set(match[1], decodeXml(match[2]));
  }
  const isDateCode = (code: string): boolean => /[dmy]/i.test(code) && !/^[#0.,%\s-]+$/.test(code);
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml)?.[1] ?? '';
  let index = 0;
  for (const match of cellXfs.matchAll(/<xf\b[^>]*numFmtId="(\d+)"/g)) {
    const formatId = Number(match[1]);
    if (BUILTIN_DATE_FORMATS.has(formatId) || isDateCode(custom.get(String(formatId)) ?? '')) {
      dates.add(index);
    }
    index += 1;
  }
  return dates;
}

/**
 * Excel serial day -> `YYYY-MM-DD`. Excel's 1900 calendar counts a 29 February
 * 1900 that never existed, so serials below 61 are one day off with the usual
 * 1899-12-30 epoch and must be shifted.
 */
export function excelDate(serial: number): string {
  const days = Math.floor(serial);
  const adjusted = days < 60 ? days + 1 : days;
  return new Date(Date.UTC(1899, 11, 30) + adjusted * 86_400_000).toISOString().slice(0, 10);
}

function columnIndex(reference: string): number {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase() ?? '';
  let index = 0;
  for (const letter of letters) index = index * 26 + (letter.charCodeAt(0) - 64);
  return index - 1;
}

/** The first sheet, by name order, among the workbook's worksheets. */
export function sheetPath(files: Map<string, Uint8Array>): string {
  const candidates = [...files.keys()]
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  if (candidates.length === 0) throw new XlsxError('XLSX_NO_SHEET');
  return candidates[0];
}

/** Rows of text values, gaps filled, in spreadsheet order. */
export function sheetRows(
  xml: string,
  shared: string[],
  dateStyles: Set<number>,
): string[][] {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    let next = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2] ?? '';
      const reference = /r="([A-Z]+\d+)"/i.exec(attributes)?.[1];
      const position = reference ? columnIndex(reference) : next;
      while (cells.length < position) cells.push('');

      const type = /t="([^"]*)"/.exec(attributes)?.[1];
      const style = Number(/s="(\d+)"/.exec(attributes)?.[1] ?? -1);
      const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1] ?? '';
      let value = '';
      if (type === 's') {
        value = shared[Number(raw)] ?? '';
      } else if (type === 'inlineStr') {
        value = [...body.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((run) => decodeXml(run[1])).join('');
      } else if (type === 'b') {
        value = raw === '1' ? 'oui' : 'non';
      } else if (type === 'e') {
        value = '';
      } else if (raw !== '') {
        value = dateStyles.has(style) && Number.isFinite(Number(raw)) ? excelDate(Number(raw)) : decodeXml(raw);
      }
      cells[position] = value;
      next = position + 1;
    }
    rows.push(cells);
  }
  return rows;
}

function csvCell(value: string): string {
  return /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Base64 payload -> semicolon CSV, ready for `parseCsv` and the importer. */
export async function xlsxToCsv(base64: string): Promise<string> {
  const clean = base64.replace(/\s+/g, '');
  if (clean === '') throw new XlsxError('XLSX_EMPTY');
  let bytes: Uint8Array;
  try {
    const binary = atob(clean);
    bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    throw new XlsxError('XLSX_BASE64');
  }
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new XlsxError('XLSX_NOT_ZIP');

  const files = await unzip(bytes);
  const textFile = (name: string): string | undefined => {
    const data = files.get(name);
    return data ? decoder.decode(data) : undefined;
  };
  const shared = sharedStringsOf(textFile('xl/sharedStrings.xml'));
  const dates = dateStylesOf(textFile('xl/styles.xml'));
  const sheet = decoder.decode(files.get(sheetPath(files))!);
  const rows = sheetRows(sheet, shared, dates).filter((row) => row.some((value) => value.trim() !== ''));
  if (rows.length === 0) throw new XlsxError('XLSX_EMPTY');

  return rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}
