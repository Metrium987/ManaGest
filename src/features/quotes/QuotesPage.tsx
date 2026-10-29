import { SavedFilterBar } from '@/components/domain/SavedFilterBar';
import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { FileText, Plus } from 'lucide-react';
import { QUOTE_STATUSES } from '@shared/domain';
import { api, toQuery } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import type { ListResponse, QuoteSummary } from '@/lib/types';
import { EmptyState, PageHeader, Pagination, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { SearchInput, Select } from '@/components/ui/Form';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';

export function QuotesPage() {
  const { company, can } = useSession();
  const currency = company?.currency ?? 'XPF';
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);

  const quotes = useQuery({
    queryKey: ['quotes', deferred, status, page],
    queryFn: () => api.get<ListResponse<QuoteSummary>>(`/quotes${toQuery({ q: deferred, status, page })}`),
  });

  return (
    <>
      <div className="mb-3">
        <SavedFilterBar list="quotes" query={search} onApply={(value) => { setSearch(value); setPage(1); }} />
      </div>
      <PageHeader
        title={t('quotes.title')}
        subtitle={t('quotes.subtitle')}
        actions={<>
          <ExportCsvButton entity="quotes" />
          {can('quotes.write') ? (
          <Link to="/devis/nouveau" className="btn btn-primary">
            <Plus className="h-4 w-4" aria-hidden="true" /> {t('quotes.new')}
          </Link>
        ) : null}
        </>}
      />

      <SectionCard
        title={t('quotes.title')}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <SearchInput value={search} onChange={(value) => { setSearch(value); setPage(1); }} placeholder={t('quotes.searchPlaceholder')} className="sm:w-60" />
            <Select aria-label={t('common.status')} value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} className="sm:w-40">
              <option value="">{t('common.all')}</option>
              {QUOTE_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
            </Select>
          </div>
        }
        bodyClassName="table-wrap"
      >
        {quotes.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : quotes.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('invoices.number')}</th>
                <th scope="col">{t('invoices.client')}</th>
                <th scope="col">{t('common.date')}</th>
                <th scope="col">{t('quotes.validUntil')}</th>
                <th scope="col" className="text-right">{t('common.total')}</th>
                <th scope="col">{t('common.status')}</th>
              </tr>
            </thead>
            <tbody>
              {quotes.data.data.map((quote) => (
                <tr key={quote.id}>
                  <td><Link to={`/devis/${quote.id}`} className="font-medium text-brand-700 hover:underline">{quote.number}</Link></td>
                  <td>{quote.client_name}</td>
                  <td className="text-muted">{formatDate(quote.date)}</td>
                  <td className="text-muted">{formatDate(quote.valid_until)}</td>
                  <td className="text-right font-medium tabular-nums">{formatMoney(quote.total, currency)}</td>
                  <td><StatusBadge status={quote.status} />{quote.expired ? <StatusBadge status="expired" /> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState
            icon={<FileText className="h-6 w-6" aria-hidden="true" />}
            title={t('quotes.empty')}
            action={can('quotes.write') ? <Link to="/devis/nouveau" className="btn btn-primary">{t('quotes.new')}</Link> : undefined}
          />
        )}
        {quotes.data ? <Pagination page={page} totalPages={quotes.data.meta.total_pages} total={quotes.data.meta.total} onChange={setPage} /> : null}
      </SectionCard>
    </>
  );
}
