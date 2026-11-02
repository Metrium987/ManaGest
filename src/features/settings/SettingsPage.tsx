import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Lock, LockOpen, Plus, Save, Trash2, Users } from 'lucide-react';
import { COUNTRIES, CURRENCIES, DEFAULT_TAX_RATE, DISPLAY_LOCALES } from '@shared/domain';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_METHOD_LABELS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_PAYMENT_TERM_LABELS,
  CLIENT_VAT_REGIMES,
  CLIENT_VAT_REGIME_LABELS,
  ENTITY_CATEGORIES,
  ENTITY_CATEGORY_LABELS,
  LEGAL_FORMS,
  LEGAL_FORM_LABELS,
} from '@shared/client-profile';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { LANGUAGES, setLanguage, t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate } from '@/lib/format';
import type { Company, PeriodLock, SettingsPayload } from '@/lib/types';
import { PageHeader, SectionCard, Skeleton, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Modal';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { RolesPanel } from './RolesPanel';

interface ImportRuleRow {
  code: string;
  label: string;
  base: string;
  rate_bp: number;
  amount: number;
  transport: string;
  sort_order: number;
  is_active: number | boolean;
  valid_from: string | null;
  valid_to: string | null;
  source: string | null;
}

interface TariffRow {
  code: string;
  label: string;
  duty_rate_bp: number;
  duty_rate_eu_bp: number | null;
  vat_rate_bp: number;
  is_active: number;
}

interface RuleDraft {
  label: string;
  base: string;
  rate: string;
  amount: string;
  transport: string;
  sort_order: number;
  active: boolean;
  source: string;
  valid_from: string;
  valid_to: string;
}

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

/** The chart codes are settings: the screen and the posting rules read the same
 * list, so adding one never means editing a route. */
const ACCOUNT_FIELDS = [
  ['account_sales', 'settings.accountSales'],
  ['account_deferred', 'settings.accountDeferred'],
  ['account_client', 'settings.accountClient'],
  ['account_supplier', 'settings.accountSupplier'],
  ['account_bank', 'settings.accountBank'],
  ['account_expense', 'settings.accountExpense'],
  ['account_vat_due', 'settings.accountVatDue'],
  ['account_vat_deductible', 'settings.accountVatDeductible'],
  ['account_retained_earnings', 'settings.accountRetainedEarnings'],
] as const;

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
  const [tokenLimits, setTokenLimits] = useState<{ lifetime: string; max: string } | null>(null);

  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api.get<SettingsPayload>('/settings') });
  const extras = useQuery({
    queryKey: ['settings-extras'],
    queryFn: () => api.get<{ extras: { key: string; value: string; is_default: boolean }[] }>('/settings/extras'),
    enabled: can('settings.read'),
  });
  const [fiscal, setFiscal] = useState<{ retention_years: string; franchise_threshold: string; item_accounts: string } | null>(null);
  // Owner decision 2026-11-02: purchase price history thresholds are data, not
  // constants — standard values ship, the workspace can change them.
  const [purchasing, setPurchasing] = useState<{ price_history_months: string; price_alert_percent: string; price_alert_days: string } | null>(null);
  const [accounts, setAccounts] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    if (extras.data && !fiscal) {
      const read = (key: string) => extras.data!.extras.find((item) => item.key === key)?.value ?? '';
      setFiscal({
        retention_years: read('retention_years'),
        franchise_threshold: read('franchise_threshold'),
        item_accounts: read('item_accounts') || '0',
      });
      setAccounts(Object.fromEntries(ACCOUNT_FIELDS.map(([key]) => [key, read(key)])));
      setTokenLimits({
        lifetime: read('api_token_lifetime_days'),
        max: read('api_token_max_per_user'),
      });
      setPurchasing({
        price_history_months: read('price_history_months'),
        price_alert_percent: read('price_alert_percent'),
        price_alert_days: read('price_alert_days'),
      });
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

  const saveTokenLimits = useMutation({
    mutationFn: (input: { lifetime: string; max: string }) => api.patch('/settings/extras', {
      api_token_lifetime_days: input.lifetime,
      api_token_max_per_user: input.max,
    }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings-extras'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveFiscal = useMutation({
    mutationFn: (input: { retention_years: string; franchise_threshold: string; item_accounts: string }) => api.patch('/settings/extras', input),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings-extras'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const savePurchasing = useMutation({
    mutationFn: (input: { price_history_months: string; price_alert_percent: string; price_alert_days: string }) =>
      api.patch('/settings/extras', input),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings-extras'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const saveAccounts = useMutation({
    mutationFn: (input: Record<string, string>) => api.patch('/settings/extras', input),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['settings-extras'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  // Q11: the centres are a reference list. The invoice line keeps the code it was
  // issued with, so archiving one here never rewrites a document.
  const centres = useQuery({
    queryKey: ['profit-centers'],
    queryFn: () => api.get<{ data: { code: string; name: string; archived: boolean }[] }>('/profit-centers'),
    enabled: can('invoices.read'),
  });
  const [newCentre, setNewCentre] = useState({ code: '', name: '' });
  const saveCentre = useMutation({
    mutationFn: () => api.put(`/profit-centers/${newCentre.code.trim().toUpperCase()}`, { name: newCentre.name.trim() }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      setNewCentre({ code: '', name: '' });
      queryClient.invalidateQueries({ queryKey: ['profit-centers'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const archiveCentre = useMutation({
    mutationFn: (code: string) => api.delete(`/profit-centers/${code}`),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['profit-centers'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Q13: the demonstration can be emptied and reseeded, but only while its flag is
  // on — and only after an explicit confirmation.
  const demo = useQuery({
    queryKey: ['demo'],
    queryFn: () => api.get<{ demo_mode: boolean }>('/demo'),
    enabled: can('settings.read'),
  });
  const setDemoMode = useMutation({
    mutationFn: (enabled: boolean) => api.put('/demo/mode', { enabled }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['demo'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const resetDemo = useMutation({
    mutationFn: () => api.post('/demo/reset', { reseed: true }),
    onSuccess: () => {
      toast.success(t('settings.demoResetDone'));
      queryClient.invalidateQueries();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Q6/Q7: the tariff and the import taxes are data. Editing them here is a settings
  // change, and an old landed cost keeps the figure it was computed with.
  const taxes = useQuery({
    queryKey: ['import-taxes'],
    queryFn: () => api.get<{ rules: ImportRuleRow[]; tariffs: TariffRow[] }>('/import-taxes'),
    enabled: can('products.read'),
  });
  const [ruleDrafts, setRuleDrafts] = useState<Record<string, RuleDraft>>({});
  const [tariff, setTariff] = useState({ code: '', label: '', normal: '0', eu: '', vat: '16' });
  useEffect(() => {
    if (!taxes.data) return;
    const next: Record<string, RuleDraft> = {};
    for (const rule of taxes.data.rules) {
      next[rule.code] = {
        label: rule.label,
        base: rule.base,
        rate: String(Number(rule.rate_bp) / 100),
        amount: String(rule.amount),
        transport: rule.transport,
        sort_order: rule.sort_order,
        active: Boolean(rule.is_active),
        source: rule.source ?? '',
        valid_from: rule.valid_from ?? '',
        valid_to: rule.valid_to ?? '',
      };
    }
    setRuleDrafts(next);
  }, [taxes.data]);
  const saveRule = useMutation({
    mutationFn: (input: { code: string; draft: RuleDraft }) => api.put(`/import-taxes/rules/${input.code}`, {
      label: input.draft.label,
      base: input.draft.base,
      rate_bp: Math.round(Number(input.draft.rate || 0) * 100),
      amount: Math.round(Number(input.draft.amount || 0)),
      transport: input.draft.transport,
      sort_order: input.draft.sort_order,
      is_active: input.draft.active,
      valid_from: input.draft.valid_from || null,
      valid_to: input.draft.valid_to || null,
      source: input.draft.source || null,
    }),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      queryClient.invalidateQueries({ queryKey: ['import-taxes'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const saveTariff = useMutation({
    mutationFn: () => api.put(`/import-taxes/tariffs/${tariff.code.trim()}`, {
      label: tariff.label,
      duty_rate_bp: Math.round(Number(tariff.normal || 0) * 100),
      duty_rate_eu_bp: tariff.eu === '' ? null : Math.round(Number(tariff.eu) * 100),
      duty_rate_oceania_bp: null,
      vat_rate_bp: Math.round(Number(tariff.vat || DEFAULT_TAX_RATE) * 100),
      is_active: true,
    }),
    onSuccess: () => {
      toast.success(t('settings.tariffSaved'));
      setTariff({ code: '', label: '', normal: '0', eu: '', vat: '16' });
      queryClient.invalidateQueries({ queryKey: ['import-taxes'] });
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
        vat_regime_detail: form.vat_regime_detail, entity_category: form.entity_category,
        legal_form: form.legal_form, numero_tps: form.numero_tps, contact_role: form.contact_role,
        po_box_number: form.po_box_number, po_box_municipality: form.po_box_municipality,
        island: form.island, physical_municipality: form.physical_municipality, district: form.district,
        pk_landmark: form.pk_landmark, street_building_zone: form.street_building_zone,
        delivery_instructions: form.delivery_instructions, payment_method: form.payment_method,
        payment_terms_code: form.payment_terms_code, tax_exemption_decree_num: form.tax_exemption_decree_num,
        tax_exemption_expiry: form.tax_exemption_expiry,
        data_consent_accepted: Boolean(form.data_consent_accepted),
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
      setNewTax({ name: '', rate: DEFAULT_TAX_RATE });
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
                <Field label={t('settings.locale')} htmlFor="locale" hint={t('settings.localeHint')}>
                  <Select id="locale" value={form.locale} onChange={(event) => set('locale', event.target.value)} disabled={readOnly}>
                    {DISPLAY_LOCALES.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                    {DISPLAY_LOCALES.some((option) => option.value === form.locale) ? null : (
                      <option value={form.locale}>{form.locale}</option>
                    )}
                  </Select>
                </Field>
              </FormGrid>
              <FormGrid>
                <Field label={t('clientProfile.entityCategory')} htmlFor="entity_category">
                  <Select id="entity_category" value={form.entity_category ?? 'PRIVATE_COMPANY'} onChange={(event) => set('entity_category', event.target.value as Company['entity_category'])} disabled={readOnly}>
                    {ENTITY_CATEGORIES.map((category) => (<option key={category} value={category}>{ENTITY_CATEGORY_LABELS[category]}</option>))}
                  </Select>
                </Field>
                <Field label={t('clientProfile.legalForm')} htmlFor="legal_form">
                  <Select id="legal_form" value={form.legal_form ?? ''} onChange={(event) => set('legal_form', (event.target.value || null) as Company['legal_form'])} disabled={readOnly}>
                    <option value="">—</option>
                    {LEGAL_FORMS.map((value) => (<option key={value} value={value}>{LEGAL_FORM_LABELS[value]}</option>))}
                  </Select>
                </Field>
                <Field label={t('clientProfile.tps')} htmlFor="numero_tps"><Input id="numero_tps" value={form.numero_tps ?? ''} onChange={(event) => set('numero_tps', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.contactRole')} htmlFor="contact_role"><Input id="contact_role" value={form.contact_role ?? ''} onChange={(event) => set('contact_role', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.poBox')} htmlFor="po_box_number"><Input id="po_box_number" value={form.po_box_number ?? ''} onChange={(event) => set('po_box_number', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.poBoxMunicipality')} htmlFor="po_box_municipality"><Input id="po_box_municipality" value={form.po_box_municipality ?? ''} onChange={(event) => set('po_box_municipality', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.island')} htmlFor="island"><Input id="island" value={form.island ?? ''} onChange={(event) => set('island', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.physicalMunicipality')} htmlFor="physical_municipality"><Input id="physical_municipality" value={form.physical_municipality ?? ''} onChange={(event) => set('physical_municipality', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.district')} htmlFor="district"><Input id="district" value={form.district ?? ''} onChange={(event) => set('district', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.pk')} htmlFor="pk_landmark"><Input id="pk_landmark" value={form.pk_landmark ?? ''} onChange={(event) => set('pk_landmark', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.street')} htmlFor="street_building_zone" className="sm:col-span-2"><Input id="street_building_zone" value={form.street_building_zone ?? ''} onChange={(event) => set('street_building_zone', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.delivery')} htmlFor="delivery_instructions" className="sm:col-span-2"><Input id="delivery_instructions" value={form.delivery_instructions ?? ''} onChange={(event) => set('delivery_instructions', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.paymentMethod')} htmlFor="payment_method">
                  <Select id="payment_method" value={form.payment_method ?? ''} onChange={(event) => set('payment_method', (event.target.value || null) as Company['payment_method'])} disabled={readOnly}>
                    <option value="">—</option>
                    {CLIENT_PAYMENT_METHODS.map((value) => (<option key={value} value={value}>{CLIENT_PAYMENT_METHOD_LABELS[value]}</option>))}
                  </Select>
                </Field>
                <Field label={t('clientProfile.taxExemptionDecree')} htmlFor="tax_exemption_decree_num"><Input id="tax_exemption_decree_num" value={form.tax_exemption_decree_num ?? ''} onChange={(event) => set('tax_exemption_decree_num', event.target.value)} disabled={readOnly} /></Field>
                <Field label={t('clientProfile.taxExemptionExpiry')} htmlFor="tax_exemption_expiry"><Input id="tax_exemption_expiry" type="date" value={form.tax_exemption_expiry ?? ''} onChange={(event) => set('tax_exemption_expiry', event.target.value)} disabled={readOnly} /></Field>
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
                <Field label={t('settings.vatRegime')} htmlFor="vat_regime_detail">
                  <Select id="vat_regime_detail" value={form.vat_regime_detail ?? ''} onChange={(event) => set('vat_regime_detail', (event.target.value || null) as Company['vat_regime_detail'])} disabled={readOnly}>
                    <option value="">—</option>
                    {CLIENT_VAT_REGIMES.map((value) => (<option key={value} value={value}>{CLIENT_VAT_REGIME_LABELS[value]}</option>))}
                  </Select>
                </Field>
                <Field label={t('settings.defaultTaxRate')} htmlFor="default_tax_rate">
                  <Input id="default_tax_rate" type="number" min="0" max="100" value={form.default_tax_rate} onChange={(event) => set('default_tax_rate', Number(event.target.value))} disabled={readOnly} />
                </Field>
                <Field label={t('clientProfile.paymentTermsLabel')} htmlFor="payment_terms_code">
                  <Select id="payment_terms_code" value={form.payment_terms_code ?? ''} onChange={(event) => set('payment_terms_code', (event.target.value || null) as Company['payment_terms_code'])} disabled={readOnly}>
                    <option value="">—</option>
                    {CLIENT_PAYMENT_TERMS.map((value) => (<option key={value} value={value}>{CLIENT_PAYMENT_TERM_LABELS[value]}</option>))}
                  </Select>
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
                    <Checkbox
                      checked={fiscal.item_accounts === '1'}
                      onChange={(event) => setFiscal({ ...fiscal, item_accounts: event.target.checked ? '1' : '0' })}
                      label={t('settings.itemAccounts')}
                      description={t('settings.itemAccountsHint')}
                      disabled={readOnly}
                    />
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
              <SectionCard title={t('settings.purchasing')} subtitle={t('settings.purchasingHint')} bodyClassName="space-y-4 p-5">
                {purchasing ? (
                  <>
                    <FormGrid>
                      <Field label={t('settings.priceHistoryMonths')} htmlFor="price_history_months" hint={t('settings.priceHistoryMonthsHint')}>
                        <Input
                          id="price_history_months"
                          type="number"
                          min="1"
                          max="120"
                          value={purchasing.price_history_months}
                          onChange={(event) => setPurchasing({ ...purchasing, price_history_months: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                      <Field label={t('settings.priceAlertPercent')} htmlFor="price_alert_percent" hint={t('settings.priceAlertPercentHint')}>
                        <Input
                          id="price_alert_percent"
                          type="number"
                          min="0"
                          max="1000"
                          value={purchasing.price_alert_percent}
                          onChange={(event) => setPurchasing({ ...purchasing, price_alert_percent: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                      <Field label={t('settings.priceAlertDays')} htmlFor="price_alert_days" hint={t('settings.priceAlertDaysHint')}>
                        <Input
                          id="price_alert_days"
                          type="number"
                          min="1"
                          max="3650"
                          value={purchasing.price_alert_days}
                          onChange={(event) => setPurchasing({ ...purchasing, price_alert_days: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                    </FormGrid>
                    <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('settings.defaultsNote')}</p>
                    {can('settings.write') ? (
                      <Button variant="secondary" loading={savePurchasing.isPending} onClick={() => savePurchasing.mutate(purchasing)} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
                        {t('common.save')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Skeleton className="h-24" />
                )}
              </SectionCard>
              <SectionCard title={t('settings.chartOfAccounts')} subtitle={t('settings.chartOfAccountsHint')} bodyClassName="space-y-4 p-5">
                {accounts ? (
                  <>
                    <FormGrid>
                      {ACCOUNT_FIELDS.map(([key, label]) => (
                        <Field key={key} label={t(label)} htmlFor={key}>
                          <Input
                            id={key}
                            inputMode="numeric"
                            maxLength={10}
                            value={accounts[key] ?? ''}
                            onChange={(event) => setAccounts({ ...accounts, [key]: event.target.value })}
                            disabled={readOnly}
                          />
                        </Field>
                      ))}
                    </FormGrid>
                    <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('settings.chartOfAccountsNote')}</p>
                    {can('settings.write') ? (
                      <Button variant="secondary" loading={saveAccounts.isPending} onClick={() => saveAccounts.mutate(accounts)} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
                        {t('common.save')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Skeleton className="h-24" />
                )}
              </SectionCard>
              <SectionCard title={t('settings.profitCenters')} subtitle={t('settings.profitCentersHint')} bodyClassName="space-y-3 p-5">
                <FormGrid>
                  <Field label={t('settings.profitCenterCode')} htmlFor="centre_code">
                    <Input
                      id="centre_code"
                      maxLength={20}
                      value={newCentre.code}
                      onChange={(event) => setNewCentre({ ...newCentre, code: event.target.value.toUpperCase() })}
                      disabled={readOnly}
                    />
                  </Field>
                  <Field label={t('settings.profitCenterName')} htmlFor="centre_name">
                    <Input
                      id="centre_name"
                      value={newCentre.name}
                      onChange={(event) => setNewCentre({ ...newCentre, name: event.target.value })}
                      disabled={readOnly}
                    />
                  </Field>
                </FormGrid>
                {can('settings.write') ? (
                  <Button
                    variant="secondary"
                    loading={saveCentre.isPending}
                    disabled={!newCentre.code.trim() || !newCentre.name.trim()}
                    onClick={() => saveCentre.mutate()}
                    icon={<Plus className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('settings.addProfitCenter')}
                  </Button>
                ) : null}
                <ul className="space-y-1 text-sm">
                  {(centres.data?.data ?? []).map((centre) => (
                    <li key={centre.code} className="flex items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                      <span><span className="font-medium text-ink-950">{centre.code}</span> · {centre.name}</span>
                      {centre.archived ? (
                        <span className="text-xs text-muted">{t('settings.archived')}</span>
                      ) : can('settings.write') ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          loading={archiveCentre.isPending}
                          onClick={() => archiveCentre.mutate(centre.code)}
                          icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                        >
                          {t('settings.archive')}
                        </Button>
                      ) : null}
                    </li>
                  ))}
                  {centres.data?.data.length ? null : <li className="text-xs text-muted">{t('settings.noProfitCenter')}</li>}
                </ul>
              </SectionCard>
              <SectionCard title={t('settings.customsTariff')} subtitle={t('settings.customsTariffHint')} bodyClassName="space-y-4 p-5">
                {taxes.isLoading ? <Skeleton className="h-20" /> : (
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('settings.ruleCode')}</th>
                          <th scope="col">{t('settings.ruleBase')}</th>
                          <th scope="col" className="text-right">{t('settings.ruleRate')}</th>
                          <th scope="col" className="text-right">{t('settings.ruleAmount')}</th>
                          <th scope="col">{t('settings.ruleTransport')}</th>
                          <th scope="col">{t('settings.ruleActive')}</th>
                          <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {(taxes.data?.rules ?? []).map((rule) => {
                          const draft = ruleDrafts[rule.code];
                          if (!draft) return null;
                          const patch = (change: Partial<RuleDraft>) =>
                            setRuleDrafts({ ...ruleDrafts, [rule.code]: { ...draft, ...change } });
                          return (
                            <tr key={rule.code}>
                              <td>
                                <p className="font-medium text-ink-950">{rule.code}</p>
                                <p className="text-xs text-muted">{rule.label}</p>
                              </td>
                              <td className="text-xs">{rule.base}</td>
                              <td className="text-right">
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.01"
                                  aria-label={`${rule.code} ${t('settings.ruleRate')}`}
                                  value={draft.rate}
                                  onChange={(event) => patch({ rate: event.target.value })}
                                  disabled={readOnly}
                                />
                              </td>
                              <td className="text-right">
                                <Input
                                  type="number"
                                  min="0"
                                  aria-label={`${rule.code} ${t('settings.ruleAmount')}`}
                                  value={draft.amount}
                                  onChange={(event) => patch({ amount: event.target.value })}
                                  disabled={readOnly}
                                />
                              </td>
                              <td>
                                <Select
                                  aria-label={`${rule.code} ${t('settings.ruleTransport')}`}
                                  value={draft.transport}
                                  onChange={(event) => patch({ transport: event.target.value })}
                                  disabled={readOnly}
                                >
                                  <option value="any">{t('settings.transportAny')}</option>
                                  <option value="sea">{t('settings.transportSea')}</option>
                                  <option value="air">{t('settings.transportAir')}</option>
                                </Select>
                              </td>
                              <td>
                                <Checkbox
                                  checked={draft.active}
                                  onChange={(event) => patch({ active: event.target.checked })}
                                  label={t('settings.ruleActive')}
                                  disabled={readOnly}
                                />
                              </td>
                              <td className="text-right">
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  loading={saveRule.isPending}
                                  onClick={() => saveRule.mutate({ code: rule.code, draft })}
                                >
                                  {t('common.save')}
                                </Button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="space-y-3 border-t border-line pt-4">
                  <p className="text-sm font-semibold text-ink-950">{t('settings.tariffAdd')}</p>
                  <FormGrid>
                    <Field label={t('settings.tariffCode')} htmlFor="tariff_code">
                      <Input
                        id="tariff_code"
                        maxLength={10}
                        value={tariff.code}
                        onChange={(event) => setTariff({ ...tariff, code: event.target.value.replace(/\D/g, '') })}
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label={t('settings.tariffLabel')} htmlFor="tariff_label">
                      <Input
                        id="tariff_label"
                        value={tariff.label}
                        onChange={(event) => setTariff({ ...tariff, label: event.target.value })}
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label={t('settings.tariffNormal')} htmlFor="tariff_normal">
                      <Input
                        id="tariff_normal"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={tariff.normal}
                        onChange={(event) => setTariff({ ...tariff, normal: event.target.value })}
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label={t('settings.tariffEu')} htmlFor="tariff_eu">
                      <Input
                        id="tariff_eu"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={tariff.eu}
                        onChange={(event) => setTariff({ ...tariff, eu: event.target.value })}
                        disabled={readOnly}
                      />
                    </Field>
                    <Field label={t('settings.tariffVat')} htmlFor="tariff_vat">
                      <Input
                        id="tariff_vat"
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={tariff.vat}
                        onChange={(event) => setTariff({ ...tariff, vat: event.target.value })}
                        disabled={readOnly}
                      />
                    </Field>
                  </FormGrid>
                  <Button
                    variant="secondary"
                    loading={saveTariff.isPending}
                    disabled={!/^\d{6,10}$/.test(tariff.code) || !tariff.label.trim()}
                    onClick={() => saveTariff.mutate()}
                    icon={<Save className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('settings.tariffSave')}
                  </Button>
                  <ul className="space-y-1 text-xs text-muted">
                    {(taxes.data?.tariffs ?? []).slice(0, 8).map((row) => (
                      <li key={row.code}>
                        <span className="font-medium text-ink-950">{row.code}</span> · {row.label} · {row.duty_rate_bp / 100} %
                        {' · '}UE {row.duty_rate_eu_bp == null ? '—' : `${row.duty_rate_eu_bp / 100} %`}
                      </li>
                    ))}
                    {taxes.data?.tariffs.length ? null : <li>{t('settings.tariffNone')}</li>}
                  </ul>
                </div>
              </SectionCard>
              <SectionCard title={t('settings.demoModeTitle')} subtitle={t('settings.demoModeHint')} bodyClassName="space-y-3 p-5">
                <Checkbox
                  checked={Boolean(demo.data?.demo_mode)}
                  onChange={(event) => setDemoMode.mutate(event.target.checked)}
                  label={t('settings.demoModeEnable')}
                  description={t('settings.demoModeEnableHint')}
                  disabled={readOnly}
                />
                {demo.data?.demo_mode ? (
                  <>
                    <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">{t('settings.demoResetHint')}</p>
                    <Button
                      variant="secondary"
                      loading={resetDemo.isPending}
                      onClick={async () => {
                        const accepted = await confirm({
                          title: t('settings.demoReset'),
                          description: t('settings.demoResetConfirm'),
                          confirmLabel: t('settings.demoReset'),
                          danger: true,
                        });
                        if (accepted) resetDemo.mutate();
                      }}
                      icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                    >
                      {t('settings.demoReset')}
                    </Button>
                  </>
                ) : null}
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
              <SectionCard title={t('tokens.title')} subtitle={t('tokens.lifetimeHint')} bodyClassName="space-y-4 p-5">
                {tokenLimits ? (
                  <>
                    <FormGrid>
                      <Field label={t('tokens.lifetime')} htmlFor="api_token_lifetime">
                        <Input
                          id="api_token_lifetime"
                          type="number"
                          min="1"
                          max="3650"
                          value={tokenLimits.lifetime}
                          onChange={(event) => setTokenLimits({ ...tokenLimits, lifetime: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                      <Field label={t('tokens.maxPerUser')} htmlFor="api_token_max">
                        <Input
                          id="api_token_max"
                          type="number"
                          min="1"
                          max="100"
                          value={tokenLimits.max}
                          onChange={(event) => setTokenLimits({ ...tokenLimits, max: event.target.value })}
                          disabled={readOnly}
                        />
                      </Field>
                    </FormGrid>
                    {can('settings.write') ? (
                      <Button variant="secondary" loading={saveTokenLimits.isPending} onClick={() => saveTokenLimits.mutate(tokenLimits)} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
                        {t('common.save')}
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Skeleton className="h-20" />
                )}
              </SectionCard>
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
