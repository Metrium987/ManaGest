import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, MapPin, ShieldCheck, Sparkles } from 'lucide-react';
import { DEFAULT_TAX_RATE, TVA_RATES } from '@shared/domain';
import { DEFAULT_INVOICE_TERMS } from '@shared/company-defaults';
import {
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_METHOD_LABELS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_PAYMENT_TERM_LABELS,
  CLIENT_VAT_REGIMES,
  CLIENT_VAT_REGIME_LABELS,
  ENTITY_CATEGORIES,
  ENTITY_CATEGORY_HINTS,
  ENTITY_CATEGORY_LABELS,
  LEGAL_FORMS,
  LEGAL_FORM_LABELS,
  type ClientPaymentMethod,
  type ClientPaymentTerms,
  type ClientVatRegime,
  type EntityCategory,
  type LegalForm,
} from '@shared/client-profile';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';

interface SetupForm {
  company_name: string;
  entity_category: EntityCategory;
  legal_form: LegalForm | '';
  legal_name: string;
  tax_id: string;
  rcs: string;
  numero_tps: string;
  share_capital: string;
  vat_regime_detail: ClientVatRegime | '';
  default_tax_rate: number;
  email: string;
  phone: string;
  contact_role: string;
  po_box_number: string;
  po_box_municipality: string;
  postal_code: string;
  island: string;
  physical_municipality: string;
  district: string;
  pk_landmark: string;
  street_building_zone: string;
  delivery_instructions: string;
  payment_method: ClientPaymentMethod | '';
  payment_terms_code: ClientPaymentTerms | '';
  bank_name: string;
  bank_holder: string;
  bank_iban: string;
  bank_bic: string;
  tax_exemption_decree_num: string;
  tax_exemption_expiry: string;
  data_consent_accepted: boolean;
  invoice_terms: string;
  invoice_footer: string;
  admin_first: string;
  admin_last: string;
  admin_email: string;
  password: string;
  confirm: string;
  demo_data: boolean;
}

const INITIAL: SetupForm = {
  company_name: '',
  entity_category: 'PRIVATE_COMPANY',
  legal_form: '',
  legal_name: '',
  tax_id: '',
  rcs: '',
  numero_tps: '',
  share_capital: '',
  vat_regime_detail: '',
  default_tax_rate: DEFAULT_TAX_RATE,
  email: '',
  phone: '',
  contact_role: '',
  po_box_number: '',
  po_box_municipality: '',
  postal_code: '',
  island: '',
  physical_municipality: '',
  district: '',
  pk_landmark: '',
  street_building_zone: '',
  delivery_instructions: '',
  payment_method: '',
  payment_terms_code: '',
  bank_name: '',
  bank_holder: '',
  bank_iban: '',
  bank_bic: '',
  tax_exemption_decree_num: '',
  tax_exemption_expiry: '',
  data_consent_accepted: false,
  invoice_terms: '',
  invoice_footer: '',
  admin_first: '',
  admin_last: '',
  admin_email: '',
  password: '',
  confirm: '',
  demo_data: true,
};

const DEFAULT_TERMS = DEFAULT_INVOICE_TERMS;

