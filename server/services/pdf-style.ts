/**
 * T-108: two predefined document layouts. There is no layout designer
 * (owner decision OQ-010): the owner picks a layout for the workspace, and a
 * single document can be produced with the other one by adding `?layout=` to
 * its PDF request.
 */
export type DocLayout = 'classic' | 'compact';

export const DOC_LAYOUTS: DocLayout[] = ['classic', 'compact'];

export interface DocStyle {
  /** Full-width coloured header band (classic) or a thin rule (compact). */
  band: boolean;
  /** Filled table header (classic) or accent-coloured text on a rule (compact). */
  tableHeaderFill: boolean;
  /** Accent block behind the grand total (classic) or a bold plain line (compact). */
  totalsBlock: boolean;
  /** Extra vertical space below each line row. */
  rowGap: number;
}

const STYLES: Record<DocLayout, DocStyle> = {
  classic: { band: true, tableHeaderFill: true, totalsBlock: true, rowGap: 0 },
  compact: { band: false, tableHeaderFill: false, totalsBlock: false, rowGap: -2 },
};

export function styleFor(layout: DocLayout): DocStyle {
  return STYLES[layout] ?? STYLES.classic;
}

function parse(value: string | null | undefined): DocLayout | null {
  if (!value) return null;
  const normalised = value.trim().toLowerCase();
  return normalised === 'compact' || normalised === 'classic' ? normalised : null;
}

/**
 * The per-document request wins over the workspace default; anything unknown
 * falls back to the default and then to the classic layout, so a bad query
 * string can never break a document.
 */
export function resolveLayout(
  requested?: string | null,
  workspaceDefault?: string | null,
): DocLayout {
  return parse(requested) ?? parse(workspaceDefault) ?? 'classic';
}
