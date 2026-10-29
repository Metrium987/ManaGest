import { useDeferredValue, useState, type FormEvent } from 'react';
import { useNewRecordFlag } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plus, Users } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatMoney } from '@/lib/format';
import type { Client, ListResponse } from '@/lib/types';
import { PageHeader, EmptyState, Pagination, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, SearchInput, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { SavedFilterBar } from '@/components/domain/SavedFilterBar';

interface ClientFormState {
  display_name: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postal_code: string;
  tax_id: string;
  payment_terms: number;
  is_tax_exempt: boolean;
  notes: string;
}

const EMPTY: ClientFormState = {
  display_name: '', first_name: '', last_name: '', email: '', phone: '', address1: '',
  city: '', postal_code: '', tax_id: '', payment_terms: 30, is_tax_exempt: false, notes: '',
};

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
  const [form, setForm] = useState<ClientFormState>(
    client
      ? {
          display_name: client.display_name,
          first_name: client.first_name ?? '',
          last_name: client.last_name ?? '',
          email: client.email ?? '',
          phone: client.phone ?? '',
          address1: client.address1 ?? '',
          city: client.city ?? '',
          postal_code: client.postal_code ?? '',
          tax_id: client.tax_id ?? '',
          payment_terms: client.payment_terms,
          is_tax_exempt: Boolean(client.is_tax_exempt),
          notes: client.notes ?? '',
        }
      : EMPTY,
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () =>
      client
        ? api.patch(`/clients/${client.id}`, form)
        : api.post<{ id: string }>('/clients', form),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      queryClient.invalidateQueries({ queryKey: ['client', client?.id] });
      toast.success(client ? t('clients.edit') : t('clients.new'));
      onSaved?.(client?.id ?? (result as { id: string })?.id ?? '');
      onClose();
    },
    onError: (error) => {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next: Record<string, string> = {};
    if (!form.display_name.trim()) next.display_name = t('validation.required');
    if (form.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email)) next.email = t('errors.invalid_string');
    setErrors(next);
    if (Object.keys(next).length) return;
    save.mutate();
  };

  const set = <K extends keyof ClientFormState>(key: K, value: ClientFormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={client ? t('clients.edit') : t('clients.new')}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={submit} loading={save.isPending}>{t('common.save')}</Button>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <FormGrid>
          <Field label={t('clients.displayName')} htmlFor="display_name" required error={errors.display_name}>
            <Input
              id="display_name"
              value={form.display_name}
              onChange={(event) => set('display_name', event.target.value)}
              required
              autoFocus
            />
          </Field>
          <Field label={t('clients.tahitiNumber')} htmlFor="tax_id">
            <Input id="tax_id" value={form.tax_id} onChange={(event) => set('tax_id', event.target.value.toUpperCase())} maxLength={6} placeholder="T12345" />
          </Field>
          <Field label={t('common.firstName')} htmlFor="first_name">
            <Input id="first_name" value={form.first_name} onChange={(event) => set('first_name', event.target.value)} />
          </Field>
          <Field label={t('common.lastName')} htmlFor="last_name">
            <Input id="last_name" value={form.last_name} onChange={(event) => set('last_name', event.target.value)} />
          </Field>
          <Field label={t('common.email')} htmlFor="email" error={errors.email}>
            <Input id="email" type="email" value={form.email} onChange={(event) => set('email', event.target.value)} />
          </Field>
          <Field label={t('common.phone')} htmlFor="phone">
            <Input id="phone" value={form.phone} onChange={(event) => set('phone', event.target.value)} />
          </Field>
          <Field label={t('common.address')} htmlFor="address1" className="sm:col-span-2">
            <Input id="address1" value={form.address1} onChange={(event) => set('address1', event.target.value)} />
          </Field>
          <Field label={t('common.postalCode')} htmlFor="postal_code">
            <Input id="postal_code" value={form.postal_code} onChange={(event) => set('postal_code', event.target.value)} />
          </Field>
          <Field label={t('common.city')} htmlFor="city">
            <Input id="city" value={form.city} onChange={(event) => set('city', event.target.value)} />
          </Field>
          <Field label={t('clients.paymentTerms')} htmlFor="payment_terms">
            <Input
              id="payment_terms"
              type="number"
              min="0"
              max="365"
              value={form.payment_terms}
              onChange={(event) => set('payment_terms', Number(event.target.value))}
            />
          </Field>
          <div className="flex items-end pb-2">
            <Checkbox
              label={t('clients.taxExempt')}
              checked={form.is_tax_exempt}
              onChange={(event) => set('is_tax_exempt', event.target.checked)}
            />
          </div>
        </FormGrid>
        <Field label={t('common.notes')} htmlFor="notes">
          <Textarea id="notes" value={form.notes} onChange={(event) => set('notes', event.target.value)} />
        </Field>
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
                <th scope="col">{t('common.city')}</th>
                <th scope="col">{t('common.email')}</th>
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
                    {client.tax_id ? <p className="text-xs text-muted">TAHITI {client.tax_id}</p> : null}
                  </td>
                  <td className="text-muted">{client.city ?? '—'}</td>
                  <td className="text-muted">{client.email ?? '—'}</td>
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
