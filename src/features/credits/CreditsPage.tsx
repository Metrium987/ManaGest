import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditCard, Plus } from 'lucide-react';
import { toMinor } from '@shared/money';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import type { Client, ClientDetail, CreditSummary, ListResponse } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';

export function CreditsPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [createOpen, setCreateOpen] = useState(false);
  const [applyCredit, setApplyCredit] = useState<CreditSummary | null>(null);
  const [clientId, setClientId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState(0);
  const [taxRate, setTaxRate] = useState(company?.default_tax_rate ?? 16);
  const [invoiceId, setInvoiceId] = useState('');
  const [applyAmount, setApplyAmount] = useState(0);

  const credits = useQuery({
    queryKey: ['credits'],
    queryFn: () => api.get<ListResponse<CreditSummary>>('/credits?per_page=100'),
  });
  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100'),
  });
  const clientInvoices = useQuery({
    queryKey: ['client', applyCredit?.client_id],
    queryFn: () => api.get<ClientDetail>(`/clients/${applyCredit!.client_id}`),
    enabled: Boolean(applyCredit),
  });

  const create = useMutation({
    mutationFn: () =>
      api.post('/credits', {
        client_id: clientId,
        date,
        line_items: [
          {
            id: crypto.randomUUID(),
            description: description || t('credits.title'),
            quantity: 1,
            unit_price: toMinor(amount, currency),
            tax_rate: taxRate,
          },
        ],
        discount_type: 'percent',
        discount_value: 0,
      }),
    onSuccess: () => {
      toast.success(t('credits.new'));
      setCreateOpen(false);
      setClientId('');
      setDescription('');
      setAmount(0);
      queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const apply = useMutation({
    mutationFn: () =>
      api.post(`/credits/${applyCredit?.id}/apply`, { invoice_id: invoiceId, amount: toMinor(applyAmount, currency) }),
    onSuccess: () => {
      toast.success(t('credits.apply'));
      setApplyCredit(null);
      setInvoiceId('');
      setApplyAmount(0);
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <>
      <PageHeader
        title={t('credits.title')}
        subtitle={t('credits.subtitle')}
        actions={<>
          <ExportCsvButton entity="credits" />
          {can('credits.write') ? <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('credits.new')}</Button> : null}
        </>}
      />

      <SectionCard title={t('credits.title')} bodyClassName="table-wrap">
        {credits.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : credits.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('invoices.number')}</th>
                <th scope="col">{t('invoices.client')}</th>
                <th scope="col">{t('common.date')}</th>
                <th scope="col" className="text-right">{t('common.total')}</th>
                <th scope="col" className="text-right">{t('credits.remaining')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {credits.data.data.map((credit) => (
                <tr key={credit.id}>
                  <td className="font-medium">{credit.number}</td>
                  <td>{credit.client_name}</td>
                  <td className="text-muted">{formatDate(credit.date)}</td>
                  <td className="text-right tabular-nums">{formatMoney(credit.total, currency)}</td>
                  <td className="text-right tabular-nums">{formatMoney(credit.balance, currency)}</td>
                  <td><StatusBadge status={credit.status} /></td>
                  <td className="text-right">
                    {credit.balance > 0 && can('credits.write') ? (
                      <Button variant="secondary" size="sm" onClick={() => { setApplyCredit(credit); setApplyAmount(credit.balance / (10 ** (currency === 'XPF' ? 0 : 2))); }}>
                        {t('credits.apply')}
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<CreditCard className="h-6 w-6" aria-hidden="true" />} title={t('credits.empty')} />
        )}
      </SectionCard>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('credits.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} onClick={submit}>{t('common.save')}</Button>
          </>
        }
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label={t('invoices.client')} htmlFor="credit_client" required>
            <Select id="credit_client" value={clientId} onChange={(event) => setClientId(event.target.value)} required>
              <option value="">{t('common.none')}</option>
              {(clients.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
            </Select>
          </Field>
          <FormGrid>
            <Field label={t('common.date')} htmlFor="credit_date">
              <Input id="credit_date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label={t('common.amount')} htmlFor="credit_amount" required>
              <Input id="credit_amount" type="number" min="0" value={amount || ''} onChange={(event) => setAmount(Number(event.target.value))} required />
            </Field>
            <Field label={t('invoices.lineTax')} htmlFor="credit_tax">
              <Select id="credit_tax" value={taxRate} onChange={(event) => setTaxRate(Number(event.target.value))}>
                {[16, 13, 5, 0].map((rate) => <option key={rate} value={rate}>{rate} %</option>)}
              </Select>
            </Field>
            <Field label={t('common.description')} htmlFor="credit_description">
              <Input id="credit_description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </Field>
          </FormGrid>
        </form>
      </Modal>

      <Modal
        open={Boolean(applyCredit)}
        onClose={() => setApplyCredit(null)}
        title={t('credits.apply')}
        description={applyCredit ? `${applyCredit.number} · ${formatMoney(applyCredit.balance, currency)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setApplyCredit(null)}>{t('common.cancel')}</Button>
            <Button loading={apply.isPending} onClick={() => apply.mutate()}>{t('common.confirm')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('bank.selectInvoice')} htmlFor="apply_invoice">
            <Select id="apply_invoice" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
              <option value="">{t('common.none')}</option>
              {(clientInvoices.data?.invoices ?? []).filter((invoice) => invoice.balance > 0).map((invoice) => (
                <option key={invoice.id} value={invoice.id}>{invoice.number} — {formatMoney(invoice.balance, currency)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.amount')} htmlFor="apply_amount">
            <Input id="apply_amount" type="number" min="0" value={applyAmount || ''} onChange={(event) => setApplyAmount(Number(event.target.value))} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
