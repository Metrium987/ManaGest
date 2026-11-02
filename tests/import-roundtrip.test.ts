import { describe, expect, it } from 'vitest';
import { EXPORT_SPECS } from '../server/routes/export';
import {
  IMPORT_COLUMNS,
  parseCsv,
  templateCsv,
  validateImport,
  type ImportEntity,
} from '../server/lib/import';

/**
 * H4, owner decision 2026-11-02: ManaGest does not chase the file format of a
 * particular legacy application. Its own template is the migration path, and the
 * export is the other half of it. These tests make the promise executable: the
 * headers the export writes are exactly the headers the importer reads, and the
 * template imports with zero errors out of the box.
 */
const ENTITIES: ImportEntity[] = ['clients', 'products'];

describe('ManaGest template round-trip', () => {
  it('exports the exact headers the importer expects, in the same order', () => {
    for (const entity of ENTITIES) {
      const templateLabels = IMPORT_COLUMNS[entity].map((column) => column.label);
      expect(EXPORT_SPECS[entity].columns.map((column) => column.label), entity)
        .toEqual(templateLabels);
    }
  });

  it('imports the downloaded template with no issue at all', () => {
    for (const entity of ENTITIES) {
      const preview = validateImport(entity, parseCsv(templateCsv(entity)));
      expect(preview.errors, entity).toEqual([]);
      expect(preview.invalidCount, entity).toBe(0);
      // The annotation row is skipped; the example row is real data on purpose.
      expect(preview.validCount, entity).toBe(1);
      expect(preview.unknownColumns, entity).toEqual([]);
      expect(preview.missingColumns, entity).toEqual([]);
    }
  });

  it('re-imports an exported row unchanged', () => {
    for (const entity of ENTITIES) {
      const labels = EXPORT_SPECS[entity].columns.map((column) => column.label);
      const example = IMPORT_COLUMNS[entity].map((column) => column.example);
      const csv = `\uFEFF${labels.join(';')}\r\n${example.join(';')}\r\n`;
      const preview = validateImport(entity, parseCsv(csv));
      expect(preview.errors, entity).toEqual([]);
      expect(preview.validCount, entity).toBe(1);
    }
  });

  it('keeps an unknown legacy column visible instead of failing the file', () => {
    const labels = [...IMPORT_COLUMNS.clients.map((column) => column.label), 'code interne'];
    const example = [...IMPORT_COLUMNS.clients.map((column) => column.example), 'X-42'];
    const preview = validateImport('clients', parseCsv(`\uFEFF${labels.join(';')}\r\n${example.join(';')}\r\n`));
    expect(preview.errors).toEqual([]);
    expect(preview.unknownColumns).toEqual(['code interne']);
    expect(preview.mapping.display_name).toBe('nom');
  });
});
