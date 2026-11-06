/**
 * A-16: list endpoints name their columns and never carry `line_items`, while
 * the detail keeps the document payload. Reverting a list to `i.*` or adding a
 * column without updating the projection makes these cases fail.
 */
import { describe, expect, it } from 'vitest';
import { SCHEMA_STATEMENTS } from '../server/db/schema';
import { invoiceListSql } from '../server/routes/invoices';
import { CLIENT_LIST_COLUMNS } from '../server/routes/clients';
import { PUBLIC_LINK_COLUMNS } from '../server/routes/public-links';

function columnsOf(table: string): string[] {
  const statement = SCHEMA_STATEMENTS.find((sql) => sql.includes(`CREATE TABLE IF NOT EXISTS ${table} (`))!;
  const body = statement.slice(0, statement.indexOf(')`'));
  return [...body.matchAll(/^\s{4}(\w+)\s/gm)].map((match) => match[1]);
}

describe('list projections — A-16', () => {
  it('builds the invoice list without line_items and without a wildcard', () => {
    const sql = invoiceListSql('WHERE 1 = 1');
    expect(sql).not.toContain('line_items');
    expect(sql).not.toMatch(/\bi\.\*/);
    expect(sql).not.toMatch(/SELECT \*/);
    expect(sql).toContain('c.display_name AS client_name');
    expect(sql).toContain('ORDER BY i.date DESC');
  });

  it('projects every invoice column except the payload, so nothing shown is lost', () => {
    const sql = invoiceListSql('WHERE 1 = 1');
    const projected = columnsOf('invoices').filter((column) => column !== 'line_items');
    for (const column of projected) expect(sql).toContain(`i.${column}`);
    expect(columnsOf('invoices')).toContain('line_items');
  });

  it('keeps the client directory explicit and complete', () => {
    expect(CLIENT_LIST_COLUMNS).not.toMatch(/\bc\.\*/);
    const projected = columnsOf('clients');
    for (const column of projected) expect(CLIENT_LIST_COLUMNS).toContain(`c.${column}`);
  });

  it('reads a public link by name and never selects token_hash', () => {
    expect(PUBLIC_LINK_COLUMNS).not.toContain('token_hash');
    expect(PUBLIC_LINK_COLUMNS).toContain('revoked_at');
    expect(PUBLIC_LINK_COLUMNS).toContain('entity_type');
  });
});
