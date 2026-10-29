import { useState } from 'react';
import { useNewRecordFlag } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Paperclip, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { PAYMENT_METHODS } from '@shared/domain';
import { toMinor } from '@shared/money';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import type { Client, Expense, ListResponse, Vendor } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { AttachmentsPanel } from '@/components/domain/AttachmentsPanel';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';

export function ExpensesPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const currency = company?.currency ?? 'XPF';
  const [category, setCategory] = useState('');
  // T-107: the list is a setting, not a constant.
  const categoryList = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get<{ categories: { key: string; label: string; archived: number }[] }>('/settings/expense-categories'),
  });
  const categoryOptions = (categoryList.data?.categories ?? []).filter((item) => !item.archived);
  const categoryLabel = (key: string) =>
    categoryList.data?.categories.find((item) => item.key === key)?.label ?? t(`categories.${key}`);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const startNew = useNewRecordFlag();
  const [open, setOpen] = useState(startNew);
  const [attachmentsFor, setAttachmentsFor] = useState<Expense | null>(null);
  const [form, setForm] = useState({
    vendor_id: '', client_id: '', category: 'other', date: todayISO(),
    amount: 0, tax_amount: 0, payment_method: 'transfer', reference: '', notes: '', is_billable: false,
  });

  const expenses = useQuery({
    queryKey: ['expenses', category, from, to],
    queryFn: () => api.get<ListResponse<Expense>>(`/expenses${toQuery({ category, from, to, per_page: 100 })}`),
  });
  const vendors = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => api.get<ListResponse<Vendor>>('/vendors?per_page=100') });
  const clients = useQuery({ queryKey: ['clients', 'options'], queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100') });

  const create = useMutation({
    mutationFn: () =>
      api.post('/expenses', {
        ...form,
        vendor_id: form.vendor_id || null,
        client_id: form.client_id || null,
        amount: toMinor(form.amount, currency),
        tax_amount: toMinor(form.tax_amount, currency),
      }),
    onSuccess: () => {
      toast.success(t('expenses.new'));
      setOpen(false);
      setForm({ vendor_id: '', client_id: '', category: 'other', date: todayISO(), amount: 0, tax_amount: 0, payment_method: 'transfer', reference: '', notes: '', is_billable: false });
      queryClient.invalidateQueries({ queryKey: ['expenses'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const total = (expenses.data?.data ?? []).reduce((sum, expense) => sum + expense.amount, 0);

  return (
    <>
      <PageHeader
        title={t('expenses.title')}
        subtitle={t('expenses.subtitle')}
        actions={<>
          <ExportCsvButton entity="expenses" />
          {can('expenses.write') ? <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('expenses.new')}</Button> : null}
        </>}
      />

      <SectionCard
        title={t('expenses.title')}
        subtitle={`${t('expenses.totalPeriod')} : ${formatMoney(total, currency)}`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Input aria-label={t('common.from')} type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="sm:w-40" />
            <Input aria-label={t('common.to')} type="date" value={to} onChange={(event) => setTo(event.target.value)} className="sm:w-40" />
            <Select aria-label={t('expenses.category')} value={category} onChange={(event) => setCategory(event.target.value)} className="sm:w-44">
              <option value="">{t('common.all')}</option>
              {categoryOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
            </Select>
          </div>
        }
        bodyClassName="table-wrap"
      >
        {expenses.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : expenses.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.date')}</th>
                <th scope="col">{t('expenses.category')}</th>
                <th scope="col">{t('expenses.vendor')}</th>
                <th scope="col">{t('common.reference')}</th>
                <th scope="col" className="text-right">{t('common.amount')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {expenses.data.data.map((expense) => (
                <tr key={expense.id}>
                  <td className="text-muted">{formatDate(expense.date)}</td>
                  <td>{categoryLabel(expense.category)}</td>
                  <td className="text-muted">{expense.vendor_name ?? '—'}</td>
                  <td className="text-muted">{expense.reference ?? '—'}</td>
                  <td className="text-right font-medium tabular-nums">{formatMoney(expense.amount, currency)}</td>
                  <td className="text-right">
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                      aria-label={`${t('attachments.title')} — ${expense.reference ?? formatDate(expense.date)}`}
                      onClick={() => setAttachmentsFor(expense)}
                    >
                      <Paperclip className="h-4 w-4" aria-hidden="true" />
                    </button>
                    {can('expenses.delete') ? (
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                        aria-label={t('common.delete')}
                        onClick={async () => {
                          if (await confirm({ title: t('common.delete'), description: expense.reference ?? '', danger: true, confirmLabel: t('common.delete') })) remove.mutate(expense.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<ShoppingCart className="h-6 w-6" aria-hidden="true" />} title={t('expenses.empty')} />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('expenses.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t('common.date')} htmlFor="expense_date">
              <Input id="expense_date" type="date" value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} />
            </Field>
            <Field label={t('expenses.category')} htmlFor="expense_category">
              <Select id="expense_category" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })}>
                {categoryOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}
              </Select>
            </Field>
            <Field label={t('common.amount')} htmlFor="expense_amount">
              <Input id="expense_amount" type="number" min="0" value={form.amount || ''} onChange={(event) => setForm({ ...form, amount: Number(event.target.value) })} />
            </Field>
            <Field label={t('common.tax')} htmlFor="expense_tax">
              <Input id="expense_tax" type="number" min="0" value={form.tax_amount || ''} onChange={(event) => setForm({ ...form, tax_amount: Number(event.target.value) })} />
            </Field>
            <Field label={t('expenses.vendor')} htmlFor="expense_vendor">
              <Select id="expense_vendor" value={form.vendor_id} onChange={(event) => setForm({ ...form, vendor_id: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {(vendors.data?.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </Select>
            </Field>
            <Field label={t('payments.method')} htmlFor="expense_method">
              <Select id="expense_method" value={form.payment_method} onChange={(event) => setForm({ ...form, payment_method: event.target.value })}>
                {PAYMENT_METHODS.map((value) => <option key={value} value={value}>{t(`methods.${value}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('invoices.client')} htmlFor="expense_client">
              <Select id="expense_client" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {(clients.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
              </Select>
            </Field>
            <Field label={t('common.reference')} htmlFor="expense_reference">
              <Input id="expense_reference" value={form.reference} onChange={(event) => setForm({ ...form, reference: event.target.value })} />
            </Field>
          </FormGrid>
          <Checkbox label={t('expenses.billable')} checked={form.is_billable} onChange={(event) => setForm({ ...form, is_billable: event.target.checked })} />
          <Field label={t('common.notes')} htmlFor="expense_notes">
            <Textarea id="expense_notes" value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(attachmentsFor)}
        onClose={() => setAttachmentsFor(null)}
        title={t('attachments.title')}
        description={attachmentsFor ? `${formatDate(attachmentsFor.date)} — ${formatMoney(attachmentsFor.amount, currency)}` : undefined}
        size="lg"
      >
        {attachmentsFor ? (
          <AttachmentsPanel entity="expense" entityId={attachmentsFor.id} canWrite={can('expenses.write')} />
        ) : null}
      </Modal>
    </>
  );
}
