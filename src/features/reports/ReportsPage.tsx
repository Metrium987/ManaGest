import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Download } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { addDaysISO, formatDate, formatMoney, todayISO } from '@/lib/format';
import type { ReportResponse } from '@/lib/types';
import { PageHeader, SectionCard, Skeleton, StatCard, EmptyState } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';

type ReportType =
  | 'revenue'
  | 'profit-loss'
  | 'tax'
  | 'aging'
  | 'client-sales'
  | 'expenses'
  | 'tva-recap'
  | 'revenue-summary'
  | 'margin'
  | 'profit-centres';

const REPORT_TYPES: { value: ReportType; label: string }[] = [
  { value: 'revenue', label: 'reports.revenue' },
  { value: 'profit-loss', label: 'reports.profitLoss' },
  { value: 'tax', label: 'reports.tax' },
  { value: 'aging', label: 'reports.aging' },
  { value: 'client-sales', label: 'reports.clientSales' },
  { value: 'expenses', label: 'reports.expenseReport' },
  { value: 'tva-recap', label: 'reports.tvaRecap' },
  { value: 'revenue-summary', label: 'reports.revenueSummary' },
  { value: 'margin', label: 'reports.margin' },
  { value: 'profit-centres', label: 'reports.profitCentres' },
];

/** Reports whose CSV is produced server-side (T-207) and therefore journalled. */
const SERVER_EXPORTS = new Set<ReportType>(['tva-recap', 'revenue-summary']);

interface Column {
  key: string;
  label: string;
  format?: 'money' | 'number' | 'percent' | 'text';
  align?: 'left' | 'right';
}

const COLUMNS: Record<ReportType, Column[]> = {
  revenue: [
    { key: 'period', label: 'common.period' },
    { key: 'revenue', label: 'reports.revenue', format: 'money' },
    { key: 'collected', label: 'dashboard.collected', format: 'money' },
    { key: 'expenses', label: 'dashboard.expenses', format: 'money' },
    { key: 'result', label: 'reports.result', format: 'money' },
  ],
  'profit-loss': [
    { key: 'period', label: 'common.period' },
    { key: 'revenue', label: 'reports.revenue', format: 'money' },
    { key: 'collected', label: 'dashboard.collected', format: 'money' },
    { key: 'expenses', label: 'dashboard.expenses', format: 'money' },
    { key: 'result', label: 'reports.result', format: 'money' },
  ],
  tax: [
    { key: 'rate', label: 'reports.rate', format: 'percent' },
    { key: 'base', label: 'reports.base', format: 'money' },
    { key: 'tax', label: 'reports.collected', format: 'money' },
    { key: 'documents', label: 'reports.documents', format: 'number' },
  ],
  aging: [
    { key: 'number', label: 'invoices.number' },
    { key: 'client_name', label: 'invoices.client' },
    { key: 'due_date', label: 'common.dueDate' },
    { key: 'days_overdue', label: 'reports.daysOverdue', format: 'number' },
    { key: 'balance', label: 'common.balance', format: 'money' },
  ],
  'client-sales': [
    { key: 'client_name', label: 'invoices.client' },
    { key: 'invoices', label: 'clients.invoiceCount', format: 'number' },
    { key: 'invoiced', label: 'dashboard.invoiced', format: 'money' },
    { key: 'paid', label: 'dashboard.collected', format: 'money' },
    { key: 'balance', label: 'common.balance', format: 'money' },
  ],
  expenses: [
    { key: 'category', label: 'expenses.category' },
    { key: 'entries', label: 'reports.documents', format: 'number' },
    { key: 'amount', label: 'common.amount', format: 'money' },
    { key: 'tax_amount', label: 'common.tax', format: 'money' },
  ],
  'tva-recap': [
    { key: 'period', label: 'common.period' },
    { key: 'base', label: 'reports.base', format: 'money' },
    { key: 'tax', label: 'reports.collected', format: 'money' },
    { key: 'exempt_base', label: 'reports.exemptBase', format: 'money' },
    { key: 'documents', label: 'reports.documents', format: 'number' },
  ],
  'revenue-summary': [
    { key: 'period', label: 'common.period' },
    { key: 'taxable', label: 'reports.taxableSales', format: 'money' },
    { key: 'exempt', label: 'reports.exemptSales', format: 'money' },
    { key: 'total', label: 'reports.totalSales', format: 'money' },
    { key: 'collected', label: 'dashboard.collected', format: 'money' },
    { key: 'documents', label: 'reports.documents', format: 'number' },
  ],
  margin: [
    { key: 'key', label: 'reports.groupedBy' },
    { key: 'revenue', label: 'reports.marginRevenue', format: 'money' },
    { key: 'cost', label: 'reports.marginCost', format: 'money' },
    { key: 'margin', label: 'reports.marginAmount', format: 'money' },
    { key: 'margin_bp', label: 'reports.marginRate', format: 'percent' },
    { key: 'uncosted_lines', label: 'reports.marginUncosted', format: 'number' },
  ],
  'profit-centres': [
    { key: 'code', label: 'reports.profitCenterCode' },
    { key: 'name', label: 'reports.profitCenterName' },
    { key: 'base', label: 'reports.base', format: 'money' },
    { key: 'tax', label: 'reports.collected', format: 'money' },
    { key: 'total', label: 'reports.totalSales', format: 'money' },
    { key: 'documents', label: 'reports.documents', format: 'number' },
  ],
};

