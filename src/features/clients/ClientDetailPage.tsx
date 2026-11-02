import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Building2, FileCheck2, Mail, MapPin, Pencil, Phone, Plus, Printer } from 'lucide-react';
import {
  CLIENT_BANK_LABELS,
  CLIENT_PAYMENT_METHOD_LABELS,
  CLIENT_PAYMENT_TERM_LABELS,
  CLIENT_VAT_REGIME_LABELS,
  ENTITY_CATEGORY_LABELS,
  LEGAL_FORM_LABELS,
} from '@shared/client-profile';
import { ClientDocumentsPanel } from './ClientDocumentsPanel';
import { api } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import type { ClientDetail } from '@/lib/types';
import { PageHeader, SectionCard, StatCard, StatusBadge, EmptyState, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { ClientFormModal } from './ClientsPage';

export function ClientDetailPage() {
  const { id = '' } = useParams();
  const { company, can } = useSession();
  const [editOpen, setEditOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const currency = company?.currency ?? 'XPF';

  const client = useQuery({
    queryKey: ['client', id],
    queryFn: () => api.get<ClientDetail>(`/clients/${id}`),
    enabled: Boolean(id),
  });

  const statement = useQuery({
    queryKey: ['client-statement', id],
    queryFn: () =>
      api.get<{
        invoices: { id: string; number: string; date: string; total: number; paid_total: number; balance: number; status: string }[];
        payments: { id: string; number: string; date: string; amount: number }[];
        totals: { invoiced: number; paid: number; balance: number };
      }>(`/clients/${id}/statement`),
    enabled: statementOpen,
  });

  if (client.isLoading) {
    return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-28" /><Skeleton className="h-64" /></div>;
  }
  if (!client.data) {
    return <EmptyState title={t('errors.NOT_FOUND')} action={<Link to="/clients" className="btn btn-secondary">{t('common.back')}</Link>} />;
  }

  const data = client.data;

  return (
    <>
      <PageHeader
        breadcrumb={
          <Link to="/clients" className="inline-flex items-center gap-1 hover:text-brand-700">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('clients.title')}
          </Link>
        }
        title={data.display_name}
        subtitle={[data.number, ENTITY_CATEGORY_LABELS[data.entity_category], data.city, data.email].filter(Boolean).join(' · ') || t('clients.detailTitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setStatementOpen(true)} icon={<Printer className="h-4 w-4" aria-hidden="true" />}>
              {t('clients.statement')}
            </Button>
            {can('invoices.write') ? (
              <Link to={`/factures/nouvelle?client=${data.id}`} className="btn btn-primary">
                <Plus className="h-4 w-4" aria-hidden="true" /> {t('dashboard.newInvoice')}
              </Link>
            ) : null}
            {can('clients.write') ? (
              <Button variant="secondary" onClick={() => setEditOpen(true)} icon={<Pencil className="h-4 w-4" aria-hidden="true" />}>
                {t('common.edit')}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label={t('clients.balance')} value={formatMoney(data.balance, currency)} accent="warning" />
        <StatCard label={t('clients.paidToDate')} value={formatMoney(data.paid_to_date, currency)} accent="success" />
        <StatCard label={t('credits.remaining')} value={formatMoney(data.credit_balance, currency)} accent="brand" />
        <StatCard label={t('clients.invoiceCount')} value={String(data.invoice_count)} accent="brand" />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-3">
        <SectionCard title={t('common.details')} className="xl:col-span-1">
          <dl className="divide-y divide-line text-sm">
            {[
              { icon: Building2, label: t('clients.code'), value: data.number ?? '—' },
              { icon: Building2, label: t('clients.category'), value: ENTITY_CATEGORY_LABELS[data.entity_category] ?? '—' },
              { icon: FileCheck2, label: t('clientProfile.accountStatus'), value: t(`clientProfile.status.${data.account_status}`) },
              ...(data.legal_name ? [{ icon: Building2, label: t('clientProfile.legalName'), value: data.legal_name }] : []),
              ...(data.trade_name ? [{ icon: Building2, label: t('clientProfile.tradeName'), value: data.trade_name }] : []),
              ...(data.legal_form ? [{ icon: Building2, label: t('clientProfile.legalForm'), value: LEGAL_FORM_LABELS[data.legal_form] }] : []),
              { icon: Building2, label: t('clients.tahitiNumber'), value: data.tax_id ?? '—' },
              ...(data.numero_rcs ? [{ icon: Building2, label: t('clientProfile.rcs'), value: data.numero_rcs }] : []),
              ...(data.numero_tps ? [{ icon: Building2, label: t('clientProfile.tps'), value: data.numero_tps }] : []),
              ...(data.vat_regime ? [{ icon: Building2, label: t('clientProfile.vatRegime'), value: CLIENT_VAT_REGIME_LABELS[data.vat_regime] }] : []),
              { icon: Mail, label: t('common.email'), value: data.email ?? '—' },
              { icon: Phone, label: t('common.phone'), value: data.phone ?? '—' },
              ...(data.contact_role ? [{ icon: Building2, label: t('clientProfile.contactRole'), value: data.contact_role }] : []),
              { icon: MapPin, label: t('clientProfile.poBox'), value: [data.po_box_number ? `B.P. ${data.po_box_number}` : null, data.postal_code, data.po_box_municipality].filter(Boolean).join(', ') || '—' },
              ...(data.street_building_zone || data.physical_municipality
                ? [{
                    icon: MapPin,
                    label: t('clientProfile.street'),
                    value: [data.street_building_zone, data.pk_landmark, data.district, data.physical_municipality, data.island]
                      .filter(Boolean).join(', '),
                  }]
                : []),
              ...(data.payment_method
                ? [{ icon: Building2, label: t('clientProfile.paymentMethod'), value: CLIENT_PAYMENT_METHOD_LABELS[data.payment_method] }]
                : []),
              ...(data.payment_terms_code
                ? [{ icon: Building2, label: t('clientProfile.paymentTermsLabel'), value: CLIENT_PAYMENT_TERM_LABELS[data.payment_terms_code] }]
                : []),
              ...(data.bank_name
                ? [{
                    icon: Building2,
                    label: t('clientProfile.bank'),
                    value: [CLIENT_BANK_LABELS[data.bank_name], data.iban].filter(Boolean).join(' · '),
                  }]
                : []),
            ].map((row) => {
              const Icon = row.icon;
              return (
                <div key={row.label} className="flex gap-3 px-5 py-3">
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                  <div className="min-w-0">
                    <dt className="text-xs text-muted">{row.label}</dt>
                    <dd className="break-words font-medium text-ink-900">{row.value}</dd>
                  </div>
                </div>
              );
            })}
            {data.has_delegation_authority ? (
              <div className="px-5 py-3 text-xs font-medium text-brand-700">{t('clientProfile.delegation')}</div>
            ) : null}
            {data.is_tax_exempt ? (
              <div className="px-5 py-3 text-xs font-medium text-brand-700">{t('invoices.taxExemptNote')}</div>
            ) : null}
          </dl>
        </SectionCard>

        <div className="space-y-4 xl:col-span-2">
          <SectionCard
            title={t('clients.recentInvoices')}
            actions={<Link to={`/factures?client_id=${data.id}`} className="text-xs font-semibold text-brand-700 hover:underline">{t('common.seeAll')}</Link>}
            bodyClassName="table-wrap"
          >
            {data.invoices.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('invoices.number')}</th>
                    <th scope="col">{t('common.date')}</th>
                    <th scope="col" className="text-right">{t('common.total')}</th>
                    <th scope="col" className="text-right">{t('common.balance')}</th>
                    <th scope="col">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invoices.map((invoice) => (
                    <tr key={invoice.id}>
                      <td><Link to={`/factures/${invoice.id}`} className="font-medium text-brand-700 hover:underline">{invoice.number}</Link></td>
                      <td className="text-muted">{formatDate(invoice.date)}</td>
                      <td className="text-right tabular-nums">{formatMoney(invoice.total, currency)}</td>
                      <td className="text-right tabular-nums">{formatMoney(invoice.balance, currency)}</td>
                      <td><StatusBadge status={invoice.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-5 py-8 text-center text-sm text-muted">{t('clients.noInvoices')}</p>
            )}
          </SectionCard>

          <div className="grid gap-4 sm:grid-cols-2">
            <SectionCard title={t('clients.recentQuotes')} bodyClassName="divide-y divide-line">
              {data.quotes.length ? data.quotes.map((quote) => (
                <Link key={quote.id} to={`/devis/${quote.id}`} className="flex items-center justify-between gap-2 px-5 py-3 hover:bg-surface/60">
                  <div>
                    <p className="text-sm font-medium">{quote.number}</p>
                    <p className="text-xs text-muted">{formatDate(quote.date)}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm tabular-nums">{formatMoney(quote.total, currency)}</p>
                    <StatusBadge status={quote.status} />
                  </div>
                </Link>
              )) : <p className="px-5 py-6 text-sm text-muted">{t('clients.noQuotes')}</p>}
            </SectionCard>
            <SectionCard title={t('clients.recentPayments')} bodyClassName="divide-y divide-line">
              {data.payments.length ? data.payments.map((payment) => (
                <div key={payment.id} className="flex items-center justify-between gap-2 px-5 py-3">
                  <div>
                    <p className="text-sm font-medium">{payment.number}</p>
                    <p className="text-xs text-muted">{formatDate(payment.date)}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums">{formatMoney(payment.amount, currency)}</p>
                </div>
              )) : <p className="px-5 py-6 text-sm text-muted">{t('clients.noPayments')}</p>}
            </SectionCard>
          </div>
        </div>
      </div>

      <SectionCard
        title={t('clientProfile.documents')}
        subtitle={t('clientProfile.documentsHint')}
        className="mt-4"
      >
        <div className="flex items-start gap-3">
          <FileCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <ClientDocumentsPanel clientId={data.id} canWrite={can('clients.write')} />
          </div>
        </div>
      </SectionCard>

      {editOpen ? (
        <ClientFormModal open client={data} onClose={() => setEditOpen(false)} />
      ) : null}

      <Modal
        open={statementOpen}
        onClose={() => setStatementOpen(false)}
        title={t('clients.statement')}
        description={data.display_name}
        size="lg"
        footer={<Button variant="secondary" onClick={() => setStatementOpen(false)}>{t('common.close')}</Button>}
      >
        {statement.isLoading ? <Skeleton className="h-40" /> : statement.data ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-surface p-3">
                <p className="text-xs text-muted">{t('common.total')}</p>
                <p className="font-semibold tabular-nums">{formatMoney(statement.data.totals.invoiced, currency)}</p>
              </div>
              <div className="rounded-xl bg-success-50 p-3">
                <p className="text-xs text-muted">{t('dashboard.collected')}</p>
                <p className="font-semibold tabular-nums">{formatMoney(statement.data.totals.paid, currency)}</p>
              </div>
              <div className="rounded-xl bg-warning-50 p-3">
                <p className="text-xs text-muted">{t('common.balance')}</p>
                <p className="font-semibold tabular-nums">{formatMoney(statement.data.totals.balance, currency)}</p>
              </div>
            </div>
            <table className="data-table">
              <thead>
                <tr><th scope="col">{t('invoices.number')}</th><th scope="col">{t('common.date')}</th><th scope="col" className="text-right">{t('common.total')}</th><th scope="col" className="text-right">{t('common.balance')}</th></tr>
              </thead>
              <tbody>
                {statement.data.invoices.map((invoice) => (
                  <tr key={invoice.id}>
                    <td>{invoice.number}</td>
                    <td>{formatDate(invoice.date)}</td>
                    <td className="text-right tabular-nums">{formatMoney(invoice.total, currency)}</td>
                    <td className="text-right tabular-nums">{formatMoney(invoice.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
