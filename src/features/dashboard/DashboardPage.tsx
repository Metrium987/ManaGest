import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, CalendarClock, FileText, Plus, Receipt, Users, Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import {
  formatDate, formatLongDate, formatMoney, percentageChange, relativeDays,
} from '@/lib/format';
import type { DashboardData } from '@/lib/types';
import { PageHeader, SectionCard, Skeleton, StatCard, StatusBadge } from '@/components/ui/Layout';
import { RevenueChart } from '@/components/ui/Chart';
import { Button } from '@/components/ui/Button';

function activityLabel(summary: string, meta: string | null): string {
  const template = t(`activityMessages.${summary}`);
  if (template === `activityMessages.${summary}`) return summary;
  let vars: Record<string, string> = {};
  if (meta) {
    try {
      const parsed = JSON.parse(meta) as Record<string, unknown>;
      vars = Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key, String(value)]));
    } catch {
      vars = {};
    }
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '—');
}

export function DashboardPage() {
  const { user, company, can } = useSession();
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
  });

  const data = dashboard.data;
  const currency = company?.currency ?? 'XPF';
  const result = (data?.kpis.collected_month ?? 0) - (data?.kpis.expenses_month ?? 0);

  return (
    <>
      <PageHeader
        title={t('dashboard.greeting', { name: user?.first_name ?? '' })}
        subtitle={t('dashboard.subtitle', { date: data ? formatLongDate(data.today) : '…' })}
        actions={
          <>
            {can('quotes.write') ? (
              <Link to="/devis/nouveau" className="btn btn-secondary">
                <FileText className="h-4 w-4" aria-hidden="true" />
                {t('dashboard.newQuote')}
              </Link>
            ) : null}
            {can('invoices.write') ? (
              <Link to="/factures/nouvelle" className="btn btn-primary">
                <Plus className="h-4 w-4" aria-hidden="true" />
                {t('dashboard.newInvoice')}
              </Link>
            ) : null}
          </>
        }
      />

      {dashboard.isLoading || !data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-28" />)}
          <Skeleton className="h-80 sm:col-span-2 xl:col-span-3" />
          <Skeleton className="h-80" />
        </div>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              label={t('dashboard.invoicedMonth')}
              value={formatMoney(data.kpis.invoiced_month, currency)}
              trend={{ value: percentageChange(data.kpis.invoiced_month, data.kpis.invoiced_previous) ?? 0, label: t('dashboard.vsPrevious') }}
              accent="brand"
            />
            <StatCard
              label={t('dashboard.collectedMonth')}
              value={formatMoney(data.kpis.collected_month, currency)}
              trend={{ value: percentageChange(data.kpis.collected_month, data.kpis.collected_previous) ?? 0, label: t('dashboard.vsPrevious') }}
              accent="success"
            />
            <StatCard
              label={t('dashboard.outstanding')}
              value={formatMoney(data.kpis.outstanding, currency)}
              hint={`${data.kpis.open_invoices} ${t('dashboard.openInvoices').toLowerCase()}`}
              accent="warning"
            />
            <StatCard
              label={t('dashboard.overdue')}
              value={formatMoney(data.kpis.overdue, currency)}
              hint={`${t('dashboard.expensesMonth')} : ${formatMoney(data.kpis.expenses_month, currency)}`}
              accent={data.kpis.overdue > 0 ? 'danger' : 'brand'}
            />
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <section className="card xl:col-span-2">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-ink-950">{t('dashboard.chartTitle')}</h2>
                  <p className="text-xs text-muted">{t('dashboard.chartSubtitle')}</p>
                </div>
                <div className="text-right">
                  <p className="text-[11px] uppercase tracking-wider text-muted">{t('dashboard.resultMonth')}</p>
                  <p className={`font-display text-lg font-semibold ${result >= 0 ? 'text-success-600' : 'text-danger-600'}`}>
                    {formatMoney(result, currency)}
                  </p>
                </div>
              </header>
              <div className="p-4 sm:p-5">
                <RevenueChart data={data.series} />
              </div>
            </section>

            <div className="space-y-4">
              <SectionCard
                title={t('dashboard.upcoming')}
                actions={<CalendarClock className="h-4 w-4 text-muted" aria-hidden="true" />}
                bodyClassName="divide-y divide-line"
              >
                {data.upcoming.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted">{t('dashboard.empty')}</p>
                ) : (
                  data.upcoming.map((invoice) => {
                    const days = relativeDays(invoice.due_date);
                    return (
                      <Link key={invoice.id} to={`/factures/${invoice.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface/60">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-ink-900">{invoice.number}</p>
                          <p className="text-xs text-muted">
                            {formatDate(invoice.due_date)}
                            {days !== null ? ` · ${days < 0 ? t('invoices.overdueLabel', { days: Math.abs(days) }) : t('invoices.dueIn', { days })}` : ''}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold tabular-nums">{formatMoney(invoice.balance, currency)}</span>
                      </Link>
                    );
                  })
                )}
              </SectionCard>

              <SectionCard title={t('dashboard.topClients')} bodyClassName="divide-y divide-line">
                {data.top_clients.length === 0 ? (
                  <p className="px-5 py-6 text-sm text-muted">{t('dashboard.empty')}</p>
                ) : (
                  data.top_clients.map((client, index) => (
                    <div key={client.id} className="flex items-center gap-3 px-5 py-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">
                        {index + 1}
                      </span>
                      <Link to={`/clients/${client.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:text-brand-700">
                        {client.client_name}
                      </Link>
                      <span className="text-sm font-semibold tabular-nums">{formatMoney(client.revenue, currency)}</span>
                    </div>
                  ))
                )}
              </SectionCard>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-3">
            <SectionCard
              title={t('dashboard.recentInvoices')}
              className="xl:col-span-2"
              actions={<Link to="/factures" className="text-xs font-semibold text-brand-700 hover:underline">{t('common.seeAll')}</Link>}
              bodyClassName="table-wrap"
            >
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('invoices.number')}</th>
                    <th scope="col">{t('invoices.client')}</th>
                    <th scope="col">{t('common.date')}</th>
                    <th scope="col" className="text-right">{t('common.total')}</th>
                    <th scope="col">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent_invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td>
                        <Link to={`/factures/${invoice.id}`} className="font-medium text-brand-700 hover:underline">
                          {invoice.number}
                        </Link>
                      </td>
                      <td className="text-ink-900">{invoice.client_name}</td>
                      <td className="text-muted">{formatDate(invoice.date)}</td>
                      <td className="text-right font-medium tabular-nums">{formatMoney(invoice.total, currency)}</td>
                      <td><StatusBadge status={invoice.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {data.recent_invoices.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-muted">{t('invoices.empty')}</p>
              ) : null}
            </SectionCard>

            <SectionCard
              title={t('dashboard.activity')}
              actions={<ArrowUpRight className="h-4 w-4 text-muted" aria-hidden="true" />}
              bodyClassName="divide-y divide-line"
            >
              {data.activities.length === 0 ? (
                <p className="px-5 py-6 text-sm text-muted">{t('dashboard.noActivity')}</p>
              ) : (
                data.activities.slice(0, 6).map((entry) => (
                  <div key={entry.id} className="px-5 py-3">
                    <p className="text-sm text-ink-900">{activityLabel(entry.summary, entry.meta)}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {entry.first_name ? `${entry.first_name} ${entry.last_name ?? ''} · ` : ''}
                      {formatDate(entry.created_at)}
                    </p>
                  </div>
                ))
              )}
            </SectionCard>
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { to: '/clients', label: t('dashboard.newClient'), icon: Users, show: can('clients.write') },
              { to: '/factures/nouvelle', label: t('dashboard.newInvoice'), icon: Receipt, show: can('invoices.write') },
              { to: '/depenses', label: t('dashboard.newExpense'), icon: Wallet, show: can('expenses.write') },
              { to: '/rapports', label: t('nav.reports'), icon: ArrowUpRight, show: can('reports.read') },
            ].filter((action) => action.show).map((action) => {
              const Icon = action.icon;
              return (
                <Link
                  key={action.to}
                  to={action.to}
                  className="card flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-ink-900 transition hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  {action.label}
                  <ArrowUpRight className="ml-auto h-4 w-4 text-muted" aria-hidden="true" />
                </Link>
              );
            })}
          </div>
        </>
      )}

      {dashboard.isError ? (
        <div className="card mt-4 border-danger-200 bg-danger-50 p-4 text-sm text-danger-700" role="alert">
          {t('errors.generic')}
          <Button variant="secondary" size="sm" className="ml-3" onClick={() => dashboard.refetch()}>
            {t('common.next')}
          </Button>
        </div>
      ) : null}
    </>
  );
}
