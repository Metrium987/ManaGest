import { useDeferredValue, useState, type FormEvent } from 'react';
import { useNewRecordFlag } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Wallet } from 'lucide-react';
import { PAYMENT_METHODS } from '@shared/domain';
import { toMinor } from '@shared/money';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import type { Client, ListResponse, PaymentSummary } from '@/lib/types';
import { EmptyState, PageHeader, Pagination, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, SearchInput, Select } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';

export function PaymentsPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const currency = company?.currency ?? 'XPF';
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const startNew = useNewRecordFlag();
  const [open, setOpen] = useState(startNew);

  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState(0);
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [autoApply, setAutoApply] = useState(true);
  const [error, setError] = useState('');

  const payments = useQuery({
    queryKey: ['payments', deferred, page],
    queryFn: () => api.get<ListResponse<PaymentSummary>>(`/payments${toQuery({ q: deferred, page })}`),
  });

  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100'),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/payments', {
        client_id: clientId,
        date,
        amount: toMinor(amount, currency),
        method,
        reference,
        auto_apply: autoApply,
        allocations: [],
      }),
    onSuccess: () => {
      toast.success(t('payments.new'));
      setOpen(false);
      setClientId('');
      setAmount(0);
      setReference('');
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const voidPayment = useMutation({
    mutationFn: (id: string) => api.delete(`/payments/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      toast.success(t('payments.voidConfirm'));
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!clientId || amount <= 0) {
      setError(t('validation.required'));
      return;
    }
    create.mutate();
  };

  return (
    <>
      <PageHeader
        title={t('payments.title')}
        subtitle={t('payments.subtitle')}
        actions={<>
          <ExportCsvButton entity="payments" />
          {can('payments.write') ? (
          <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('payments.new')}</Button>
        ) : null}
        </>}
      />

      <SectionCard
        title={t('payments.title')}
        actions={<SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={t('nav.search')} className="w-full sm:w-64" />}
        bodyClassName="table-wrap"
      >
        {payments.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : payments.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.reference')}</th>
                <th scope="col">{t('invoices.client')}</th>
                <th scope="col">{t('common.date')}</th>
                <th scope="col">{t('payments.method')}</th>
                <th scope="col" className="text-right">{t('common.amount')}</th>
                <th scope="col" className="text-right">{t('payments.applied')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {payments.data.data.map((payment) => (
                <tr key={payment.id}>
                  <td className="font-medium">{payment.number}</td>
                  <td>{payment.client_name}</td>
                  <td className="text-muted">{formatDate(payment.date)}</td>
                  <td className="text-muted">{t(`methods.${payment.method}`)}</td>
                  <td className="text-right font-medium tabular-nums">{formatMoney(payment.amount, currency)}</td>
                  <td className="text-right tabular-nums text-muted">{formatMoney(payment.applied ?? 0, currency)}</td>
                  <td className="text-right">
                    {can('payments.delete') ? (
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                        aria-label={`${t('common.delete')} ${payment.number}`}
                        onClick={async () => {
                          if (await confirm({ title: t('common.delete'), description: t('payments.voidConfirm'), danger: true, confirmLabel: t('common.confirm') })) {
                            voidPayment.mutate(payment.id);
                          }
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
          <EmptyState
            icon={<Wallet className="h-6 w-6" aria-hidden="true" />}
            title={t('payments.empty')}
            action={can('payments.write') ? <Button onClick={() => setOpen(true)}>{t('payments.new')}</Button> : undefined}
          />
        )}
        {payments.data ? <Pagination page={page} totalPages={payments.data.meta.total_pages} total={payments.data.meta.total} onChange={setPage} /> : null}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('payments.new')}
        description={t('payments.amountHint')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          {error ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">{error}</p> : null}
          <Field label={t('invoices.client')} htmlFor="payment_client" required>
            <Select id="payment_client" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
              <option value="">{t('common.none')}</option>
              {(clients.data?.data ?? []).map((client) => (
                <option key={client.id} value={client.id}>{client.display_name}</option>
              ))}
            </Select>
          </Field>
          <FormGrid>
            <Field label={t('common.date')} htmlFor="payment_date">
              <Input id="payment_date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label={t('common.amount')} htmlFor="payment_amount" required>
              <Input
                id="payment_amount"
                type="number"
                min="0"
                step={currency === 'XPF' ? '1' : '0.01'}
                value={amount || ''}
                onChange={(event) => setAmount(Number(event.target.value))}
                required
              />
            </Field>
            <Field label={t('payments.method')} htmlFor="payment_method">
              <Select id="payment_method" value={method} onChange={(event) => setMethod(event.target.value)}>
                {PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>{t(`methods.${value}`)}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('common.reference')} htmlFor="payment_reference">
              <Input id="payment_reference" value={reference} onChange={(event) => setReference(event.target.value)} />
            </Field>
          </FormGrid>
          <Checkbox
            label={t('payments.autoApply')}
            checked={autoApply}
            onChange={(event) => setAutoApply(event.target.checked)}
          />
        </form>
      </Modal>
    </>
  );
}
