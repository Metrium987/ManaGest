import { useQuery } from '@tanstack/react-query';
import { TVA_RATES } from '@shared/domain';
import { api } from './api';

/**
 * The selectable TVA rates. They are rows in `tax_rates`, maintained in
 * Paramètres → Taxes, so a business can add, rename or remove a rate without a
 * code change. The shared TVA_RATES list is only the seed used when the company
 * has not been set up yet.
 *
 * They are read from `/tax-rates`, not from the settings screen: issuing a
 * document only requires `invoices.read`, so a sales account keeps the rates
 * configured by the people who hold `settings.write`.
 */

interface SettingsTaxRate {
  id: string;
  name: string;
  rate: number;
}

interface TaxRatePayload {
  data?: SettingsTaxRate[];
}

export interface TaxRateOption {
  rate: number;
  label: string;
}

export function useTaxRates(): TaxRateOption[] {
  const settings = useQuery<TaxRatePayload>({
    // Same key as the settings screen, so saving a rate there refreshes the
    // line editors without a second invalidation path.
    queryKey: ['settings'],
    queryFn: () => api.get<TaxRatePayload>('/tax-rates'),
    staleTime: 60_000,
  });

  const rows = settings.data?.data ?? [];
  if (!rows.length) return TVA_RATES.map((rate) => ({ rate: rate.rate, label: rate.label }));
  return rows.map((row) => ({ rate: row.rate, label: row.name || `${row.rate} %` }));
}
