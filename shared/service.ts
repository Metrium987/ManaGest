/**
 * Service sheet vocabulary and pure calculations (immatériel side of the
 * catalogue). A service has no weight, no warehouse bin and no customs code: it
 * is billed on time, on milestones or on a recurring schedule, and its cost is a
 * loaded hourly rate rather than a purchase price.
 *
 * The CPS (contribution pour la solidarité, 1 %) is a French Polynesia specific
 * levy, kept here so the rate and its calculation have a single definition.
 */

import { localised } from './labels-locale';

export const SERVICE_TYPES = ['one_off', 'subscription', 'time_materials', 'fixed_package'] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];
export const SERVICE_TYPE_LABELS: Record<ServiceType, string> = localised({
  one_off: 'Prestation ponctuelle',
  subscription: 'Abonnement / contrat récurrent',
  time_materials: 'Régie / assistance technique',
  fixed_package: 'Forfait / livrable fixe',
}, {
  one_off: 'One-off service',
  subscription: 'Subscription / recurring contract',
  time_materials: 'Time & materials / technical support',
  fixed_package: 'Fixed package / deliverable',
});

export const BILLING_UNITS = ['hour', 'day', 'fixed', 'month', 'year', 'unit'] as const;
export type BillingUnit = (typeof BILLING_UNITS)[number];
export const BILLING_UNIT_LABELS: Record<BillingUnit, string> = localised({
  hour: 'Heure (H)',
  day: 'Jour (J / JH)',
  fixed: 'Forfait',
  month: 'Mois',
  year: 'Année',
  unit: 'Unité / acte',
}, {
  hour: 'Hour (H)',
  day: 'Day (D)',
  fixed: 'Fixed package',
  month: 'Month',
  year: 'Year',
  unit: 'Unit / act',
});

export const BILLING_TRIGGERS = ['order', 'milestone', 'timesheet', 'recurring'] as const;
export type BillingTrigger = (typeof BILLING_TRIGGERS)[number];
export const BILLING_TRIGGER_LABELS: Record<BillingTrigger, string> = localised({
  order: 'À la commande / avance',
  milestone: 'Au livrable / jalons',
  timesheet: 'Sur relevé d’heures validé',
  recurring: 'Échéancier récurrent',
}, {
  order: 'On order / advance',
  milestone: 'On deliverable / milestones',
  timesheet: 'On approved timesheet',
  recurring: 'Recurring schedule',
});

export const RENEWAL_MODES = ['tacit', 'fixed_term', 'end_date'] as const;
export type RenewalMode = (typeof RENEWAL_MODES)[number];
export const RENEWAL_MODE_LABELS: Record<RenewalMode, string> = localised({
  tacit: 'Tacite reconduction',
  fixed_term: 'Période ferme',
  end_date: 'Date de fin fixe',
}, {
  tacit: 'Tacit renewal',
  fixed_term: 'Fixed term',
  end_date: 'Fixed end date',
});

export const EXPENSE_MODES = ['included', 'actual', 'forfait'] as const;
export type ExpenseMode = (typeof EXPENSE_MODES)[number];
export const EXPENSE_MODE_LABELS: Record<ExpenseMode, string> = localised({
  included: 'Inclus dans le prix',
  actual: 'Au réel (débours)',
  forfait: 'Forfaitaire',
}, {
  included: 'Included in the price',
  actual: 'Actual cost (disbursement)',
  forfait: 'Flat rate',
});

/** Intervention perimeter. Zone 3 implies airfare, accommodation and per diem. */
export const TRAVEL_ZONES = ['zone1', 'zone2', 'zone3'] as const;
export type TravelZone = (typeof TRAVEL_ZONES)[number];
export const TRAVEL_ZONE_LABELS: Record<TravelZone, string> = localised({
  zone1: 'Zone 1 — Tahiti (Papeete / urbain)',
  zone2: 'Zone 2 — Presqu’île / zones éloignées',
  zone3: 'Zone 3 — Inter-îles / archipels',
}, {
  zone1: 'Zone 1 — Tahiti (Papeete / urban)',
  zone2: 'Zone 2 — Peninsula / remote areas',
  zone3: 'Zone 3 — Outer islands / archipelagos',
});

export const REVENUE_RECOGNITIONS = ['advance', 'percentage_completion'] as const;
export type RevenueRecognition = (typeof REVENUE_RECOGNITIONS)[number];
export const REVENUE_RECOGNITION_LABELS: Record<RevenueRecognition, string> = localised({
  advance: 'Facturation d’avance (produits constatés d’avance)',
  percentage_completion: 'Avancement au pourcentage d’achèvement',
}, {
  advance: 'Advance billing (deferred revenue)',
  percentage_completion: 'Percentage of completion',
});

export const DEFAULT_CPS_RATE = 1;

/** CPS on the pre-tax amount, in minor units. 1 % by default in Polynésie. */
export function cpsAmount(amountMinor: number, ratePercent: number = DEFAULT_CPS_RATE): number {
  if (!Number.isFinite(amountMinor) || amountMinor <= 0) return 0;
  return Math.round((amountMinor * Math.max(0, ratePercent)) / 100);
}

/**
 * Minimum billable quantity: a 30-minute call sold with a 2-hour minimum bills
 * 2 hours, and nothing is billed for zero work.
 */
export function billableQuantity(quantity: number, minimum: number): number {
  if (!Number.isFinite(quantity) || quantity <= 0) return 0;
  return Math.max(quantity, Math.max(0, minimum));
}

const FREQUENCY_MONTHS: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12,
};

/**
 * Next billing date of a recurring contract. The day of month is kept and
 * clamped to the length of the target month: a contract starting on the 31st
 * bills on the 28th (or 29th) in February, never on 3 March.
 */
export function nextBillingDate(iso: string, frequency: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  if (frequency === 'weekly') {
    date.setUTCDate(date.getUTCDate() + 7);
    return date.toISOString().slice(0, 10);
  }
  const months = FREQUENCY_MONTHS[frequency] ?? 1;
  const day = date.getUTCDate();
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
  return date.toISOString().slice(0, 10);
}
