import { describe, expect, it } from 'vitest';
import { timesheetLines, type TimesheetTask } from '../server/lib/task-billing';

const task = (overrides: Partial<TimesheetTask>): TimesheetTask => ({
  id: 't1',
  title: 'Intervention',
  client_id: 'c1',
  minutes: 60,
  hourly_rate: 5000,
  billable: 1,
  invoice_id: null,
  product_id: null,
  ...overrides,
});

const price = (rate: number, minimum = 0, description = 'Service') =>
  new Map([['t1', { rate, minimum, description }]]);

describe('timesheetLines', () => {
  it('keeps one line per task when no service is attached', () => {
    const lines = timesheetLines([task({})], 16, price(5000));
    expect(lines).toEqual([{
      id: 'task-t1', description: 'Intervention', quantity: 1, unit_price: 5000, tax_rate: 16,
    }]);
  });

  it('uses the catalogue wording and rate for a service entry', () => {
    const lines = timesheetLines(
      [task({ product_id: 'p1', minutes: 90 })], 16, price(6000, 0, 'Assistance — Expert'),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0].description).toBe('Assistance — Expert');
    expect(lines[0].quantity).toBe(1.5);
    expect(lines[0].unit_price).toBe(6000);
  });

  it('applies the minimum billable quantity once per intervention', () => {
    const tasks = [
      task({ id: 't1', product_id: 'p1', minutes: 30 }),
      task({ id: 't2', product_id: 'p1', minutes: 30 }),
    ];
    const pricing = new Map([
      ['t1', { rate: 5000, minimum: 2, description: 'Régie' }],
      ['t2', { rate: 5000, minimum: 2, description: 'Régie' }],
    ]);
    const lines = timesheetLines(tasks, 16, pricing);
    expect(lines).toHaveLength(1);
    expect(lines[0].quantity).toBe(2);
  });

  it('does not let a minimum create billing out of nothing', () => {
    const lines = timesheetLines([task({ product_id: 'p1', minutes: 0 })], 16, price(5000, 2));
    expect(lines).toEqual([]);
  });

  it('bills a premium as its own line at the premium rate', () => {
    const lines = timesheetLines(
      [task({ product_id: 'p1', minutes: 120, premium_label: 'Dimanche', premium_percent: 50 })],
      16,
      price(4000, 0, 'Régie'),
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ description: 'Régie', quantity: 2, unit_price: 4000 });
    expect(lines[1]).toMatchObject({ description: 'Majoration Dimanche (50 %)', quantity: 2, unit_price: 2000 });
  });

  it('skips an entry with no billable rate', () => {
    expect(timesheetLines([task({ hourly_rate: 0 })], 16, price(0))).toEqual([]);
  });

  it('never bills an entry that already carries an invoice', () => {
    expect(timesheetLines([task({ invoice_id: 'inv-1' })], 16, price(5000))).toEqual([]);
  });

  it('applies the minimum to the service, not to each level', () => {
    const tasks = [
      task({ id: 't1', product_id: 'p1', service_level: 'Junior', minutes: 30 }),
      task({ id: 't2', product_id: 'p1', service_level: 'Expert', minutes: 30 }),
    ];
    const pricing = new Map([
      ['t1', { rate: 4000, minimum: 2, description: 'Régie — Junior' }],
      ['t2', { rate: 9000, minimum: 2, description: 'Régie — Expert' }],
    ]);
    const lines = timesheetLines(tasks, 16, pricing);
    // One hour worked, a two-hour floor shared in proportion to each level's
    // hours: 1 h each, never 2 h for the junior *and* 2 h for the expert.
    expect(lines.map((line) => [line.unit_price, line.quantity]).sort((a, b) => a[0] - b[0]))
      .toEqual([[4000, 1], [9000, 1]]);
  });

  it('separates two expertise levels into two lines', () => {
    const tasks = [
      task({ id: 't1', product_id: 'p1', service_level: 'Junior', minutes: 60 }),
      task({ id: 't2', product_id: 'p1', service_level: 'Expert', minutes: 60 }),
    ];
    const pricing = new Map([
      ['t1', { rate: 4000, minimum: 0, description: 'Régie — Junior' }],
      ['t2', { rate: 9000, minimum: 0, description: 'Régie — Expert' }],
    ]);
    const lines = timesheetLines(tasks, 16, pricing);
    expect(lines.map((line) => [line.unit_price, line.quantity]))
      .toEqual([[9000, 1], [4000, 1]]);
  });

  it('gives the same total whatever order the entries arrive in', () => {
    const junior = task({ id: 't1', product_id: 'p1', service_level: 'Junior', minutes: 30 });
    const expert = task({ id: 't2', product_id: 'p1', service_level: 'Expert', minutes: 30 });
    const pricing = new Map([
      ['t1', { rate: 4000, minimum: 2, description: 'Régie — Junior' }],
      ['t2', { rate: 9000, minimum: 2, description: 'Régie — Expert' }],
    ]);
    const amount = (lines: { quantity: number; unit_price: number }[]) =>
      lines.reduce((sum, line) => sum + Math.round(line.quantity * line.unit_price), 0);

    expect(amount(timesheetLines([junior, expert], 16, pricing)))
      .toBe(amount(timesheetLines([expert, junior], 16, pricing)));
  });
});
