import { describe, expect, it } from 'vitest';
import { XlsxError, excelDate, xlsxToCsv } from '../server/lib/xlsx';
import { parseCsv } from '../server/lib/import';

/** CRC-32 for the stored (uncompressed) ZIP entries the test builds. */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal .xlsx container: a ZIP with stored entries, no compression. */
function workbook(files: Record<string, string>): string {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(content);
    const crc = crc32(data);

    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);
    locals.push(local);

    const directory = new Uint8Array(46 + nameBytes.length);
    const directoryView = new DataView(directory.buffer);
    directoryView.setUint32(0, 0x02014b50, true);
    directoryView.setUint16(4, 20, true);
    directoryView.setUint16(6, 20, true);
    directoryView.setUint32(16, crc, true);
    directoryView.setUint32(20, data.length, true);
    directoryView.setUint32(24, data.length, true);
    directoryView.setUint16(28, nameBytes.length, true);
    directoryView.setUint32(42, offset, true);
    directory.set(nameBytes, 46);
    central.push(directory);

    offset += local.length;
  }

  const centralSize = central.reduce((sum, entry) => sum + entry.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, central.length, true);
  endView.setUint16(10, central.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);

  const total = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...central, end]) {
    total.set(part, cursor);
    cursor += part.length;
  }
  return Buffer.from(total).toString('base64');
}

const SHARED = `<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <si><t>nom</t></si>
  <si><t>courriel</t></si>
  <si><t>Hôtel &amp; Spa</t></si>
</sst>`;

const SHEET = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    <row r="1">
      <c r="A1" t="s"><v>0</v></c>
      <c r="B1" t="s"><v>1</v></c>
      <c r="C1" t="inlineStr"><is><t>depuis</t></is></c>
      <c r="D1" t="inlineStr"><is><t>montant</t></is></c>
    </row>
    <row r="2">
      <c r="A2" t="s"><v>2</v></c>
      <c r="B2" t="inlineStr"><is><t>a;b@example.test</t></is></c>
      <c r="C2" s="1"><v>45292</v></c>
      <c r="D2"><v>1500</v></c>
    </row>
    <row r="3">
      <c r="A3" t="inlineStr"><is><t>Perlerie</t></is></c>
      <c r="B3" t="inlineStr"><is><t>contact@perlerie.pf</t></is></c>
      <c r="C3" s="1"><v>45322</v></c>
      <c r="D3"><v>2500</v></c>
    </row>
  </sheetData>
</worksheet>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>
</styleSheet>`;

function sample(): string {
  return workbook({
    '[Content_Types].xml': '<?xml version="1.0"?><Types/>',
    'xl/workbook.xml': '<?xml version="1.0"?><workbook/>',
    'xl/sharedStrings.xml': SHARED,
    'xl/styles.xml': STYLES,
    'xl/worksheets/sheet1.xml': SHEET,
  });
}

describe('P-05 XLSX import', () => {
  it('turns the first sheet into the CSV the importer already reads', async () => {
    const csv = await xlsxToCsv(sample());
    const parsed = parseCsv(csv);

    expect(parsed.header).toEqual(['nom', 'courriel', 'depuis', 'montant']);
    expect(parsed.rows).toHaveLength(2);
    // Shared strings are decoded, the semicolon in a value is quoted, numbers stay text.
    expect(parsed.rows[0]).toEqual(['Hôtel & Spa', 'a;b@example.test', '2024-01-01', '1500']);
    expect(parsed.rows[1]).toEqual(['Perlerie', 'contact@perlerie.pf', '2024-01-31', '2500']);
  });

  it('converts Excel serial days to calendar dates', () => {
    expect(excelDate(45292)).toBe('2024-01-01');
    expect(excelDate(1)).toBe('1900-01-01');
  });

  it('refuses anything that is not an .xlsx workbook', async () => {
    await expect(xlsxToCsv(Buffer.from('not a zip at all').toString('base64')))
      .rejects.toBeInstanceOf(XlsxError);
    await expect(xlsxToCsv(Buffer.from('not a zip at all').toString('base64')))
      .rejects.toMatchObject({ code: 'XLSX_NOT_ZIP' });
    await expect(xlsxToCsv('')).rejects.toMatchObject({ code: 'XLSX_EMPTY' });
  });

  it('refuses a workbook without a worksheet', async () => {
    const empty = workbook({ 'xl/sharedStrings.xml': SHARED });
    await expect(xlsxToCsv(empty)).rejects.toMatchObject({ code: 'XLSX_NO_SHEET' });
  });
});
