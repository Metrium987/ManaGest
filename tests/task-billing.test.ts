import { describe, expect, it } from 'vitest';
import {
  billableTotal,
  hoursOf,
  invoiceClientOf,
  isBillable,
  toInvoiceLines,
  type BillableTask,
} from '../server/lib/task-billing';

const task = (over: Partial<BillableTask> = {}): BillableTask => ({
  id: 't1',
  title: 'Refonte du site',
  client_id: 'client-1',
  minutes: 90,
  hourly_rate: 12_000,
  billable: 1,
  invoice_id: null,
  ...over,
});

describe('tasks → invoice lines (T-205)', () => {
  it('converts minutes to hours with two decimals', () => {
    expect(hoursOf(90)).toBe(1.5);
    expect(hoursOf(60)).toBe(1);
    expect(hoursOf(1)).toBe(0.02);
    expect(hoursOf(0)).toBe(0.01);
  });

  it('excludes unbilled, already invoiced, non-billable and empty tasks', () => {
    expect(isBillable(task())).toBe(true);
    expect(isBillable(task({ invoice_id: 'inv-1' }))).toBe(false);
    expect(isBillable(task({ billable: 0 }))).toBe(false);
    expect(isBillable(task({ minutes: 0 }))).toBe(false);
    expect(isBillable(task({ hourly_rate: 0 }))).toBe(false);
  });

  it('prices each line at the task rate', () => {
    const [line] = toInvoiceLines([task()], 16);
    expect(line.quantity).toBe(1.5);
    expect(line.unit_price).toBe(12_000);
    expect(line.tax_rate).toBe(16);
    expect(line.description).toBe('Refonte du site');
  });

  it('sums the rounded line amounts', () => {
    expect(billableTotal([task(), task({ id: 't2', minutes: 30, hourly_rate: 10_000 })])).toBe(18_000 + 5_000);
  });

  it('refuses an invoice that would mix clients or has no client', () => {
    expect(invoiceClientOf([])).toBe('NO_TASKS');
    expect(invoiceClientOf([task(), task({ id: 't2', client_id: 'client-2' })])).toBe('MIXED_CLIENTS');
    expect(invoiceClientOf([task({ client_id: null })])).toBe('NO_CLIENT');
    expect(invoiceClientOf([task(), task({ id: 't2', invoice_id: 'inv-9' })])).toBe('client-1');
  });
});
