import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Ban, BellRing, CheckCircle2, Copy, Download, FileMinus, Pencil, Send, Trash2, Wallet,
} from 'lucide-react';
import { PAYMENT_METHODS } from '@shared/domain';
import { api, downloadPdf } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import type { Invoice } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { Field, Select, Input, Textarea } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';

export function InvoiceDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { company, can } = useSession();
  const currency = company?.currency ?? 'XPF';
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [method, setMethod] = useState('transfer');
  const [reference, setReference] = useState('');
  const [refundOpen, setRefundOpen] = useState(false);
  const [refundAmount, setRefundAmount] = useState('');
  const [refundNote, setRefundNote] = useState('');

  const invoice = useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get<Invoice>(`/invoices/${id}`),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['invoice', id] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
    queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    queryClient.invalidateQueries({ queryKey: ['payments'] });
  };

  // T-005 (BK-002 manual half, OQ-020): a reminder is a recorded, manual act;
  // no email is sent until a mail provider is configured (PDF + "sent" status).
  const remind = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/remind`),
    onSuccess: () => {
      toast.success(t('invoices.reminded'));
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['activity'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // T-004 (OQ-012): a refund is a credit note, never a payment reversal.
  const refund = useMutation({
    mutationFn: () =>
      api.post<{ id: string; number: string; amount: number }>(`/invoices/${id}/credit-note`, {
        amount: Number(refundAmount),
        notes: refundNote.trim() || null,
      }),
    onSuccess: (result) => {
      toast.success(t('invoices.creditNoteCreated', { number: result.number }));
      setRefundOpen(false);
      setRefundAmount('');
      setRefundNote('');
      invalidate();
      queryClient.invalidateQueries({ queryKey: ['credits'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const action = useMutation({
    mutationFn: async (name: 'send' | 'cancel' | 'duplicate') => {
      if (name === 'duplicate') return api.post<{ id: string }>(`/invoices/${id}/duplicate`);
      return api.post(`/invoices/${id}/${name}`);
    },
    onSuccess: (result, name) => {
      if (name === 'duplicate' && result && typeof result === 'object' && 'id' in result) {
        toast.success(t('invoices.duplicate'));
        navigate(`/factures/${(result as { id: string }).id}`);
        return;
      }
      toast.success(name === 'send' ? t('invoices.sent') : t('invoices.cancelInvoice'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const markPaid = useMutation({
    mutationFn: () => api.post(`/invoices/${id}/mark-paid`, { method, reference }),
    onSuccess: () => {
      toast.success(t('dashboard.collected'));
      setPaymentOpen(false);
      setReference('');
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      toast.success(t('invoices.deleteConfirm'));
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      navigate('/factures');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (invoice.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  }
  if (!invoice.data) {
    return <EmptyState title={t('errors.NOT_FOUND')} action={<Link to="/factures" className="btn btn-secondary">{t('common.back')}</Link>} />;
  }

  const data = invoice.data;
  const isLocked = data.status === 'paid' || data.status === 'cancelled' || data.paid_total > 0;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/factures" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('invoices.title')}
          </Link>
        }
        title={`${t('invoices.number')} ${data.number ?? '—'}`}
        subtitle={`${data.client_name} · ${formatDate(data.date)}`}
        actions={
          <>
            <StatusBadge status={data.overdue ? 'overdue' : data.status} />
            <Button
              variant="secondary"
              icon={<Download className="h-4 w-4" aria-hidden="true" />}
              onClick={() => downloadPdf(`/invoices/${data.id}/pdf`, `${data.number}.pdf`).catch(() => toast.error(t('errors.generic')))}
            >
              {t('invoices.pdf')}
            </Button>
            {data.status === 'draft' && can('invoices.write') ? (
              <Button variant="secondary" loading={action.isPending} onClick={() => action.mutate('send')} icon={<Send className="h-4 w-4" aria-hidden="true" />}>
                {t('invoices.send')}
              </Button>
            ) : null}
            {data.balance > 0 && data.status !== 'cancelled' && can('payments.write') ? (
              <Button onClick={() => setPaymentOpen(true)} icon={<Wallet className="h-4 w-4" aria-hidden="true" />}>
                {t('invoices.markPaid')}
              </Button>
            ) : null}
            {data.overdue && can('invoices.write') ? (
              <Button
                variant="secondary"
                loading={remind.isPending}
                onClick={() => remind.mutate()}
                icon={<BellRing className="h-4 w-4" aria-hidden="true" />}
              >
                {t('invoices.remind')}
              </Button>
            ) : null}
            {['paid', 'partial'].includes(data.status) && can('credits.write') ? (
              <Button
                variant="secondary"
                icon={<FileMinus className="h-4 w-4" aria-hidden="true" />}
                onClick={() => {
                  setRefundAmount(String(data.status === 'paid' ? data.paid_total : data.balance));
                  setRefundOpen(true);
                }}
              >
                {t('invoices.creditNote')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <section className="card overflow-hidden">
            <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line bg-surface/40 px-5 py-4">
              <div>
                <p className="text-xs uppercase tracking-wider text-muted">{t('invoices.client')}</p>
                <Link to={`/clients/${data.client_id}`} className="mt-1 block font-display text-lg font-semibold text-ink-950 hover:text-brand-700">
                  {data.client_name}
                </Link>
                <p className="mt-1 text-xs text-muted">{[data.client_address1, data.client_city].filter(Boolean).join(', ')}</p>
                {data.client_tax_id ? <p className="text-xs text-muted">TAHITI {data.client_tax_id}</p> : null}
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div><dt className="text-xs text-muted">{t('invoices.issueDate')}</dt><dd className="font-medium">{formatDate(data.date)}</dd></div>
                <div><dt className="text-xs text-muted">{t('common.dueDate')}</dt><dd className="font-medium">{formatDate(data.due_date)}</dd></div>
                {data.po_number ? <div><dt className="text-xs text-muted">{t('invoices.poNumber')}</dt><dd className="font-medium">{data.po_number}</dd></div> : null}
                <div><dt className="text-xs text-muted">{t('common.status')}</dt><dd className="font-medium">{t(`status.${data.status}`)}</dd></div>
              </dl>
            </div>

            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('invoices.lineDescription')}</th>
                    <th scope="col" className="text-right">{t('invoices.lineQuantity')}</th>
                    <th scope="col" className="text-right">{t('invoices.linePrice')}</th>
                    <th scope="col" className="text-right">{t('invoices.lineTax')}</th>
                    <th scope="col" className="text-right">{t('invoices.lineTotal')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.line_items.map((line) => (
                    <tr key={line.id}>
                      <td className="font-medium text-ink-900">{line.description}</td>
                      <td className="text-right tabular-nums">{line.quantity}</td>
                      <td className="text-right tabular-nums">{formatMoney(line.unit_price, currency)}</td>
                      <td className="text-right tabular-nums">{data.tax_exempt ? '—' : `${line.tax_rate} %`}</td>
                      <td className="text-right font-medium tabular-nums">{formatMoney(Math.round(line.unit_price * line.quantity), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end border-t border-line px-5 py-4">
              <dl className="w-full max-w-xs space-y-2 text-sm">
                <div className="flex justify-between"><dt className="text-muted">{t('common.subtotal')}</dt><dd className="tabular-nums">{formatMoney(data.subtotal, currency)}</dd></div>
                {data.discount_total > 0 ? (
                  <div className="flex justify-between"><dt className="text-muted">{t('common.discount')}</dt><dd className="tabular-nums text-danger-600">− {formatMoney(data.discount_total, currency)}</dd></div>
                ) : null}
                {data.tax_buckets.map((bucket) => (
                  <div key={bucket.rate} className="flex justify-between">
                    <dt className="text-muted">{t('common.tax')} {bucket.rate} %</dt>
                    <dd className="tabular-nums">{formatMoney(bucket.amount, currency)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>Total TTC</dt><dd className="tabular-nums">{formatMoney(data.total, currency)}</dd></div>
                <div className="flex justify-between"><dt className="text-muted">{t('dashboard.collected')}</dt><dd className="tabular-nums">{formatMoney(data.paid_total, currency)}</dd></div>
                <div className="flex justify-between text-base font-semibold text-ink-950"><dt>{t('common.balance')}</dt><dd className="tabular-nums">{formatMoney(data.balance, currency)}</dd></div>
              </dl>
            </div>
          </section>

          {data.notes ? (
            <SectionCard title={t('common.notes')}>
              <p className="whitespace-pre-line px-5 py-4 text-sm text-ink-900">{data.notes}</p>
            </SectionCard>
          ) : null}

          <SectionCard title={t('invoices.payments')} bodyClassName="divide-y divide-line">
            {data.payments.length === 0 ? (
              <p className="px-5 py-6 text-sm text-muted">{t('clients.noPayments')}</p>
            ) : (
              data.payments.map((payment) => (
                <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{payment.payment_number}</p>
                    <p className="text-xs text-muted">{formatDate(payment.date)} · {t(`methods.${payment.method}`)}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{formatMoney(payment.amount, currency)}</p>
                </div>
              ))
            )}
          </SectionCard>
        </div>

        <div className="space-y-4">
          <SectionCard title={t('common.actions')} bodyClassName="space-y-2 p-4">
            {data.status === 'draft' && can('invoices.write') ? (
              <Link to={`/factures/${data.id}/modifier`} className="btn btn-secondary w-full justify-start">
                <Pencil className="h-4 w-4" aria-hidden="true" /> {t('common.edit')}
              </Link>
            ) : null}
            <Button
              variant="secondary"
              className="w-full justify-start"
              onClick={() => action.mutate('duplicate')}
              loading={action.isPending}
              icon={<Copy className="h-4 w-4" aria-hidden="true" />}
            >
              {t('invoices.duplicate')}
            </Button>
            {data.status !== 'cancelled' && !isLocked && can('invoices.write') ? (
              <Button
                variant="secondary"
                className="w-full justify-start"
                onClick={async () => {
                  if (await confirm({ title: t('invoices.cancelInvoice'), description: t('invoices.cancelConfirm'), danger: true, confirmLabel: t('common.confirm') })) {
                    action.mutate('cancel');
                  }
                }}
                icon={<Ban className="h-4 w-4" aria-hidden="true" />}
              >
                {t('invoices.cancelInvoice')}
              </Button>
            ) : null}
            {can('invoices.delete') && data.paid_total === 0 ? (
              <Button
                variant="ghost"
                className="w-full justify-start text-danger-600 hover:bg-danger-50"
                onClick={async () => {
                  if (await confirm({ title: t('invoices.deleteConfirm'), description: t('invoices.deleteConfirm'), danger: true, confirmLabel: t('common.delete') })) {
                    remove.mutate();
                  }
                }}
                icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
              >
                {t('common.delete')}
              </Button>
            ) : null}
          </SectionCard>

          <SectionCard title={t('invoices.taxBreakdown')} bodyClassName="divide-y divide-line">
            {data.tax_exempt ? (
              <p className="px-5 py-4 text-sm text-muted">{t('invoices.taxExemptNote')}</p>
            ) : data.tax_buckets.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted">{t('common.none')}</p>
            ) : (
              data.tax_buckets.map((bucket) => (
                <div key={bucket.rate} className="flex items-center justify-between px-5 py-3 text-sm">
                  <span>{t('common.tax')} {bucket.rate} % <span className="text-xs text-muted">({formatMoney(bucket.base, currency)})</span></span>
                  <span className="font-medium tabular-nums">{formatMoney(bucket.amount, currency)}</span>
                </div>
              ))
            )}
          </SectionCard>

          <div className="card p-4 text-xs text-muted">
            <p className="font-semibold text-ink-900">{data.terms ? t('invoices.terms') : t('common.none')}</p>
            {data.terms ? <p className="mt-1 whitespace-pre-line">{data.terms}</p> : null}
          </div>
        </div>
      </div>

      <Modal
        open={refundOpen}
        onClose={() => setRefundOpen(false)}
        title={t('invoices.creditNote')}
        description={t('invoices.creditNoteHint')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRefundOpen(false)}>{t('common.cancel')}</Button>
            <Button
              loading={refund.isPending}
              disabled={!(Number(refundAmount) > 0)}
              onClick={() => refund.mutate()}
              icon={<FileMinus className="h-4 w-4" aria-hidden="true" />}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('invoices.creditNoteAmount')} htmlFor="refund-amount" required>
            <Input
              id="refund-amount"
              type="number"
              min={1}
              max={data.status === 'paid' ? data.paid_total : data.balance}
              step={1}
              value={refundAmount}
              onChange={(event) => setRefundAmount(event.target.value)}
            />
          </Field>
          <Field label={t('invoices.creditNoteReason')} htmlFor="refund-note">
            <Textarea
              id="refund-note"
              rows={3}
              value={refundNote}
              onChange={(event) => setRefundNote(event.target.value)}
            />
          </Field>
          <p className="rounded-lg bg-surface px-3 py-2 text-xs text-muted">
            {t('invoices.creditNoteHint')}
          </p>
        </div>
      </Modal>

      <Modal
        open={paymentOpen}
        onClose={() => setPaymentOpen(false)}
        title={t('invoices.markPaid')}
        description={t('invoices.paidConfirm', { amount: formatMoney(data.balance, currency) })}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPaymentOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={markPaid.isPending} onClick={() => markPaid.mutate()} icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('payments.method')} htmlFor="method">
            <Select id="method" value={method} onChange={(event) => setMethod(event.target.value)}>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>{t(`methods.${value}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('common.reference')} htmlFor="reference">
            <Input id="reference" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Virement, chèque n°…" />
          </Field>
          <p className="rounded-lg bg-surface px-3 py-2 text-sm">
            {t('common.amount')} : <strong>{formatMoney(data.balance, currency)}</strong>
          </p>
        </div>
      </Modal>
    </>
  );
}
