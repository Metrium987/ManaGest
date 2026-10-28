import { useDeferredValue, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil, Plus, Trash2 } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatMoney } from '@/lib/format';
import type { ListResponse, Vendor } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, SearchInput, Textarea } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface VendorForm {
  name: string;
  email: string;
  phone: string;
  address1: string;
  city: string;
  postal_code: string;
  tax_id: string;
  notes: string;
}

const EMPTY: VendorForm = { name: '', email: '', phone: '', address1: '', city: '', postal_code: '', tax_id: '', notes: '' };

export function VendorsPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const currency = company?.currency ?? 'XPF';
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Vendor | null>(null);
  const [form, setForm] = useState<VendorForm>(EMPTY);

  const vendors = useQuery({
    queryKey: ['vendors', deferred],
    queryFn: () => api.get<ListResponse<Vendor>>(`/vendors${toQuery({ q: deferred, per_page: 100 })}`),
  });

  const openForm = (vendor?: Vendor) => {
    setEditing(vendor ?? null);
    setForm(vendor ? {
      name: vendor.name, email: vendor.email ?? '', phone: vendor.phone ?? '', address1: vendor.address1 ?? '',
      city: vendor.city ?? '', postal_code: vendor.postal_code ?? '', tax_id: vendor.tax_id ?? '', notes: vendor.notes ?? '',
    } : EMPTY);
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => (editing ? api.patch(`/vendors/${editing.id}`, form) : api.post('/vendors', form)),
    onSuccess: () => {
      toast.success(editing ? t('common.save') : t('vendors.new'));
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['vendors'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/vendors/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['vendors'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('vendors.title')}
        subtitle={t('vendors.subtitle')}
        actions={can('vendors.write') ? <Button onClick={() => openForm()} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('vendors.new')}</Button> : null}
      />

      <SectionCard
        title={t('vendors.title')}
        actions={<SearchInput value={search} onChange={setSearch} placeholder={t('common.search')} className="w-full sm:w-64" />}
        bodyClassName="table-wrap"
      >
        {vendors.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : vendors.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('common.city')}</th>
                <th scope="col">{t('common.email')}</th>
                <th scope="col" className="text-right">{t('vendors.orders')}</th>
                <th scope="col" className="text-right">{t('vendors.totalPurchases')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {vendors.data.data.map((vendor) => (
                <tr key={vendor.id}>
                  <td className="font-medium">{vendor.name}</td>
                  <td className="text-muted">{vendor.city ?? '—'}</td>
                  <td className="text-muted">{vendor.email ?? '—'}</td>
                  <td className="text-right tabular-nums">{vendor.po_count ?? 0}</td>
                  <td className="text-right tabular-nums">{formatMoney(vendor.po_total ?? 0, currency)}</td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {can('vendors.write') ? (
                        <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('common.edit')} ${vendor.name}`} onClick={() => openForm(vendor)}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      {can('vendors.delete') ? (
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                          aria-label={`${t('common.delete')} ${vendor.name}`}
                          onClick={async () => {
                            if (await confirm({ title: t('common.delete'), description: vendor.name, danger: true, confirmLabel: t('common.delete') })) remove.mutate(vendor.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Building2 className="h-6 w-6" aria-hidden="true" />} title={t('vendors.empty')} />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('common.edit') : t('vendors.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t('common.name')} htmlFor="vendor_name" required>
              <Input id="vendor_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label={t('common.email')} htmlFor="vendor_email">
              <Input id="vendor_email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
            </Field>
            <Field label={t('common.phone')} htmlFor="vendor_phone">
              <Input id="vendor_phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} />
            </Field>
            <Field label={t('clients.tahitiNumber')} htmlFor="vendor_tax">
              <Input id="vendor_tax" value={form.tax_id} onChange={(event) => setForm({ ...form, tax_id: event.target.value.toUpperCase() })} maxLength={6} />
            </Field>
            <Field label={t('common.address')} htmlFor="vendor_address" className="sm:col-span-2">
              <Input id="vendor_address" value={form.address1} onChange={(event) => setForm({ ...form, address1: event.target.value })} />
            </Field>
            <Field label={t('common.postalCode')} htmlFor="vendor_postal">
              <Input id="vendor_postal" value={form.postal_code} onChange={(event) => setForm({ ...form, postal_code: event.target.value })} />
            </Field>
            <Field label={t('common.city')} htmlFor="vendor_city">
              <Input id="vendor_city" value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} />
            </Field>
          </FormGrid>
          <Field label={t('common.notes')} htmlFor="vendor_notes">
            <Textarea id="vendor_notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
