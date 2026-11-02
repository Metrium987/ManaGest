import { roundMinor, currencyDecimals } from './money';
import {
  computeImportTaxes,
  type ImportTaxLine,
  type ImportTaxRule,
  type ImportTransport,
} from './import-taxes';

/**
 * F4 — landed cost for Polynesia.
 *
 * The calculation follows what the customs administration actually does, not a
 * generic percentage:
 *  - the customs value ("valeur en douane", CAF) is the invoice price **plus**
 *    freight and transport insurance up to the territory (service-public.pf,
 *    valeur en douane, arrêté n° 344 CM) ;
 *  - customs duty is charged on that CAF value, per tariff heading (0 % with a
 *    preference, 8 %, 13 % in the published examples) ;
 *  - local taxes ride on the same base (the Port autonome de Papeete toll is
 *    1,25 % of the customs value) ;
 *  - import VAT is charged on CAF + duty + other taxes — duty is *not* part of
 *    the customs value, but it *is* part of the VAT base ;
 *  - import VAT is deductible for a business under the real regime (DICP refunds
 *    the credit), so it does not enter the cost; a business under the franchise
 *    en base cannot deduct it, so there it does.
 *
 * Customs **excludes** the clearance invoice itself (broker, storage, the 85 XPF
 * per item declaration fee) from the VAT base: those are services bought locally.
 * They are still part of what the goods cost us.
 */

/** XPF is pegged to the euro: 1 000 XPF = 8,38 EUR (IEOM). */
export const XPF_PER_EUR = 119.3317;

/** Péage du Port autonome de Papeete, 1,25 % de la valeur en douane. */
export const PORT_FEE_RATE_BP = 125;

/** The normal rate, the one that applies to imported goods by default. */
export const DEFAULT_VAT_RATE_BP = 1600;

/** One unit of a currency in XPF, expressed in millionths (1 000 000 = 1:1). */
export const RATE_ONE_TO_ONE = 1_000_000;

export interface LandedCostInput {
  currency: string;
  /** XPF per unit of `currency`, in millionths. */
  exchange_rate_micro: number;
  quantity_milli: number;
  /** Invoice amount in the currency's own minor units (cents for EUR). */
  goods_amount: number;
  freight: number;
  insurance: number;
  fixed_fees: number;
  duty_rate_bp: number;
  port_fee_rate_bp: number;
  vat_rate_bp: number;
  vat_recoverable: boolean;
  /** Q7: when rules are given, they carry the local taxes instead of the single
   * port toll, and each one is computed on its own base. */
  tax_rules?: ImportTaxRule[];
  weight_g?: number;
  units?: number;
  transport?: ImportTransport;
  date?: string;
}

export interface LandedCostBreakdown {
  /** Everything below is in XPF, the currency the cost is kept in. */
  goods: number;
  freight: number;
  insurance: number;
  fixed_fees: number;
  customs_value: number;
  duty: number;
  /** The port toll alone, kept apart because it is the one tax that used to exist. */
  port_fee: number;
  /** Every local tax, in evaluation order. */
  tax_lines: ImportTaxLine[];
  taxes_total: number;
  vat_base: number;
  vat: number;
  /** What the goods add to the stock value. */
  total_in_cost: number;
  /** What actually leaves the bank, VAT included even when it is deductible. */
  total_cash: number;
  unit_cost: number;
}

/**
 * Convert a foreign amount into XPF. A foreign amount travels in its own minor
 * units, so its decimals come off before the rate is applied: 10,00 EUR is 1000
 * cents, not 1000 euros.
 */
export function toXpf(amountMinor: number, currency: string, exchangeRateMicro: number): number {
  const amount = Number(amountMinor) || 0;
  const code = currency.toUpperCase();
  if (code === 'XPF') return roundMinor(amount);
  const scale = 10 ** currencyDecimals(code);
  const rate = (Number(exchangeRateMicro) || RATE_ONE_TO_ONE) / RATE_ONE_TO_ONE;
  return roundMinor((amount / scale) * rate);
}

export function computeLandedCost(input: LandedCostInput): LandedCostBreakdown {
  const rate = input.currency.toUpperCase() === 'XPF' ? RATE_ONE_TO_ONE : input.exchange_rate_micro;
  const goods = toXpf(input.goods_amount, input.currency, rate);
  const freight = toXpf(input.freight, input.currency, rate);
  const insurance = toXpf(input.insurance, input.currency, rate);
  const fixedFees = toXpf(input.fixed_fees, input.currency, rate);

  const customsValue = goods + freight + insurance;
  const duty = roundMinor((customsValue * input.duty_rate_bp) / 10_000);

  // Q7: with rules, each tax is computed on its own base (CAF, CAF + duty, weight,
  // articles) in the order the workspace set; the port toll is then just one of
  // them. Without rules the single historical port fee keeps working.
  const rules = input.tax_rules ?? [];
  const taxLines: ImportTaxLine[] = rules.length
    ? computeImportTaxes({
      customs_value: customsValue,
      duty,
      weight_g: Number(input.weight_g) || 0,
      units: Number(input.units) || 0,
      transport: input.transport ?? 'any',
      date: input.date ?? new Date().toISOString().slice(0, 10),
    }, rules)
    : (() => {
      const legacy = roundMinor((customsValue * input.port_fee_rate_bp) / 10_000);
      return legacy ? [{ code: 'PAP', label: 'Péage portuaire', amount: legacy }] : [];
    })();
  const taxesTotal = taxLines.reduce((sum, line) => sum + line.amount, 0);
  const portFee = taxLines.find((line) => line.code === 'PAP')?.amount ?? 0;

  // Duty is not part of the customs value, but it is part of the VAT base.
  const vatBase = customsValue + duty + taxesTotal;
  const vat = roundMinor((vatBase * input.vat_rate_bp) / 10_000);

  const totalInCost = customsValue + duty + taxesTotal + fixedFees + (input.vat_recoverable ? 0 : vat);
  const totalCash = totalInCost + (input.vat_recoverable ? vat : 0);
  const unitCost = input.quantity_milli > 0
    ? roundMinor((totalInCost * 1000) / input.quantity_milli)
    : 0;

  return {
    goods,
    freight,
    insurance,
    fixed_fees: fixedFees,
    customs_value: customsValue,
    duty,
    port_fee: portFee,
    tax_lines: taxLines,
    taxes_total: taxesTotal,
    vat_base: vatBase,
    vat,
    total_in_cost: totalInCost,
    total_cash: totalCash,
    unit_cost: unitCost,
  };
}
