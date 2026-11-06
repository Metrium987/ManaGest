import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowUpRight, CalendarClock, FileText, Plus, Receipt, Users, Wallet,
} from 'lucide-react';
import type { Permission } from '@shared/domain';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import {
  formatDate, formatLocale, formatLongDate, formatMoney, percentageChange, relativeDays,
} from '@/lib/format';
import type { DashboardData, ObservabilityData } from '@/lib/types';
import { PageHeader, SectionCard, Skeleton, StatCard, StatusBadge } from '@/components/ui/Layout';
import { RevenueChart } from '@/components/ui/Chart';
import { Button } from '@/components/ui/Button';

type KpiKey =
  | 'invoiced'
  | 'collected'
  | 'outstanding'
  | 'overdue'
  | 'expenses'
  | 'result'
  | 'clients';

type ActionKey = 'quote' | 'invoice' | 'client' | 'expense' | 'payments' | 'reports';

type VariantKey = 'pilotage' | 'finance' | 'commercial' | 'consultation';

interface DashboardVariant {
  /** Translation key of the view name, shown next to the date. */
  label: string;
  subtitle: string;
  kpis: KpiKey[];
  chart: boolean;
  dailyRun: boolean;
  topClients: boolean;
  upcoming: boolean;
  recentInvoices: boolean;
  activity: boolean;
  actions: ActionKey[];
}

/**
 * One dashboard per role. A salesperson opens on the commercial pipeline, an
 * accountant on cash and result, a read-only account on its own documents and
 * due dates. Owner and admin keep the full picture. Everything remains gated by
 * the permissions the server resolved for the session, so a variant can only
 * narrow what the role may already see.
 */
const VARIANTS: Record<VariantKey, DashboardVariant> = {
  pilotage: {
    label: 'dashboard.variants.pilotage.label',
    subtitle: 'dashboard.variants.pilotage.subtitle',
    kpis: ['invoiced', 'collected', 'outstanding', 'overdue'],
    chart: true,
    dailyRun: true,
    topClients: true,
    upcoming: true,
    recentInvoices: true,
    activity: true,
    actions: ['client', 'invoice', 'expense', 'reports'],
  },
  finance: {
    label: 'dashboard.variants.finance.label',
    subtitle: 'dashboard.variants.finance.subtitle',
    kpis: ['collected', 'expenses', 'result', 'overdue'],
    chart: true,
    dailyRun: true,
    topClients: false,
    upcoming: true,
    recentInvoices: true,
    activity: true,
    actions: ['expense', 'payments', 'reports'],
  },
  commercial: {
    label: 'dashboard.variants.commercial.label',
    subtitle: 'dashboard.variants.commercial.subtitle',
    kpis: ['invoiced', 'outstanding', 'clients', 'overdue'],
    chart: true,
    dailyRun: false,
    topClients: true,
    upcoming: true,
    recentInvoices: true,
    activity: false,
    actions: ['quote', 'invoice', 'client'],
  },
  consultation: {
    label: 'dashboard.variants.consultation.label',
    subtitle: 'dashboard.variants.consultation.subtitle',
    kpis: ['invoiced', 'outstanding', 'overdue'],
    chart: false,
    dailyRun: false,
    topClients: false,
    upcoming: true,
    recentInvoices: true,
    activity: false,
    actions: [],
  },
};

const ACTION_LINKS: Record<
  ActionKey,
  { to: string; label: string; icon: typeof Users; permission: Permission }
> = {
  quote: { to: '/devis/nouveau', label: 'dashboard.newQuote', icon: FileText, permission: 'quotes.write' },
  invoice: { to: '/factures/nouvelle', label: 'dashboard.newInvoice', icon: Plus, permission: 'invoices.write' },
  client: { to: '/clients', label: 'dashboard.newClient', icon: Users, permission: 'clients.write' },
  expense: { to: '/depenses', label: 'dashboard.newExpense', icon: Wallet, permission: 'expenses.write' },
  payments: { to: '/paiements', label: 'nav.payments', icon: Receipt, permission: 'payments.read' },
  reports: { to: '/rapports', label: 'nav.reports', icon: ArrowUpRight, permission: 'reports.read' },
};

