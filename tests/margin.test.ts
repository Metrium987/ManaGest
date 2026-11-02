import { describe, expect, it } from 'vitest';
import {
  aggregateMargin,
  lineNetAmounts,
  marginSummary,
  type CostLookup,
  type MarginDocument,
} from '../server/lib/margin';

const costs = new Map<string, CostLookup>([
  ['a', { cost: 500, axis: 'NORD', family: 'Panneaux' }],
  ['b', { cost: 200, axis: 'SUD', family: 'Visserie' }],
  ['c', { cost: null, axis: null, family: null }],
]);

const invoice = (lines: MarginDocument['lines'], discount_value = 0, discount_type: 'percent' | 'amount' = 'percent'): MarginDocument => ({
  id: 'i1', date: '2026-11-02', kind: 'invoice', discount_type, discount_value, lines,
});

describe('margin report (F3)', () => {
  it('spreads a document discount over its lines without losing a franc', () => {
    const nets = lineNetAmounts(invoice([
      { product_id: 'a', quantity: 1, unit_price: 1000 },
      { product_id: 'b', quantity: 1, unit_price: 1000 },
      { product_id: 'a', quantity: 1, unit_price: 1000 },
    ], 10));
    expect(nets.reduce((sum, value) => sum + value, 0)).toBe(2700);
    expect(nets).toEqual([900, 900, 900]);
  });

  it('handles an amount discount and never discounts below zero', () => {
    const nets = lineNetAmounts(invoice([
      { product_id: 'a', quantity: 2, unit_price: 1000 },
    ], 500, 'amount'));
    expect(nets).toEqual([1500]);
    const over = lineNetAmounts(invoice([{ product_id: 'a', quantity: 1, unit_price: 800 }], 900, 'amount'));
    expect(over).toEqual([0]);
  });

  it('computes revenue, cost and margin rate per family', () => {
    const rows = aggregateMargin([invoice([
      { product_id: 'a', product_family: 'Panneaux', quantity: 2, unit_price: 1000 },
      { product_id: 'b', product_family: 'Visserie', quantity: 1, unit_price: 500 },
    ])], costs, 'family');

    const panneaux = rows.find((row) => row.key === 'Panneaux')!;
    expect(panneaux.revenue).toBe(2000);
    expect(panneaux.cost).toBe(1000);
    expect(panneaux.margin).toBe(1000);
    expect(panneaux.margin_bp).toBe(5000);
    expect(panneaux.quantity_milli).toBe(2000);

    const visserie = rows.find((row) => row.key === 'Visserie')!;
    expect(visserie.margin).toBe(300);
    expect(visserie.margin_bp).toBe(6000);
  });

  it('subtracts a credit note from both revenue and cost', () => {
    const credit: MarginDocument = {
      id: 'c1', date: '2026-11-02', kind: 'credit', discount_type: 'percent', discount_value: 0,
      lines: [{ product_id: 'a', product_family: 'Panneaux', quantity: 1, unit_price: 1000 }],
    };
    const rows = aggregateMargin([invoice([
      { product_id: 'a', product_family: 'Panneaux', quantity: 2, unit_price: 1000 },
    ]), credit], costs, 'family');
    const row = rows[0];
    expect(row.revenue).toBe(1000);
    expect(row.cost).toBe(500);
    expect(row.margin).toBe(500);
    expect(row.quantity_milli).toBe(1000);
    expect(row.documents).toBe(2);
  });

  it('falls back to the sheet family when a line carries no snapshot', () => {
    // A credit note created without the A1 snapshot must still land on its family.
    const rows = aggregateMargin([invoice([
      { product_id: 'a', product_family: null, quantity: 1, unit_price: 1000 },
    ])], costs, 'family');
    expect(rows[0].key).toBe('Panneaux');
    expect(rows[0].revenue).toBe(1000);
  });

  it('keeps a readable rate on a net credit (negative revenue)', () => {
    const credit: MarginDocument = {
      id: 'c2', date: '2026-11-02', kind: 'credit', discount_type: 'percent', discount_value: 0,
      lines: [{ product_id: 'a', product_family: 'Panneaux', quantity: 1, unit_price: 1000 }],
    };
    const [row] = aggregateMargin([credit], costs, 'family');
    expect(row.revenue).toBe(-1000);
    expect(row.margin).toBe(-500);
    expect(row.margin_bp).toBe(5000);
  });

  it('returns a null rate only when there is no revenue at all', () => {
    const [row] = aggregateMargin([invoice([
      { product_id: 'a', product_family: 'Panneaux', quantity: 1, unit_price: 1000 },
    ], 100)], costs, 'family');
    expect(row.revenue).toBe(0);
    expect(row.margin).toBe(-500);
    expect(row.margin_bp).toBeNull();
  });

  it('returns a null margin when a line cannot be costed, instead of 100 %', () => {
    const rows = aggregateMargin([invoice([
      { product_id: 'c', product_family: 'Divers', quantity: 1, unit_price: 1000 },
    ])], costs, 'family');
    expect(rows[0].margin).toBeNull();
    expect(rows[0].margin_bp).toBeNull();
    expect(rows[0].uncosted_lines).toBe(1);
  });

  it('groups by analytic axis and by product, with a bucket for the rest', () => {
    const documents = [invoice([
      { product_id: 'a', product_family: 'Panneaux', quantity: 1, unit_price: 1000 },
      { product_id: 'b', product_family: 'Visserie', quantity: 1, unit_price: 500 },
      { product_id: null, product_family: null, quantity: 1, unit_price: 200 },
    ])];

    const byAxis = aggregateMargin(documents, costs, 'axis');
    expect(byAxis.map((row) => row.key).sort()).toEqual(['NORD', 'SUD', '__none__']);

    const byProduct = aggregateMargin(documents, costs, 'product');
    expect(byProduct.find((row) => row.key === 'a')?.revenue).toBe(1000);
    expect(byProduct.find((row) => row.key === '__none__')?.uncosted_lines).toBe(1);
  });

  it('summarises the period, with a null total when any line is uncosted', () => {
    const clean = aggregateMargin([invoice([
      { product_id: 'a', product_family: 'Panneaux', quantity: 1, unit_price: 1000 },
    ])], costs, 'family');
    expect(marginSummary(clean)).toEqual({ revenue: 1000, cost: 500, margin: 500, margin_bp: 5000, uncosted_lines: 0 });

    const partial = aggregateMargin([invoice([
      { product_id: 'a', product_family: 'Panneaux', quantity: 1, unit_price: 1000 },
      { product_id: null, product_family: 'Divers', quantity: 1, unit_price: 100 },
    ])], costs, 'family');
    expect(marginSummary(partial).margin).toBeNull();
    expect(marginSummary(partial).uncosted_lines).toBe(1);
  });
});