const TOTAL_STEPS = 4;

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-b border-line pb-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-950">{title}</h2>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function SetupPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<SetupForm>(INITIAL);
  const [step, setStep] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const status = useQuery({
    queryKey: ['setup-status'],
    queryFn: () => api.get<{ configured: boolean }>('/setup/status'),
    retry: false,
  });

  const set = <K extends keyof SetupForm>(key: K, value: SetupForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: '' }));
  };

  const install = useMutation({
    mutationFn: () =>
      api.post('/setup/install', {
        company: {
          name: form.company_name,
          entity_category: form.entity_category,
          legal_form: form.legal_form,
          legal_name: form.legal_name,
          email: form.email,
          phone: form.phone,
          contact_role: form.contact_role,
          address1: form.street_building_zone,
          city: form.physical_municipality || form.po_box_municipality,
          po_box_number: form.po_box_number,
          po_box_municipality: form.po_box_municipality,
          postal_code: form.postal_code,
          island: form.island,
          physical_municipality: form.physical_municipality,
          district: form.district,
          pk_landmark: form.pk_landmark,
          street_building_zone: form.street_building_zone,
          delivery_instructions: form.delivery_instructions,
          tax_id: form.tax_id,
          rcs: form.rcs,
          numero_tps: form.numero_tps,
          share_capital: form.share_capital,
          vat_regime_detail: form.vat_regime_detail,
          default_tax_rate: form.default_tax_rate,
          payment_method: form.payment_method,
          payment_terms_code: form.payment_terms_code,
          bank_name: form.bank_name,
          bank_holder: form.bank_holder,
          bank_iban: form.bank_iban,
          bank_bic: form.bank_bic,
          tax_exemption_decree_num: form.tax_exemption_decree_num,
          tax_exemption_expiry: form.tax_exemption_expiry || null,
          data_consent_accepted: form.data_consent_accepted,
          invoice_terms: form.invoice_terms || DEFAULT_TERMS,
          invoice_footer: form.invoice_footer,
        },
        admin: {
          first_name: form.admin_first,
          last_name: form.admin_last,
          email: form.admin_email,
          password: form.password,
        },
        demo_data: form.demo_data,
      }),
    onSuccess: () => {
      toast.success(t('setup.success'));
      navigate('/connexion', { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.details) {
        const mapped: Record<string, string> = {};
        for (const [field, code] of Object.entries(error.details)) {
          const key = field.replace('company.', '').replace('admin.', 'admin_');
          const validationKey = `validation.${code}`;
          const errorKey = `errors.${code}`;
          mapped[key] = t(validationKey) !== validationKey
            ? t(validationKey)
            : t(errorKey) !== errorKey
              ? t(errorKey)
              : t('errors.validation');
        }
        setErrors(mapped);
        const stepOfKey = (key: string) => {
          if (key.startsWith('admin')) return 3;
          if (['payment_method', 'payment_terms_code', 'data_consent_accepted', 'invoice_terms', 'invoice_footer'].includes(key)) return 4;
          if (['legal_name', 'legal_form', 'tax_id', 'vat_regime_detail', 'entity_category', 'rcs', 'numero_tps', 'share_capital', 'name'].includes(key)) return 1;
          return 2;
        };
        const first = Object.keys(mapped)[0];
        if (first) setStep(stepOfKey(first));
      } else if (error instanceof ApiError) {
        toast.error(t(`errors.${error.code}`) === `errors.${error.code}` ? t('errors.generic') : t(`errors.${error.code}`));
      } else {
        toast.error(t('errors.generic'));
      }
    },
  });

  const validateStep = (): boolean => {
    const next: Record<string, string> = {};
    if (step === 1) {
      if (!form.company_name.trim()) next.company_name = t('validation.required');
      if (!form.legal_name.trim()) next.legal_name = t('validation.required');
      if (!form.legal_form) next.legal_form = t('validation.required');
      if (!form.tax_id.trim()) next.tax_id = t('validation.required');
      else if (!/^([A-Za-z]\d{5}|\d{7})$/.test(form.tax_id.trim())) {
        next.tax_id = t('validation.invalid_tahiti_number');
      }
      if (!form.vat_regime_detail) next.vat_regime_detail = t('validation.required');
    }
    if (step === 2) {
      if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = t('validation.invalid_email');
      if (!form.po_box_municipality.trim()) next.po_box_municipality = t('validation.required');
      if (!form.postal_code.trim()) next.postal_code = t('validation.required');
    }
    if (step === 3) {
      if (!form.admin_first.trim()) next.admin_first = t('validation.required');
      if (!form.admin_last.trim()) next.admin_last = t('validation.required');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.admin_email)) next.admin_email = t('validation.invalid_email');
      if (form.password.length < 12) next.password = t('errors.too_small');
      if (form.password !== form.confirm) next.confirm = t('errors.validation');
    }
    if (step === 4) {
      if (!form.payment_method) next.payment_method = t('validation.required');
      if (!form.payment_terms_code) next.payment_terms_code = t('validation.required');
      if (!form.data_consent_accepted) next.data_consent_accepted = t('validation.consent_required');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (!validateStep()) return;
    if (step < TOTAL_STEPS) {
      setStep(step + 1);
      return;
    }
    install.mutate();
  };

  if (status.data?.configured) {
    return (
      <AuthLayout>
        <div className="card p-8 text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-success-600" aria-hidden="true" />
          <h1 className="mt-4 font-display text-xl font-semibold">{t('setup.alreadyConfigured')}</h1>
          <Link to="/connexion" className="btn btn-primary mt-6">{t('auth.signIn')}</Link>
        </div>
      </AuthLayout>
    );
  }

  const steps = [
    { label: t('clientProfile.legal'), icon: Building2 },
    { label: t('clientProfile.address'), icon: MapPin },
    { label: t('setup.stepAdmin'), icon: ShieldCheck },
    { label: t('clientProfile.terms'), icon: Sparkles },
  ];

  const errorText = (key: string) => (errors[key] ? errors[key] : undefined);

  return (
    <AuthLayout>
      <div className="card overflow-hidden">
        <div className="border-b border-line bg-surface/60 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            {t('setup.stepOf', { current: step, total: TOTAL_STEPS })}
          </p>
          <h1 className="mt-1.5 font-display text-xl font-semibold text-ink-950">{t('setup.title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('setup.subtitle')}</p>

          <ol className="mt-4 flex items-center gap-2" aria-label={t('setup.title')}>
            {steps.map((item, index) => {
              const Icon = item.icon;
              const state = index + 1 === step ? 'current' : index + 1 < step ? 'done' : 'todo';
              return (
                <li key={item.label} className="flex flex-1 items-center gap-2">
                  <span
                    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                      state === 'current'
                        ? 'bg-brand-600 text-white'
                        : state === 'done'
                          ? 'bg-success-600 text-white'
                          : 'bg-line text-muted'
                    }`}
                    aria-current={state === 'current' ? 'step' : undefined}
                  >
                    {state === 'done' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
                  </span>
                  <span className={`hidden text-xs font-medium sm:block ${state === 'current' ? 'text-ink-900' : 'text-muted'}`}>
                    {item.label}
                  </span>
                </li>
              );
            })}
          </ol>
        </div>

        <form onSubmit={next} className="space-y-5 p-6" noValidate>
          {step === 1 ? (
            <>
              <SectionTitle title={t('clientProfile.legal')} hint={t('clientProfile.legalHint')} />
              <p className="text-xs text-muted">{t('clientProfile.requiredFields')}</p>
              <FormGrid>
                <Field label={t('setup.companyName')} htmlFor="company_name" required error={errorText('company_name')}>
                  <Input
                    id="company_name"
                    value={form.company_name}
                    onChange={(event) => set('company_name', event.target.value)}
                    placeholder="Fenua Services"
                    required
                  />
                </Field>
                <Field label={t('clientProfile.entityCategory')} htmlFor="entity_category" required
                  hint={ENTITY_CATEGORY_HINTS[form.entity_category]}>
                  <Select
                    id="entity_category"
                    value={form.entity_category}
                    onChange={(event) => set('entity_category', event.target.value as EntityCategory)}
                  >
                    {ENTITY_CATEGORIES.map((category) => (
                      <option key={category} value={category}>{ENTITY_CATEGORY_LABELS[category]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('setup.legalName')} htmlFor="legal_name" required error={errorText('legal_name')}>
                  <Input id="legal_name" value={form.legal_name} onChange={(event) => set('legal_name', event.target.value)} required />
                </Field>
                <Field label={t('clientProfile.legalForm')} htmlFor="legal_form" required error={errorText('legal_form')}>
                  <Select
                    id="legal_form"
                    value={form.legal_form}
                    required
                    onChange={(event) => set('legal_form', event.target.value as LegalForm | '')}
                  >
                    <option value="">—</option>
                    {LEGAL_FORMS.map((value) => (
                      <option key={value} value={value}>{LEGAL_FORM_LABELS[value]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('setup.tahitiNumber')} htmlFor="tax_id" hint={t('setup.tahitiHint')} required error={errorText('tax_id')}>
                  <Input
                    id="tax_id"
                    value={form.tax_id}
                    onChange={(event) => set('tax_id', event.target.value.toUpperCase())}
                    placeholder="T12345"
                    maxLength={7}
                    required
                  />
                </Field>
                <Field label={t('setup.rcs')} htmlFor="rcs">
                  <Input id="rcs" value={form.rcs} onChange={(event) => set('rcs', event.target.value)} placeholder="Papeete B 12345" />
                </Field>
                <Field label={t('clientProfile.tps')} htmlFor="numero_tps">
                  <Input id="numero_tps" value={form.numero_tps} onChange={(event) => set('numero_tps', event.target.value)} />
                </Field>
                <Field label={t('setup.shareCapital')} htmlFor="capital">
                  <Input id="capital" value={form.share_capital} onChange={(event) => set('share_capital', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.vatRegime')} htmlFor="vat_regime_detail" required error={errorText('vat_regime_detail')}>
                  <Select
                    id="vat_regime_detail"
                    value={form.vat_regime_detail}
                    required
                    onChange={(event) => set('vat_regime_detail', event.target.value as ClientVatRegime | '')}
                  >
                    <option value="">—</option>
                    {CLIENT_VAT_REGIMES.map((value) => (
                      <option key={value} value={value}>{CLIENT_VAT_REGIME_LABELS[value]}</option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
            </>
          ) : null}

          {step === 2 ? (
            <>
              <SectionTitle title={t('clientProfile.contact')} hint={t('clientProfile.contactHint')} />
              <FormGrid>
                <Field label={t('common.email')} htmlFor="company_email" error={errorText('email')}>
                  <Input id="company_email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} placeholder="contact@entreprise.pf" />
                </Field>
                <Field label={t('common.phone')} htmlFor="phone">
                  <Input id="phone" value={form.phone} onChange={(event) => set('phone', event.target.value)} placeholder="+689 40 00 00 00" />
                </Field>
                <Field label={t('clientProfile.contactRole')} htmlFor="contact_role">
                  <Input
                    id="contact_role"
                    value={form.contact_role}
                    placeholder={t('clientProfile.contactRolePlaceholder')}
                    onChange={(event) => set('contact_role', event.target.value)}
                  />
                </Field>
              </FormGrid>

              <SectionTitle title={t('clientProfile.address')} hint={t('clientProfile.addressHint')} />
              <FormGrid>
                <Field label={t('clientProfile.poBox')} htmlFor="po_box_number">
                  <Input id="po_box_number" value={form.po_box_number} onChange={(event) => set('po_box_number', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.poBoxMunicipality')} htmlFor="po_box_municipality" required error={errorText('po_box_municipality')}>
                  <Input
                    id="po_box_municipality"
                    value={form.po_box_municipality}
                    placeholder="Papeete, Faa’a…"
                    onChange={(event) => set('po_box_municipality', event.target.value)}
                    required
                  />
                </Field>
                <Field label={t('common.postalCode')} htmlFor="postal_code" required error={errorText('postal_code')}>
                  <Input
                    id="postal_code"
                    value={form.postal_code}
                    maxLength={5}
                    placeholder="98713"
                    onChange={(event) => set('postal_code', event.target.value)}
                    required
                  />
                </Field>
                <Field label={t('clientProfile.island')} htmlFor="island">
                  <Input id="island" value={form.island} placeholder="Tahiti" onChange={(event) => set('island', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.physicalMunicipality')} htmlFor="physical_municipality">
                  <Input id="physical_municipality" value={form.physical_municipality} onChange={(event) => set('physical_municipality', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.district')} htmlFor="district">
                  <Input id="district" value={form.district} onChange={(event) => set('district', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.pk')} htmlFor="pk_landmark">
                  <Input id="pk_landmark" value={form.pk_landmark} onChange={(event) => set('pk_landmark', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.street')} htmlFor="street_building_zone" className="sm:col-span-2">
                  <Input id="street_building_zone" value={form.street_building_zone} onChange={(event) => set('street_building_zone', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.delivery')} htmlFor="delivery_instructions" className="sm:col-span-2">
                  <Textarea id="delivery_instructions" rows={2} value={form.delivery_instructions} onChange={(event) => set('delivery_instructions', event.target.value)} />
                </Field>
              </FormGrid>
            </>
          ) : null}

          {step === 3 ? (
            <>
              <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800">
                {t('auth.secured')}
              </div>
              <FormGrid>
                <Field label={t('setup.adminFirst')} htmlFor="admin_first" required error={errorText('admin_first')}>
                  <Input id="admin_first" value={form.admin_first} onChange={(event) => set('admin_first', event.target.value)} required />
                </Field>
                <Field label={t('setup.adminLast')} htmlFor="admin_last" required error={errorText('admin_last')}>
                  <Input id="admin_last" value={form.admin_last} onChange={(event) => set('admin_last', event.target.value)} required />
                </Field>
              </FormGrid>
              <Field label={t('setup.adminEmail')} htmlFor="admin_email" required error={errorText('admin_email')}>
                <Input id="admin_email" type="email" autoComplete="email" value={form.admin_email} onChange={(event) => set('admin_email', event.target.value)} required />
              </Field>
              <FormGrid>
                <Field label={t('setup.adminPassword')} htmlFor="password" hint={t('setup.passwordHint')} required error={errorText('password')}>
                  <Input id="password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => set('password', event.target.value)} required />
                </Field>
                <Field label={t('common.confirm')} htmlFor="confirm" required error={errorText('confirm')}>
                  <Input id="confirm" type="password" autoComplete="new-password" value={form.confirm} onChange={(event) => set('confirm', event.target.value)} required />
                </Field>
              </FormGrid>
            </>
          ) : null}

          {step === 4 ? (
            <>
              <SectionTitle title={t('clientProfile.terms')} hint={t('clientProfile.termsHint')} />
              <FormGrid>
                <Field label={t('clientProfile.paymentMethod')} htmlFor="payment_method" required error={errorText('payment_method')}>
                  <Select
                    id="payment_method"
                    value={form.payment_method}
                    required
                    onChange={(event) => set('payment_method', event.target.value as ClientPaymentMethod | '')}
                  >
                    <option value="">—</option>
                    {CLIENT_PAYMENT_METHODS.map((value) => (
                      <option key={value} value={value}>{CLIENT_PAYMENT_METHOD_LABELS[value]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('clientProfile.paymentTermsLabel')} htmlFor="payment_terms_code" required error={errorText('payment_terms_code')}>
                  <Select
                    id="payment_terms_code"
                    value={form.payment_terms_code}
                    required
                    onChange={(event) => set('payment_terms_code', event.target.value as ClientPaymentTerms | '')}
                  >
                    <option value="">—</option>
                    {CLIENT_PAYMENT_TERMS.map((value) => (
                      <option key={value} value={value}>{CLIENT_PAYMENT_TERM_LABELS[value]}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('clientProfile.bank')} htmlFor="bank_name">
                  <Input id="bank_name" value={form.bank_name} placeholder="Banque de Polynésie" onChange={(event) => set('bank_name', event.target.value)} />
                </Field>
                <Field label={t('settings.bankHolder')} htmlFor="bank_holder">
                  <Input id="bank_holder" value={form.bank_holder} onChange={(event) => set('bank_holder', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.iban')} htmlFor="bank_iban">
                  <Input id="bank_iban" value={form.bank_iban} onChange={(event) => set('bank_iban', event.target.value)} />
                </Field>
                <Field label={t('settings.bankBic')} htmlFor="bank_bic">
                  <Input id="bank_bic" value={form.bank_bic} onChange={(event) => set('bank_bic', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.taxExemptionDecree')} htmlFor="tax_exemption_decree_num">
                  <Input id="tax_exemption_decree_num" value={form.tax_exemption_decree_num} onChange={(event) => set('tax_exemption_decree_num', event.target.value)} />
                </Field>
                <Field label={t('clientProfile.taxExemptionExpiry')} htmlFor="tax_exemption_expiry">
                  <Input id="tax_exemption_expiry" type="date" value={form.tax_exemption_expiry} onChange={(event) => set('tax_exemption_expiry', event.target.value)} />
                </Field>
                <Field label={t('setup.defaultTax')} htmlFor="default_tax_rate">
                  <Select id="default_tax_rate" value={form.default_tax_rate} onChange={(event) => set('default_tax_rate', Number(event.target.value))}>
                    {TVA_RATES.map((rate) => (
                      <option key={rate.rate} value={rate.rate}>{rate.label}</option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>

              <SectionTitle title={t('clientProfile.compliance')} hint={t('clientProfile.complianceHint')} />
              <Checkbox
                label={t('clientProfile.consent')}
                description={t('clientProfile.consentHint')}
                checked={form.data_consent_accepted}
                onChange={(event) => set('data_consent_accepted', event.target.checked)}
                aria-invalid={errors.data_consent_accepted ? true : undefined}
              />
              {errors.data_consent_accepted ? <p className="field-error" role="alert">{errors.data_consent_accepted}</p> : null}

              <Field label={t('setup.invoiceTerms')} htmlFor="invoice_terms">
                <Textarea
                  id="invoice_terms"
                  rows={3}
                  value={form.invoice_terms}
                  onChange={(event) => set('invoice_terms', event.target.value)}
                  placeholder={DEFAULT_TERMS}
                />
              </Field>
              <Field label={t('setup.invoiceFooter')} htmlFor="invoice_footer">
                <Input id="invoice_footer" value={form.invoice_footer} onChange={(event) => set('invoice_footer', event.target.value)} placeholder="Merci de votre confiance." />
              </Field>
              <Checkbox
                label={t('setup.demoData')}
                description={t('setup.demoHint')}
                checked={form.demo_data}
                onChange={(event) => set('demo_data', event.target.checked)}
              />

              <dl className="divide-y divide-line rounded-xl border border-line bg-surface/50 text-sm">
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-muted">{t('common.name')}</dt>
                  <dd className="font-medium">{form.company_name}</dd>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-muted">{t('auth.email')}</dt>
                  <dd className="font-medium">{form.admin_email}</dd>
                </div>
                <div className="flex items-center justify-between px-4 py-3">
                  <dt className="text-muted">{t('setup.defaultTax')}</dt>
                  <dd className="font-medium">{form.default_tax_rate} %</dd>
                </div>
              </dl>
              <p className="text-xs text-muted">{t('setup.legalNotice')}</p>
            </>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
            {step > 1 ? (
              <Button variant="ghost" onClick={() => setStep(step - 1)} icon={<ArrowLeft className="h-4 w-4" aria-hidden="true" />}>
                {t('common.previous')}
              </Button>
            ) : <span />}
            <Button
              type="submit"
              loading={install.isPending}
              icon={step < TOTAL_STEPS ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            >
              {step < TOTAL_STEPS ? t('common.next') : install.isPending ? t('setup.installing') : t('setup.install')}
            </Button>
          </div>
        </form>
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        {t('app.name')} · {t('app.description')}
      </p>
    </AuthLayout>
  );
}
