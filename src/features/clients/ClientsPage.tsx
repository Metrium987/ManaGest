import { useDeferredValue, useState, type FormEvent } from 'react';
import { useNewRecordFlag } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import {
  CLIENT_ACCOUNT_STATUSES,
  CLIENT_BANKS,
  CLIENT_BANK_LABELS,
  CLIENT_PAYMENT_METHODS,
  CLIENT_PAYMENT_METHOD_LABELS,
  CLIENT_PAYMENT_TERMS,
  CLIENT_PAYMENT_TERM_LABELS,
  CLIENT_VAT_REGIMES,
  CLIENT_VAT_REGIME_LABELS,
  ENTITY_CATEGORIES,
  ENTITY_CATEGORY_HINTS,
  ENTITY_CATEGORY_LABELS,
  ENTITY_CATEGORY_PREFIX,
  LEGAL_FORMS,
  LEGAL_FORM_LABELS,
  isLegalEntity,
  validateClientProfile,
  type ClientAccountStatus,
  type ClientBank,
  type ClientPaymentMethod,
  type ClientPaymentTerms,
  type ClientVatRegime,
  type EntityCategory,
  type LegalForm,
} from '@shared/client-profile';
import { api, toQuery } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatMoney } from '@/lib/format';
import type { Client, ListResponse } from '@/lib/types';
import { PageHeader, EmptyState, Pagination, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, SearchInput, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { SavedFilterBar } from '@/components/domain/SavedFilterBar';
import { ClientDocumentsPanel } from './ClientDocumentsPanel';

interface ClientFormState {
  display_name: string;
  entity_category: EntityCategory;
  legal_name: string;
  trade_name: string;
  legal_form: LegalForm | '';
  tax_id: string;
  numero_rcs: string;
  numero_tps: string;
  nif: string;
  vat_regime: ClientVatRegime | '';
  price_tier: 'public' | 'pro' | 'member';
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  contact_role: string;
  has_delegation_authority: boolean;
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
  bank_name: ClientBank | '';
  iban: string;
  credit_limit: number;
  is_tax_exempt: boolean;
  tax_exemption_decree_num: string;
  tax_exemption_expiry: string;
  data_consent_accepted: boolean;
  account_status: ClientAccountStatus;
  notes: string;
}

const EMPTY: ClientFormState = {
  display_name: '',
  entity_category: 'PRIVATE_COMPANY',
  legal_name: '',
  trade_name: '',
  legal_form: '',
  tax_id: '',
  numero_rcs: '',
  numero_tps: '',
  nif: '',
  vat_regime: '',
  price_tier: 'public',
  first_name: '',
  last_name: '',
  email: '',
  phone: '',
  contact_role: '',
  has_delegation_authority: false,
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
  iban: '',
  credit_limit: 0,
  is_tax_exempt: false,
  tax_exemption_decree_num: '',
  tax_exemption_expiry: '',
  data_consent_accepted: false,
  account_status: 'PENDING_DOCUMENTS',
  notes: '',
};

/** Existing rows predate the enum: derive a sensible term from the stored days. */
function termsCodeFromDays(days: number): ClientPaymentTerms | '' {
  if (days === 30) return 'NET_30_DAYS';
  if (days === 60) return 'NET_60_DAYS';
  if (days === 0) return 'IMMEDIATE';
  return '';
}

function fromClient(client: Client): ClientFormState {
  return {
    display_name: client.display_name,
    entity_category: client.entity_category ?? 'PRIVATE_COMPANY',
    legal_name: client.legal_name ?? '',
    trade_name: client.trade_name ?? '',
    legal_form: (client.legal_form ?? '') as LegalForm | '',
    tax_id: client.tax_id ?? '',
    numero_rcs: client.numero_rcs ?? '',
    numero_tps: client.numero_tps ?? '',
    nif: client.nif ?? '',
    vat_regime: (client.vat_regime ?? '') as ClientVatRegime | '',
    price_tier: client.price_tier ?? 'public',
    first_name: client.first_name ?? '',
    last_name: client.last_name ?? '',
    email: client.email ?? '',
    phone: client.phone ?? '',
    contact_role: client.contact_role ?? '',
    has_delegation_authority: Boolean(client.has_delegation_authority),
    po_box_number: client.po_box_number ?? '',
    po_box_municipality: client.po_box_municipality ?? '',
    postal_code: client.postal_code ?? '',
    island: client.island ?? '',
    physical_municipality: client.physical_municipality ?? '',
    district: client.district ?? '',
    pk_landmark: client.pk_landmark ?? '',
    street_building_zone: client.street_building_zone ?? '',
    delivery_instructions: client.delivery_instructions ?? '',
    payment_method: (client.payment_method ?? '') as ClientPaymentMethod | '',
    payment_terms_code: (client.payment_terms_code ?? termsCodeFromDays(client.payment_terms)) as ClientPaymentTerms | '',
    bank_name: (client.bank_name ?? '') as ClientBank | '',
    iban: client.iban ?? '',
    credit_limit: client.credit_limit ?? 0,
    is_tax_exempt: Boolean(client.is_tax_exempt),
    tax_exemption_decree_num: client.tax_exemption_decree_num ?? '',
    tax_exemption_expiry: client.tax_exemption_expiry ?? '',
    data_consent_accepted: Boolean(client.data_consent_accepted),
    account_status: (client.account_status ?? 'PENDING_DOCUMENTS') as ClientAccountStatus,
    notes: client.notes ?? '',
  };
}

function SectionTitle({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-b border-line pb-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink-950">{title}</h3>
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

export function ClientFormModal({
  open,
  client,
  onClose,
  onSaved,
}: {
  open: boolean;
  client?: Client | null;
  onClose: () => void;
  onSaved?: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { can } = useSession();
  const [form, setForm] = useState<ClientFormState>(client ? fromClient(client) : EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const legalEntity = isLegalEntity(form.entity_category);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        ...form,
        legal_form: form.legal_form || null,
        vat_regime: form.vat_regime,
        price_tier: form.price_tier || null,
        payment_method: form.payment_method || null,
        payment_terms_code: form.payment_terms_code || null,
        bank_name: form.bank_name || null,
        tax_exemption_expiry: form.tax_exemption_expiry || null,
        account_status: client ? form.account_status : undefined,
      };
      return client ? api.patch(`/clients/${client.id}`, payload) : api.post<{ id: string }>('/clients', payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['client', client?.id] });
      queryClient.invalidateQueries({ queryKey: ['client-documents', client?.id] });
      toast.success(client ? t('clients.edit') : t('clients.new'));
      onSaved?.(client?.id ?? (result as { id: string })?.id ?? '');
      onClose();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    },
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    const codes = validateClientProfile({
      entity_category: form.entity_category,
      display_name: form.display_name,
      legal_name: form.legal_name,
      legal_form: form.legal_form,
      tax_id: form.tax_id,
      nif: form.nif,
      vat_regime: form.vat_regime,
        price_tier: form.price_tier,
      first_name: form.first_name,
      last_name: form.last_name,
      email: form.email,
      phone: form.phone,
      has_delegation_authority: form.has_delegation_authority,
      contact_role: form.contact_role,
      po_box_number: form.po_box_number,
      po_box_municipality: form.po_box_municipality,
      postal_code: form.postal_code,
      payment_method: form.payment_method,
      payment_terms_code: form.payment_terms_code,
      data_consent_accepted: form.data_consent_accepted,
    });
    const next = Object.fromEntries(
      Object.entries(codes).map(([field, code]) => {
        const key = `validation.${code}`;
        const message = t(key);
        return [field, message === key ? t('errors.validation') : message];
      }),
    );
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate();
  };

  const set = <K extends keyof ClientFormState>(key: K, value: ClientFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const clientCode = client?.number ?? `${ENTITY_CATEGORY_PREFIX[form.entity_category]}-####`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? t('clients.edit') : t('clients.new')}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => submit()} loading={save.isPending}>{t('common.save')}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-7" noValidate>
        <p className="text-xs text-muted">{t('clientProfile.requiredFields')}</p>

        <section className="space-y-4">
          <SectionTitle title={t('clientProfile.identity')} hint={t('clientProfile.identityHint')} />
          <FormGrid columns={3}>
            <Field label={t('clients.displayName')} htmlFor="display_name" required error={errors.display_name}>
              <Input
                id="display_name"
                value={form.display_name}
                onChange={(event) => set('display_name', event.target.value)}
                required
                autoFocus
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
            <Field label={t('clients.code')} htmlFor="client_number" hint={t('clientProfile.identityHint')}>
              <Input id="client_number" value={clientCode} readOnly disabled />
            </Field>
            <Field label={t('clientProfile.tradeName')} htmlFor="trade_name">
              <Input id="trade_name" value={form.trade_name} onChange={(event) => set('trade_name', event.target.value)} />
            </Field>
            {client ? (
              <Field label={t('clientProfile.accountStatus')} htmlFor="account_status"
                hint={t('clientProfile.accountStatusHint')}>
                <Select
                  id="account_status"
                  value={form.account_status}
                  disabled={!can('clients.write')}
                  onChange={(event) => set('account_status', event.target.value as ClientAccountStatus)}
                >
                  {CLIENT_ACCOUNT_STATUSES.map((status) => (
                    <option key={status} value={status}>{t(`clientProfile.status.${status}`)}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </FormGrid>
        </section>

        {legalEntity ? (
          <section className="space-y-4">
            <SectionTitle title={t('clientProfile.legal')} hint={t('clientProfile.legalHint')} />
            <FormGrid columns={3}>
              <Field label={t('clientProfile.legalName')} htmlFor="legal_name" required error={errors.legal_name}
                className="sm:col-span-2">
                <Input id="legal_name" value={form.legal_name} onChange={(event) => set('legal_name', event.target.value)} required />
              </Field>
              <Field label={t('clientProfile.legalForm')} htmlFor="legal_form" required error={errors.legal_form}>
                <Select id="legal_form" value={form.legal_form} required
                  onChange={(event) => set('legal_form', event.target.value as LegalForm | '')}>
                  <option value="">—</option>
                  {LEGAL_FORMS.map((value) => (
                    <option key={value} value={value}>{LEGAL_FORM_LABELS[value]}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('clientProfile.tahitiNumber')} htmlFor="tax_id" error={errors.tax_id}
                hint={t('clientProfile.tahitiHint')}>
                <Input
                  id="tax_id"
                  value={form.tax_id}
                  maxLength={7}
                  placeholder="T12345"
                  onChange={(event) => set('tax_id', event.target.value.toUpperCase())}
                />
              </Field>
              <Field label={t('clientProfile.rcs')} htmlFor="numero_rcs">
                <Input id="numero_rcs" value={form.numero_rcs} onChange={(event) => set('numero_rcs', event.target.value)} />
              </Field>
              <Field label={t('clientProfile.tps')} htmlFor="numero_tps">
                <Input id="numero_tps" value={form.numero_tps} onChange={(event) => set('numero_tps', event.target.value)} />
              </Field>
              <Field label={t('clientProfile.nif')} htmlFor="nif">
                <Input id="nif" value={form.nif} onChange={(event) => set('nif', event.target.value)} />
              </Field>
              <Field label={t('clients.priceTier')} htmlFor="price_tier">
                <Select id="price_tier" value={form.price_tier}
                  onChange={(event) => set('price_tier', event.target.value as 'public' | 'pro' | 'member')}>
                  <option value="public">{t('clients.priceTierPublic')}</option>
                  <option value="pro">{t('clients.priceTierPro')}</option>
                  <option value="member">{t('clients.priceTierMember')}</option>
                </Select>
              </Field>
              <Field label={t('clientProfile.vatRegime')} htmlFor="vat_regime" required error={errors.vat_regime}>
                <Select id="vat_regime" value={form.vat_regime} required
                  onChange={(event) => set('vat_regime', event.target.value as ClientVatRegime | '')}>
                  <option value="">—</option>
                  {CLIENT_VAT_REGIMES.map((value) => (
                    <option key={value} value={value}>{CLIENT_VAT_REGIME_LABELS[value]}</option>
                  ))}
                </Select>
              </Field>
            </FormGrid>
          </section>
        ) : null}

        <section className="space-y-4">
          <SectionTitle title={t('clientProfile.contact')} hint={t('clientProfile.contactHint')} />
          <FormGrid columns={3}>
            <Field label={t('common.firstName')} htmlFor="first_name">
              <Input id="first_name" value={form.first_name} onChange={(event) => set('first_name', event.target.value)} />
            </Field>
            <Field label={t('common.lastName')} htmlFor="last_name" required error={errors.last_name}>
              <Input id="last_name" value={form.last_name} onChange={(event) => set('last_name', event.target.value)} required />
            </Field>
            <Field label={t('clientProfile.contactRole')} htmlFor="contact_role">
              <Input
                id="contact_role"
                value={form.contact_role}
                placeholder={t('clientProfile.contactRolePlaceholder')}
                onChange={(event) => set('contact_role', event.target.value)}
              />
            </Field>
            <Field label={t('common.email')} htmlFor="email" required={legalEntity} error={errors.email}>
              <Input id="email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
            </Field>
            <Field label={t('common.phone')} htmlFor="phone" required={legalEntity} error={errors.phone}>
              <Input id="phone" value={form.phone} onChange={(event) => set('phone', event.target.value)} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox
                label={t('clientProfile.delegation')}
                description={t('clientProfile.delegationHint')}
                checked={form.has_delegation_authority}
                onChange={(event) => set('has_delegation_authority', event.target.checked)}
              />
            </div>
          </FormGrid>
        </section>

        <section className="space-y-4">
          <SectionTitle title={t('clientProfile.address')} hint={t('clientProfile.addressHint')} />
          <FormGrid columns={3}>
            <Field label={t('clientProfile.poBox')} htmlFor="po_box_number" required={legalEntity} error={errors.po_box_number}>
              <Input id="po_box_number" value={form.po_box_number} onChange={(event) => set('po_box_number', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.poBoxMunicipality')} htmlFor="po_box_municipality" required error={errors.po_box_municipality}>
              <Input
                id="po_box_municipality"
                value={form.po_box_municipality}
                placeholder="Papeete, Faa’a…"
                onChange={(event) => set('po_box_municipality', event.target.value)}
              />
            </Field>
            <Field label={t('common.postalCode')} htmlFor="postal_code" required error={errors.postal_code}>
              <Input
                id="postal_code"
                value={form.postal_code}
                maxLength={5}
                placeholder="98713"
                onChange={(event) => set('postal_code', event.target.value)}
              />
            </Field>
            <Field label={t('clientProfile.island')} htmlFor="island">
              <Input id="island" value={form.island} placeholder="Tahiti" onChange={(event) => set('island', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.physicalMunicipality')} htmlFor="physical_municipality">
              <Input
                id="physical_municipality"
                value={form.physical_municipality}
                onChange={(event) => set('physical_municipality', event.target.value)}
              />
            </Field>
            <Field label={t('clientProfile.district')} htmlFor="district">
              <Input id="district" value={form.district} onChange={(event) => set('district', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.pk')} htmlFor="pk_landmark">
              <Input id="pk_landmark" value={form.pk_landmark} onChange={(event) => set('pk_landmark', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.street')} htmlFor="street_building_zone" className="sm:col-span-2">
              <Input id="street_building_zone" value={form.street_building_zone}
                onChange={(event) => set('street_building_zone', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.delivery')} htmlFor="delivery_instructions" className="sm:col-span-3">
              <Textarea id="delivery_instructions" rows={2} value={form.delivery_instructions}
                onChange={(event) => set('delivery_instructions', event.target.value)} />
            </Field>
          </FormGrid>
        </section>

        <section className="space-y-4">
          <SectionTitle title={t('clientProfile.terms')} hint={t('clientProfile.termsHint')} />
          <FormGrid columns={3}>
            <Field label={t('clientProfile.paymentMethod')} htmlFor="payment_method" required error={errors.payment_method}>
              <Select id="payment_method" value={form.payment_method} required
                onChange={(event) => set('payment_method', event.target.value as ClientPaymentMethod | '')}>
                <option value="">—</option>
                {CLIENT_PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>{CLIENT_PAYMENT_METHOD_LABELS[value]}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('clientProfile.paymentTermsLabel')} htmlFor="payment_terms_code" required error={errors.payment_terms_code}>
              <Select id="payment_terms_code" value={form.payment_terms_code} required
                onChange={(event) => set('payment_terms_code', event.target.value as ClientPaymentTerms | '')}>
                <option value="">—</option>
                {CLIENT_PAYMENT_TERMS.map((value) => (
                  <option key={value} value={value}>{CLIENT_PAYMENT_TERM_LABELS[value]}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('clientProfile.bank')} htmlFor="bank_name">
              <Select id="bank_name" value={form.bank_name}
                onChange={(event) => set('bank_name', event.target.value as ClientBank | '')}>
                <option value="">—</option>
                {CLIENT_BANKS.map((value) => (
                  <option key={value} value={value}>{CLIENT_BANK_LABELS[value]}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('clientProfile.iban')} htmlFor="iban" className="sm:col-span-2">
              <Input id="iban" value={form.iban} onChange={(event) => set('iban', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.creditLimit')} htmlFor="credit_limit" hint={t('app.currency')}>
              <Input
                id="credit_limit"
                type="number"
                min="0"
                step="1"
                value={form.credit_limit}
                onChange={(event) => set('credit_limit', Number(event.target.value))}
              />
            </Field>
            <Field label={t('clientProfile.taxExemptionDecree')} htmlFor="tax_exemption_decree_num">
              <Input id="tax_exemption_decree_num" value={form.tax_exemption_decree_num}
                onChange={(event) => set('tax_exemption_decree_num', event.target.value)} />
            </Field>
            <Field label={t('clientProfile.taxExemptionExpiry')} htmlFor="tax_exemption_expiry">
              <Input id="tax_exemption_expiry" type="date" value={form.tax_exemption_expiry}
                onChange={(event) => set('tax_exemption_expiry', event.target.value)} />
            </Field>
            <div className="flex items-end pb-2">
              <Checkbox
                label={t('clients.taxExempt')}
                checked={form.is_tax_exempt || form.vat_regime === 'EXONERE'}
                onChange={(event) => set('is_tax_exempt', event.target.checked)}
              />
            </div>
          </FormGrid>
          <Field label={t('common.notes')} htmlFor="notes">
            <Textarea id="notes" value={form.notes} onChange={(event) => set('notes', event.target.value)} />
          </Field>
        </section>

        <section className="space-y-4">
          <SectionTitle title={t('clientProfile.compliance')} hint={t('clientProfile.complianceHint')} />
          <Checkbox
            label={t('clientProfile.consent')}
            description={t('clientProfile.consentHint')}
            checked={form.data_consent_accepted}
            onChange={(event) => set('data_consent_accepted', event.target.checked)}
            aria-invalid={errors.data_consent_accepted ? true : undefined}
          />
          {errors.data_consent_accepted ? (
            <p className="field-error" role="alert">{errors.data_consent_accepted}</p>
          ) : null}
        </section>

        <section className="space-y-4">
          <SectionTitle title={t('clientProfile.documents')} hint={t('clientProfile.documentsHint')} />
          {client ? (
            <ClientDocumentsPanel clientId={client.id} canWrite={can('clients.write')} />
          ) : (
            <p className="rounded-xl bg-surface px-3 py-2 text-sm text-muted">{t('clientProfile.saveToUpload')}</p>
          )}
        </section>
      </form>
    </Modal>
  );
}

export function ClientsPage() {
  const { company, can } = useSession();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const startNew = useNewRecordFlag();
  const [modal, setModal] = useState<{ open: boolean; client?: Client }>({ open: startNew });
  const currency = company?.currency ?? 'XPF';

  const clients = useQuery({
    queryKey: ['clients', deferredSearch, page],
    queryFn: () => api.get<ListResponse<Client>>(`/clients${toQuery({ q: deferredSearch, page })}`),
  });

  return (
    <>
      <div className="mb-3">
        <SavedFilterBar list="clients" query={search} onApply={(value) => { setSearch(value); setPage(1); }} />
      </div>
      <PageHeader
        title={t('clients.title')}
        subtitle={t('clients.subtitle')}
        actions={
          <>
            <ExportCsvButton entity="clients" />
            {can('clients.write') ? (
              <Button onClick={() => setModal({ open: true })} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
                {t('clients.new')}
              </Button>
            ) : null}
          </>
        }
      />

      <SectionCard
        title={t('clients.title')}
        subtitle={clients.data ? `${clients.data.meta.total} ${t('common.results')}` : undefined}
        actions={<SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={t('clients.searchPlaceholder')} className="w-full sm:w-72" />}
        bodyClassName="table-wrap"
      >
        {clients.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : clients.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('clients.category')}</th>
                <th scope="col">{t('common.city')}</th>
                <th scope="col">{t('common.email')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col" className="text-right">{t('clients.balance')}</th>
                <th scope="col" className="text-right">{t('clients.invoiceCount')}</th>
              </tr>
            </thead>
            <tbody>
              {clients.data.data.map((client) => (
                <tr key={client.id}>
                  <td>
                    <Link to={`/clients/${client.id}`} className="font-medium text-ink-900 hover:text-brand-700">
                      {client.display_name}
                    </Link>
                    <p className="text-xs text-muted">
                      {client.number ?? '—'}
                      {client.tax_id ? ` · TAHITI ${client.tax_id}` : ''}
                    </p>
                  </td>
                  <td className="text-muted">{ENTITY_CATEGORY_LABELS[client.entity_category] ?? '—'}</td>
                  <td className="text-muted">{client.city ?? '—'}</td>
                  <td className="text-muted">{client.email ?? '—'}</td>
                  <td>
                    <StatusBadge
                      status={client.account_status}
                      label={t(`clientProfile.status.${client.account_status}`)}
                    />
                  </td>
                  <td className={`text-right tabular-nums font-medium ${client.balance > 0 ? 'text-warning-700' : 'text-ink-900'}`}>
                    {formatMoney(client.balance, currency)}
                  </td>
                  <td className="text-right tabular-nums text-muted">{client.invoice_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={<Users className="h-6 w-6" aria-hidden="true" />}
            title={t('clients.empty')}
            action={can('clients.write') ? <Button onClick={() => setModal({ open: true })}>{t('clients.new')}</Button> : undefined}
          />
        )}
        {clients.data ? (
          <Pagination page={page} totalPages={clients.data.meta.total_pages} total={clients.data.meta.total} onChange={setPage} />
        ) : null}
      </SectionCard>

      {modal.open ? (
        <ClientFormModal open client={modal.client} onClose={() => setModal({ open: false })} />
      ) : null}
    </>
  );
}
