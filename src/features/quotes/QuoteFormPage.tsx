import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { addDaysISO, todayISO } from '@/lib/format';
import type { Client, LineItem, ListResponse, Product, Quote } from '@/lib/types';
import { PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { LineItemsEditor, emptyLine } from '@/components/domain/LineItemsEditor';
import { TotalsPanel } from '@/components/domain/TotalsPanel';
import { useToast } from '@/components/ui/Toast';

function QuoteEditor({ quote }: { quote?: Quote }) {
  const navigate = useNavigate();
  const toast = useToast();
  const { company } = useSession();
  const currency = company?.currency ?? 'XPF';
  const [clientId, setClientId] = useState(quote?.client_id ?? '');
  const [date, setDate] = useState(quote?.date ?? todayISO());
  const [validUntil, setValidUntil] = useState(quote?.valid_until ?? addDaysISO(todayISO(), 30));
  const [lines, setLines] = useState<LineItem[]>(quote?.line_items ?? [emptyLine(company?.default_tax_rate ?? 16)]);
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>(quote?.discount_type ?? 'percent');
  const [discountValue, setDiscountValue] = useState(quote?.discount_value ?? 0);
  const [notes, setNotes] = useState(quote?.notes ?? '');
  const [terms, setTerms] = useState(quote?.terms ?? company?.invoice_terms ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});

  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100'),
  });
  const products = useQuery({
    queryKey: ['products', 'options'],
    queryFn: () => api.get<ListResponse<Product>>('/products?per_page=100'),
  });
  const client = clients.data?.data.find((item) => item.id === clientId);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        client_id: clientId,
        date,
        valid_until: validUntil,
        line_items: lines,
        discount_type: discountType,
        discount_value: discountValue,
        notes,
        terms,
      };
      return quote ? api.patch(`/quotes/${quote.id}`, body) : api.post<{ id: string }>('/quotes', body);
    },
    onSuccess: (result) => {
      toast.success(quote ? t('common.save') : t('quotes.new'));
      navigate(`/devis/${quote?.id ?? (result as { id: string }).id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!clientId) next.client_id = t('validation.required');
    if (lines.some((line) => !line.description.trim())) next.lines = t('validation.required');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate();
  };

  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        breadcrumb={<Link to="/devis" className="inline-flex items-center gap-1 hover:text-brand-700"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('quotes.title')}</Link>}
        title={quote ? `${t('quotes.edit')} · ${quote.number}` : t('quotes.new')}
        actions={
          <>
            <Link to={quote ? `/devis/${quote.id}` : '/devis'} className="btn btn-secondary">{t('common.cancel')}</Link>
            <Button type="submit" loading={save.isPending} icon={<Save className="h-4 w-4" aria-hidden="true" />}>{t('common.save')}</Button>
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <SectionCard title={t('invoices.lines')} bodyClassName="p-5 sm:p-6">
            <LineItemsEditor lines={lines} onChange={setLines} products={products.data?.data ?? []} currency={currency} />
            {errors.lines ? <p className="field-error">{errors.lines}</p> : null}
          </SectionCard>
          <SectionCard title={t('common.notes')} bodyClassName="grid gap-4 p-5 sm:grid-cols-2">
            <Field label={t('invoices.notesClient')} htmlFor="quote_notes">
              <Textarea id="quote_notes" rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
            <Field label={t('invoices.terms')} htmlFor="quote_terms">
              <Textarea id="quote_terms" rows={4} value={terms} onChange={(event) => setTerms(event.target.value)} />
            </Field>
          </SectionCard>
        </div>
        <div className="space-y-4">
          <SectionCard title={t('invoices.client')} bodyClassName="space-y-4 p-5">
            <Field label={t('invoices.client')} htmlFor="client_id" required error={errors.client_id}>
              <Select id="client_id" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
                <option value="">{t('common.none')}</option>
                {(clients.data?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.display_name}</option>)}
              </Select>
            </Field>
            <FormGrid columns={1}>
              <Field label={t('common.date')} htmlFor="quote_date">
                <Input id="quote_date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </Field>
              <Field label={t('quotes.validUntil')} htmlFor="valid_until">
                <Input id="valid_until" type="date" value={validUntil} onChange={(event) => setValidUntil(event.target.value)} />
              </Field>
            </FormGrid>
          </SectionCard>
          <SectionCard title={t('common.discount')} bodyClassName="grid grid-cols-2 gap-3 p-5">
            <Field label={t('invoices.discountType')} htmlFor="quote_discount_type">
              <Select id="quote_discount_type" value={discountType} onChange={(event) => { setDiscountType(event.target.value as 'percent' | 'amount'); setDiscountValue(0); }}>
                <option value="percent">{t('invoices.discountPercent')}</option>
                <option value="amount">{t('invoices.discountAmount')}</option>
              </Select>
            </Field>
            <Field label={t('invoices.discountValue')} htmlFor="quote_discount_value">
              <Input
                id="quote_discount_value"
                type="number"
                min="0"
                value={discountType === 'percent' ? discountValue / 100 : discountValue}
                onChange={(event) => setDiscountValue(discountType === 'percent' ? Math.round(Number(event.target.value) * 100) : Number(event.target.value))}
              />
            </Field>
          </SectionCard>
          <TotalsPanel lines={lines} discountType={discountType} discountValue={discountValue} taxExempt={Boolean(client?.is_tax_exempt)} currency={currency} />
        </div>
      </div>
    </form>
  );
}

export function QuoteFormPage() {
  const { id } = useParams();
  const quote = useQuery({
    queryKey: ['quote', id],
    queryFn: () => api.get<Quote>(`/quotes/${id}`),
    enabled: Boolean(id),
  });
  if (id && quote.isLoading) return <Skeleton className="h-96" />;
  return <QuoteEditor key={id ?? 'new'} quote={quote.data} />;
}
