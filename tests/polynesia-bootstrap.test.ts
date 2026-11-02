/**
 * A brand-new install must already be Polynesian: country, XPF, Tahiti time,
 * the local tax plan (0/5/13/16 plus the dated 1 % archipelago rate) and a
 * service rate of 13 %. The install route is exercised for real against SQLite,
 * through the same schema provisioning the Worker runs, so the test fails if the
 * defaults drift back to metropolitan values.
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { ensureSchema } from '../server/db';
import { setupRoutes } from '../server/routes/setup';
import { computeTotals } from '../server/lib/tax';
import {
  DEFAULT_COUNTRY,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TAX_RATE,
  DEFAULT_TIMEZONE,
  TVA_RATES,
} from '../shared/domain';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_VAT_REGIMES,
  ENTITY_CATEGORIES,
  LEGAL_FORMS,
} from '../shared/client-profile';
import { identifierMentions } from '../shared/invoice-mentions';
import { formatMoney } from '../shared/money';

type Row = Record<string, unknown>;

function asD1(database: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    const bind = (params: unknown[]): unknown => ({
      bind: (...next: unknown[]) => bind(next),
      all: async () => ({ results: database.prepare(sql).all(...(params as never[])) as Row[] }),
      first: async () => (database.prepare(sql).get(...(params as never[])) as Row | undefined) ?? null,
      run: async () => {
        database.prepare(sql).run(...(params as never[]));
        return { success: true, meta: {} };
      },
    });
    return bind([]);
  };
  return {
    prepare,
    batch: async (statements: { run: () => Promise<unknown> }[]) => {
      for (const statement of statements) await statement.run();
      return [];
    },
  } as unknown as D1Database;
}

const ADMIN = {
  first_name: 'Test',
  last_name: 'Owner',
  email: 'owner@example.test',
  password: 'ManaGest-Demo-2026!',
};

function installPayload(taxId: string) {
  return {
    company: {
      name: 'ManaGest Test',
      legal_name: 'ManaGest Test SARL',
      entity_category: ENTITY_CATEGORIES[0],
      legal_form: LEGAL_FORMS[0],
      tax_id: taxId,
      po_box_municipality: 'Papeete',
      postal_code: '98714',
      vat_regime_detail: CLIENT_VAT_REGIMES[0],
      payment_method: CLIENT_PAYMENT_METHODS[0],
      payment_terms_code: CLIENT_PAYMENT_TERMS[0],
      data_consent_accepted: true,
    },
    admin: ADMIN,
    demo_data: false,
  };
}

describe('Polynesian bootstrap', () => {
  it('ships the local constants as defaults', () => {
    expect(DEFAULT_COUNTRY).toBe('Polynésie française');
    expect(DEFAULT_CURRENCY).toBe('XPF');
    expect(DEFAULT_TIMEZONE).toBe('Pacific/Tahiti');
    expect(DEFAULT_LOCALE).toBe('fr-PF');
    expect(DEFAULT_TAX_RATE).toBe(13);
  });

  it('publishes the full local tax plan, including the dated archipelago rate', () => {
    const rates = TVA_RATES.map((rate) => rate.rate).sort((a, b) => a - b);
    expect(rates).toEqual([0, 1, 5, 13, 16]);
    const archipelago = TVA_RATES.find((rate) => rate.rate === 1);
    expect(archipelago?.valid_from).toBe('2026-07-01');
    expect(TVA_RATES.find((rate) => rate.rate === 13)?.label).toContain('services');
    expect(TVA_RATES.find((rate) => rate.rate === 16)?.label).toContain('biens');
  });

  it('installs a Polynesian company with XPF, Tahiti time and the five tax lines', async () => {
    const database = new DatabaseSync(':memory:');
    const d1 = asD1(database);
    await ensureSchema(d1);

    // No tax number at install time: the identifiers must stay optional.
    const response = await setupRoutes.request(
      '/install',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(installPayload('')),
      },
      { DB: d1 } as never,
    );
    expect(response.status).toBe(201);

    const company = database
      .prepare(`SELECT country, currency, timezone, locale, default_tax_rate, tax_id FROM company`)
      .get() as Row;
    expect(company.country).toBe('Polynésie française');
    expect(company.currency).toBe('XPF');
    expect(company.timezone).toBe('Pacific/Tahiti');
    expect(company.locale).toBe('fr-PF');
    expect(company.default_tax_rate).toBe(13);
    expect(company.tax_id).toBeNull();

    const taxRates = database
      .prepare(`SELECT rate, name, is_default, valid_from FROM tax_rates ORDER BY rate`)
      .all() as Row[];
    expect(taxRates.map((row) => row.rate)).toEqual([0, 1, 5, 13, 16]);
    const dated = taxRates.find((row) => row.rate === 1);
    expect(dated?.valid_from).toBe('2026-07-01');
    expect(dated?.name).toContain('archipels');
    expect(taxRates.find((row) => row.rate === 13)?.is_default).toBe(1);
    expect(taxRates.find((row) => row.rate === 13)?.name).toContain('services');
  });

  it('bills a service at 13 %, in XPF without decimals, with both parties identified', async () => {
    const totals = computeTotals(
      [{ id: 'service-1', description: 'Prestation de conseil', quantity: 1, unit_price: 100_000, tax_rate: 13 }],
      { discount_type: 'percent', discount_value: 0 },
      false,
    );
    expect(totals.tax_total).toBe(13_000);
    expect(totals.total).toBe(113_000);
    expect(totals.tax_buckets).toEqual([{ rate: 13, base: 100_000, amount: 13_000 }]);
    // XPF is a zero-decimal currency: no cents in the rendered amount.
    expect(formatMoney(totals.total, 'XPF')).not.toMatch(/[.,]\d{2}\b/);
    expect(formatMoney(totals.total, 'XPF')).toMatch(/XPF|FCFP/);

    const companyMentions = identifierMentions({ tax_id: 'T12345', ridet: '1234567', nif: '987654' });
    expect(companyMentions).toEqual([
      'Numéro TAHITI : T12345',
      'RIDET : 1234567',
      'NIF : 987654',
    ]);
    const clientMentions = identifierMentions({ tax_id: null, ridet: '7654321', nif: null });
    expect(clientMentions).toEqual(['RIDET : 7654321']);
  });
});
