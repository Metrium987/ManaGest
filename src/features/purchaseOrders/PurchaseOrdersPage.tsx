import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Briefcase, Eye, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney, todayISO } from '@/lib/format';
import type { LineItem, ListResponse, PurchaseOrder, Vendor } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { LineItemsEditor, emptyLine } from '@/components/domain/LineItemsEditor';
import { useToast } from '@/components/ui/Toast';
import { GatedButton } from '@/components/ui/GatedButton';
import { showRecord } from '@/components/ui/RecordDrawer';

export function PurchaseOrdersPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState('');
  const [date, setDate] = useState(todayISO());
  const [expected, setExpected] = useState('');
  const [lines, setLines] = useState<LineItem[]>([emptyLine(company?.default_tax_rate ?? 16)]);

  const orders = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => api.get<ListResponse<PurchaseOrder>>('/purchase-orders?per_page=100'),
  });
  const vendors = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => api.get<ListResponse<Vendor>>('/vendors?per_page=100') });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['purchase-orders'] });

  const create = useMutation({
    mutationFn: () => api.post('/purchase-orders', { vendor_id: vendorId, date, expected_date: expected || null, line_items: lines, discount_type: 'percent', discount_value: 0 }),
    onSuccess: () => {
      toast.success(t('purchaseOrders.new'));
      setOpen(false);
      setVendorId('');
      setLines([emptyLine(company?.default_tax_rate ?? 16)]);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const changeStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.post(`/purchase-orders/${id}/status`, { status }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('purchaseOrders.title')}
        subtitle={t('purchaseOrders.subtitle')}
        actions={<GatedButton permission="purchase_orders.write" onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('purchaseOrders.new')}</GatedButton>}
      />

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
                      {can('purchase_orders.write') && order.status === 'approved' ? (
                        <Button size="sm" variant="secondary" onClick={() => changeStatus.mutate({ id: order.id, status: 'received' })}>{t('purchaseOrders.receive')}</Button>
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
          <LineItemsEditor lines={lines} onChange={setLines} products={[]} currency={currency} />
        </div>
      </Modal>
    </>
  );
}
