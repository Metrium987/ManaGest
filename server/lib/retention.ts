/**
 * Retention guard (OQ-005/006): issued documents are never deleted, only
 * cancelled. The configurable retention window (default 10 years, pending
 * local validation with the DICP) blocks purging older documents.
 */
export const DEFAULT_RETENTION_YEARS = 10;

/** Cutoff date as YYYY-MM-DD after which the retention window has elapsed. */
export function retentionCutoff(docDate: string, retentionYears: number): string {
  const yearPart = docDate.slice(0, 4);
  const y = Number(yearPart);
  if (!Number.isFinite(y)) return docDate;
  return `${y + Math.max(0, retentionYears)}${docDate.slice(4)}`;
}

/** True once the retention window has elapsed (document may be purged). */
export function retentionElapsed(docDate: string, retentionYears: number, today: string): boolean {
  return retentionCutoff(docDate, retentionYears) < today;
}
