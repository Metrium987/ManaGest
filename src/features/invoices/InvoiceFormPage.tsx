import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { addDaysISO, formatMoney, todayISO } from '@/lib/format';
import type { Client, Invoice, LineItem, ListResponse, Product } from '@/lib/types';
import { fromMinor, toMinor } from '@shared/money';
import { PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { ARCHIPELAGO_LABELS, ARCHIPELAGO_VAT_RATE, ARCHIPELAGOS } from '@shared/archipelago';
import { DEFAULT_TAX_RATE } from '@shared/domain';
import { DEFAULT_PAYMENT_TERMS_DAYS } from '@shared/company-defaults';
import { LineItemsEditor, emptyLine } from '@/components/domain/LineItemsEditor';
import { TotalsPanel } from '@/components/domain/TotalsPanel';
import { useToast } from '@/components/ui/Toast';

interface InvoiceDraft {
  client_id: string;
  date: string;
  due_date: string;
  currency: string;
  po_number: string;
  line_items: LineItem[];
  discount_type: 'percent' | 'amount';
  discount_value: number;
  notes: string;
  terms: string;
  archipelago: string;
  transport_reference: string;
  shipped_by_seller: boolean;
}

function InvoiceEditor({ invoice }: { invoice?: Invoice }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const { company, can } = useSession();
  const [draft, setDraft] = useState<InvoiceDraft>(() => ({
    client_id: invoice?.client_id ?? params.get('client') ?? '',
    date: invoice?.date ?? todayISO(),
    due_date: invoice?.due_date ?? addDaysISO(todayISO(), company?.payment_terms ?? DEFAULT_PAYMENT_TERMS_DAYS),
    currency: invoice?.currency ?? company?.currency ?? 'XPF',
    po_number: invoice?.po_number ?? '',
    line_items: invoice?.line_items ?? [emptyLine(company?.default_tax_rate ?? DEFAULT_TAX_RATE)],
    discount_type: invoice?.discount_type ?? 'percent',
    discount_value: invoice?.discount_value ?? 0,
    notes: invoice?.notes ?? '',
    terms: invoice?.terms ?? company?.invoice_terms ?? '',
    archipelago: invoice?.archipelago ?? '',
    transport_reference: invoice?.transport_reference ?? '',
    shipped_by_seller: Boolean(invoice?.shipped_by_seller),
  }));
  const currency = draft.currency;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dueTouched, setDueTouched] = useState(false);

  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100'),
  });
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.get<ListResponse<Product>>('/products?per_page=100'),
  });

  const currencies = useQuery({
    queryKey: ['currencies'],
    queryFn: () => api.get<{ data: { code: string; label: string; active: number }[] }>('/currencies'),
  });
  const selectedClient = clients.data?.data.find((client) => client.id === draft.client_id);

  useEffect(() => {
    if (!dueTouched && selectedClient) {
      setDraft((current) => ({ ...current, due_date: addDaysISO(current.date, selectedClient.payment_terms) }));
    }
  }, [selectedClient, dueTouched]);

  const save = useMutation({
    mutationFn: () =>
      invoice
        ? api.patch(`/invoices/${invoice.id}`, {
            client_id: draft.client_id,
            date: draft.date,
            due_date: draft.due_date || null,
            currency: draft.currency,
            line_items: draft.line_items,
            discount_type: draft.discount_type,
            discount_value: draft.discount_value,
            notes: draft.notes,
            terms: draft.terms,
            po_number: draft.po_number,
            archipelago: draft.archipelago || null,
            transport_reference: draft.transport_reference || null,
            shipped_by_seller: draft.shipped_by_seller,
          })
        : api.post<{ id: string }>('/invoices', {
            client_id: draft.client_id,
            date: draft.date,
            due_date: draft.due_date || null,
            currency: draft.currency,
            line_items: draft.line_items,
            discount_type: draft.discount_type,
            discount_value: draft.discount_value,
            notes: draft.notes,
            terms: draft.terms,
            po_number: draft.po_number,
            archipelago: draft.archipelago || null,
            transport_reference: draft.transport_reference || null,
            shipped_by_seller: draft.shipped_by_seller,
          }),
    onSuccess: (result) => {
      toast.success(invoice ? t('invoices.updated') : t('invoices.created'));
      navigate(`/factures/${invoice?.id ?? (result as { id: string }).id}`);
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!draft.client_id) next.client_id = t('validation.required');
    if (!draft.date) next.date = t('validation.required');
    if (draft.line_items.some((line) => !line.description.trim())) next.line_items = t('validation.required');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate();
  };

  if (!can('invoices.write')) {
    return <p className="card p-6 text-sm text-danger-700">{t('settings.permissionDenied')}</p>;
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="mb-4 max-w-xs">
        <Field label={t('currencies.title')} htmlFor="invoice_currency">
          <Select
            id="invoice_currency"
            value={draft.currency}
            onChange={(event) => setDraft((current) => ({ ...current, currency: event.target.value }))}
          >
            {(currencies.data?.data ?? [{ code: 'XPF', label: 'Franc Pacifique', active: 1 }])
              .filter((item) => item.active)
              .map((item) => <option key={item.code} value={item.code}>{item.code} — {item.label}</option>)}
          </Select>
        </Field>
      </div>
      <PageHeader
        breadcrumb={
          <Link to={invoice ? `/factures/${invoice.id}` : '/factures'} className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('invoices.title')}
          </Link>
        }
        title={invoice ? `${t('invoices.edit')} · ${invoice.number}` : t('invoices.new')}
        subtitle={t('invoices.issueHint')}
        actions={
          <>
            <Link to={invoice ? `/factures/${invoice.id}` : '/factures'} className="btn btn-secondary">{t('common.cancel')}</Link>
            <Button type="submit" loading={save.isPending} icon={<Save className="h-4 w-4" aria-hidden="true" />}>
              {save.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <SectionCard
            title={t('invoices.lines')}
            subtitle={t('common.requiredFields')}
            bodyClassName="p-5 sm:p-6"
          >
            <LineItemsEditor
              lines={draft.line_items}
              onChange={(lines) => setDraft((current) => ({ ...current, line_items: lines }))}
              products={products.data?.data ?? []}
              currency={currency}
              tier={selectedClient?.price_tier}
            />
            {errors.line_items ? <p className="field-error">{errors.line_items}</p> : null}
            {draft.line_items.some((line) => line.tax_status !== 'exempt' && line.tax_rate === ARCHIPELAGO_VAT_RATE) ? (
              <fieldset className="space-y-3 rounded-lg border border-line p-4">
                <legend className="px-1 text-sm font-semibold text-ink-950">{t('invoices.archipelagoTitle')}</legend>
                <p className="text-xs text-muted">{t('invoices.archipelagoHint')}</p>
                <FormGrid>
                  <Field label={t('invoices.archipelago')} htmlFor="archipelago">
                    <Select id="archipelago" value={draft.archipelago} onChange={(event) => setDraft((current) => ({ ...current, archipelago: event.target.value }))}>
                      <option value="">—</option>
                      {ARCHIPELAGOS.map((code) => <option key={code} value={code}>{ARCHIPELAGO_LABELS[code]}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('invoices.transportReference')} htmlFor="transport_reference">
                    <Input id="transport_reference" value={draft.transport_reference} onChange={(event) => setDraft((current) => ({ ...current, transport_reference: event.target.value }))} />
                  </Field>
                </FormGrid>
                <Checkbox
                  checked={draft.shipped_by_seller}
                  onChange={(event) => setDraft((current) => ({ ...current, shipped_by_seller: event.target.checked }))}
                  label={t('invoices.shippedBySeller')}
                />
              </fieldset>
            ) : null}
          </SectionCard>

          <SectionCard title={t('common.notes')} bodyClassName="p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('invoices.notesClient')} htmlFor="notes">
                <Textarea id="notes" value={draft.notes} onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))} rows={4} />
              </Field>
              <Field label={t('invoices.terms')} htmlFor="terms">
                <Textarea id="terms" value={draft.terms} onChange={(event) => setDraft((current) => ({ ...current, terms: event.target.value }))} rows={4} />
              </Field>
            </div>
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t('invoices.client')} bodyClassName="space-y-4 p-5">
            <Field label={t('invoices.client')} htmlFor="client_id" required error={errors.client_id}>
              <Select
                id="client_id"
                value={draft.client_id}
                onChange={(event) => setDraft((current) => ({ ...current, client_id: event.target.value }))}
                required
              >
                <option value="">{t('common.none')}</option>
                {(clients.data?.data ?? []).map((client) => (
                  <option key={client.id} value={client.id}>{client.display_name}</option>
                ))}
              </Select>
            </Field>
            <FormGrid columns={1}>
              <Field label={t('invoices.issueDate')} htmlFor="date">
                <Input
                  id="date"
                  type="date"
                  value={draft.date}
                  onChange={(event) => {
                    const date = event.target.value;
                    setDraft((current) => ({
                      ...current,
                      date,
                      due_date: dueTouched ? current.due_date : addDaysISO(date, selectedClient?.payment_terms ?? DEFAULT_PAYMENT_TERMS_DAYS),
                    }));
                  }}
                />
              </Field>
              <Field label={t('invoices.dueDate')} htmlFor="due_date">
                <Input
                  id="due_date"
                  type="date"
                  value={draft.due_date}
                  onChange={(event) => {
                    setDueTouched(true);
                    setDraft((current) => ({ ...current, due_date: event.target.value }));
                  }}
                />
              </Field>
              <Field label={t('invoices.poNumber')} htmlFor="po_number">
                <Input id="po_number" value={draft.po_number} onChange={(event) => setDraft((current) => ({ ...current, po_number: event.target.value }))} />
              </Field>
            </FormGrid>
            {selectedClient?.is_tax_exempt ? (
              <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-800">{t('invoices.taxExemptNote')}</p>
            ) : null}
          </SectionCard>

          <SectionCard title={t('common.discount')} bodyClassName="grid grid-cols-2 gap-3 p-5">
            <Field label={t('invoices.discountType')} htmlFor="discount_type">
              <Select
                id="discount_type"
                value={draft.discount_type}
                onChange={(event) => setDraft((current) => ({ ...current, discount_type: event.target.value as 'percent' | 'amount', discount_value: 0 }))}
              >
                <option value="percent">{t('invoices.discountPercent')}</option>
                <option value="amount">{t('invoices.discountAmount')}</option>
              </Select>
            </Field>
            <Field label={t('invoices.discountValue')} htmlFor="discount_value">
              <Input
                id="discount_value"
                type="number"
                min="0"
                step={draft.discount_type === 'percent' ? '0.5' : '1'}
                value={draft.discount_type === 'percent' ? draft.discount_value / 100 : fromMinor(draft.discount_value, currency)}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    discount_value:
                      current.discount_type === 'percent'
                        ? Math.round(Number(event.target.value) * 100)
                        : toMinor(Number(event.target.value), currency),
                  }))
                }
              />
            </Field>
          </SectionCard>

          <TotalsPanel
            lines={draft.line_items}
            discountType={draft.discount_type}
            discountValue={draft.discount_value}
            taxExempt={Boolean(selectedClient?.is_tax_exempt)}
            currency={currency}
          />

          <div className="rounded-xl border border-line bg-white p-4 text-xs text-muted">
            {t('invoices.issueHint')} · {formatMoney(0, currency).replace('0', '').trim()}
          </div>
        </div>
      </div>
    </form>
  );
}

export function InvoiceFormPage() {
  const { id } = useParams();
  const invoice = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<Invoice>(`/invoices/${id}`),
    enabled: Boolean(id),
  });

  if (id && invoice.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-16" /><Skeleton className="h-96" /></div>;
  }
  if (id && invoice.isError) {
    return <p className="card p-6 text-sm text-danger-700">{t('errors.NOT_FOUND')}</p>;
  }
  return <InvoiceEditor key={id ?? 'new'} invoice={invoice.data} />;
}
