/**
 * Billable tasks → invoice lines (T-205). Pure so the amount rounding is proven
 * by test rather than by a walk: minutes are converted to hours with two
 * decimals and each line is priced at the task's own hourly rate.
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

export interface BilledLine {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
}

export function isBillable(task: BillableTask): boolean {
  return Boolean(task.billable) && !task.invoice_id && task.minutes > 0 && task.hourly_rate > 0;
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
export function invoiceClientOf(tasks: readonly BillableTask[]): TaskInvoiceRefusal | string {
  const billable = tasks.filter(isBillable);
  if (!billable.length) return 'NO_TASKS';
  const clients = new Set(billable.map((task) => task.client_id ?? ''));
  if (clients.size > 1) return 'MIXED_CLIENTS';
  const only = billable[0].client_id;
  if (!only) return 'NO_CLIENT';
  return only;
}
