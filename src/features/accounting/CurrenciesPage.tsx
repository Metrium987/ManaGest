import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Coins, Pencil, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { ListResponse } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface Currency {
  code: string;
  label: string;
  symbol: string;
  decimals: number;
  is_base: number;
  active: number;
  rate: number | null;
  rate_date: string | null;
}

interface Rate {
  id: string;
  rate: number;
  effective_date: string;
  note: string | null;
  created_at: string;
}

/**
 * Currencies and rates are typed by the owner: no local bank exposes a feed, so
 * a missing rate is visible here instead of being guessed by the application.
 * The accountant can read this screen; only the settings permission writes it.
 */
export function CurrenciesPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canWrite = can('settings.write');

  const [editing, setEditing] = useState<Currency | null>(null);
  const [creating, setCreating] = useState(false);
  const [rateFor, setRateFor] = useState<Currency | null>(null);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [symbol, setSymbol] = useState('');
  const [decimals, setDecimals] = useState(2);
  const [active, setActive] = useState(true);
  const [rate, setRate] = useState(0);
  const [rateDate, setRateDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  const currencies = useQuery({
    queryKey: ['currencies'],
    queryFn: () => api.get<ListResponse<Currency>>('/currencies'),
  });

  const rates = useQuery({
    queryKey: ['currencies', rateFor?.code, 'rates'],
    queryFn: () => api.get<ListResponse<Rate>>(`/currencies/${rateFor!.code}/rates`),
    enabled: Boolean(rateFor),
  });

  const saveCurrency = useMutation({
    mutationFn: () => {
      const payload = { code, label, symbol, decimals, active };
      return editing
        ? api.patch(`/currencies/${editing.code}`, { label, symbol, decimals, active })
        : api.post('/currencies', payload);
    },
    onSuccess: () => {
      toast.success(t('currencies.saved'));
      setCreating(false);
      setEditing(null);
      setError('');
      queryClient.invalidateQueries({ queryKey: ['currencies'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const saveRate = useMutation({
    mutationFn: () =>
      api.post(`/currencies/${rateFor!.code}/rates`, {
        rate,
        effective_date: rateDate,
        note: note || null,
      }),
    onSuccess: () => {
      toast.success(t('currencies.rateSaved'));
      setRateFor(null);
      setRate(0);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['currencies'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const openCreate = () => {
    setCode('');
    setLabel('');
    setSymbol('');
    setDecimals(2);
    setActive(true);
    setEditing(null);
    setCreating(true);
    setError('');
  };

  const openEdit = (currency: Currency) => {
    setCode(currency.code);
    setLabel(currency.label);
    setSymbol(currency.symbol);
    setDecimals(currency.decimals);
    setActive(Boolean(currency.active));
    setEditing(currency);
    setCreating(false);
    setError('');
  };

  return (
    <>
      <PageHeader
        title={t('currencies.title')}
        subtitle={t('currencies.subtitle')}
        actions={
          canWrite ? (
            <Button onClick={openCreate} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
              {t('currencies.new')}
            </Button>
          ) : undefined
        }
      />

      <SectionCard title={t('currencies.title')} subtitle={t('currencies.ratesHint')} bodyClassName="table-wrap">
        {currencies.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : currencies.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('currencies.code')}</th>
                <th scope="col">{t('currencies.label')}</th>
                <th scope="col" className="text-right">{t('currencies.decimals')}</th>
                <th scope="col" className="text-right">{t('currencies.rate')}</th>
                <th scope="col">{t('currencies.updated')}</th>
                <th scope="col">{t('currencies.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {currencies.data.data.map((currency) => (
                <tr key={currency.code}>
                  <td className="font-medium">
                    {currency.code}
                    {currency.is_base ? <span className="ml-2 text-xs text-muted">({t('currencies.base')})</span> : null}
                  </td>
                  <td>{currency.label} <span className="text-muted">({currency.symbol})</span></td>
                  <td className="text-right tabular-nums">{currency.decimals}</td>
                  <td className="text-right tabular-nums">
                    {currency.is_base
                      ? `1 ${currency.code} = 1 XPF`
                      : currency.rate
                        ? `1 ${currency.code} = ${currency.rate.toLocaleString('fr-FR')} XPF`
                        : t('currencies.noRate')}
                  </td>
                  <td className="text-muted">{currency.rate_date ? formatDate(currency.rate_date) : '—'}</td>
                  <td>
                    <span className={currency.active ? 'badge badge-success' : 'badge'}>
                      {currency.active ? t('currencies.active') : t('currencies.inactive')}
                    </span>
                  </td>
                  <td className="text-right">
                    {canWrite ? (
                      <>
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                          aria-label={`${t('common.edit')} ${currency.code}`}
                          onClick={() => openEdit(currency)}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                        {!currency.is_base ? (
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                            aria-label={`${t('currencies.rate')} ${currency.code}`}
                            onClick={() => { setRateFor(currency); setRate(currency.rate ?? 0); setError(''); }}
                          >
                            <Coins className="h-4 w-4" aria-hidden="true" />
                          </button>
                        ) : null}
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Coins className="h-6 w-6" aria-hidden="true" />} title={t('currencies.empty')} />
        )}
      </SectionCard>

      <Modal
        open={creating || Boolean(editing)}
        onClose={() => { setCreating(false); setEditing(null); }}
        title={editing ? t('currencies.edit') : t('currencies.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => { setCreating(false); setEditing(null); }}>{t('common.cancel')}</Button>
            <Button loading={saveCurrency.isPending} onClick={() => saveCurrency.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">{error}</p> : null}
          <FormGrid>
            <Field label={t('currencies.code')} htmlFor="currency_code" required>
              <Input
                id="currency_code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                disabled={Boolean(editing)}
                maxLength={5}
                required
              />
            </Field>
            <Field label={t('currencies.label')} htmlFor="currency_label" required>
              <Input id="currency_label" value={label} onChange={(event) => setLabel(event.target.value)} required />
            </Field>
            <Field label={t('currencies.symbol')} htmlFor="currency_symbol" required>
              <Input id="currency_symbol" value={symbol} onChange={(event) => setSymbol(event.target.value)} maxLength={8} required />
            </Field>
            <Field label={t('currencies.decimals')} htmlFor="currency_decimals">
              <Select id="currency_decimals" value={decimals} onChange={(event) => setDecimals(Number(event.target.value))} disabled={Boolean(editing?.is_base)}>
                {[0, 1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
              </Select>
            </Field>
          </FormGrid>
          <Checkbox
            label={t('currencies.active')}
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            disabled={Boolean(editing?.is_base)}
          />
        </div>
      </Modal>

      <Modal
        open={Boolean(rateFor)}
        onClose={() => setRateFor(null)}
        title={`${t('currencies.rate')} · ${rateFor?.code ?? ''}`}
        description={t('currencies.ratesHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRateFor(null)}>{t('common.cancel')}</Button>
            <Button loading={saveRate.isPending} onClick={() => saveRate.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {error ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">{error}</p> : null}
          <FormGrid>
            <Field label={`1 ${rateFor?.code ?? ''} = ? XPF`} htmlFor="rate_value" required>
              <Input id="rate_value" type="number" min="0" step="any" value={rate || ''} onChange={(event) => setRate(Number(event.target.value))} required />
            </Field>
            <Field label={t('currencies.effectiveDate')} htmlFor="rate_date" required>
              <Input id="rate_date" type="date" value={rateDate} onChange={(event) => setRateDate(event.target.value)} required />
            </Field>
          </FormGrid>
          <Field label={t('common.reference')} htmlFor="rate_note">
            <Input id="rate_note" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
          {rates.data?.data.length ? (
            <div className="max-h-48 overflow-y-auto text-sm">
              <p className="mb-2 font-medium">{t('currencies.history')}</p>
              <ul className="space-y-1">
                {rates.data.data.map((row) => (
                  <li key={row.id} className="flex justify-between gap-3 text-muted">
                    <span>{formatDate(row.effective_date)}</span>
                    <span className="tabular-nums">{row.rate.toLocaleString('fr-FR')} XPF</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Modal>
    </>
  );
}
