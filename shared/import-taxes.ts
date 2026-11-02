import { roundMinor } from './money';

/**
 * Q7 — import taxes as data, not as code.
 *
 * Every tax has its own base, and the order matters: the VAT is charged on the
 * customs value **plus** the duty and the other taxes, so a rule cannot be applied
 * in a vacuum. A rule therefore carries:
 *  - its base: customs value (`caf`), customs value plus duty (`caf_duty`), weight
 *    in kg, weight in quintals (100 kg), or the number of declared articles;
 *  - either a percentage (in basis points) or a fixed amount in XPF;
 *  - the transport mode it applies to (the Port autonome toll is maritime only);
 *  - a validity window, because rates change and an old sheet must stay
 *    explainable;
 *  - its source, so nobody has to guess where a figure came from.
 *
 * The defaults are the taxes the customs FAQ publishes explicitly. They are
 * seeded rows, editable like any other: a rate change is a data change, not a
 * deployment.
 */

export const TAX_BASES = ['caf', 'caf_duty', 'kg', 'quintal', 'article'] as const;
export type TaxBase = (typeof TAX_BASES)[number];

export const TAX_BASE_LABELS: Record<TaxBase, string> = {
  caf: 'Valeur en douane (CAF)',
  caf_duty: 'CAF + droits de douane',
  kg: 'Poids (kg)',
  quintal: 'Poids (quintal)',
  article: 'Nombre d’articles',
};

export const IMPORT_TRANSPORTS = ['any', 'sea', 'air'] as const;
export type ImportTransport = (typeof IMPORT_TRANSPORTS)[number];

export const IMPORT_TRANSPORT_LABELS: Record<ImportTransport, string> = {
  any: 'Tous modes',
  sea: 'Maritime',
  air: 'Aérien',
};

export interface ImportTaxRule {
  code: string;
  label: string;
  base: TaxBase;
  /** Percentage of the base in basis points: 125 = 1,25 %. */
  rate_bp: number;
  /** Fixed amount in XPF per unit of the base. */
  amount: number;
  transport: ImportTransport;
  sort_order: number;
  /** SQLite hands back 0/1, so the flag is read as a number or a boolean. */
  is_active?: boolean | number;
  valid_from?: string | null;
  valid_to?: string | null;
  source?: string | null;
}

export const DEFAULT_IMPORT_TAX_RULES: ImportTaxRule[] = [
  {
    code: 'TEA',
    label: 'Taxe pour l’environnement (TEA)',
    base: 'caf',
    rate_bp: 200,
    amount: 0,
    transport: 'any',
    sort_order: 10,
    source: 'FAQ douane PF — 2 % de la valeur CAF',
  },
  {
    code: 'PID',
    label: 'Participation informatique douanière (PID)',
    base: 'article',
    rate_bp: 0,
    amount: 85,
    transport: 'any',
    sort_order: 20,
    source: 'FAQ douane PF — 85 XPF par article déclaré',
  },
  {
    code: 'STAT',
    label: 'Taxe statistique',
    base: 'quintal',
    rate_bp: 0,
    amount: 50,
    transport: 'any',
    sort_order: 30,
    source: 'FAQ douane PF — 50 XPF par quintal',
  },
  {
    code: 'PAP',
    label: 'Péage du Port autonome de Papeete',
    base: 'caf',
    rate_bp: 125,
    amount: 0,
    transport: 'sea',
    sort_order: 40,
    source: 'FAQ douane PF — 1,25 % de la valeur CAF, fret maritime',
  },
];

export interface ImportTaxContext {
  customs_value: number;
  duty: number;
  weight_g: number;
  units: number;
  transport: ImportTransport;
  date: string;
}

export interface ImportTaxLine {
  code: string;
  label: string;
  amount: number;
}

function inWindow(rule: ImportTaxRule, date: string): boolean {
  if (rule.valid_from && date < rule.valid_from) return false;
  if (rule.valid_to && date > rule.valid_to) return false;
  return true;
}

/** Active rules that apply to this transport on this date, in evaluation order. */
export function applicableRules(rules: ImportTaxRule[], context: Pick<ImportTaxContext, 'transport' | 'date'>): ImportTaxRule[] {
  return rules
    // A deactivated rule must leave the computation: SQLite returns 0, not
    // `false`, so comparing to `false` alone would keep it alive.
    .filter((rule) => rule.is_active !== false && Number(rule.is_active ?? 1) !== 0)
    .filter((rule) => rule.transport === 'any' || rule.transport === context.transport)
    .filter((rule) => inWindow(rule, context.date))
    .sort((a, b) => (a.sort_order - b.sort_order) || a.code.localeCompare(b.code));
}

/** The amount one rule adds. A base of weight or article is a pure fixed amount
 * per unit; a customs value base carries a percentage. */
export function taxAmount(rule: ImportTaxRule, context: ImportTaxContext): number {
  const caf = Number(context.customs_value) || 0;
  const duty = Number(context.duty) || 0;
  const weight = Math.max(0, Number(context.weight_g) || 0);
  const units = Math.max(0, Number(context.units) || 0);

  switch (rule.base) {
    case 'caf':
      return roundMinor((caf * rule.rate_bp) / 10_000);
    case 'caf_duty':
      return roundMinor(((caf + duty) * rule.rate_bp) / 10_000);
    case 'kg':
      return roundMinor((weight / 1000) * rule.amount);
    case 'quintal':
      return roundMinor((weight / 100_000) * rule.amount);
    case 'article':
      return roundMinor(units * rule.amount);
    default:
      return 0;
  }
}

export type TariffOrigin = 'standard' | 'eu' | 'oceania';

export interface TariffRow {
  code: string;
  label?: string | null;
  duty_rate_bp: number;
  duty_rate_eu_bp?: number | null;
  duty_rate_oceania_bp?: number | null;
  vat_rate_bp?: number | null;
}

/**
 * Q6: the duty rate for a tariff heading, given where the goods come from.
 * Preferential rates exist for the European Union and the Pacific (LP 2024-34),
 * but they need a certificate of origin; when no preferential rate is recorded,
 * the standard one applies rather than 0 %.
 */
export function tariffDutyRate(tariff: TariffRow | undefined | null, origin: TariffOrigin): number | null {
  if (!tariff) return null;
  const standard = Number(tariff.duty_rate_bp ?? 0);
  if (origin === 'eu' && tariff.duty_rate_eu_bp !== null && tariff.duty_rate_eu_bp !== undefined) {
    return Number(tariff.duty_rate_eu_bp);
  }
  if (origin === 'oceania' && tariff.duty_rate_oceania_bp !== null && tariff.duty_rate_oceania_bp !== undefined) {
    return Number(tariff.duty_rate_oceania_bp);
  }
  return standard;
}

export function computeImportTaxes(context: ImportTaxContext, rules: ImportTaxRule[]): ImportTaxLine[] {
  return applicableRules(rules, context)
    .map((rule) => ({ code: rule.code, label: rule.label, amount: taxAmount(rule, context) }))
    .filter((line) => line.amount !== 0);
}
