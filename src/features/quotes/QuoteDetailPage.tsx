import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, FileCheck2, Pencil, Send, Trash2, XCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import type { Quote } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export function QuoteDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const { company, can } = useSession();
  const currency = company?.currency ?? 'XPF';

  const quote = useQuery({ queryKey: ['quote', id], queryFn: () => api.get<Quote>(`/quotes/${id}`), enabled: Boolean(id) });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['quote', id] });
    queryClient.invalidateQueries({ queryKey: ['quotes'] });
  };

  const action = useMutation({
    mutationFn: (name: string) => api.post(`/quotes/${id}/${name}`),
    onSuccess: (_data, name) => {
      toast.success(t(`quotes.${name === 'send' ? 'send' : name === 'approve' ? 'approve' : 'reject'}`));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const convert = useMutation({
    mutationFn: () => api.post<{ id: string; number: string }>(`/quotes/${id}/convert`),
    onSuccess: (result) => {
      toast.success(t('quotes.converted'));
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/factures/${result.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: () => api.delete(`/quotes/${id}`),
    onSuccess: () => navigate('/devis'),
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (quote.isLoading) return <Skeleton className="h-96" />;
  if (!quote.data) return <EmptyState title={t('errors.NOT_FOUND')} />;
  const data = quote.data;

  return (
    <>
      <PageHeader
        breadcrumb={<Link to="/devis" className="inline-flex items-center gap-1 hover:text-brand-700"><ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('quotes.title')}</Link>}
        title={`${t('invoices.number')} ${data.number ?? '—'}`}
        subtitle={`${data.client_name} · ${formatDate(data.date)}`}
        actions={
          <>
            <StatusBadge status={data.status} />
            {data.expired ? <StatusBadge status="expired" /> : null}
            {data.status === 'draft' && can('quotes.write') ? (
              <Button variant="secondary" onClick={() => action.mutate('send')} loading={action.isPending} icon={<Send className="h-4 w-4" aria-hidden="true" />}>{t('quotes.send')}</Button>
            ) : null}
            {data.status === 'sent' && can('quotes.write') ? (
              <>
                <Button variant="secondary" onClick={() => action.mutate('approve')} loading={action.isPending} icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}>{t('quotes.approve')}</Button>
                <Button variant="ghost" onClick={() => action.mutate('reject')} loading={action.isPending} icon={<XCircle className="h-4 w-4" aria-hidden="true" />}>{t('quotes.reject')}</Button>
              </>
            ) : null}
            {['sent', 'approved'].includes(data.status) && can('invoices.write') ? (
              <Button
                onClick={async () => {
                  if (await confirm({ title: t('quotes.convert'), description: t('quotes.convertConfirm'), confirmLabel: t('common.confirm') })) convert.mutate();
                }}
                loading={convert.isPending}
                icon={<FileCheck2 className="h-4 w-4" aria-hidden="true" />}
              >
                {t('quotes.convert')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <section className="card overflow-hidden">
          <div className="border-b border-line bg-surface/40 px-5 py-4">
            <p className="text-xs uppercase tracking-wider text-muted">{t('invoices.client')}</p>
            <Link to={`/clients/${data.client_id}`} className="mt-1 block font-display text-lg font-semibold hover:text-brand-700">{data.client_name}</Link>
            <p className="mt-1 text-xs text-muted">{data.client_email ?? ''}</p>
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
                    <td className="font-medium">{line.description}</td>
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
              {data.discount_total > 0 ? <div className="flex justify-between"><dt className="text-muted">{t('common.discount')}</dt><dd className="tabular-nums">− {formatMoney(data.discount_total, currency)}</dd></div> : null}
              <div className="flex justify-between"><dt className="text-muted">{t('common.tax')}</dt><dd className="tabular-nums">{formatMoney(data.tax_total, currency)}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total TTC</dt><dd className="tabular-nums">{formatMoney(data.total, currency)}</dd></div>
            </dl>
          </div>
        </section>

        <div className="space-y-4">
          <SectionCard title={t('common.details')} bodyClassName="divide-y divide-line text-sm">
            <div className="flex justify-between px-5 py-3"><span className="text-muted">{t('quotes.validUntil')}</span><span className="font-medium">{formatDate(data.valid_until)}</span></div>
            <div className="flex justify-between px-5 py-3"><span className="text-muted">{t('common.date')}</span><span className="font-medium">{formatDate(data.date)}</span></div>
            <div className="flex justify-between px-5 py-3"><span className="text-muted">{t('common.status')}</span><StatusBadge status={data.status} /></div>
          </SectionCard>

          {data.status !== 'converted' && data.status !== 'rejected' && can('quotes.write') ? (
            <SectionCard title={t('common.actions')} bodyClassName="space-y-2 p-4">
              <Link to={`/devis/${data.id}/modifier`} className="btn btn-secondary w-full justify-start">
                <Pencil className="h-4 w-4" aria-hidden="true" /> {t('common.edit')}
              </Link>
              {can('quotes.delete') ? (
                <Button
                  variant="ghost"
                  className="w-full justify-start text-danger-600 hover:bg-danger-50"
                  icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  onClick={async () => {
                    if (await confirm({ title: t('common.delete'), description: t('common.delete'), danger: true, confirmLabel: t('common.delete') })) remove.mutate();
                  }}
                >
                  {t('common.delete')}
                </Button>
              ) : null}
            </SectionCard>
          ) : null}

          {data.notes ? (
            <div className="card p-4 text-sm"><p className="font-semibold">{t('common.notes')}</p><p className="mt-1 whitespace-pre-line text-muted">{data.notes}</p></div>
          ) : null}
        </div>
      </div>
    </>
  );
}
