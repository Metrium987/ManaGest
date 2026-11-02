import { describe, expect, it } from 'vitest';
import { applyExpertisePricing, levelPrice } from '../server/lib/expertise';

const service = {
  id: 'svc',
  expertise_levels: [
    { level: 'Junior', price: 3000 },
    { level: 'Senior', price: 5000 },
    { level: 'Expert', price: 0 },
  ],
};

describe('expertise level prices', () => {
  it('reads the price attached to a level', () => {
    expect(levelPrice(service, 'Junior')).toBe(3000);
    expect(levelPrice(service, 'Senior')).toBe(5000);
  });

  it('treats an unpriced level as missing rather than free', () => {
    expect(levelPrice(service, 'Expert')).toBeNull();
    expect(levelPrice(service, null)).toBeNull();
  });
});

describe('applying a level to document lines', () => {
  const products = new Map([['svc', service]]);

  it('prices a service line from the chosen level', () => {
    const [line] = applyExpertisePricing(
      [{ product_id: 'svc', quantity: 2, unit_price: 0, expertise_level: 'Senior' }],
      products,
    );
    expect(line.unit_price).toBe(5000);
  });

  it('leaves a line alone when no level is chosen', () => {
    const [line] = applyExpertisePricing(
      [{ product_id: 'svc', quantity: 2, unit_price: 2500, expertise_level: null }],
      products,
    );
    expect(line.unit_price).toBe(2500);
  });

  it('never reprices a negotiated line', () => {
    const [line] = applyExpertisePricing(
      [{ product_id: 'svc', quantity: 1, unit_price: 4200, expertise_level: 'Senior' }],
      products,
    );
    expect(line.unit_price).toBe(4200);
  });

  it('refuses a level the sheet does not carry', () => {
    expect(() =>
      applyExpertisePricing(
        [{ product_id: 'svc', quantity: 1, unit_price: 0, expertise_level: 'Directeur' }],
        products,
      ),
    ).toThrowError(/VALIDATION_ERROR/);
  });

  it('ignores products without levels', () => {
    const [line] = applyExpertisePricing(
      [{ product_id: 'plain', quantity: 1, unit_price: 0, expertise_level: 'Senior' }],
      new Map([['plain', { id: 'plain', expertise_levels: [] }]]),
    );
    expect(line.unit_price).toBe(0);
  });
});
