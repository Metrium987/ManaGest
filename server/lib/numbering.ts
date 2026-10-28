import { many } from '../db';

/**
 * Sequential, gap-free document numbers per entity and year.
 * Uses an UPSERT ... RETURNING so concurrent requests cannot reuse a value.
 */
export async function nextNumber(
  database: D1Database,
  entity: string,
  prefix: string,
  pattern: string,
  dateISO: string,
): Promise<string> {
  const override = await database
    .prepare(`SELECT prefix, pattern FROM entity_numbering WHERE entity = ?`)
    .bind(entity)
    .first<{ prefix: string; pattern: string }>();
  if (override) {
    prefix = override.prefix;
    pattern = override.pattern;
  }
  const year = dateISO.slice(0, 4);
  const month = dateISO.slice(5, 7);

  const row = await database
    .prepare(
      `INSERT INTO number_sequences (entity, period, last_number)
       VALUES (?, ?, 1)
       ON CONFLICT(entity, period) DO UPDATE SET last_number = last_number + 1
       RETURNING last_number`,
    )
    .bind(entity, year)
    .first<{ last_number: number }>();

  const sequence = row?.last_number ?? 1;
  return formatPattern(pattern, {
    prefix,
    year,
    month,
    sequence,
  });
}

export function formatPattern(
  pattern: string,
  values: { prefix: string; year: string; month: string; sequence: number },
): string {
  return pattern
    .replace(/\{prefix\}/g, values.prefix)
    .replace(/\{YYYY\}/g, values.year)
    .replace(/\{YY\}/g, values.year.slice(2))
    .replace(/\{MM\}/g, values.month)
    .replace(/\{#####\}/g, String(values.sequence).padStart(5, '0'))
    .replace(/\{####\}/g, String(values.sequence).padStart(4, '0'))
    .replace(/\{###\}/g, String(values.sequence).padStart(3, '0'))
    .replace(/\{##\}/g, String(values.sequence).padStart(2, '0'));
}

/** Next client/vendor/PMT number, kept separate from financial documents. */
export async function nextSimpleNumber(
  database: D1Database,
  entity: string,
  prefix: string,
): Promise<string> {
  const row = await database
    .prepare(
      `INSERT INTO number_sequences (entity, period, last_number)
       VALUES (?, 'all', 1)
       ON CONFLICT(entity, period) DO UPDATE SET last_number = last_number + 1
       RETURNING last_number`,
    )
    .bind(entity)
    .first<{ last_number: number }>();
  return `${prefix}-${String(row?.last_number ?? 1).padStart(4, '0')}`;
}

export async function sequenceAudit(database: D1Database): Promise<
  { entity: string; period: string; last_number: number }[]
> {
  return many(
    database
      .prepare(`SELECT entity, period, last_number FROM number_sequences ORDER BY entity, period`)
      
  );
}


/** Record a consumed number without a live document behind it (gap register). */
export async function recordNumberGap(
  database: D1Database,
  entity: string,
  number: string | null,
  userId: string | null,
  reason = 'deleted',
): Promise<void> {
  if (!number) return;
  await database
    .prepare(
      `INSERT INTO number_gaps (id, entity, number, reason, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .bind(crypto.randomUUID(), entity, number, reason, userId, new Date().toISOString())
    .run();
}
