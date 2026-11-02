import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Eye, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatLocale, formatMoney, todayISO } from '@/lib/format';
import { DEFAULT_TAX_RATE } from '@shared/domain';
import type { LineItem, ListResponse, Product, PurchaseOrder, Vendor } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { LineItemsEditor, emptyLine } from '@/components/domain/LineItemsEditor';
import { useToast } from '@/components/ui/Toast';
import { GatedButton } from '@/components/ui/GatedButton';
import { showRecord } from '@/components/ui/RecordDrawer';

type SuggestionProposal = {
  product_id: string;
  name: string;
  on_hand_milli: number;
  to_order_milli: number;
  reason: string;
};

type SuggestionGroup = {
  supplier_id: string;
  supplier_name: string | null;
  lead_time_days: number;
  proposals: SuggestionProposal[];
};

export function PurchaseOrdersPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<LineItem[]>([emptyLine(company?.default_tax_rate ?? DEFAULT_TAX_RATE)]);
  // C3: a reception is what arrived, line by line — not a status change.
  const [receiving, setReceiving] = useState<PurchaseOrder | null>(null);
  const [receiptQty, setReceiptQty] = useState<Record<string, number>>({});

  const orders = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => api.get<ListResponse<PurchaseOrder>>('/purchase-orders?per_page=100'),
  });
  const vendors = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => api.get<ListResponse<Vendor>>('/vendors?per_page=100') });
  // The catalogue feeds the line editor, so a received order can move stock.
  const products = useQuery({ queryKey: ['products', 'options'], queryFn: () => api.get<ListResponse<Product>>('/products?per_page=100') });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });

  // C1: the buyer's worklist, computed by the server from the article's own
  // thresholds — never from quantities typed here.
  const suggestions = useQuery({
    queryKey: ['purchase-suggestions'],
    queryFn: () => api.get<{ groups: SuggestionGroup[] }>('/purchase-orders/suggestions'),
  });

  const createDraft = useMutation({
    mutationFn: (group: SuggestionGroup) => api.post<{ id: string; number: string }>('/purchase-orders/from-suggestions', {
      vendor_id: group.supplier_id,
      product_ids: group.proposals.map((proposal) => proposal.product_id),
    }),
    onSuccess: (result) => {
      toast.success(`${t('purchaseOrders.draftCreated')}${result?.number ? ` — ${result.number}` : ''}`);
      queryClient.invalidateQueries({ queryKey: ['purchase-suggestions'] });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const create = useMutation({
    mutationFn: () => api.post('/purchase-orders', { vendor_id: vendorId, date, expected_date: expected || null, line_items: lines, discount_type: 'percent', discount_value: 0 }),
    onSuccess: () => {
      toast.success(t('purchaseOrders.new'));
      setOpen(false);
      setVendorId('');
      setLines([emptyLine(company?.default_tax_rate ?? DEFAULT_TAX_RATE)]);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post<{ received: { product_id: string; quantity: number }[] }>(`/purchase-orders/${id}/status`, { status }),
    onSuccess: (result) => {
      refresh();
      // A reception changes the on-hand quantities: refresh the catalogue too.
      queryClient.invalidateQueries({ queryKey: ['products'] });
      if (result?.received?.length) toast.success(t('purchaseOrders.received'));
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const receiptDetail = useQuery({
    queryKey: ['purchase-order', receiving?.id],
    queryFn: () => api.get<{
      balances: { line_id: string; ordered_milli: number; received_milli: number; remaining_milli: number }[];
      remaining_milli: number;
    }>(`/purchase-orders/${receiving?.id}`),
    enabled: Boolean(receiving),
  });

  const receive = useMutation({
    mutationFn: () => api.post<{ status: string; gaps: { price_gap: number }[] }>(`/purchase-orders/${receiving?.id}/receive`, {
      lines: (receiptDetail.data?.balances ?? [])
        .map((balance) => ({
          line_id: balance.line_id,
          quantity: receiptQty[balance.line_id] ?? balance.remaining_milli / 1000,
        }))
        .filter((line) => line.quantity > 0),
    }),
    onSuccess: (result) => {
      toast.success(t('purchaseOrders.received'));
      const gap = (result?.gaps ?? []).reduce((sum, row) => sum + Math.abs(row.price_gap ?? 0), 0);
      if (gap > 0) toast.error(`${t('purchaseOrders.priceGap')} : ${formatMoney(gap, currency)}`);
      setReceiving(null);
      setReceiptQty({});
      refresh();
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('purchaseOrders.title')}
        subtitle={t('purchaseOrders.subtitle')}
        actions={<GatedButton permission="purchase_orders.write" onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('purchaseOrders.new')}</GatedButton>}
      />

      <SectionCard title={t('purchaseOrders.proposals')} subtitle={t('purchaseOrders.proposalsSubtitle')} bodyClassName="p-4">
        {suggestions.isLoading ? (
          <Skeleton className="h-16" />
        ) : suggestions.data?.groups.length ? (
          <div className="space-y-5">
            {suggestions.data.groups.map((group) => (
              <div key={group.supplier_id} className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-ink-950">
                    {group.supplier_name ?? t('common.none')}
                    {group.lead_time_days ? ` · ${group.lead_time_days} j` : ''}
                  </p>
                  <GatedButton permission="purchase_orders.write" onClick={() => createDraft.mutate(group)}>
                    {t('purchaseOrders.createDraft')}
                  </GatedButton>
                </div>
                <div className="table-wrap">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">{t('products.title')}</th>
                        <th scope="col" className="text-right">{t('products.qtyOnHand')}</th>
                        <th scope="col" className="text-right">{t('purchaseOrders.toOrder')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.proposals.map((proposal) => (
                        <tr key={proposal.product_id}>
                          <td className="font-medium">{proposal.name}</td>
                          <td className="text-right text-xs tabular-nums">{(proposal.on_hand_milli / 1000).toLocaleString(formatLocale())}</td>
                          <td className="text-right tabular-nums">{(proposal.to_order_milli / 1000).toLocaleString(formatLocale())}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        ) : <p className="text-xs text-muted">{t('purchaseOrders.noProposals')}</p>}
      </SectionCard>

      <SectionCard title={t('purchaseOrders.title')} bodyClassName="table-wrap">
        {orders.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : orders.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('invoices.number')}</th>
                <th scope="col">{t('expenses.vendor')}</th>
                <th scope="col">{t('common.date')}</th>
                <th scope="col">{t('purchaseOrders.expectedDate')}</th>
                <th scope="col" className="text-right">{t('common.total')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {orders.data.data.map((order) => (
                <tr key={order.id}>
                  <td className="font-medium">
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-left hover:text-brand-700"
                      aria-label={`${t('records.view')} ${order.number}`}
                      onClick={() => showRecord({
                        trace: { entityType: 'purchase_order', entityId: order.id },
                        title: order.number ?? t('purchaseOrders.title'),
                        subtitle: order.vendor_name,
                        status: order.status,
                        fields: [
                          { label: t('common.date'), value: formatDate(order.date) },
                          { label: t('purchaseOrders.expectedDate'), value: formatDate(order.expected_date) },
                          { label: t('common.amount'), value: formatMoney(order.total, currency) },
                          { label: t('common.status'), value: <StatusBadge status={order.status} /> },
                        ],
                        sections: order.line_items.length ? [{
                          title: t('invoices.lines'),
                          fields: order.line_items.map((line: LineItem, index: number) => ({
                            label: `${index + 1}. ${line.description}`,
                            value: `${line.quantity} × ${formatMoney(line.unit_price, currency)} · ${line.tax_rate} %`,
                          })),
                        }] : undefined,
                      })}
                    >
                      <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                      {order.number}
                    </button>
                  </td>
                  <td>{order.vendor_name}</td>
                  <td className="text-muted">{formatDate(order.date)}</td>
                  <td className="text-muted">{formatDate(order.expected_date)}</td>
                  <td className="text-right tabular-nums">{formatMoney(order.total, currency)}</td>
                  <td><StatusBadge status={order.status} /></td>
                  <td>
                    <div className="flex flex-wrap justify-end gap-1">
                      {can('purchase_orders.write') && order.status === 'draft' ? (
                        <Button size="sm" variant="secondary" onClick={() => changeStatus.mutate({ id: order.id, status: 'sent' })}>{t('purchaseOrders.markSent')}</Button>
                      ) : null}
                      {can('purchase_orders.write') && order.status === 'sent' ? (
                        <Button size="sm" variant="secondary" onClick={() => changeStatus.mutate({ id: order.id, status: 'approved' })}>{t('purchaseOrders.approve')}</Button>
                      ) : null}
                      {can('purchase_orders.write') && (order.status === 'approved' || order.status === 'partially_received') ? (
                        <Button size="sm" variant="secondary" onClick={() => { setReceiptQty({}); setReceiving(order); }}>{t('purchaseOrders.receive')}</Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Briefcase className="h-6 w-6" aria-hidden="true" />} title={t('purchaseOrders.empty')} />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('purchaseOrders.new')}
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
            <Field label={t('expenses.vendor')} htmlFor="po_vendor" required>
              <Select id="po_vendor" value={vendorId} onChange={(event) => setVendorId(event.target.value)}>
                <option value="">{t('common.none')}</option>
                {(vendors.data?.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </Select>
            </Field>
            <Field label={t('common.date')} htmlFor="po_date">
              <Input id="po_date" type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
            <Field label={t('purchaseOrders.expectedDate')} htmlFor="po_expected">
              <Input id="po_expected" type="date" value={expected} onChange={(event) => setExpected(event.target.value)} />
            </Field>
          </FormGrid>
          <LineItemsEditor lines={lines} onChange={setLines} products={products.data?.data ?? []} currency={currency} />
        </div>
      </Modal>

      <Modal
        open={receiving !== null}
        onClose={() => setReceiving(null)}
        title={`${t('purchaseOrders.receive')} — ${receiving?.number ?? ''}`}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setReceiving(null)}>{t('common.cancel')}</Button>
            <Button loading={receive.isPending} onClick={() => receive.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="hint">{t('purchaseOrders.receiveHint')}</p>
          {receiptDetail.isLoading ? <Skeleton className="h-16" /> : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('invoices.lines')}</th>
                    <th scope="col" className="text-right">{t('purchaseOrders.orderedQty')}</th>
                    <th scope="col" className="text-right">{t('purchaseOrders.receivedQty')}</th>
                    <th scope="col" className="text-right">{t('purchaseOrders.remainingQty')}</th>
                    <th scope="col" className="text-right">{t('purchaseOrders.receiveNow')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(receiving?.line_items ?? []).map((line) => {
                    const balance = (receiptDetail.data?.balances ?? []).find((row) => row.line_id === line.id);
                    const remaining = (balance?.remaining_milli ?? 0) / 1000;
                    return (
                      <tr key={line.id}>
                        <td className="font-medium">{line.description}</td>
                        <td className="text-right tabular-nums">{line.quantity.toLocaleString(formatLocale())}</td>
                        <td className="text-right tabular-nums">{((balance?.received_milli ?? 0) / 1000).toLocaleString(formatLocale())}</td>
                        <td className="text-right tabular-nums">{remaining.toLocaleString(formatLocale())}</td>
                        <td className="text-right">
                          <Input
                            type="number"
                            min="0"
                            step="0.001"
                            aria-label={`${t('purchaseOrders.receiveNow')} ${line.description}`}
                            value={receiptQty[line.id] ?? remaining}
                            onChange={(event) => setReceiptQty({ ...receiptQty, [line.id]: Number(event.target.value) })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {receive.isError ? <p className="text-xs text-danger-600">{errorMessage(receive.error)}</p> : null}
        </div>
      </Modal>
    </>
  );
}
