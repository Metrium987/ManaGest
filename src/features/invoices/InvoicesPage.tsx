import { useEffect, useDeferredValue, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Copy, Download, Eye, Pencil, Plus, Receipt, Trash2 } from 'lucide-react';
import { api, downloadPdf, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import type { InvoiceSummary, ListResponse } from '@/lib/types';
import { DOCUMENT_STATUSES } from '@shared/domain';
import {
  EmptyState, PageHeader, Pagination, SectionCard, Skeleton, StatusBadge,
} from '@/components/ui/Layout';
import { SearchInput, Select } from '@/components/ui/Form';
import { useConfirm } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { SavedFilterBar } from '@/components/domain/SavedFilterBar';

export function InvoicesPage() {
  const { company, can } = useSession();
  const [params] = useSearchParams();
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const clientId = params.get('client_id') ?? '';
  const currency = company?.currency ?? 'XPF';

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [menuId, setMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close the row menu when clicking away or when the list re-renders.
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const invoices = useQuery({
    queryKey: ['invoices', deferredSearch, status, page, clientId],
    queryFn: () =>
      api.get<ListResponse<InvoiceSummary>>(
        `/invoices${toQuery({ q: deferredSearch, status, page, client_id: clientId })}`,
      ),
  });

  const duplicate = useMutation({
    mutationFn: (id: string) => api.post<{ id: string }>(`/invoices/${id}/duplicate`),
    onSuccess: (result) => {
      toast.success(t('invoices.duplicate'));
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      navigate(`/factures/${result.id}`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/invoices/${id}`),
    onSuccess: () => {
      toast.success(t('invoices.deleteConfirm'));
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const runPdf = (invoice: InvoiceSummary) => {
    downloadPdf(`/invoices/${invoice.id}/pdf`, `${invoice.number}.pdf`).catch(() =>
      toast.error(t('errors.generic')),
    );
  };

  const openMenu = (id: string) => setMenuId((current) => (current === id ? null : id));

  return (
    <>
      <div className="mb-3">
        <SavedFilterBar list="invoices" query={search} onApply={(value) => { setSearch(value); setPage(1); }} />
      </div>
      <PageHeader
        title={t('invoices.title')}
        subtitle={t('invoices.subtitle')}
        actions={<>
          <ExportCsvButton entity="invoices" />
          {can('invoices.write') ? (
          <Link to="/factures/nouvelle" className="btn btn-primary">
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('invoices.new')}
          </Link>
        ) : null}
        </>}
      />

      <SectionCard
        title={t('invoices.title')}
        subtitle={invoices.data ? `${invoices.data.meta.total} ${t('common.results')}` : undefined}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={t('invoices.searchPlaceholder')} className="sm:w-64" />
            <Select
              aria-label={t('common.status')}
              value={status}
              onChange={(event) => { setStatus(event.target.value); setPage(1); }}
              className="sm:w-44"
            >
              <option value="">{t('common.all')}</option>
              {DOCUMENT_STATUSES.map((value) => (
                <option key={value} value={value}>{t(`status.${value}`)}</option>
              ))}
              <option value="overdue">{t('status.overdue')}</option>
            </Select>
          </div>
        }
        bodyClassName="table-wrap"
      >
        {invoices.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : invoices.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('invoices.number')}</th>
                <th scope="col">{t('invoices.client')}</th>
                <th scope="col">{t('common.date')}</th>
                <th scope="col">{t('common.dueDate')}</th>
                <th scope="col" className="text-right">{t('common.total')}</th>
                <th scope="col" className="text-right">{t('common.balance')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('rowActions.label')}</span></th>
              </tr>
            </thead>
            <tbody>
              {invoices.data.data.map((invoice) => {
                const deletable =
                  can('invoices.delete') &&
                  invoice.status !== 'paid' &&
                  invoice.status !== 'partial' &&
                  invoice.status !== 'cancelled';
                return (
                  <tr key={invoice.id}>
                    <td>
                      <Link to={`/factures/${invoice.id}`} className="font-medium text-brand-700 hover:underline">
                        {invoice.number}
                      </Link>
                    </td>
                    <td className="text-ink-900">{invoice.client_name}</td>
                    <td className="text-muted">{formatDate(invoice.date)}</td>
                    <td className={invoice.overdue ? 'font-medium text-danger-600' : 'text-muted'}>
                      {formatDate(invoice.due_date)}
                    </td>
                    <td className="text-right tabular-nums">{formatMoney(invoice.total, currency)}</td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(invoice.balance, currency)}</td>
                    <td>
                      <div className="flex flex-wrap items-center gap-1">
                        <StatusBadge status={invoice.status} />
                        {invoice.overdue ? <StatusBadge status="overdue" /> : null}
                      </div>
                    </td>
                    <td className="text-right">
                      <div className="relative inline-block" ref={menuId === invoice.id ? menuRef : undefined}>
                        <button
                          type="button"
                          className="rounded-lg px-2 py-1 text-sm font-medium text-muted hover:bg-surface hover:text-ink-900"
                          aria-label={t('rowActions.label')}
                          aria-haspopup="menu"
                          aria-expanded={menuId === invoice.id}
                          onClick={() => openMenu(invoice.id)}
                        >
                          ⋯
                        </button>
                        {menuId === invoice.id ? (
                          <div
                            className="absolute right-0 top-9 z-30 w-56 overflow-hidden rounded-xl border border-line bg-white py-1 text-left shadow-[var(--shadow-pop)]"
                            role="menu"
                          >
                            <Link to={`/factures/${invoice.id}`} role="menuitem" className="flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-surface" onClick={() => setMenuId(null)}>
                              <Eye className="h-4 w-4 text-muted" aria-hidden="true" /> {t('rowActions.view')}
                            </Link>
                            {invoice.status === 'draft' && can('invoices.write') ? (
                              <Link to={`/factures/${invoice.id}/modifier`} role="menuitem" className="flex items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-surface" onClick={() => setMenuId(null)}>
                                <Pencil className="h-4 w-4 text-muted" aria-hidden="true" /> {t('rowActions.edit')}
                              </Link>
                            ) : null}
                            <button
                              type="button"
                              role="menuitem"
                              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-surface"
                              onClick={() => { setMenuId(null); runPdf(invoice); }}
                            >
                              <Download className="h-4 w-4 text-muted" aria-hidden="true" /> {t('rowActions.pdf')}
                            </button>
                            {can('invoices.write') ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2.5 px-3.5 py-2 text-sm hover:bg-surface"
                                onClick={() => { setMenuId(null); duplicate.mutate(invoice.id); }}
                              >
                                <Copy className="h-4 w-4 text-muted" aria-hidden="true" /> {t('rowActions.duplicate')}
                              </button>
                            ) : null}
                            {deletable ? (
                              <button
                                type="button"
                                role="menuitem"
                                className="flex w-full items-center gap-2.5 border-t border-line px-3.5 py-2 text-sm text-danger-600 hover:bg-danger-50"
                                onClick={async () => {
                                  setMenuId(null);
                                  if (await confirm({
                                    title: t('invoices.deleteConfirm'),
                                    description: t('invoices.deleteConfirm'),
                                    danger: true,
                                    confirmLabel: t('common.delete'),
                                  })) remove.mutate(invoice.id);
                                }}
                              >
                                <Trash2 className="h-4 w-4" aria-hidden="true" /> {t('common.delete')}
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={<Receipt className="h-6 w-6" aria-hidden="true" />}
            title={t('invoices.empty')}
            action={can('invoices.write') ? (
              <Link to="/factures/nouvelle" className="btn btn-primary">{t('invoices.new')}</Link>
            ) : undefined}
          />
        )}
        {invoices.data ? (
          <Pagination page={page} totalPages={invoices.data.meta.total_pages} total={invoices.data.meta.total} onChange={setPage} />
        ) : null}
      </SectionCard>
    </>
  );
}
