import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { TVA_RATES } from '@shared/domain';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';

interface SetupForm {
  company_name: string;
  legal_name: string;
  tax_id: string;
  rcs: string;
  share_capital: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postal_code: string;
  vat_regime: 'standard' | 'franchise';
  default_tax_rate: number;
  payment_terms: number;
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
  legal_name: '',
  tax_id: '',
  rcs: '',
  share_capital: '',
  email: '',
  phone: '',
  address1: '',
  city: '',
  postal_code: '',
  vat_regime: 'standard',
  default_tax_rate: 16,
  payment_terms: 30,
  invoice_terms: '',
  invoice_footer: '',
  admin_first: '',
  admin_last: '',
  admin_email: '',
  password: '',
  confirm: '',
  demo_data: true,
};

const DEFAULT_TERMS =
  'Paiement à réception de facture. Passé ce délai, une pénalité de retard de 10 % et une indemnité forfaitaire de recouvrement de 5 000 F CFP sont applicables.';

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
          legal_name: form.legal_name,
          email: form.email,
          phone: form.phone,
          address1: form.address1,
          city: form.city,
          postal_code: form.postal_code,
          tax_id: form.tax_id,
          rcs: form.rcs,
          share_capital: form.share_capital,
          vat_regime: form.vat_regime,
          default_tax_rate: form.default_tax_rate,
          payment_terms: form.payment_terms,
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
          const key = field.replace('company.', '').replace('admin.', (prefix) => (prefix === 'admin.' ? 'admin_' : prefix));
          mapped[key] = t(`errors.${code}`) === `errors.${code}` ? t('errors.validation') : t(`errors.${code}`);
        }
        setErrors(mapped);
        setStep(Object.keys(mapped).some((key) => key.startsWith('admin')) ? 2 : 1);
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
      if (form.tax_id && !/^[A-Za-z]\d{5}$/.test(form.tax_id.trim())) {
        next.tax_id = t('validation.invalid_tahiti_number');
      }
      if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = t('errors.invalid_string');
    }
    if (step === 2) {
      if (!form.admin_first.trim()) next.admin_first = t('validation.required');
      if (!form.admin_last.trim()) next.admin_last = t('validation.required');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.admin_email)) next.admin_email = t('errors.invalid_string');
      if (form.password.length < 12) next.password = t('errors.too_small');
      if (form.password !== form.confirm) next.confirm = t('errors.validation');
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const next = (event: FormEvent) => {
    event.preventDefault();
    if (!validateStep()) return;
    if (step < 3) {
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
    { label: t('setup.stepCompany'), icon: Building2 },
    { label: t('setup.stepAdmin'), icon: ShieldCheck },
    { label: t('setup.stepPreferences'), icon: Sparkles },
  ];

  const errorText = (key: string) => (errors[key] ? errors[key] : undefined);

  return (
    <AuthLayout>
      <div className="card overflow-hidden">
        <div className="border-b border-line bg-surface/60 px-6 py-5">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            {t('setup.stepOf', { current: step, total: 3 })}
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
                <Field label={t('setup.legalName')} htmlFor="legal_name">
                  <Input id="legal_name" value={form.legal_name} onChange={(event) => set('legal_name', event.target.value)} />
                </Field>
                <Field label={t('setup.tahitiNumber')} htmlFor="tax_id" hint={t('setup.tahitiHint')} error={errorText('tax_id')}>
                  <Input
                    id="tax_id"
                    value={form.tax_id}
                    onChange={(event) => set('tax_id', event.target.value.toUpperCase())}
                    placeholder="T12345"
                    maxLength={6}
                  />
                </Field>
                <Field label={t('setup.rcs')} htmlFor="rcs">
                  <Input id="rcs" value={form.rcs} onChange={(event) => set('rcs', event.target.value)} placeholder="Papeete B 12345" />
                </Field>
                <Field label={t('common.email')} htmlFor="company_email" error={errorText('email')}>
                  <Input id="company_email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} placeholder="contact@entreprise.pf" />
                </Field>
                <Field label={t('common.phone')} htmlFor="phone">
                  <Input id="phone" value={form.phone} onChange={(event) => set('phone', event.target.value)} placeholder="+689 40 00 00 00" />
                </Field>
                <Field label={t('common.address')} htmlFor="address1" className="sm:col-span-2">
                  <Input id="address1" value={form.address1} onChange={(event) => set('address1', event.target.value)} placeholder="Rue du Général de Gaulle" />
                </Field>
                <Field label={t('common.postalCode')} htmlFor="postal_code">
                  <Input id="postal_code" value={form.postal_code} onChange={(event) => set('postal_code', event.target.value)} placeholder="98713" />
                </Field>
                <Field label={t('common.city')} htmlFor="city">
                  <Input id="city" value={form.city} onChange={(event) => set('city', event.target.value)} placeholder="Papeete" />
                </Field>
                <Field label={t('setup.vatRegime')} htmlFor="vat_regime" hint={t('setup.vatHint')}>
                  <Select id="vat_regime" value={form.vat_regime} onChange={(event) => set('vat_regime', event.target.value as 'standard' | 'franchise')}>
                    <option value="standard">{t('setup.vatStandard')}</option>
                    <option value="franchise">{t('setup.vatFranchise')}</option>
                  </Select>
                </Field>
                <Field label={t('setup.defaultTax')} htmlFor="default_tax_rate">
                  <Select id="default_tax_rate" value={form.default_tax_rate} onChange={(event) => set('default_tax_rate', Number(event.target.value))}>
                    {TVA_RATES.map((rate) => (
                      <option key={rate.rate} value={rate.rate}>{rate.label}</option>
                    ))}
                  </Select>
                </Field>
              </FormGrid>
              <Field label={t('setup.invoiceTerms')} htmlFor="invoice_terms">
                <Textarea
                  id="invoice_terms"
                  rows={3}
                  value={form.invoice_terms}
                  onChange={(event) => set('invoice_terms', event.target.value)}
                  placeholder={DEFAULT_TERMS}
                />
              </Field>
            </>
          ) : null}

          {step === 2 ? (
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

          {step === 3 ? (
            <>
              <Checkbox
                label={t('setup.demoData')}
                description={t('setup.demoHint')}
                checked={form.demo_data}
                onChange={(event) => set('demo_data', event.target.checked)}
              />
              <Field label={t('setup.paymentTerms')} htmlFor="payment_terms">
                <Input
                  id="payment_terms"
                  type="number"
                  min="0"
                  max="365"
                  value={form.payment_terms}
                  onChange={(event) => set('payment_terms', Number(event.target.value))}
                  className="max-w-[160px]"
                />
              </Field>
              <Field label={t('setup.invoiceFooter')} htmlFor="invoice_footer">
                <Input id="invoice_footer" value={form.invoice_footer} onChange={(event) => set('invoice_footer', event.target.value)} placeholder="Merci de votre confiance." />
              </Field>
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
              icon={step < 3 ? <ArrowRight className="h-4 w-4" aria-hidden="true" /> : <CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
            >
              {step < 3 ? t('common.next') : install.isPending ? t('setup.installing') : t('setup.install')}
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
