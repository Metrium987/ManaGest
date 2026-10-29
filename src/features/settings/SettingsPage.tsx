import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Lock, LockOpen, Plus, Save, Trash2, Users } from 'lucide-react';
import { COUNTRIES, CURRENCIES } from '@shared/domain';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { LANGUAGES, setLanguage, t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { Company, PeriodLock, SettingsPayload } from '@/lib/types';
import { PageHeader, SectionCard, Skeleton, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Modal';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { RolesPanel } from './RolesPanel';

const TABS = [
  { value: 'company', label: 'settings.company' },
  { value: 'invoicing', label: 'settings.invoicing' },
  { value: 'taxes', label: 'settings.taxes' },
  { value: 'expenses', label: 'settings.expenseCategories' },
  { value: 'periods', label: 'periods.title' },
  { value: 'security', label: 'settings.security' },
  { value: 'legal', label: 'settings.legal' },
  { value: 'email', label: 'settings.emailDelivery' },
  { value: 'roles', label: 'roles.title' },
];

export function SettingsPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [tab, setTab] = useState('company');
  const [form, setForm] = useState<Company | null>(null);
  const [newTax, setNewTax] = useState({ name: '', rate: 16 });
  const [period, setPeriod] = useState('');
  const [periodNote, setPeriodNote] = useState('');
  const [reopenReason, setReopenReason] = useState('');

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsPayload>('/settings') });
  const extras = useQuery({
    queryKey: ['settings-extras'],
    queryFn: () => api.get<{ extras: { key: string; value: string; is_default: boolean }[] }>('/settings/extras'),
    enabled: can('settings.read'),
  });
  const [fiscal, setFiscal] = useState<{ retention_years: string; franchise_threshold: string } | null>(null);
  useEffect(() => {
    if (extras.data && !fiscal) {
      const read = (key: string) => extras.data!.extras.find((item) => item.key === key)?.value ?? '';
      setFiscal({ retention_years: read('retention_years'), franchise_threshold: read('franchise_threshold') });
    }
  }, [extras.data, fiscal]);
  const categories = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<{ categories: { key: string; label: string; archived: number }[] }>('/settings/expense-categories'),
    enabled: can('settings.read'),
  });
  const [newCategory, setNewCategory] = useState('');
  const addCategory = useMutation({
    mutationFn: () => api.post('/settings/expense-categories', { label: newCategory.trim() }),
    onSuccess: () => {
      setNewCategory('');
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const toggleCategory = useMutation({
    mutationFn: (input: { key: string; archived: boolean }) =>
      api.patch(`/settings/expense-categories/${input.key}`, { archived: input.archived }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['expense-categories'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveFiscal = useMutation({
    mutationFn: (input: { retention_years: string; franchise_threshold: string }) => api.patch('/settings/extras', input),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings-extras'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveLanguage = useMutation({
    mutationFn: (value: string) => api.put('/settings/extras/ui_language', { value }),
    onSuccess: (_result, value) => {
      // The dictionaries are read synchronously by t(): switching language is
      // applied immediately and the page reloads so every mounted screen
      // (and the cached queries) is rendered with the new wording.
      setLanguage(value);
      window.location.reload();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const savePdfLayout = useMutation({
    mutationFn: (value: string) => api.put('/settings/extras/pdf_layout', { value }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings-extras'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const periods = useQuery({
    queryKey: ['periods'],
    queryFn: () => api.get<{ data: PeriodLock[] }>(`/settings/periods${toQuery({ page: 1, per_page: 100 })}`),
    enabled: can('periods.read'),
  });

  const closePeriod = useMutation({
    mutationFn: () => api.post('/settings/periods', { period, note: periodNote || null }),
    onSuccess: () => {
      toast.success(t('periods.close'));
      setPeriod('');
      setPeriodNote('');
      queryClient.invalidateQueries({ queryKey: ['periods'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const reopenPeriod = useMutation({
    mutationFn: (input: { period: string; reason: string }) =>
      api.delete(`/settings/periods/${input.period}`, { reason: input.reason || null }),
    onSuccess: () => {
      toast.success(t('periods.reopen'));
      setReopenReason('');
      queryClient.invalidateQueries({ queryKey: ['periods'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data.company);
  }, [settings.data, form]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error('missing');
      return api.patch('/settings', {
        name: form.name, legal_name: form.legal_name, email: form.email, phone: form.phone,
        address1: form.address1, address2: form.address2, city: form.city, postal_code: form.postal_code,
        country: form.country, timezone: form.timezone, currency: form.currency, locale: form.locale,
        tax_id: form.tax_id, rcs: form.rcs, share_capital: form.share_capital, vat_regime: form.vat_regime,
        default_tax_rate: form.default_tax_rate, payment_terms: form.payment_terms, number_pattern: form.number_pattern,
        invoice_terms: form.invoice_terms, invoice_footer: form.invoice_footer, legal_notes: form.legal_notes,
        bank_name: form.bank_name, bank_holder: form.bank_holder, bank_iban: form.bank_iban, bank_bic: form.bank_bic,
        session_idle_minutes: form.session_idle_minutes, session_absolute_hours: form.session_absolute_hours,
      });
    },
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings'] });
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const addTax = useMutation({
    mutationFn: () => api.post('/tax-rates', newTax),
    onSuccess: () => {
      setNewTax({ name: '', rate: 16 });
      queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const removeTax = useMutation({
    mutationFn: (id: string) => api.delete(`/tax-rates/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (settings.isLoading || !form) return <Skeleton className="h-96" />;

  const set = <K extends keyof Company>(key: K, value: Company[K]) => setForm((current) => (current ? { ...current, [key]: value } : current));
  const readOnly = !can('settings.write');
  const visibleTabs = TABS.filter((item) =>
    (item.value !== 'periods' || can('periods.read')) && (item.value !== 'roles' || can('users.read')),
  );

  return (
    <>
      <PageHeader
        title={t('settings.title')}
        subtitle={t('settings.subtitle')}
        actions={can('users.read') ? <Link to="/parametres/utilisateurs" className="btn btn-secondary"><Users className="h-4 w-4" aria-hidden="true" />{t('settings.users')}</Link> : null}
      />

      <div className="card overflow-hidden">
        <div className="px-4 pt-2"><Tabs items={visibleTabs.map((item) => ({ value: item.value, label: t(item.label) }))} value={tab} onChange={setTab} /></div>

        <div className="space-y-5 p-5 sm:p-6">
          {tab === 'company' ? (
            <>
              <FormGrid>
                <Field label={t('settings.companyName')} htmlFor="name" required><Input id="name" value={form.name} onChange={(event) => set('name', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.legalName')} htmlFor="legal_name"><Input id="legal_name" value={form.legal_name ?? ''} onChange={(event) => set('legal_name', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.email')} htmlFor="company_email"><Input id="company_email" type="email" value={form.email ?? ''} onChange={(event) => set('email', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.phone')} htmlFor="phone"><Input id="phone" value={form.phone ?? ''} onChange={(event) => set('phone', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.address')} htmlFor="address1" className="sm:col-span-2"><Input id="address1" value={form.address1 ?? ''} onChange={(event) => set('address1', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.postalCode')} htmlFor="postal_code"><Input id="postal_code" value={form.postal_code ?? ''} onChange={(event) => set('postal_code', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.city')} htmlFor="city"><Input id="city" value={form.city ?? ''} onChange={(event) => set('city', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.country')} htmlFor="country">
                  <Select id="country" value={form.country} onChange={(event) => set('country', event.target.value)} disabled={readOnly}>
                    {COUNTRIES.map((country) => <option key={country} value={country}>{country}</option>)}
                  </Select>
                </Field>
                <Field label={t('settings.tahitiNumber')} htmlFor="tax_id"><Input id="tax_id" value={form.tax_id ?? ''} onChange={(event) => set('tax_id', event.target.value.toUpperCase())} disabled={readOnly} maxLength={6} /></Field>
                <Field label={t('settings.rcs')} htmlFor="rcs"><Input id="rcs" value={form.rcs ?? ''} onChange={(event) => set('rcs', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.shareCapital')} htmlFor="capital"><Input id="capital" value={form.share_capital ?? ''} onChange={(event) => set('share_capital', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.timezone')} htmlFor="timezone">
                  <Select id="timezone" value={form.timezone} onChange={(event) => set('timezone', event.target.value)} disabled={readOnly}>
                    <option value="Pacific/Tahiti">Pacific/Tahiti (UTC−10)</option>
                    <option value="Pacific/Marquesas">Pacific/Marquesas (UTC−9:30)</option>
                    <option value="Pacific/Gambier">Pacific/Gambier (UTC−9)</option>
                  </Select>
                </Field>
                <Field label={t('settings.currency')} htmlFor="currency">
                  <Select id="currency" value={form.currency} onChange={(event) => set('currency', event.target.value)} disabled={readOnly}>
                    {CURRENCIES.map((currency) => <option key={currency} value={currency}>{currency}</option>)}
                  </Select>
                </Field>
              </FormGrid>
              <Field label={t('settings.uiLanguage')} htmlFor="ui_language" hint={t('settings.uiLanguageHint')}>
                <Select
                  id="ui_language"
                  value={extras.data?.extras.find((item) => item.key === 'ui_language')?.value ?? 'fr'}
                  onChange={(event) => saveLanguage.mutate(event.target.value)}
                  disabled={readOnly || saveLanguage.isPending}
                  className="w-full sm:w-64"
                >
                  {LANGUAGES.map((language) => (
                    <option key={language.value} value={language.value}>{t(language.labelKey)}</option>
                  ))}
                </Select>
              </Field>
            </>
          ) : null}

          {tab === 'invoicing' ? (
            <>
              <FormGrid>
                <Field label={t('settings.vatRegime')} htmlFor="vat_regime">
                  <Select id="vat_regime" value={form.vat_regime} onChange={(event) => set('vat_regime', event.target.value as Company['vat_regime'])} disabled={readOnly}>
                    <option value="standard">{t('setup.vatStandard')}</option>
                    <option value="franchise">{t('setup.vatFranchise')}</option>
                  </Select>
                </Field>
                <Field label={t('settings.defaultTaxRate')} htmlFor="default_tax_rate">
                  <Input id="default_tax_rate" type="number" min="0" max="100" value={form.default_tax_rate} onChange={(event) => set('default_tax_rate', Number(event.target.value))} disabled={readOnly} />
                </Field>
                <Field label={t('settings.paymentTerms')} htmlFor="payment_terms">
                  <Input id="payment_terms" type="number" min="0" max="365" value={form.payment_terms} onChange={(event) => set('payment_terms', Number(event.target.value))} disabled={readOnly} />
                </Field>
                <Field label={t('settings.numberPattern')} htmlFor="number_pattern" hint={t('settings.numberPatternHint')}>
                  <Input id="number_pattern" value={form.number_pattern} onChange={(event) => set('number_pattern', event.target.value)} disabled={readOnly} />
                </Field>
                <Field label={t('settings.pdfLayout')} htmlFor="pdf_layout" hint={t('settings.pdfLayoutHint')}>
                  <Select
                    id="pdf_layout"
                    value={extras.data?.extras.find((item) => item.key === 'pdf_layout')?.value ?? 'classic'}
                    onChange={(event) => savePdfLayout.mutate(event.target.value)}
                    disabled={readOnly || savePdfLayout.isPending}
                  >
                    <option value="classic">{t('settings.pdfLayoutClassic')}</option>
                    <option value="compact">{t('settings.pdfLayoutCompact')}</option>
                  </Select>
                </Field>
              </FormGrid>
              <Field label={t('settings.invoiceTerms')} htmlFor="invoice_terms">
                <Textarea id="invoice_terms" rows={3} value={form.invoice_terms ?? ''} onChange={(event) => set('invoice_terms', event.target.value)} disabled={readOnly} />
              </Field>
              <Field label={t('settings.invoiceFooter')} htmlFor="invoice_footer">
                <Input id="invoice_footer" value={form.invoice_footer ?? ''} onChange={(event) => set('invoice_footer', event.target.value)} disabled={readOnly} />
              </Field>
            </>
          ) : null}

          {tab === 'taxes' ? (
            <>
              <SectionCard title={t('settings.taxRates')} bodyClassName="table-wrap">
                <table className="data-table">
                  <thead><tr><th scope="col">{t('settings.taxName')}</th><th scope="col" className="text-right">{t('settings.taxValue')}</th><th scope="col"><span className="sr-only">{t('common.actions')}</span></th></tr></thead>
                  <tbody>
                    {settings.data!.tax_rates.map((rate) => (
                      <tr key={rate.id}>
                        <td className="font-medium">{rate.name}</td>
                        <td className="text-right tabular-nums">{rate.rate} %</td>
                        <td className="text-right">
                          {can('settings.write') ? (
                            <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600" aria-label={t('common.delete')} onClick={() => removeTax.mutate(rate.id)}>
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </SectionCard>
              {can('settings.write') ? (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t('settings.taxName')} htmlFor="new_tax_name"><Input id="new_tax_name" value={newTax.name} onChange={(event) => setNewTax({ ...newTax, name: event.target.value })} /></Field>
                  <Field label={t('settings.taxValue')} htmlFor="new_tax_rate"><Input id="new_tax_rate" type="number" min="0" max="100" value={newTax.rate} onChange={(event) => setNewTax({ ...newTax, rate: Number(event.target.value) })} /></Field>
                  <Button variant="secondary" onClick={() => addTax.mutate()} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('settings.addTaxRate')}</Button>
                </div>
              ) : null}
              <SectionCard title={t('settings.sequences')} bodyClassName="table-wrap">
                <table className="data-table">
                  <thead><tr><th scope="col">{t('settings.entity')}</th><th scope="col">{t('settings.period')}</th><th scope="col" className="text-right">{t('settings.lastNumber')}</th></tr></thead>
                  <tbody>
                    {settings.data!.sequences.length ? settings.data!.sequences.map((sequence) => (
                      <tr key={`${sequence.entity}-${sequence.period}`}>
                        <td className="font-medium">{sequence.entity}</td>
                        <td>{sequence.period}</td>
                        <td className="text-right tabular-nums">{sequence.last_number}</td>
                      </tr>
                    )) : <tr><td colSpan={3} className="text-center text-muted">{t('common.none')}</td></tr>}
                  </tbody>
                </table>
              </SectionCard>
              <SectionCard title={t('settings.fiscalDefaults')} subtitle={t('settings.fiscalDefaultsHint')} bodyClassName="space-y-4 p-5">
                {fiscal ? (
                  <>
                    <FormGrid>
                      <Field label={t('settings.retentionYears')} htmlFor="retention_years" hint={t('settings.retentionHint')}>
                        <Input
                          id="retention_years"
                          type="number"
                          min="1"
                          max="999"
                          value={fiscal.retention_years}
                          onChange={(event) => setFiscal({ ...fiscal, retention_years: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                      <Field label={t('settings.franchiseThreshold')} htmlFor="franchise_threshold" hint={t('settings.franchiseHint')}>
                        <Input
                          id="franchise_threshold"
                          type="number"
                          min="0"
                          step="1000"
                          value={fiscal.franchise_threshold}
                          onChange={(event) => setFiscal({ ...fiscal, franchise_threshold: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                    </FormGrid>
                    <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('settings.defaultsNote')}</p>
                    {can('settings.write') ? (
                      <Button variant="secondary" loading={saveFiscal.isPending} onClick={() => saveFiscal.mutate(fiscal)} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
                        {t('common.save')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Skeleton className="h-24" />
                )}
              </SectionCard>
            </>
          ) : null}

          {tab === 'expenses' ? (
            <SectionCard title={t('settings.expenseCategories')} subtitle={t('settings.expenseCategoriesHint')} bodyClassName="space-y-4 p-5">
              <ul className="divide-y divide-line">
                {(categories.data?.categories ?? []).map((item) => (
                  <li key={item.key} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div>
                      <p className={`text-sm font-medium ${item.archived ? 'text-muted line-through' : ''}`}>{item.label}</p>
                      {item.archived ? <p className="text-xs text-muted">{t('settings.categoryArchived')}</p> : null}
                    </div>
                    {can('settings.write') ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => toggleCategory.mutate({ key: item.key, archived: !item.archived })}
                      >
                        {item.archived ? t('settings.restoreCategory') : t('settings.archiveCategory')}
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
              {can('settings.write') ? (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t('settings.categoryName')} htmlFor="new_category">
                    <Input id="new_category" value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
                  </Field>
                  <Button
                    variant="secondary"
                    loading={addCategory.isPending}
                    disabled={newCategory.trim().length < 2}
                    onClick={() => addCategory.mutate()}
                    icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('settings.addCategory')}
                  </Button>
                </div>
              ) : null}
            </SectionCard>
          ) : null}

          {tab === 'periods' ? (
            <>
              <div className="rounded-xl border border-line bg-surface px-4 py-3 text-sm text-muted">
                {t('periods.subtitle')}
              </div>
              {can('periods.write') ? (
                <div className="flex flex-wrap items-end gap-3">
                  <Field label={t('periods.label')} htmlFor="period" required>
                    <Input id="period" type="month" value={period} onChange={(event) => setPeriod(event.target.value)} className="w-48" />
                  </Field>
                  <Field label={t('periods.note')} htmlFor="period_note">
                    <Input id="period_note" value={periodNote} onChange={(event) => setPeriodNote(event.target.value)} className="w-64" />
                  </Field>
                  <Button
                    variant="secondary"
                    loading={closePeriod.isPending}
                    disabled={!period}
                    onClick={async () => {
                      if (await confirm({
                        title: t('periods.confirmClose', { period }),
                        description: t('periods.confirmCloseHint'),
                        danger: true,
                        confirmLabel: t('periods.close'),
                      })) closePeriod.mutate();
                    }}
                    icon={<Lock className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('periods.close')}
                  </Button>
                </div>
              ) : (
                <p className="text-sm text-muted">{t('periods.permissionDenied')}</p>
              )}
              <SectionCard title={t('periods.title')} bodyClassName="table-wrap">
                {periods.isLoading ? (
                  <Skeleton className="m-4 h-16" />
                ) : (periods.data?.data ?? []).length ? (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('periods.label')}</th>
                        <th scope="col">{t('activity.date')}</th>
                        <th scope="col">{t('activity.user')}</th>
                        <th scope="col">{t('common.notes')}</th>
                        <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(periods.data?.data ?? []).map((entry) => (
                        <tr key={entry.period}>
                          <td className="font-medium tabular-nums">{entry.period}</td>
                          <td className="text-muted">{formatDate(entry.closed_at)}</td>
                          <td className="text-muted">{[entry.first_name, entry.last_name].filter(Boolean).join(' ') || '—'}</td>
                          <td className="text-muted">{entry.note ?? '—'}</td>
                          <td className="text-right">
                            {can('periods.write') ? (
                              <Button
                                variant="ghost"
                                size="sm"
                                loading={reopenPeriod.isPending && reopenPeriod.variables?.period === entry.period}
                                onClick={async () => {
                                  const reason = window.prompt(t('periods.reasonLabel'), reopenReason);
                                  if (reason === null) return;
                                  setReopenReason(reason);
                                  if (await confirm({
                                    title: t('periods.confirmReopen', { period: entry.period }),
                                    description: t('periods.subtitle'),
                                    danger: true,
                                    confirmLabel: t('periods.reopen'),
                                  })) reopenPeriod.mutate({ period: entry.period, reason });
                                }}
                                icon={<LockOpen className="h-4 w-4" aria-hidden="true" />}
                              >
                                {t('periods.reopen')}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="px-5 py-6 text-sm text-muted">{t('periods.empty')}</p>
                )}
              </SectionCard>
            </>
          ) : null}

          {tab === 'roles' ? <RolesPanel /> : null}

          {tab === 'security' ? (
            <>
              <FormGrid>
                <Field label={t('settings.sessionIdle')} htmlFor="session_idle">
                  <Input id="session_idle" type="number" min="5" max="240" value={form.session_idle_minutes} onChange={(event) => set('session_idle_minutes', Number(event.target.value))} disabled={readOnly} />
                </Field>
                <Field label={t('settings.sessionAbsolute')} htmlFor="session_absolute">
                  <Input id="session_absolute" type="number" min="1" max="72" value={form.session_absolute_hours} onChange={(event) => set('session_absolute_hours', Number(event.target.value))} disabled={readOnly} />
                </Field>
              </FormGrid>
              <p className="rounded-xl bg-surface px-4 py-3 text-xs text-muted">{t('auth.secured')} · PBKDF2-SHA256 · CSRF · {t('settings.sessionIdle').toLowerCase()}</p>
            </>
          ) : null}

          {tab === 'email' ? (can('settings.write') ? <EmailSettingsPanel /> : <p className="text-sm text-muted">{t('settings.permissionDenied')}</p>) : null}

          {tab === 'legal' ? (
            <>
              <Field label={t('settings.legalNotes')} htmlFor="legal_notes" hint={t('settings.legalNotesHint')}>
                <Textarea id="legal_notes" rows={3} value={form.legal_notes ?? ''} onChange={(event) => set('legal_notes', event.target.value)} disabled={readOnly} />
              </Field>
              <FormGrid>
                <Field label={t('settings.bankName')} htmlFor="bank_name"><Input id="bank_name" value={form.bank_name ?? ''} onChange={(event) => set('bank_name', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.bankHolder')} htmlFor="bank_holder"><Input id="bank_holder" value={form.bank_holder ?? ''} onChange={(event) => set('bank_holder', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.bankIban')} htmlFor="bank_iban"><Input id="bank_iban" value={form.bank_iban ?? ''} onChange={(event) => set('bank_iban', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('settings.bankBic')} htmlFor="bank_bic"><Input id="bank_bic" value={form.bank_bic ?? ''} onChange={(event) => set('bank_bic', event.target.value)} disabled={readOnly} /></Field>
              </FormGrid>
            </>
          ) : null}

          {!readOnly ? (
            <div className="flex justify-end border-t border-line pt-4">
              <Button onClick={() => save.mutate()} loading={save.isPending} icon={<Save className="h-4 w-4" aria-hidden="true" />}>{t('common.save')}</Button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('settings.permissionDenied')}</p>
          )}
        </div>
      </div>
    </>
  );
}
