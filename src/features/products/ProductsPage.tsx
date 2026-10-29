import { useDeferredValue, useState } from 'react';
import { useNewRecordFlag } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Package, Pencil, Plus, Trash2 } from 'lucide-react';
import { fromMinor, toMinor } from '@shared/money';
import { TVA_RATES } from '@shared/domain';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatMoney } from '@/lib/format';
import type { ListResponse, Product } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, SearchInput, Select, Textarea } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';

interface ProductForm {
  name: string;
  product_key: string;
  description: string;
  unit_price: number;
  cost: number;
  quantity: number;
  track_quantity: boolean;
  tax_rate: number;
}

export function ProductsPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const currency = company?.currency ?? 'XPF';
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [editing, setEditing] = useState<Product | null>(null);
  const startNew = useNewRecordFlag();
  const [open, setOpen] = useState(startNew);
  const [form, setForm] = useState<ProductForm>({
    name: '', product_key: '', description: '', unit_price: 0, cost: 0,
    quantity: 0, track_quantity: false, tax_rate: company?.default_tax_rate ?? 16,
  });

  const products = useQuery({
    queryKey: ['products', deferred],
    queryFn: () => api.get<ListResponse<Product>>(`/products${toQuery({ q: deferred, per_page: 100 })}`),
  });

  const openForm = (product?: Product) => {
    setEditing(product ?? null);
    setForm({
      name: product?.name ?? '',
      product_key: product?.product_key ?? '',
      description: product?.description ?? '',
      unit_price: fromMinor(product?.unit_price ?? 0, currency),
      cost: fromMinor(product?.cost ?? 0, currency),
      quantity: (product?.quantity_milli ?? 0) / 1000,
      track_quantity: Boolean(product?.track_quantity),
      tax_rate: product?.tax_rate ?? company?.default_tax_rate ?? 16,
    });
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, unit_price: toMinor(form.unit_price, currency), cost: toMinor(form.cost, currency) };
      return editing ? api.patch(`/products/${editing.id}`, body) : api.post('/products', body);
    },
    onSuccess: () => {
      toast.success(editing ? t('common.save') : t('products.new'));
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['products'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('products.title')}
        subtitle={t('products.subtitle')}
        actions={<>
          <ExportCsvButton entity="products" />
          {can('products.write') ? <Button onClick={() => openForm()} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('products.new')}</Button> : null}
        </>}
      />

      <SectionCard
        title={t('products.title')}
        actions={<SearchInput value={search} onChange={setSearch} placeholder={t('common.search')} className="w-full sm:w-64" />}
        bodyClassName="table-wrap"
      >
        {products.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : products.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('products.sku')}</th>
                <th scope="col" className="text-right">{t('products.price')}</th>
                <th scope="col" className="text-right">{t('products.stock')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {products.data.data.map((product) => (
                <tr key={product.id}>
                  <td>
                    <p className="font-medium">{product.name}</p>
                    {product.description ? <p className="max-w-md truncate text-xs text-muted">{product.description}</p> : null}
                  </td>
                  <td className="text-muted">{product.product_key ?? '—'}</td>
                  <td className="text-right tabular-nums">{formatMoney(product.unit_price, currency)}</td>
                  <td className="text-right tabular-nums">
                    {product.track_quantity ? (
                      <span className={product.quantity_milli <= 0 ? 'font-medium text-danger-600' : ''}>
                        {(product.quantity_milli / 1000).toLocaleString('fr-FR')}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {can('products.write') ? (
                        <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('common.edit')} ${product.name}`} onClick={() => openForm(product)}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                      {can('products.delete') ? (
                        <button
                          type="button"
                          className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                          aria-label={`${t('common.delete')} ${product.name}`}
                          onClick={async () => {
                            if (await confirm({ title: t('common.delete'), description: product.name, danger: true, confirmLabel: t('common.delete') })) remove.mutate(product.id);
                          }}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Package className="h-6 w-6" aria-hidden="true" />} title={t('products.empty')} />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('common.edit') : t('products.new')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t('common.name')} htmlFor="product_name" required>
              <Input id="product_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </Field>
            <Field label={t('products.sku')} htmlFor="product_key">
              <Input id="product_key" value={form.product_key} onChange={(event) => setForm({ ...form, product_key: event.target.value })} />
            </Field>
            <Field label={t('products.price')} htmlFor="unit_price">
              <Input id="unit_price" type="number" min="0" value={form.unit_price} onChange={(event) => setForm({ ...form, unit_price: Number(event.target.value) })} />
            </Field>
            <Field label={t('products.cost')} htmlFor="cost">
              <Input id="cost" type="number" min="0" value={form.cost} onChange={(event) => setForm({ ...form, cost: Number(event.target.value) })} />
            </Field>
            <Field label={t('invoices.lineTax')} htmlFor="product_tax">
              <Select id="product_tax" value={form.tax_rate} onChange={(event) => setForm({ ...form, tax_rate: Number(event.target.value) })}>
                {TVA_RATES.map((rate) => <option key={rate.rate} value={rate.rate}>{rate.rate} %</option>)}
              </Select>
            </Field>
            <Field label={t('products.stock')} htmlFor="quantity">
              <Input id="quantity" type="number" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} />
            </Field>
          </FormGrid>
          <Checkbox label={t('products.trackStock')} checked={form.track_quantity} onChange={(event) => setForm({ ...form, track_quantity: event.target.checked })} />
          <Field label={t('common.description')} htmlFor="product_description">
            <Textarea id="product_description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
        </div>
      </Modal>
    </>
  );
}