export function ReportsPage() {
  const { company } = useSession();
  const currency = company?.currency ?? 'XPF';
  const [type, setType] = useState<ReportType>('revenue');
  const [from, setFrom] = useState(addDaysISO(todayISO(), -365));
  const [to, setTo] = useState(todayISO());
  const [group, setGroup] = useState<'family' | 'axis' | 'product'>('family');

  const report = useQuery({
    queryKey: ['report', type, from, to, group],
    queryFn: () => api.get<ReportResponse>(
      `/reports/${type}${toQuery({ from, to, ...(type === 'margin' ? { group_by: group } : {}) })}`,
    ),
    enabled: type !== 'profit-centres',
  });

  // Q11: the turnover of each profit centre, credit notes already deducted by the
  // server — a report that ignored them would overstate every centre it touched.
  const centres = useQuery({
    queryKey: ['report-profit-centres', from, to],
    queryFn: () => api.get<{
      data: { code: string | null; name: string | null; base: number; tax: number; total: number; lines: number; documents: number }[];
      totals: { base: number; tax: number; total: number; documents: number; credits: number };
    }>(`/profit-centers/summary${toQuery({ from, to })}`),
    enabled: type === 'profit-centres',
  });

  const summary = type === 'profit-centres'
    ? { ...(centres.data?.totals ?? {}) }
    : report.data?.summary ?? {};
  const rows: Record<string, string | number | null>[] = type === 'profit-centres'
    ? (centres.data?.data ?? []).map((row) => ({
      code: row.code ?? '—',
      name: row.name ?? t('reports.ungrouped'),
      base: row.base,
      tax: row.tax,
      total: row.total,
      documents: row.documents,
    }))
    : report.data?.rows ?? [];

  const exportCsv = () => {
    if (SERVER_EXPORTS.has(type)) {
      // Server-side CSV: same figures as the screen, and the export is journalled.
      window.open(`/api/reports/export/${type}${toQuery({ from, to })}`, '_blank');
      return;
    }
    const columns = COLUMNS[type];
    const header = columns.map((column) => t(column.label)).join(';');
    const body = rows.map((row) =>
      columns
        .map((column) => {
          const value = row[column.key];
          if (column.format === 'percent') return String(Number(value ?? 0) / 100).replace('.', ',');
          if (column.format === 'money') return String(Number(value ?? 0)).replace('.', ',');
          return String(value ?? '').replace(/;/g, ' ');
        })
        .join(';'),
    );
    const csv = `\uFEFF${[header, ...body].join('\n')}`;
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `managest-${type}-${from}-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const summaryCards =
    type === 'revenue' || type === 'profit-loss'
      ? [
          { label: t('dashboard.invoiced'), value: formatMoney(summary.revenue ?? 0, currency) },
          { label: t('dashboard.collected'), value: formatMoney(summary.collected ?? 0, currency) },
          { label: t('dashboard.expenses'), value: formatMoney(summary.expenses ?? 0, currency) },
          { label: t('reports.result'), value: formatMoney(summary.result ?? 0, currency) },
        ]
      : type === 'tax'
        ? [
            { label: t('reports.base'), value: formatMoney(summary.base ?? 0, currency) },
            { label: t('reports.collected'), value: formatMoney(summary.tax ?? 0, currency) },
            { label: t('reports.exemptBase'), value: formatMoney(summary.exempt_base ?? 0, currency) },
            { label: t('reports.exemptDocuments'), value: String(summary.exempt_documents ?? 0) },
          ]
        : type === 'aging'
          ? [
              { label: t('reports.current'), value: formatMoney(summary.current ?? 0, currency) },
              { label: t('reports.d30'), value: formatMoney(summary.d30 ?? 0, currency) },
              { label: t('reports.d60'), value: formatMoney(summary.d60 ?? 0, currency) },
              { label: t('reports.d90'), value: formatMoney(summary.d90 ?? 0, currency) },
              { label: t('reports.older'), value: formatMoney(summary.older ?? 0, currency) },
            ]
          : type === 'client-sales'
            ? [
                { label: t('dashboard.invoiced'), value: formatMoney(summary.invoiced ?? 0, currency) },
                { label: t('dashboard.collected'), value: formatMoney(summary.paid ?? 0, currency) },
              ]
            : type === 'tva-recap'
              ? [
                  { label: t('reports.base'), value: formatMoney(summary.base ?? 0, currency) },
                  { label: t('reports.collected'), value: formatMoney(summary.tax ?? 0, currency) },
                  { label: t('reports.exemptBase'), value: formatMoney(summary.exempt_base ?? 0, currency) },
                  { label: t('reports.documents'), value: String(summary.documents ?? 0) },
                ]
              : type === 'margin'
                ? [
                    { label: t('reports.marginRevenue'), value: formatMoney(summary.revenue ?? 0, currency) },
                    { label: t('reports.marginCost'), value: summary.cost == null ? '—' : formatMoney(Number(summary.cost), currency) },
                    { label: t('reports.marginAmount'), value: summary.margin == null ? '—' : formatMoney(Number(summary.margin), currency) },
                    { label: t('reports.marginRate'), value: summary.margin_bp == null ? '—' : `${(Number(summary.margin_bp) / 100).toFixed(1)} %` },
                  ]
              : type === 'profit-centres'
                ? [
                    { label: t('reports.base'), value: formatMoney(summary.base ?? 0, currency) },
                    { label: t('reports.collected'), value: formatMoney(summary.tax ?? 0, currency) },
                    { label: t('reports.totalSales'), value: formatMoney(summary.total ?? 0, currency) },
                    { label: t('reports.documents'), value: String(summary.documents ?? 0) },
                  ]
              : type === 'revenue-summary'
                ? [
                    { label: t('reports.taxableSales'), value: formatMoney(summary.taxable ?? 0, currency) },
                    { label: t('reports.exemptSales'), value: formatMoney(summary.exempt ?? 0, currency) },
                    { label: t('reports.totalSales'), value: formatMoney(summary.total ?? 0, currency) },
                    { label: t('dashboard.collected'), value: formatMoney(summary.collected ?? 0, currency) },
                  ]
                : [{ label: t('dashboard.expenses'), value: formatMoney(summary.amount ?? 0, currency) }];

  const renderValue = (row: Record<string, string | number | null>, column: Column) => {
    const value = row[column.key];
    if (value === undefined || value === null) return '—';
    if (column.format === 'money') return formatMoney(Number(value), currency);
    if (column.format === 'percent') {
      // Margin rates travel in basis points; tax rates are whole percentages.
      if (column.key === 'margin_bp') return `${(Number(value) / 100).toFixed(1)} %`;
      return `${Number(value)} %`;
    }
    if (column.key === 'key') return value === '__none__' ? t('reports.ungrouped') : String(value);
    if (column.key === 'due_date') return formatDate(String(value));
    if (column.key === 'category') return t(`categories.${value}`);
    return String(value);
  };

  return (
    <>
      <PageHeader
        title={t('reports.title')}
        subtitle={t('reports.subtitle')}
        actions={
          <>
            <Button variant="secondary" onClick={exportCsv} icon={<Download className="h-4 w-4" aria-hidden="true" />}>{t('common.export')}</Button>
          </>
        }
      />

      <div className="card mb-4 flex flex-col gap-3 p-4 sm:flex-row sm:items-end">
        <Field label={t('reports.title')} htmlFor="report_type" className="sm:w-56">
          <Select id="report_type" value={type} onChange={(event) => setType(event.target.value as ReportType)}>
            {REPORT_TYPES.map((item) => <option key={item.value} value={item.value}>{t(item.label)}</option>)}
          </Select>
        </Field>
        <Field label={t('common.from')} htmlFor="report_from" className="sm:w-44">
          <Input id="report_from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </Field>
        <Field label={t('common.to')} htmlFor="report_to" className="sm:w-44">
          <Input id="report_to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </Field>
        {type === 'margin' ? (
          <Field label={t('reports.groupBy')} htmlFor="report_group" className="sm:w-48">
            <Select
              id="report_group"
              value={group}
              onChange={(event) => setGroup(event.target.value as 'family' | 'axis' | 'product')}
            >
              <option value="family">{t('reports.groupFamily')}</option>
              <option value="axis">{t('reports.groupAxis')}</option>
              <option value="product">{t('reports.groupProduct')}</option>
            </Select>
          </Field>
        ) : null}
        <p className="pb-2 text-xs text-muted sm:ml-auto">{t('reports.exportNote')}</p>
      </div>

      <div className={`grid gap-4 ${summaryCards.length >= 4 ? 'sm:grid-cols-2 xl:grid-cols-4' : 'sm:grid-cols-2 xl:grid-cols-3'}`}>
        {summaryCards.map((card) => <StatCard key={card.label} label={card.label} value={card.value} />)}
      </div>

      {type === 'margin' ? (
        <p className="mt-3 text-xs text-muted">
          {report.data?.masked ? t('reports.marginMasked') : t('reports.marginPartial')}
        </p>
      ) : null}

      <div className="mt-4">
        <SectionCard title={t(REPORT_TYPES.find((item) => item.value === type)!.label)} subtitle={`${formatDate(from)} — ${formatDate(to)}`} bodyClassName="table-wrap">
          {report.isLoading || centres.isLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : rows.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  {COLUMNS[type].map((column) => (
                    <th key={column.key} scope="col" className={column.format === 'money' || column.format === 'number' ? 'text-right' : undefined}>
                      {t(column.label)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={index}>
                    {COLUMNS[type].map((column) => (
                      <td
                        key={column.key}
                        className={`${column.format === 'money' || column.format === 'number' ? 'text-right tabular-nums' : ''} ${column.key === 'result' && Number(row[column.key]) < 0 ? 'text-danger-600' : ''}`}
                      >
                        {renderValue(row, column)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<BarChart3 className="h-6 w-6" aria-hidden="true" />} title={t('reports.empty')} />
          )}
        </SectionCard>
      </div>
    </>
  );
}