function variantKeyFor(role: string | undefined): VariantKey {
  switch (role) {
    case 'owner':
    case 'admin':
      return 'pilotage';
    case 'accountant':
      return 'finance';
    case 'sales':
      return 'commercial';
    default:
      return 'consultation';
  }
}

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
  const queryClient = useQueryClient();
  const [runMessage, setRunMessage] = useState('');
  const dashboard = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get<DashboardData>('/dashboard'),
  });

  const runNow = useMutation({
    mutationFn: () => api.post<{ already_ran: boolean }>('/runs/daily/manual'),
    onSuccess: (result) => {
      setRunMessage(result.already_ran ? t('dailyRun.already') : t('dailyRun.done'));
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: () => setRunMessage(t('dailyRun.failedMessage')),
  });

  const data = dashboard.data;
  // A-25: the card is only requested by roles that may read activity or the books.
  const observability = useQuery({
    queryKey: ['observability'],
    queryFn: () => api.get<ObservabilityData>('/dashboard/observability'),
    retry: false,
    enabled: can('activity.read') || can('accounting.read'),
  });
  const currency = company?.currency ?? 'XPF';
  const result = (data?.kpis.collected_month ?? 0) - (data?.kpis.expenses_month ?? 0);
  const variant = VARIANTS[variantKeyFor(user?.role)];

  const kpiCard = (key: KpiKey) => {
    if (!data) return null;
    const k = data.kpis;
    switch (key) {
      case 'invoiced':
        return (
          <StatCard
            key={key}
            label={t('dashboard.invoicedMonth')}
            value={formatMoney(k.invoiced_month, currency)}
            trend={{
              value: percentageChange(k.invoiced_month, k.invoiced_previous) ?? 0,
              label: t('dashboard.vsPrevious'),
            }}
            accent="brand"
          />
        );
      case 'collected':
        return (
          <StatCard
            key={key}
            label={t('dashboard.collectedMonth')}
            value={formatMoney(k.collected_month, currency)}
            trend={{
              value: percentageChange(k.collected_month, k.collected_previous) ?? 0,
              label: t('dashboard.vsPrevious'),
            }}
            accent="success"
          />
        );
      case 'outstanding':
        return (
          <StatCard
            key={key}
            label={t('dashboard.outstanding')}
            value={formatMoney(k.outstanding, currency)}
            hint={`${k.open_invoices} ${t('dashboard.openInvoices').toLowerCase()}`}
            accent="warning"
          />
        );
      case 'overdue':
        return (
          <StatCard
            key={key}
            label={t('dashboard.overdue')}
            value={formatMoney(k.overdue, currency)}
            accent={k.overdue > 0 ? 'danger' : 'brand'}
          />
        );
      case 'expenses':
        return (
          <StatCard
            key={key}
            label={t('dashboard.expensesMonth')}
            value={formatMoney(k.expenses_month, currency)}
            accent="warning"
          />
        );
      case 'result':
        return (
          <StatCard
            key={key}
            label={t('dashboard.resultMonth')}
            value={formatMoney(result, currency)}
            hint={t('dashboard.resultHint')}
            accent={result >= 0 ? 'success' : 'danger'}
          />
        );
      case 'clients':
        return (
          <StatCard
            key={key}
            label={t('dashboard.clients')}
            value={String(k.clients)}
            hint={`${k.open_invoices} ${t('dashboard.openInvoices').toLowerCase()}`}
            accent="brand"
          />
        );
      default:
        return null;
    }
  };

  const actions = variant.actions.filter((action) => can(ACTION_LINKS[action].permission));
  const showRightColumn = variant.upcoming || variant.topClients;
  const showDocumentRow = variant.recentInvoices || variant.activity;

  return (
    <>
      <PageHeader
        title={t('dashboard.greeting', { name: user?.first_name ?? '' })}
        subtitle={`${t(variant.label)} · ${
          data ? t(variant.subtitle, { date: formatLongDate(data.today) }) : t(variant.label)
        }`}
        actions={
          can('invoices.write') || can('quotes.write') ? (
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
          ) : null
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
            {variant.kpis.map((key) => kpiCard(key))}
          </div>

          {observability.data ? (
            <div className="mt-4">
              <SectionCard title={t('observability.title')} subtitle={t('observability.subtitle')}>
                <div className="grid gap-3 p-5 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <p className="text-xs text-muted">{t('observability.integrity')}</p>
                    <p className="text-lg font-semibold">{observability.data.integrity_gaps}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('observability.stock')}</p>
                    <p className="text-lg font-semibold">{observability.data.stock_gaps}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('observability.backlog')}</p>
                    <p className="text-lg font-semibold">{observability.data.accounting.backlog}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('observability.lastRun')}</p>
                    <p className="text-lg font-semibold">
                      {observability.data.runs.last_status ? t(`dailyRun.status.${observability.data.runs.last_status}`) : t('observability.never')}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted">{t('observability.purge')}</p>
                    <p className="text-lg font-semibold">{observability.data.purge.last_at ? formatDate(observability.data.purge.last_at.slice(0, 10)) : t('observability.never')}</p>
                  </div>
                  <div className="sm:col-span-2 xl:col-span-3">
                    <p className="text-xs text-muted">{t('observability.biggest')}</p>
                    <p className="truncate text-sm">
                      {observability.data.largest_tables.slice(0, 3).map((table) => `${table.table} (${table.rows})`).join(' · ') || t('observability.never')}
                    </p>
                  </div>
                </div>
              </SectionCard>
            </div>
          ) : null}

          {variant.dailyRun ? (
            <div className="mt-4">
              <SectionCard
                title={t('dailyRun.title')}
                subtitle={t('dailyRun.hint')}
                actions={
                  can('recurring.write') ? (
                    <Button variant="secondary" loading={runNow.isPending} onClick={() => runNow.mutate()} icon={<CalendarClock className="h-4 w-4" aria-hidden="true" />}>
                      {t('dailyRun.runNow')}
                    </Button>
                  ) : null
                }
              >
                <div className="space-y-1 p-5">
                  {data.last_run ? (
                    <>
                      <p className="text-sm font-medium">
                        {t('dailyRun.statusLabel')} : {t(`dailyRun.status.${data.last_run.status}`)}
                        <span className="ml-2 text-xs font-normal text-muted">{formatDate(data.last_run.day)}</span>
                      </p>
                      {data.last_run.summary ? (
                        <p className="text-xs text-muted">
                          {t('dailyRun.counts', {
                            generated: data.last_run.summary.generated.length,
                            reminders: data.last_run.summary.reminders ?? 0,
                            failed: data.last_run.summary.failed.length,
                          })}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="text-sm text-muted">{t('dailyRun.never')}</p>
                  )}
                  {runMessage ? <p className="text-xs text-muted" role="status">{runMessage}</p> : null}
                </div>
              </SectionCard>
            </div>
          ) : null}

          {variant.chart || showRightColumn ? (
            <div className={`mt-4 grid gap-4 ${variant.chart ? 'xl:grid-cols-3' : ''}`}>
              {variant.chart ? (
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
              ) : null}

              {showRightColumn ? (
                <div className="space-y-4">
                  {variant.upcoming ? (
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
                  ) : null}

                  {data.stock_alerts && data.stock_alerts.top.length ? (
                    <SectionCard
                      title={t('dashboard.stockAlerts')}
                      subtitle={t('dashboard.stockAlertsSubtitle', {
                        out: data.stock_alerts.out,
                        low: data.stock_alerts.low,
                      })}
                      bodyClassName="divide-y divide-line"
                    >
                      {data.stock_alerts.top.map((alert) => (
                        <Link key={alert.product_id} to="/produits" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface/60">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink-900">{alert.name}</p>
                            <p className="text-xs text-muted">
                              {alert.level === 'out' ? t('dashboard.stockOut') : t('dashboard.stockLow')}
                              {' · '}{t('products.qtyOnHand')} {(alert.quantity_milli / 1000).toLocaleString(formatLocale())}
                            </p>
                          </div>
                          <span className="shrink-0 text-sm font-semibold tabular-nums">
                            +{(alert.suggested_milli / 1000).toLocaleString(formatLocale())}
                          </span>
                        </Link>
                      ))}
                    </SectionCard>
                  ) : null}

                  {variant.topClients ? (
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
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : null}

          {showDocumentRow ? (
            <div className={`mt-4 grid gap-4 ${variant.activity ? 'xl:grid-cols-3' : ''}`}>
              {variant.recentInvoices ? (
                <SectionCard
                  title={t('dashboard.recentInvoices')}
                  className={variant.activity ? 'xl:col-span-2' : ''}
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
              ) : null}

              {variant.activity ? (
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
              ) : null}
            </div>
          ) : null}

          {actions.length > 0 ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {actions.map((key) => {
                const action = ACTION_LINKS[key];
                const Icon = action.icon;
                return (
                  <Link
                    key={key}
                    to={action.to}
                    className="card flex items-center gap-3 px-4 py-3.5 text-sm font-medium text-ink-900 transition hover:border-brand-300 hover:bg-brand-50/40"
                  >
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700">
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    {t(action.label)}
                    <ArrowUpRight className="ml-auto h-4 w-4 text-muted" aria-hidden="true" />
                  </Link>
                );
              })}
            </div>
          ) : null}
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
