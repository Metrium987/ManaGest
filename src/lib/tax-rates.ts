import { useQuery } from '@tanstack/react-query';
import { TVA_RATES } from '@shared/domain';
import { api } from './api';

/**
 * The selectable TVA rates. They are rows in `tax_rates`, maintained in
 * Paramètres → Taxes, so a business can add, rename or remove a rate without a
 * code change. The shared TVA_RATES list is only the seed used when the company
 * has not been set up yet.
 */

interface SettingsTaxRate {
  id: string;
  name: string;
  rate: number;
}

interface SettingsPayload {
  tax_rates?: SettingsTaxRate[];
}

export interface TaxRateOption {
  rate: number;
  label: string;
}

export function useTaxRates(): TaxRateOption[] {
  const settings = useQuery<SettingsPayload>({
    queryKey: ['settings'],
    queryFn: () => api.get<SettingsPayload>('/settings'),
    staleTime: 60_000,
  });

  const rows = settings.data?.tax_rates ?? [];
  if (!rows.length) return TVA_RATES.map((rate) => ({ rate: rate.rate, label: rate.label }));
  return rows.map((row) => ({ rate: row.rate, label: row.name || `${row.rate} %` }));
}
