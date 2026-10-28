import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pause, Play, Plus, RefreshCw } from 'lucide-react';
import { FREQUENCIES } from '@shared/domain';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import type { Client, LineItem, ListResponse, RecurringInvoice } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { LineItemsEditor, emptyLine } from '@/components/domain/LineItemsEditor';
import { useToast } from '@/components/ui/Toast';

export function RecurringPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const currency = company?.currency ?? 'XPF';
  const [open, setOpen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [frequency, setFrequency] = useState('monthly');
  const [interval, setInterval] = useState(1);
  const [nextRun, setNextRun] = useState(todayISO());
  const [autoSend, setAutoSend] = useState(true);
  const [lines, setLines] = useState<LineItem[]>([emptyLine(company?.default_tax_rate ?? 16)]);

  const recurring = useQuery({
    queryKey: ['recurring'],
    queryFn: () => api.get<ListResponse<RecurringInvoice>>('/recurring-invoices?per_page=100'),
  });
  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100'),
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['recurring'] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post('/recurring-invoices', {
        client_id: clientId,
        frequency,
        interval_count: interval,
        next_run_date: nextRun,
        auto_send: autoSend,
        line_items: lines,
        discount_type: 'percent',
        discount_value: 0,
      }),
    onSuccess: () => {
      toast.success(t('recurring.new'));
      setOpen(false);
      setClientId('');
      setLines([emptyLine(company?.default_tax_rate ?? 16)]);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const run = useMutation({
    mutationFn: (id: string) => api.post<{ number: string }>(`/recurring-invoices/${id}/run`),
    onSuccess: (result) => {
      toast.success(t('recurring.generated', { number: result.number }));
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const status = useMutation({
    mutationFn: ({ id, value }: { id: string; value: 'active' | 'paused' }) =>
      api.post(`/recurring-invoices/${id}/status`, { status: value }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/recurring-invoices/${id}`),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('recurring.title')}
        subtitle={t('recurring.subtitle')}
        actions={can('recurring.write') ? <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('recurring.new')}</Button> : null}
      />

      <SectionCard title={t('recurring.title')} bodyClassName="table-wrap">
        {recurring.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : recurring.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('invoices.client')}</th>
                <th scope="col">{t('recurring.frequency')}</th>
                <th scope="col">{t('recurring.nextRun')}</th>
                <th scope="col" className="text-right">{t('recurring.remainingCycles')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {recurring.data.data.map((item) => (
                <tr key={item.id}>
                  <td className="font-medium">{item.client_name}</td>
                  <td className="text-muted">
                    {t(`frequencies.${item.frequency}`)} · {t('recurring.interval')} {item.interval_count}
                  </td>
                  <td className="text-muted">{formatDate(item.next_run_date)}</td>
                  <td className="text-right tabular-nums">{item.remaining_cycles ?? t('recurring.unlimited')}</td>
                  <td><StatusBadge status={item.status} /></td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      {can('recurring.write') ? (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={run.isPending}
                            onClick={async () => {
                              if (await confirm({ title: t('recurring.runNow'), description: t('recurring.runConfirm'), confirmLabel: t('common.confirm') })) run.mutate(item.id);
                            }}
                            icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            {t('recurring.runNow')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => status.mutate({ id: item.id, value: item.status === 'active' ? 'paused' : 'active' })}
                            icon={item.status === 'active' ? <Pause className="h-3.5 w-3.5" aria-hidden="true" /> : <Play className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            {item.status === 'active' ? t('recurring.pause') : t('recurring.activate')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger-600 hover:bg-danger-50"
                            onClick={async () => {
                              if (await confirm({ title: t('common.delete'), description: t('common.delete'), danger: true, confirmLabel: t('common.delete') })) remove.mutate(item.id);
                            }}
                          >
                            {t('common.delete')}
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={<RefreshCw className="h-6 w-6" aria-hidden="true" />}
            title={t('recurring.empty')}
            action={can('recurring.write') ? <Button onClick={() => setOpen(true)}>{t('recurring.new')}</Button> : undefined}
          />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('recurring.new')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t('invoices.client')} htmlFor="recurring_client" required>
              <Select id="recurring_client" value={clientId} onChange={(event) => setClientId(event.target.value)}>
                <option value="">{t('common.none')}</option>
                {(clients.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
              </Select>
            </Field>
            <Field label={t('recurring.nextRun')} htmlFor="next_run">
              <Input id="next_run" type="date" value={nextRun} onChange={(event) => setNextRun(event.target.value)} />
            </Field>
            <Field label={t('recurring.frequency')} htmlFor="frequency">
              <Select id="frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)}>
                {FREQUENCIES.map((value) => <option key={value} value={value}>{t(`frequencies.${value}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('recurring.interval')} htmlFor="interval">
              <Input id="interval" type="number" min="1" max="12" value={interval} onChange={(event) => setInterval(Number(event.target.value))} />
            </Field>
          </FormGrid>
          <LineItemsEditor lines={lines} onChange={setLines} products={[]} currency={currency} />
          <Checkbox label={t('recurring.autoSend')} checked={autoSend} onChange={(event) => setAutoSend(event.target.checked)} />
        </div>
      </Modal>

      {recurring.data ? (
        <p className="mt-3 text-xs text-muted">
          {t('recurring.subtitle')} · {formatMoney(recurring.data.data.reduce((sum, item) => sum + (item.generated_total ?? 0), 0), currency)}
        </p>
      ) : null}
    </>
  );
}
