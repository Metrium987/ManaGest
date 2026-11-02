import { roundMinor } from './money';
import { RATE_ONE_TO_ONE, toXpf } from './landed-cost';
import {
  computeImportTaxes,
  type ImportTaxLine,
  type ImportTaxRule,
  type ImportTransport,
} from './import-taxes';

/**
 * Q8 — a single import declaration, several articles.
 *
 * One container rarely holds one product. Freight, transport insurance and the
 * clearance invoice are paid once for the whole shipment, so they have to be split
 * across the lines, and the split has to add up **exactly** to what was paid: a
 * rounding cent left out would make the sum of the line costs disagree with the
 * invoice.
 *
 * The split uses the largest-remainder method (méthode du plus fort reste), the one
 * French accounting practice expects: every line first receives the integer part of
 * its share, then the leftover units go one by one to the lines whose fractional
 * share is biggest, ties broken by line order. Duty, local taxes and VAT are then
 * computed **per line**, because each article has its own tariff heading and its own
 * weight and unit count.
 */

export const ALLOCATION_KEYS = ['value', 'weight', 'quantity'] as const;
export type AllocationKey = (typeof ALLOCATION_KEYS)[number];

export const ALLOCATION_KEY_LABELS: Record<AllocationKey, string> = {
  value: 'Valeur des marchandises',
  weight: 'Poids',
  quantity: 'Quantité',
};

/**
 * Split an amount in minor units across weights so the parts sum to the total.
 * With no usable weight the amount is shared evenly, which is the honest answer:
 * nothing in the shipment justifies a different split.
 */
export function allocate(totalMinor: number, weights: number[]): number[] {
  const total = Math.round(Number(totalMinor) || 0);
  const count = weights.length;
  if (!count) return [];

  const positive = weights.map((weight) => (Number(weight) > 0 ? Number(weight) : 0));
  const summed = positive.reduce((sum, weight) => sum + weight, 0);
  const basis = summed > 0 ? positive : positive.map(() => 1);
  const divisor = summed > 0 ? summed : count;

  const exact = basis.map((weight) => (total * weight) / divisor);
  const parts = exact.map((value) => Math.floor(value));
  const distributed = parts.reduce((sum, part) => sum + part, 0);

  // The remainder is smaller than the number of lines for a positive total, so
  // each line receives at most one extra unit. Order: biggest fraction first, then
  // the line's own position — deterministic, so two runs never disagree.
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let rest = total - distributed;
  for (let cursor = 0; rest > 0; cursor += 1, rest -= 1) {
    parts[order[cursor % count].index] += 1;
  }
  return parts;
}

export interface ImportSheetLineInput {
  product_id: string;
  product_name?: string;
  quantity_milli: number;
  /** Invoice value of this line, in the sheet currency's minor units. */
  goods_amount: number;
  duty_rate_bp: number;
  weight_g?: number;
  units?: number;
}

export interface ImportSheetInput {
  currency: string;
  exchange_rate_micro: number;
  key: AllocationKey;
  freight: number;
  insurance: number;
  fixed_fees: number;
  vat_rate_bp: number;
  vat_recoverable: boolean;
  transport: ImportTransport;
  date: string;
  tax_rules: ImportTaxRule[];
  lines: ImportSheetLineInput[];
}

export interface ImportSheetLineResult {
  product_id: string;
  product_name: string;
  quantity_milli: number;
  goods: number;
  freight: number;
  insurance: number;
  fixed_fees: number;
  customs_value: number;
  duty: number;
  tax_lines: ImportTaxLine[];
  taxes_total: number;
  vat_base: number;
  vat: number;
  total_in_cost: number;
  unit_cost: number;
  /** Share of the goods value, in basis points: the key the split used. */
  share_bp: number;
}

export interface ImportSheetResult {
  key: AllocationKey;
  lines: ImportSheetLineResult[];
  totals: {
    goods: number;
    freight: number;
    insurance: number;
    fixed_fees: number;
    customs_value: number;
    duty: number;
    taxes_total: number;
    vat: number;
    total_in_cost: number;
    total_cash: number;
  };
}

export function computeImportSheet(input: ImportSheetInput): ImportSheetResult {
  const rate = input.currency.toUpperCase() === 'XPF' ? RATE_ONE_TO_ONE : input.exchange_rate_micro;
  const goods = input.lines.map((line) => toXpf(line.goods_amount, input.currency, rate));
  const freightTotal = toXpf(input.freight, input.currency, rate);
  const insuranceTotal = toXpf(input.insurance, input.currency, rate);
  const feesTotal = toXpf(input.fixed_fees, input.currency, rate);

  const weights = input.lines.map((line) => {
    if (input.key === 'weight') return Number(line.weight_g) || 0;
    if (input.key === 'quantity') return Number(line.quantity_milli) || 0;
    return goods[input.lines.indexOf(line)];
  });

  const freight = allocate(freightTotal, weights);
  const insurance = allocate(insuranceTotal, weights);
  const fees = allocate(feesTotal, weights);
  const goodsTotal = goods.reduce((sum, value) => sum + value, 0);

  const lines: ImportSheetLineResult[] = input.lines.map((line, index) => {
    const lineFreight = freight[index] ?? 0;
    const lineInsurance = insurance[index] ?? 0;
    const lineFees = fees[index] ?? 0;
    const customsValue = goods[index] + lineFreight + lineInsurance;
    // Each line carries its own heading, so it carries its own duty rate.
    const duty = roundMinor((customsValue * line.duty_rate_bp) / 10_000);

    const taxLines = computeImportTaxes({
      customs_value: customsValue,
      duty,
      weight_g: Number(line.weight_g) || 0,
      units: Number(line.units) || 0,
      transport: input.transport,
      date: input.date,
    }, input.tax_rules);
    const taxesTotal = taxLines.reduce((sum, tax) => sum + tax.amount, 0);

    const vatBase = customsValue + duty + taxesTotal;
    const vat = roundMinor((vatBase * input.vat_rate_bp) / 10_000);
    const totalInCost = vatBase + lineFees + (input.vat_recoverable ? 0 : vat);

    return {
      product_id: line.product_id,
      product_name: line.product_name ?? '',
      quantity_milli: line.quantity_milli,
      goods: goods[index],
      freight: lineFreight,
      insurance: lineInsurance,
      fixed_fees: lineFees,
      customs_value: customsValue,
      duty,
      tax_lines: taxLines,
      taxes_total: taxesTotal,
      vat_base: vatBase,
      vat,
      total_in_cost: totalInCost,
      unit_cost: line.quantity_milli > 0 ? roundMinor((totalInCost * 1000) / line.quantity_milli) : 0,
      share_bp: goodsTotal > 0 ? Math.round((goods[index] * 10_000) / goodsTotal) : 0,
    };
  });

  const sum = (pick: (line: ImportSheetLineResult) => number) =>
    lines.reduce((total, line) => total + pick(line), 0);
  const totalInCost = sum((line) => line.total_in_cost);
  const vat = sum((line) => line.vat);

  return {
    key: input.key,
    lines,
    totals: {
      goods: sum((line) => line.goods),
      freight: sum((line) => line.freight),
      insurance: sum((line) => line.insurance),
      fixed_fees: sum((line) => line.fixed_fees),
      customs_value: sum((line) => line.customs_value),
      duty: sum((line) => line.duty),
      taxes_total: sum((line) => line.taxes_total),
      vat,
      total_in_cost: totalInCost,
      total_cash: totalInCost + (input.vat_recoverable ? vat : 0),
    },
  };
}
