/**
 * Billable tasks → invoice lines (T-205, A5). Pure so the amount rounding is
 * proven by test rather than by a walk: minutes are converted to hours with two
 * decimals, each line is priced at a resolved rate, and a service billed on time
 * applies its minimum billable quantity to the intervention as a whole.
 */

export interface BillableTask {
  id: string;
  title: string;
  client_id: string | null;
  minutes: number;
  hourly_rate: number;
  billable: number | boolean;
  invoice_id?: string | null;
}

/** A time entry, possibly tied to a catalogue service and an expertise level. */
export interface TimesheetTask extends BillableTask {
  product_id?: string | null;
  product_name?: string | null;
  service_level?: string | null;
  premium_label?: string | null;
  premium_percent?: number | null;
}

export interface BilledLine {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

/** Rate and minimum billable quantity resolved by the caller from the service. */
export interface LinePricing {
  rate: number;
  /** Minimum billable quantity in hours, 0 when the service has none. */
  minimum?: number;
  description?: string;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

export function isBillable(task: BillableTask): boolean {
  return Boolean(task.billable) && !task.invoice_id && task.minutes > 0 && task.hourly_rate > 0;
}

/**
 * An entry is a candidate for a timesheet invoice even without its own rate: a
 * service entry is priced by the catalogue (expertise level or service price), so
 * only the work itself decides here. The rate is checked once it is resolved.
 */
function isTimeEntry(task: TimesheetTask): boolean {
  return Boolean(task.billable) && !task.invoice_id && task.minutes > 0;
}

/** Hours rounded to two decimals, never zero for a positive duration. */
export function hoursOf(minutes: number): number {
  const hours = Math.round((minutes / 60) * 100) / 100;
  return hours > 0 ? hours : 0.01;
}

export function toInvoiceLines(tasks: readonly BillableTask[], taxRate: number): BilledLine[] {
  return tasks.filter(isBillable).map((task) => ({
    id: `task-${task.id}`,
    description: task.title.slice(0, 500),
    quantity: hoursOf(task.minutes),
    unit_price: task.hourly_rate,
    tax_rate: taxRate,
  }));
}

/**
 * Time entries → invoice lines for a service catalogue (A5).
 *
 * Entries of the same service, expertise level and rate are billed as one line.
 * An entry without a catalogue service keeps its own line, exactly as before, so
 * existing tasks bill unchanged.
 *
 * The minimum billable quantity is a floor on the **intervention**, not on each
 * line: one hour of a junior and one hour of an expert on the same job is two
 * hours, not two minimums. The shortfall is carried by the first line of the
 * service, so the total never exceeds the floor and the invoice stays readable.
 *
 * A premium (night, Sunday) is a separate line at its own rate: the invoice then
 * shows what was charged and why, and the premium can be audited without
 * reverse-engineering the hourly price.
 */
export function timesheetLines(
  tasks: readonly TimesheetTask[],
  taxRate: number,
  pricing: ReadonlyMap<string, LinePricing>,
): BilledLine[] {
  const lines: BilledLine[] = [];
  const groups = new Map<string, { service: string; description: string; hours: number; rate: number }>();
  const serviceHours = new Map<string, number>();
  const serviceMinimum = new Map<string, number>();

  for (const task of tasks.filter(isTimeEntry)) {
    const resolved = pricing.get(task.id);
    const rate = Math.round(Number(resolved?.rate ?? task.hourly_rate));
    if (!Number.isFinite(rate) || rate <= 0) continue;
    const hours = hoursOf(task.minutes);
    const minimum = Math.max(0, Number(resolved?.minimum ?? 0));

    if (task.product_id) {
      const service = task.product_id;
      const key = `${service}|${task.service_level ?? ''}|${rate}`;
      const group = groups.get(key)
        ?? { service, description: (resolved?.description ?? task.title).slice(0, 500), hours: 0, rate };
      group.hours = round2(group.hours + hours);
      groups.set(key, group);
      serviceHours.set(service, round2((serviceHours.get(service) ?? 0) + hours));
      serviceMinimum.set(service, Math.max(serviceMinimum.get(service) ?? 0, minimum));
    } else {
      lines.push({
        id: `task-${task.id}`,
        description: task.title.slice(0, 500),
        quantity: hours,
        unit_price: rate,
        tax_rate: taxRate,
      });
    }

    const percent = Math.round(Number(task.premium_percent ?? 0));
    if (percent > 0) {
      const label = (task.premium_label ?? '').trim();
      lines.push({
        id: `premium-${task.id}`,
        description: `${label ? `Majoration ${label}` : 'Majoration'} (${percent} %)`.slice(0, 500),
        quantity: hours,
        unit_price: Math.round((rate * percent) / 100),
        tax_rate: taxRate,
      });
    }
  }

  // What the intervention still misses to reach the service minimum.
  const shortfalls = new Map<string, number>();
  for (const [service, hours] of serviceHours) {
    const minimum = serviceMinimum.get(service) ?? 0;
    if (hours > 0 && minimum > hours) shortfalls.set(service, round2(minimum - hours));
  }

  // The shortfall is shared between the lines in proportion to their hours, with
  // the rounding remainder on the last one. Giving it all to a single line would
  // make the invoice total depend on the order the database returned the entries,
  // which is not something a customer should ever see.
  const ordered = [...groups.values()].sort((a, b) => a.description.localeCompare(b.description, 'fr'));
  const serviceLines: BilledLine[] = [];
  const services = [...new Set(ordered.map((group) => group.service))];

  for (const service of services) {
    const members = ordered.filter((group) => group.service === service);
    const shortfall = shortfalls.get(service) ?? 0;
    const total = serviceHours.get(service) ?? 0;
    let allocated = 0;
    members.forEach((group, index) => {
      let share = 0;
      if (shortfall > 0 && total > 0) {
        share = index === members.length - 1
          ? round2(shortfall - allocated)
          : round2(shortfall * (group.hours / total));
        allocated = round2(allocated + share);
      }
      serviceLines.push({
        id: `service-${group.description.slice(0, 40)}`,
        description: group.description,
        quantity: round2(group.hours + share),
        unit_price: group.rate,
        tax_rate: taxRate,
      });
    });
  }

  return [...serviceLines, ...lines];
}

/** Total before tax, rounded once per line to match what the document computes. */
export function billableTotal(tasks: readonly BillableTask[]): number {
  return tasks
    .filter(isBillable)
    .reduce((sum, task) => sum + Math.round(hoursOf(task.minutes) * task.hourly_rate), 0);
}

export type TaskInvoiceRefusal = 'NO_TASKS' | 'MIXED_CLIENTS' | 'NO_CLIENT';

/**
 * A single invoice belongs to one client: tasks from different clients must be
 * billed separately rather than silently attributed to the first one.
 */
export function invoiceClientOf(tasks: readonly TimesheetTask[]): TaskInvoiceRefusal | string {
  const billable = tasks.filter(isTimeEntry);
  if (!billable.length) return 'NO_TASKS';
  const clients = new Set(billable.map((task) => task.client_id ?? ''));
  if (clients.size > 1) return 'MIXED_CLIENTS';
  const only = billable[0].client_id;
  if (!only) return 'NO_CLIENT';
  return only;
}
