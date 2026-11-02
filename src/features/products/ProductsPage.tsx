import { useDeferredValue, useEffect, useState } from 'react';
import { useNewRecordFlag } from '@/lib/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, Eye, History, Landmark, MapPin, Package, Pencil, Plus, Trash2, Truck, X, Link2 } from 'lucide-react';
import {
  DEFAULT_VAT_RATE_BP, PORT_FEE_RATE_BP, XPF_PER_EUR, computeLandedCost,
} from '@shared/landed-cost';
import { ALLOCATION_KEYS, type AllocationKey } from '@shared/import-sheet';
import { fromMinor, toMinor } from '@shared/money';
import { CURRENCIES, DEFAULT_TAX_RATE, FREQUENCIES } from '@shared/domain';
import { DEFAULT_ACCOUNT_CODES } from '@shared/accounts';
import { useTaxRates } from '@/lib/tax-rates';
import {
  BOM_MODES, BOM_MODE_LABELS, ITEM_TYPES, ITEM_TYPE_LABELS, LIFECYCLE_LABELS, LIFECYCLE_STATUSES,
  REPLENISH_MODES, REPLENISH_MODE_LABELS, STOCK_MODES, STOCK_MODE_LABELS, VALUATION_METHODS,
  VALUATION_METHOD_LABELS, discountForQuantity, marginRate,
} from '@shared/product-erp';
import {
  BILLING_TRIGGERS, BILLING_TRIGGER_LABELS, BILLING_UNITS, BILLING_UNIT_LABELS, EXPENSE_MODES,
  EXPENSE_MODE_LABELS, RENEWAL_MODES, RENEWAL_MODE_LABELS, REVENUE_RECOGNITIONS,
  REVENUE_RECOGNITION_LABELS, SERVICE_TYPES, SERVICE_TYPE_LABELS, TRAVEL_ZONES, TRAVEL_ZONE_LABELS,
  cpsAmount, nextBillingDate,
} from '@shared/service';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatLocale, formatMoney as formatMoneyValue, todayISO } from '@/lib/format';
import { Product, ProductDetail, ProductListResponse, LinkedProductRef } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, SearchInput, Select, Textarea } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { ExportCsvButton } from '@/components/ui/ExportCsvButton';
import { useToast } from '@/components/ui/Toast';
import { GatedButton } from '@/components/ui/GatedButton';
import { showRecord } from '@/components/ui/RecordDrawer';
import { SavedFilterBar } from '@/components/domain/SavedFilterBar';

const PRODUCT_TABS = ['general', 'purchasing', 'logistics', 'finance', 'pricing', 'links', 'stock'] as const;
const SERVICE_TABS = ['general', 'billing', 'pricing', 'planning', 'contract', 'travel', 'deliverables', 'finance'] as const;
type TabKey = (typeof PRODUCT_TABS)[number] | (typeof SERVICE_TABS)[number];

const FREQUENCY_LABELS: Record<string, string> = {
  weekly: 'Hebdomadaire',
  monthly: 'Mensuelle',
  quarterly: 'Trimestrielle',
  semiannual: 'Semestrielle',
  yearly: 'Annuelle',
};

const ALERT_CLASSES: Record<string, string> = {
  out: 'text-danger-600',
  low: 'text-warning-600',
  ok: 'text-success-600',
  none: 'text-muted',
};

interface ProductForm {
  name: string;
  product_key: string;
  description: string;
  item_type: string;
  family: string;
  subfamily: string;
  lifecycle_status: string;
  buyer: string;
  supplier_id: string;
  supplier_name: string;
  supplier_ref: string;
  purchase_price: number;
  purchase_currency: string;
  moq: number;
  order_multiple: number;
  lead_time_days: number;
  stock_mode: string;
  weight_gross_g: number;
  weight_net_g: number;
  volume_cm3: number;
  warehouse_location: string;
  customs_code: string;
  valuation_method: string;
  landed_cost: number;
  purchase_account: string;
  sales_account: string;
  stock_account: string;
  analytic_axis: string;
  unit_price: number;
  price_pro: number;
  price_member: number;
  margin_target: number;
  volume_discounts: { min_quantity: number; percent: number }[];
  bom_mode: string;
  bom: { product_id: string; quantity: number }[];
  substitutes: string[];
  accessories: string[];
  reorder_point: number;
  safety_stock: number;
  max_stock: number;
  replenish_mode: string;
  quantity: number;
  track_quantity: boolean;
  allow_negative_stock: boolean;
  lot_tracking: string;
  cost: number;
  tax_rate: number;
  // fiche service
  invoice_label: string;
  service_type: string;
  billing_unit: string;
  billing_trigger: string;
  min_billable: number;
  overtime_rules: { label: string; percent: number }[];
  expertise_levels: { level: string; price: number }[];
  cps_rate: number;
  tax_exemption_note: string;
  skills: string;
  estimated_hours: number;
  project_template: string;
  sla_response_hours: number;
  sla_resolution_hours: number;
  billing_frequency: string;
  renewal_mode: string;
  notice_days: number;
  price_revision_index: string;
  expense_mode: string;
  travel_zone: string;
  deliverables: string;
  client_prerequisites: string;
  subcontract_account: string;
  revenue_recognition: string;
}

function emptyForm(taxRate: number): ProductForm {
  return {
    name: '', product_key: '', description: '',
    item_type: 'stockable', family: '', subfamily: '', lifecycle_status: 'active', buyer: '',
    supplier_id: '', supplier_name: '', supplier_ref: '', purchase_price: 0, purchase_currency: 'XPF',
    moq: 0, order_multiple: 0, lead_time_days: 0,
    stock_mode: 'simple', weight_gross_g: 0, weight_net_g: 0, volume_cm3: 0,
    warehouse_location: '', customs_code: '',
    valuation_method: 'cmp', landed_cost: 0, purchase_account: '', sales_account: '',
    stock_account: '', analytic_axis: '',
    unit_price: 0, price_pro: 0, price_member: 0, margin_target: 0, volume_discounts: [],
    bom_mode: 'on_order', bom: [], substitutes: [], accessories: [],
    reorder_point: 0, safety_stock: 0, max_stock: 0, replenish_mode: 'manual',
    quantity: 0, track_quantity: false, allow_negative_stock: false, lot_tracking: 'none', cost: 0, tax_rate: taxRate,
    invoice_label: '', service_type: 'one_off', billing_unit: 'hour', billing_trigger: 'order',
    min_billable: 0, overtime_rules: [], expertise_levels: [], cps_rate: 1,
    tax_exemption_note: '', skills: '', estimated_hours: 0, project_template: '',
    sla_response_hours: 0, sla_resolution_hours: 0, billing_frequency: 'monthly',
    renewal_mode: 'tacit', notice_days: 30, price_revision_index: '',
    expense_mode: 'included', travel_zone: '', deliverables: '', client_prerequisites: '',
    subcontract_account: '', revenue_recognition: 'advance',
  };
}

type ProductLot = {
  id: string;
  lot_code: string;
  expiry_date: string | null;
  quantity: number;
  expired: boolean;
};

type ProductLotBalance = {
  lot_id: string;
  lot_code: string;
  location: string | null;
  quantity: number;
};

/** B2: the shelf, batch by batch — and the only place a batch is created. */
function LotsModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({ lot_code: '', expiry_date: '', quantity: 1 });
  const lots = useQuery({
    queryKey: ['product-lots', product.id],
    queryFn: () => api.get<{ data: ProductLot[] }>(`/products/${product.id}/lots`),
  });
  // Q12: where each batch sits, shelf by shelf, and the two-movement transfer.
  const balances = useQuery({
    queryKey: ['product-lot-balances', product.id],
    queryFn: () => api.get<{ data: ProductLotBalance[] }>(`/products/${product.id}/lots/balances`),
  });
  const [move, setMove] = useState({ lot_id: '', from_location: '', to_location: '', quantity: 1 });
  const transfer = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/lots/${move.lot_id}/transfer`, {
      from_location: move.from_location || null,
      to_location: move.to_location,
      quantity: move.quantity,
    }),
    onSuccess: () => {
      toast.success(t('products.lotTransferred'));
      setMove({ lot_id: '', from_location: '', to_location: '', quantity: 1 });
      queryClient.invalidateQueries({ queryKey: ['product-lot-balances', product.id] });
      queryClient.invalidateQueries({ queryKey: ['product-lots', product.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
  const transferLocations = [...new Set(
    (balances.data?.data ?? [])
      .filter((row) => row.lot_id === move.lot_id && row.location)
      .map((row) => row.location as string),
  )];
  const receive = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/lots`, {
      lot_code: form.lot_code,
      expiry_date: form.expiry_date || null,
      quantity: form.quantity,
    }),
    onSuccess: () => {
      toast.success(t('products.lotReceived'));
      setForm({ lot_code: '', expiry_date: '', quantity: 1 });
      queryClient.invalidateQueries({ queryKey: ['product-lots', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('products.lots')} — ${product.name}`}
      footer={<Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>}
    >
      <div className="space-y-4">
        <p className="hint">{t('products.lotsHint')}</p>
        {lots.isLoading ? <Skeleton className="h-16" /> : lots.data?.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('products.lotCode')}</th>
                  <th scope="col">{t('products.expiryDate')}</th>
                  <th scope="col" className="text-right">{t('products.lotQty')}</th>
                </tr>
              </thead>
              <tbody>
                {lots.data.data.map((lot) => (
                  <tr key={lot.id}>
                    <td className="font-medium">{lot.lot_code}</td>
                    <td className="text-xs">
                      {lot.expiry_date ? formatDate(lot.expiry_date) : '—'}
                      {lot.expired ? <span className="ml-2 text-danger-600">{t('products.lotExpired')}</span> : null}
                    </td>
                    <td className="text-right tabular-nums">{lot.quantity.toLocaleString(formatLocale())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-muted">{t('products.noLots')}</p>}

        <div>
          <p className="mb-1 text-sm font-semibold text-ink-950">{t('products.lotBalances')}</p>
          {balances.data?.data.length ? (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('products.lotCode')}</th>
                    <th scope="col">{t('products.location')}</th>
                    <th scope="col" className="text-right">{t('products.lotQty')}</th>
                  </tr>
                </thead>
                <tbody>
                  {balances.data.data.map((row) => (
                    <tr key={`${row.lot_id}-${row.location ?? ''}`}>
                      <td className="font-medium">{row.lot_code}</td>
                      <td className="text-xs">{row.location ?? t('products.lotNoLocation')}</td>
                      <td className="text-right tabular-nums">{row.quantity.toLocaleString(formatLocale())}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="text-xs text-muted">{t('products.noLotBalances')}</p>}
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.transferLot')}</legend>
          <FormGrid>
            <Field label={t('products.lotCode')} htmlFor="transfer_lot">
              <Select
                id="transfer_lot"
                value={move.lot_id}
                onChange={(event) => setMove({ ...move, lot_id: event.target.value, from_location: '' })}
              >
                <option value="">{t('common.none')}</option>
                {(lots.data?.data ?? []).map((lot) => (
                  <option key={lot.id} value={lot.id}>{lot.lot_code}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('products.fromLocation')} htmlFor="transfer_from">
              <Select
                id="transfer_from"
                value={move.from_location}
                onChange={(event) => setMove({ ...move, from_location: event.target.value })}
              >
                <option value="">{t('products.lotAnyLocation')}</option>
                {transferLocations.map((location) => (
                  <option key={location} value={location}>{location}</option>
                ))}
              </Select>
            </Field>
            <Field label={t('products.toLocation')} htmlFor="transfer_to">
              <Input
                id="transfer_to"
                value={move.to_location}
                onChange={(event) => setMove({ ...move, to_location: event.target.value.toUpperCase() })}
                placeholder="BOUTIQUE"
              />
            </Field>
            <Field label={t('products.lotQty')} htmlFor="transfer_qty">
              <Input
                id="transfer_qty"
                type="number"
                min="0.001"
                step="0.001"
                value={move.quantity}
                onChange={(event) => setMove({ ...move, quantity: Number(event.target.value) })}
              />
            </Field>
          </FormGrid>
          {transfer.isError ? <p className="text-xs text-danger-600">{errorMessage(transfer.error)}</p> : null}
          <Button
            variant="secondary"
            loading={transfer.isPending}
            disabled={!move.lot_id || !move.to_location.trim()}
            onClick={() => transfer.mutate()}
          >
            {t('products.transferLot')}
          </Button>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.receiveLot')}</legend>
          <FormGrid>
            <Field label={t('products.lotCode')} htmlFor="lot_code">
              <Input id="lot_code" value={form.lot_code} onChange={(event) => setForm({ ...form, lot_code: event.target.value })} />
            </Field>
            <Field label={t('products.expiryDate')} htmlFor="lot_expiry">
              <Input id="lot_expiry" type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} />
            </Field>
            <Field label={t('products.lotQty')} htmlFor="lot_quantity">
              <Input id="lot_quantity" type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} />
            </Field>
          </FormGrid>
          {receive.isError ? <p className="text-xs text-danger-600">{errorMessage(receive.error)}</p> : null}
          <Button loading={receive.isPending} onClick={() => receive.mutate()}>{t('products.receiveLot')}</Button>
        </fieldset>
      </div>
    </Modal>
  );
}

type VendorOption = { id: string; name: string };

type ProductVendorLink = {
  id: string;
  vendor_id: string;
  vendor_name: string;
  price: number;
  currency: string;
  moq: number;
  lead_time_days: number;
  vendor_ref: string | null;
  is_preferred: boolean;
  history?: { price: number; currency: string; recorded_at: string }[];
};

/** C2: a price is only true for the supplier who quoted it, so each vendor keeps
 * its own line instead of overwriting the article's purchase price. */
function VendorsModal({ product, currency, onClose }: { product: Product; currency: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const emptyVendor = { vendor_id: '', price: 0, moq: 0, lead_time_days: 0, vendor_ref: '', is_preferred: false };
  const [form, setForm] = useState(emptyVendor);
  const links = useQuery({
    queryKey: ['product-vendors', product.id],
    queryFn: () => api.get<{ data: ProductVendorLink[]; preferred_vendor_id: string | null }>(`/products/${product.id}/vendors`),
  });
  const vendors = useQuery({ queryKey: ['vendors', 'options'], queryFn: () => api.get<{ data: VendorOption[] }>('/vendors?per_page=100') });

  const save = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/vendors`, {
      vendor_id: form.vendor_id,
      price: toMinor(form.price, currency),
      moq: form.moq,
      lead_time_days: form.lead_time_days,
      vendor_ref: form.vendor_ref || null,
      is_preferred: form.is_preferred,
    }),
    onSuccess: () => {
      toast.success(t('products.vendorSaved'));
      setForm(emptyVendor);
      queryClient.invalidateQueries({ queryKey: ['product-vendors', product.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('products.vendors')} — ${product.name}`}
      footer={<Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>}
    >
      <div className="space-y-4">
        <p className="hint">{t('products.vendorHint')}</p>
        {links.isLoading ? <Skeleton className="h-16" /> : links.data?.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('expenses.vendor')}</th>
                  <th scope="col" className="text-right">{t('products.vendorPrice')}</th>
                  <th scope="col" className="text-right">{t('products.vendorMoq')}</th>
                  <th scope="col" className="text-right">{t('products.vendorLeadTime')}</th>
                </tr>
              </thead>
              <tbody>
                {links.data.data.map((link) => (
                  <tr key={link.id}>
                    <td className="font-medium">
                      {link.vendor_name}
                      {link.is_preferred ? <span className="ml-2 text-xs text-brand-700">{t('products.vendorPreferred')}</span> : null}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatMoneyValue(link.price, link.currency || currency)}
                      {(() => {
                        // C2: the ledger keeps what the supplier quoted before, so an
                        // increase is visible where the price is read, not only in the API.
                        const previous = (link.history ?? []).find((entry) => entry.price !== link.price);
                        if (!previous) return null;
                        return (
                          <span className="mt-0.5 block text-[11px] text-muted">
                            {t('products.vendorPricePrevious', {
                              price: formatMoneyValue(previous.price, previous.currency || currency),
                              date: previous.recorded_at.slice(0, 10),
                            })}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="text-right tabular-nums">{link.moq.toLocaleString(formatLocale())}</td>
                    <td className="text-right tabular-nums">{link.lead_time_days} j</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-muted">{t('products.noVendors')}</p>}

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.addVendor')}</legend>
          <FormGrid>
            <Field label={t('expenses.vendor')} htmlFor="pv_vendor">
              <Select id="pv_vendor" value={form.vendor_id} onChange={(event) => setForm({ ...form, vendor_id: event.target.value })}>
                <option value="">—</option>
                {(vendors.data?.data ?? []).map((vendor) => <option key={vendor.id} value={vendor.id}>{vendor.name}</option>)}
              </Select>
            </Field>
            <Field label={t('products.vendorPrice')} htmlFor="pv_price">
              <Input id="pv_price" type="number" min="0" value={form.price} onChange={(event) => setForm({ ...form, price: Number(event.target.value) })} />
            </Field>
            <Field label={t('products.vendorMoq')} htmlFor="pv_moq">
              <Input id="pv_moq" type="number" min="0" step="0.001" value={form.moq} onChange={(event) => setForm({ ...form, moq: Number(event.target.value) })} />
            </Field>
            <Field label={t('products.vendorLeadTime')} htmlFor="pv_lead">
              <Input id="pv_lead" type="number" min="0" value={form.lead_time_days} onChange={(event) => setForm({ ...form, lead_time_days: Number(event.target.value) })} />
            </Field>
            <Field label={t('products.vendorRef')} htmlFor="pv_ref">
              <Input id="pv_ref" value={form.vendor_ref} onChange={(event) => setForm({ ...form, vendor_ref: event.target.value })} />
            </Field>
          </FormGrid>
          <Checkbox label={t('products.vendorPreferred')} checked={form.is_preferred} onChange={(event) => setForm({ ...form, is_preferred: event.target.checked })} />
          {save.isError ? <p className="text-xs text-danger-600">{errorMessage(save.error)}</p> : null}
          <Button loading={save.isPending} onClick={() => save.mutate()}>{t('products.addVendor')}</Button>
        </fieldset>
      </div>
    </Modal>
  );
}

type ProductLocation = { location: string | null; quantity: number };

/** B4: where the goods actually are, and the transfer between two shelves. */
function LocationsModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    from_location: product.warehouse_location ?? '',
    to_location: '',
    quantity: 1,
  });
  const balances = useQuery({
    queryKey: ['product-locations', product.id],
    queryFn: () => api.get<{ data: ProductLocation[]; total: number }>(`/products/${product.id}/locations`),
  });
  const transfer = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/transfer`, {
      from_location: form.from_location,
      to_location: form.to_location,
      quantity: form.quantity,
    }),
    onSuccess: () => {
      toast.success(t('products.transferred'));
      setForm({ ...form, to_location: '', quantity: 1 });
      queryClient.invalidateQueries({ queryKey: ['product-locations', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('products.locations')} — ${product.name}`}
      footer={<Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>}
    >
      <div className="space-y-4">
        <p className="hint">{t('products.locationTransferHint')}</p>
        {balances.isLoading ? <Skeleton className="h-16" /> : balances.data?.data.length ? (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('products.locations')}</th>
                  <th scope="col" className="text-right">{t('products.qtyOnHand')}</th>
                </tr>
              </thead>
              <tbody>
                {balances.data.data.map((row) => (
                  <tr key={row.location ?? 'none'}>
                    <td className="font-medium">{row.location ?? t('products.unassigned')}</td>
                    <td className="text-right tabular-nums">{row.quantity.toLocaleString(formatLocale())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-xs text-muted">{t('products.noBalances')}</p>}

        <fieldset className="space-y-3">
          <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.transfer')}</legend>
          <FormGrid>
            <Field label={t('products.fromLocation')} htmlFor="transfer_from">
              <Input id="transfer_from" value={form.from_location} onChange={(event) => setForm({ ...form, from_location: event.target.value })} />
            </Field>
            <Field label={t('products.toLocation')} htmlFor="transfer_to">
              <Input id="transfer_to" value={form.to_location} onChange={(event) => setForm({ ...form, to_location: event.target.value })} />
            </Field>
            <Field label={t('products.delta')} htmlFor="transfer_qty">
              <Input id="transfer_qty" type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => setForm({ ...form, quantity: Number(event.target.value) })} />
            </Field>
          </FormGrid>
          {transfer.isError ? <p className="text-xs text-danger-600">{errorMessage(transfer.error)}</p> : null}
          <Button loading={transfer.isPending} onClick={() => transfer.mutate()}>{t('products.transfer')}</Button>
        </fieldset>
      </div>
    </Modal>
  );
}


function LinksModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const links = useQuery({
    queryKey: ['product-links', product.id],
    queryFn: () => api.get<{ substitutes: LinkedProductRef[]; accessories: LinkedProductRef[] }>(`/products/${product.id}/links`),
  });
  const catalogue = useQuery({
    queryKey: ['products', 'links-options'],
    queryFn: () => api.get<{ data: Product[] }>('/products?per_page=200'),
  });
  const [subs, setSubs] = useState<string[]>([]);
  const [accs, setAccs] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!links.data || loaded) return;
    setSubs(links.data.substitutes.map((item) => item.id));
    setAccs(links.data.accessories.map((item) => item.id));
    setLoaded(true);
  }, [links.data, loaded]);

  const save = useMutation({
    mutationFn: () => api.put(`/products/${product.id}/links`, { substitutes: subs, accessories: accs }),
    onSuccess: () => {
      toast.success(t('products.linksSaved'));
      queryClient.invalidateQueries({ queryKey: ['product-links', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const options = (catalogue.data?.data ?? []).filter((item) => item.id !== product.id);

  return (
    <Modal open title={`${t('products.links')} · ${product.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="substitutes">{t('products.substitutes')}</label>
          <select
            id="substitutes"
            multiple
            size={5}
            className="select h-auto"
            value={subs}
            onChange={(event) => setSubs(Array.from(event.target.selectedOptions).map((option) => option.value))}
          >
            {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label" htmlFor="accessories">{t('products.accessories')}</label>
          <select
            id="accessories"
            multiple
            size={5}
            className="select h-auto"
            value={accs}
            onChange={(event) => setAccs(Array.from(event.target.selectedOptions).map((option) => option.value))}
          >
            {options.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending}>{t('common.save')}</Button>
        </div>
      </div>
    </Modal>
  );
}

interface FamilyAccountRow {
  family: string;
  sales_account: string | null;
  purchase_account: string | null;
  stock_account: string | null;
  updated_at: string | null;
}

interface FamilyAccountsResponse {
  data: FamilyAccountRow[];
  families: { family: string; count: number }[];
}

type AccountField = 'sales' | 'purchase' | 'stock';
type AccountDraft = Record<AccountField, string>;

/**
 * F2: the family → account mapping. Setting it here is what keeps the three
 * account fields of the sheet from being typed again on every article of the
 * same family; whatever is set on an article still wins (the server only fills
 * what the sheet left empty).
 */
function FamilyAccountsModal({ onClose }: { onClose: () => void }) {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const canWrite = can('products.write');
  const mapping = useQuery({
    queryKey: ['family-accounts'],
    queryFn: () => api.get<FamilyAccountsResponse>('/products/families/accounts'),
  });
  const [rows, setRows] = useState<Record<string, AccountDraft>>({});

  useEffect(() => {
    if (!mapping.data) return;
    // Every family in use and every family already mapped: a mapping whose
    // articles were all deleted stays editable instead of becoming invisible.
    const next: Record<string, AccountDraft> = {};
    const families = new Set([
      ...mapping.data.families.map((row) => row.family),
      ...mapping.data.data.map((row) => row.family),
    ]);
    for (const row of mapping.data.data) {
      next[row.family] = {
        sales: row.sales_account ?? '',
        purchase: row.purchase_account ?? '',
        stock: row.stock_account ?? '',
      };
    }
    for (const family of families) {
      next[family] ??= { sales: '', purchase: '', stock: '' };
    }
    setRows(next);
  }, [mapping.data]);

  const families = Object.keys(rows).sort((a, b) => a.localeCompare(b, 'fr'));

  const save = useMutation({
    mutationFn: (family: string) => {
      const row = rows[family] ?? { sales: '', purchase: '', stock: '' };
      // Empty means "no default": the server validates a code, so an empty box
      // must travel as null rather than as an empty string.
      return api.put(`/products/families/${encodeURIComponent(family)}/accounts`, {
        sales_account: row.sales.trim() || null,
        purchase_account: row.purchase.trim() || null,
        stock_account: row.stock.trim() || null,
      });
    },
    onSuccess: () => {
      toast.success(t('products.familyAccountsSaved'));
      queryClient.invalidateQueries({ queryKey: ['family-accounts'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setField = (family: string, field: AccountField, value: string) => {
    const row = rows[family] ?? { sales: '', purchase: '', stock: '' };
    setRows({ ...rows, [family]: { ...row, [field]: value } });
  };

  return (
    <Modal open title={t('products.familyAccounts')} onClose={onClose} size="xl">
      <div className="space-y-4">
        <p className="text-xs text-muted">{t('products.familyAccountsHint')}</p>
        {mapping.isLoading ? (
          <Skeleton className="h-10" />
        ) : families.length === 0 ? (
          <EmptyState title={t('products.familyAccountsEmpty')} />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('products.filterFamily')}</th>
                  <th scope="col">{t('products.salesAccount')}</th>
                  <th scope="col">{t('products.purchaseAccount')}</th>
                  <th scope="col">{t('products.stockAccount')}</th>
                  <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {families.map((family) => {
                  const row = rows[family] ?? { sales: '', purchase: '', stock: '' };
                  return (
                    <tr key={family}>
                      <td className="font-medium">{family}</td>
                      {(['sales', 'purchase', 'stock'] as AccountField[]).map((field) => (
                        <td key={field}>
                          <Input
                            aria-label={`${t(`products.${field}Account`)} — ${family}`}
                            inputMode="numeric"
                            placeholder="—"
                            value={row[field]}
                            disabled={!canWrite}
                            onChange={(event) => setField(family, field, event.target.value)}
                          />
                        </td>
                      ))}
                      <td className="text-right">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={!canWrite}
                          loading={save.isPending && save.variables === family}
                          onClick={() => save.mutate(family)}
                        >
                          {t('common.save')}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </Modal>
  );
}

interface LandedCostSheet {
  id: string;
  currency: string;
  exchange_rate: number;
  quantity: number;
  goods_amount: number;
  customs_value: number;
  duty: number;
  port_fee: number;
  vat: number;
  total_in_cost: number;
  unit_cost: number;
  vat_recoverable: boolean;
  created_at: string;
}

/**
 * F4: the landed cost is computed, not typed. Freight and transport insurance
 * build the customs value; duty and the port toll are charged on it; import VAT
 * is charged on that value plus the duty, and only enters the cost when the
 * business cannot deduct it. Every computation is kept, so an old margin can
 * still be explained.
 */
function LandedCostModal({ product, onClose }: { product: Product; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const invoiceCurrency = product.purchase_currency ?? 'XPF';
  const [form, setForm] = useState({
    currency: invoiceCurrency,
    exchange_rate: invoiceCurrency === 'XPF' ? 1 : XPF_PER_EUR,
    quantity: 1,
    goods_amount: fromMinor(product.purchase_price ?? 0, invoiceCurrency),
    freight: 0,
    insurance: 0,
    fixed_fees: 0,
    duty_rate: 0,
    port_fee_rate: PORT_FEE_RATE_BP / 100,
    vat_rate: DEFAULT_VAT_RATE_BP / 100,
    vat_recoverable: true,
    vat_settlement: 'supplier',
  });
  const set = (key: keyof typeof form, value: number | string | boolean) => setForm({ ...form, [key]: value });

  const history = useQuery({
    queryKey: ['landed-cost', product.id],
    queryFn: () => api.get<{ unit_cost: number | null; data: LandedCostSheet[] }>(`/products/${product.id}/landed-cost`),
  });

  // The very same function the server runs: the preview cannot drift from what
  // will be stored.
  const preview = computeLandedCost({
    currency: form.currency,
    exchange_rate_micro: Math.round(form.exchange_rate * 1_000_000),
    quantity_milli: Math.round(form.quantity * 1000),
    goods_amount: toMinor(form.goods_amount, form.currency),
    freight: toMinor(form.freight, form.currency),
    insurance: toMinor(form.insurance, form.currency),
    fixed_fees: toMinor(form.fixed_fees, form.currency),
    duty_rate_bp: Math.round(form.duty_rate * 100),
    port_fee_rate_bp: Math.round(form.port_fee_rate * 100),
    vat_rate_bp: Math.round(form.vat_rate * 100),
    vat_recoverable: form.vat_recoverable,
  });

  const save = useMutation({
    mutationFn: () => api.post(`/products/${product.id}/landed-cost`, {
      currency: form.currency,
      exchange_rate_micro: Math.round(form.exchange_rate * 1_000_000),
      quantity: form.quantity,
      goods_amount: toMinor(form.goods_amount, form.currency),
      freight: toMinor(form.freight, form.currency),
      insurance: toMinor(form.insurance, form.currency),
      fixed_fees: toMinor(form.fixed_fees, form.currency),
      duty_rate_bp: Math.round(form.duty_rate * 100),
      port_fee_rate_bp: Math.round(form.port_fee_rate * 100),
      vat_rate_bp: Math.round(form.vat_rate * 100),
      vat_recoverable: form.vat_recoverable,
      vat_settlement: form.vat_settlement,
    }),
    onSuccess: () => {
      toast.success(t('products.landedCostSaved'));
      queryClient.invalidateQueries({ queryKey: ['landed-cost', product.id] });
      queryClient.invalidateQueries({ queryKey: ['product', product.id] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const lines: { label: string; value: number; strong?: boolean }[] = [
    { label: t('products.costGoods'), value: preview.goods },
    { label: t('products.costFreight'), value: preview.freight },
    { label: t('products.costInsurance'), value: preview.insurance },
    { label: t('products.costCustomsValue'), value: preview.customs_value, strong: true },
    { label: t('products.costDuty'), value: preview.duty },
    { label: t('products.costPortFee'), value: preview.port_fee },
    { label: t('products.costFixedFees'), value: preview.fixed_fees },
    { label: t('products.costVat'), value: preview.vat },
    { label: t('products.costInCost'), value: preview.total_in_cost, strong: true },
    { label: t('products.costUnit'), value: preview.unit_cost, strong: true },
  ];

  return (
    <Modal open title={`${t('products.computeLandedCost')} · ${product.name}`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-muted">{t('products.landedCostIntro')}</p>
        <FormGrid>
          <Field label={t('products.costQuantity')} htmlFor="lc_quantity">
            <Input id="lc_quantity" type="number" min="0.001" step="0.001" value={form.quantity} onChange={(event) => set('quantity', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costCurrency')} htmlFor="lc_currency">
            <Select
              id="lc_currency"
              value={form.currency}
              onChange={(event) => setForm({
                ...form,
                currency: event.target.value,
                exchange_rate: event.target.value === 'XPF' ? 1 : XPF_PER_EUR,
              })}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </Field>
          <Field label={t('products.costRate')} htmlFor="lc_rate">
            <Input
              id="lc_rate"
              type="number"
              min="0"
              step="0.0001"
              value={form.exchange_rate}
              disabled={form.currency === 'XPF'}
              onChange={(event) => set('exchange_rate', Number(event.target.value))}
            />
          </Field>
          <Field label={t('products.costGoods')} htmlFor="lc_goods">
            <Input id="lc_goods" type="number" min="0" value={form.goods_amount} onChange={(event) => set('goods_amount', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costFreight')} htmlFor="lc_freight">
            <Input id="lc_freight" type="number" min="0" value={form.freight} onChange={(event) => set('freight', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costInsurance')} htmlFor="lc_insurance">
            <Input id="lc_insurance" type="number" min="0" value={form.insurance} onChange={(event) => set('insurance', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costFixedFees')} htmlFor="lc_fees">
            <Input id="lc_fees" type="number" min="0" value={form.fixed_fees} onChange={(event) => set('fixed_fees', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costDutyRate')} htmlFor="lc_duty">
            <Input id="lc_duty" type="number" min="0" max="100" step="0.01" value={form.duty_rate} onChange={(event) => set('duty_rate', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costPortRate')} htmlFor="lc_port">
            <Input id="lc_port" type="number" min="0" max="100" step="0.01" value={form.port_fee_rate} onChange={(event) => set('port_fee_rate', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costVatRate')} htmlFor="lc_vat">
            <Input id="lc_vat" type="number" min="0" max="100" step="0.01" value={form.vat_rate} onChange={(event) => set('vat_rate', Number(event.target.value))} />
          </Field>
        </FormGrid>

        <Checkbox
          checked={form.vat_recoverable}
          onChange={(event) => set('vat_recoverable', event.target.checked)}
          label={t('products.costVatRecoverable')}
        />
        <p className="text-xs text-muted">{t('products.costVatRecoverableHint')}</p>
        {form.vat_recoverable ? (
          <Field label={t('products.costVatSettlement')} htmlFor="lc_settlement">
            <Select id="lc_settlement" value={form.vat_settlement} onChange={(event) => set('vat_settlement', event.target.value)}>
              <option value="supplier">{t('products.costVatSupplier')}</option>
              <option value="bank">{t('products.costVatBank')}</option>
            </Select>
          </Field>
        ) : null}

        <div className="rounded-lg border border-line bg-surface/60 p-3 text-sm">
          {lines.map((line) => (
            <div key={line.label} className={`flex items-center justify-between gap-3 py-0.5 ${line.strong ? 'font-semibold text-ink-950' : 'text-muted'}`}>
              <span>{line.label}</span>
              <span className="tabular-nums">{formatMoneyValue(line.value, 'XPF')}</span>
            </div>
          ))}
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-ink-950">{t('products.costHistory')}</p>
          {history.data?.data.length ? (
            <ul className="space-y-1 text-xs text-muted">
              {history.data.data.slice(0, 5).map((sheet) => (
                <li key={sheet.id} className="flex items-center justify-between gap-3">
                  <span>
                    {formatDate(sheet.created_at)} · {sheet.quantity.toLocaleString(formatLocale())} × {formatMoneyValue(sheet.unit_cost, 'XPF')}
                    {sheet.vat_recoverable ? '' : ' · TVA non récupérable'}
                  </span>
                  <span className="tabular-nums">{formatMoneyValue(sheet.total_in_cost, 'XPF')}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted">{t('products.costNoHistory')}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={() => save.mutate()} loading={save.isPending} icon={<Calculator className="h-4 w-4" aria-hidden="true" />}>
            {t('products.landedCostSave')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

interface ImportSheetLineForm {
  product_id: string;
  quantity: number;
  goods_amount: number;
  weight_kg: number;
  units: number;
}

interface ImportSheetSummary {
  id: string;
  reference: string | null;
  created_at: string;
  total_in_cost: number;
  line_count: number;
}

interface ImportSheetResult {
  id: string;
  reference: string;
  key: string;
  lines: {
    product_id: string;
    product_name: string;
    goods: number;
    customs_value: number;
    duty: number;
    taxes_total: number;
    total_in_cost: number;
    unit_cost: number;
    share_bp: number;
  }[];
  totals: { total_in_cost: number; total_cash: number; vat: number };
}

const EMPTY_SHEET_LINE: ImportSheetLineForm = {
  product_id: '', quantity: 1, goods_amount: 0, weight_kg: 0, units: 0,
};

/**
 * Q8: one declaration, several articles. The shared costs are paid once, so they
 * are split across the lines by value, weight or quantity with the largest-remainder
 * method, and each line then carries its own heading, taxes and import VAT. The
 * server computes the figures; the screen shows what it returned, so a preview can
 * never disagree with what was stored.
 */
function ImportSheetModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const products = useQuery({
    queryKey: ['products', 'import-sheet'],
    queryFn: () => api.get<ProductListResponse>('/products?per_page=200'),
  });
  const history = useQuery({
    queryKey: ['import-sheets'],
    queryFn: () => api.get<{ data: ImportSheetSummary[] }>('/import-sheets'),
  });
  const [form, setForm] = useState({
    reference: '',
    split_key: 'value' as AllocationKey,
    currency: 'XPF',
    exchange_rate: 1,
    freight: 0,
    insurance: 0,
    fixed_fees: 0,
    duty_rate: 0,
    vat_rate: DEFAULT_VAT_RATE_BP / 100,
    vat_recoverable: true,
    transport: 'sea',
  });
  const [lines, setLines] = useState<ImportSheetLineForm[]>([{ ...EMPTY_SHEET_LINE }]);
  const [result, setResult] = useState<ImportSheetResult | null>(null);
  const set = (key: keyof typeof form, value: number | string | boolean) => setForm({ ...form, [key]: value });
  const setLine = (index: number, patch: Partial<ImportSheetLineForm>) => {
    setLines(lines.map((line, cursor) => (cursor === index ? { ...line, ...patch } : line)));
  };
  const complete = lines.every((line) => line.product_id && line.goods_amount > 0);

  const save = useMutation({
    mutationFn: () => api.post<ImportSheetResult>('/import-sheets', {
      reference: form.reference.trim() || undefined,
      split_key: form.split_key,
      currency: form.currency,
      exchange_rate_micro: Math.round(form.exchange_rate * 1_000_000),
      freight: toMinor(form.freight, form.currency),
      insurance: toMinor(form.insurance, form.currency),
      fixed_fees: toMinor(form.fixed_fees, form.currency),
      duty_rate_bp: Math.round(form.duty_rate * 100),
      vat_rate_bp: Math.round(form.vat_rate * 100),
      vat_recoverable: form.vat_recoverable,
      transport: form.transport,
      lines: lines.map((line) => ({
        product_id: line.product_id,
        quantity: line.quantity,
        goods_amount: toMinor(line.goods_amount, form.currency),
        weight_kg: line.weight_kg,
        units: line.units,
      })),
    }),
    onSuccess: (data) => {
      setResult(data);
      toast.success(t('products.importSheetSaved'));
      queryClient.invalidateQueries({ queryKey: ['product'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['import-sheets'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Modal open title={t('products.importSheet')} onClose={onClose} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-muted">{t('products.importSheetIntro')}</p>
        <FormGrid>
          <Field label={t('products.importSheetSplit')} htmlFor="is_split">
            <Select id="is_split" value={form.split_key} onChange={(event) => set('split_key', event.target.value)}>
              {ALLOCATION_KEYS.map((key) => (
                <option key={key} value={key}>{t(`products.importSheetSplit_${key}`)}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('products.costCurrency')} htmlFor="is_currency">
            <Select
              id="is_currency"
              value={form.currency}
              onChange={(event) => setForm({
                ...form,
                currency: event.target.value,
                exchange_rate: event.target.value === 'XPF' ? 1 : XPF_PER_EUR,
              })}
            >
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </Select>
          </Field>
          <Field label={t('products.costRate')} htmlFor="is_rate">
            <Input
              id="is_rate"
              type="number"
              min="0"
              step="0.0001"
              value={form.exchange_rate}
              disabled={form.currency === 'XPF'}
              onChange={(event) => set('exchange_rate', Number(event.target.value))}
            />
          </Field>
          <Field label={t('products.costFreight')} htmlFor="is_freight">
            <Input id="is_freight" type="number" min="0" value={form.freight} onChange={(event) => set('freight', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costInsurance')} htmlFor="is_insurance">
            <Input id="is_insurance" type="number" min="0" value={form.insurance} onChange={(event) => set('insurance', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costFixedFees')} htmlFor="is_fees">
            <Input id="is_fees" type="number" min="0" value={form.fixed_fees} onChange={(event) => set('fixed_fees', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costDutyRate')} htmlFor="is_duty">
            <Input id="is_duty" type="number" min="0" max="100" step="0.01" value={form.duty_rate} onChange={(event) => set('duty_rate', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costVatRate')} htmlFor="is_vat">
            <Input id="is_vat" type="number" min="0" max="100" step="0.01" value={form.vat_rate} onChange={(event) => set('vat_rate', Number(event.target.value))} />
          </Field>
          <Field label={t('products.costQuantity')} htmlFor="is_transport">
            <Select id="is_transport" value={form.transport} onChange={(event) => set('transport', event.target.value)}>
              <option value="sea">{t('products.transportSea')}</option>
              <option value="air">{t('products.transportAir')}</option>
            </Select>
          </Field>
          <Field label={t('products.landedCost')} htmlFor="is_reference">
            <Input id="is_reference" value={form.reference} onChange={(event) => set('reference', event.target.value)} placeholder="IS-…" />
          </Field>
        </FormGrid>
        <Checkbox
          checked={form.vat_recoverable}
          onChange={(event) => set('vat_recoverable', event.target.checked)}
          label={t('products.costVatRecoverable')}
        />

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-semibold text-ink-950">{t('products.importSheetLine')}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setLines([...lines, { ...EMPTY_SHEET_LINE }])}
              icon={<Plus className="h-4 w-4" aria-hidden="true" />}
            >
              {t('products.importSheetAdd')}
            </Button>
          </div>
          {lines.map((line, index) => (
            <div key={index} className="grid gap-2 sm:grid-cols-5">
              <Select
                aria-label={t('products.importSheetProduct')}
                value={line.product_id}
                onChange={(event) => setLine(index, { product_id: event.target.value })}
              >
                <option value="">{t('products.importSheetProduct')}</option>
                {(products.data?.data ?? []).map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </Select>
              <Input
                type="number" min="0.001" step="0.001" aria-label={t('products.costQuantity')}
                value={line.quantity} onChange={(event) => setLine(index, { quantity: Number(event.target.value) })}
              />
              <Input
                type="number" min="0" aria-label={t('products.importSheetGoods')}
                value={line.goods_amount} onChange={(event) => setLine(index, { goods_amount: Number(event.target.value) })}
              />
              <Input
                type="number" min="0" aria-label={t('products.importSheetWeight')}
                value={line.weight_kg} onChange={(event) => setLine(index, { weight_kg: Number(event.target.value) })}
              />
              <div className="flex gap-1">
                <Input
                  type="number" min="0" aria-label={t('products.importSheetUnits')}
                  value={line.units} onChange={(event) => setLine(index, { units: Number(event.target.value) })}
                />
                {lines.length > 1 ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label={t('products.importSheetRemoveLine')}
                    onClick={() => setLines(lines.filter((_, cursor) => cursor !== index))}
                    icon={<Trash2 className="h-4 w-4" aria-hidden="true" />}
                  />
                ) : null}
              </div>
            </div>
          ))}
        </div>

        {result ? (
          <div className="space-y-2 rounded-lg border border-line bg-surface/60 p-3 text-sm">
            <p className="font-semibold text-ink-950">{result.reference} · {t('products.importSheetTotals')}</p>
            <ul className="space-y-1 text-xs text-muted">
              {result.lines.map((line) => (
                <li key={line.product_id} className="flex items-center justify-between gap-3">
                  <span>
                    {line.product_name} · {t('products.importSheetShare')} {(line.share_bp / 100).toFixed(2)} %
                  </span>
                  <span className="tabular-nums">
                    {formatMoneyValue(line.total_in_cost, 'XPF')} · {formatMoneyValue(line.unit_cost, 'XPF')} / u
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between gap-3 font-semibold text-ink-950">
              <span>{t('products.costInCost')}</span>
              <span className="tabular-nums">{formatMoneyValue(result.totals.total_in_cost, 'XPF')}</span>
            </div>
          </div>
        ) : null}

        <div>
          <p className="mb-1 text-sm font-semibold text-ink-950">{t('products.importSheetHistory')}</p>
          {(history.data?.data ?? []).length ? (
            <ul className="space-y-1 text-xs text-muted">
              {(history.data?.data ?? []).slice(0, 5).map((sheet) => (
                <li key={sheet.id} className="flex items-center justify-between gap-3">
                  <span>
                    {formatDate(sheet.created_at)} · {sheet.reference ?? '—'} · {sheet.line_count} {t('products.importSheetLines')}
                  </span>
                  <span className="tabular-nums">{formatMoneyValue(sheet.total_in_cost, 'XPF')}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted">{t('products.importSheetNone')}</p>}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button
            onClick={() => save.mutate()}
            loading={save.isPending}
            disabled={!complete}
            icon={<Calculator className="h-4 w-4" aria-hidden="true" />}
          >
            {t('products.importSheetSave')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ProductsPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const [kitQty, setKitQty] = useState(1);
  const toast = useToast();
  const { confirm } = useConfirm();
  const currency = company?.currency ?? 'XPF';
  const taxRates = useTaxRates();
  const [search, setSearch] = useState('');
  const deferred = useDeferredValue(search);
  const [filters, setFilters] = useState({ item_type: '', lifecycle_status: '', family: '', stock: '' });
  const [editing, setEditing] = useState<Product | null>(null);
  const [tab, setTab] = useState<TabKey>('general');
  const startNew = useNewRecordFlag();
  const [open, setOpen] = useState(startNew);
  const [form, setForm] = useState<ProductForm>(emptyForm(company?.default_tax_rate ?? DEFAULT_TAX_RATE));
  const [stockFor, setStockFor] = useState<Product | null>(null);
  const [stockForm, setStockForm] = useState({ delta: 0, reason: '', kind: 'adjust', location: '', lot: '' });
  const [linkPick, setLinkPick] = useState('');
  const [lotsFor, setLotsFor] = useState<Product | null>(null);
  const [locationsFor, setLocationsFor] = useState<Product | null>(null);
  const [vendorsFor, setVendorsFor] = useState<Product | null>(null);
  const [linksFor, setLinksFor] = useState<Product | null>(null);
  const [familyAccountsOpen, setFamilyAccountsOpen] = useState(false);
  const [landedFor, setLandedFor] = useState<Product | null>(null);
  const [importSheetOpen, setImportSheetOpen] = useState(false);

  const money = (minor: number | null | undefined) => fromMinor(minor ?? 0, currency);
  const isService = form.item_type === 'service';
  const visibleTabs = (isService ? SERVICE_TABS : PRODUCT_TABS) as readonly TabKey[];
  const activeTab: TabKey = visibleTabs.includes(tab) ? tab : 'general';

  const products = useQuery({
    queryKey: ['products', deferred, filters],
    queryFn: () => api.get<ProductListResponse>(
      `/products${toQuery({ q: deferred, per_page: 100, ...filters })}`,
    ),
  });

  const detail = useQuery({
    queryKey: ['product', editing?.id],
    queryFn: () => api.get<ProductDetail>(`/products/${editing!.id}`),
    // The finance tab needs the family's default accounts (F2) as placeholders,
    // so the sheet is loaded for every tab rather than only for stock.
    enabled: Boolean(editing),
  });
  const inherited = editing ? detail.data?.effective_accounts ?? null : null;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['products'] });
    queryClient.invalidateQueries({ queryKey: ['product'] });
  };

  const set = <K extends keyof ProductForm>(key: K, value: ProductForm[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const openForm = (product?: Product) => {
    setEditing(product ?? null);
    setTab('general');
    setForm(product ? {
      name: product.name,
      product_key: product.product_key ?? '',
      description: product.description ?? '',
      item_type: product.item_type,
      family: product.family ?? '',
      subfamily: product.subfamily ?? '',
      lifecycle_status: product.lifecycle_status,
      buyer: product.buyer ?? '',
      supplier_id: product.supplier_id ?? '',
      supplier_name: product.supplier_name ?? '',
      supplier_ref: product.supplier_ref ?? '',
      purchase_price: money(product.purchase_price),
      purchase_currency: product.purchase_currency,
      moq: product.moq,
      order_multiple: product.order_multiple,
      lead_time_days: product.lead_time_days,
      stock_mode: product.stock_mode,
      weight_gross_g: product.weight_gross_g,
      weight_net_g: product.weight_net_g,
      volume_cm3: product.volume_cm3,
      warehouse_location: product.warehouse_location ?? '',
      customs_code: product.customs_code ?? '',
      valuation_method: product.valuation_method,
      landed_cost: money(product.landed_cost),
      purchase_account: product.purchase_account ?? '',
      sales_account: product.sales_account ?? '',
      stock_account: product.stock_account ?? '',
      analytic_axis: product.analytic_axis ?? '',
      unit_price: money(product.unit_price),
      price_pro: money(product.price_pro),
      price_member: money(product.price_member),
      margin_target: product.margin_target,
      volume_discounts: product.volume_discounts ?? [],
      bom_mode: product.bom_mode,
      bom: product.bom ?? [],
      substitutes: product.substitutes ?? [],
      accessories: product.accessories ?? [],
      reorder_point: product.reorder_point,
      safety_stock: product.safety_stock,
      max_stock: product.max_stock,
      replenish_mode: product.replenish_mode,
      quantity: product.quantity,
      track_quantity: Boolean(product.track_quantity),
      lot_tracking: product.lot_tracking ?? 'none',
      allow_negative_stock: Boolean(product.allow_negative_stock),
      cost: money(product.cost),
      tax_rate: product.tax_rate,
      invoice_label: product.invoice_label ?? '',
      service_type: product.service_type,
      billing_unit: product.billing_unit,
      billing_trigger: product.billing_trigger,
      min_billable: product.min_billable,
      overtime_rules: product.overtime_rules ?? [],
      expertise_levels: (product.expertise_levels ?? []).map((level) => ({
        level: level.level,
        price: money(level.price),
      })),
      cps_rate: product.cps_rate,
      tax_exemption_note: product.tax_exemption_note ?? '',
      skills: product.skills ?? '',
      estimated_hours: product.estimated_hours,
      project_template: product.project_template ?? '',
      sla_response_hours: product.sla_response_hours,
      sla_resolution_hours: product.sla_resolution_hours,
      billing_frequency: product.billing_frequency,
      renewal_mode: product.renewal_mode,
      notice_days: product.notice_days,
      price_revision_index: product.price_revision_index ?? '',
      expense_mode: product.expense_mode,
      travel_zone: product.travel_zone ?? '',
      deliverables: product.deliverables ?? '',
      client_prerequisites: product.client_prerequisites ?? '',
      subcontract_account: product.subcontract_account ?? '',
      revenue_recognition: product.revenue_recognition,
    } : emptyForm(company?.default_tax_rate ?? DEFAULT_TAX_RATE));
    setOpen(true);
  };

  const save = useMutation({
    mutationFn: () => {
      const body = {
        ...form,
        travel_zone: form.travel_zone || null,
        unit_price: toMinor(form.unit_price, currency),
        cost: toMinor(form.cost, currency),
        purchase_price: toMinor(form.purchase_price, currency),
        landed_cost: toMinor(form.landed_cost, currency),
        price_pro: toMinor(form.price_pro, currency),
        price_member: toMinor(form.price_member, currency),
        expertise_levels: form.expertise_levels.map((level) => ({
          level: level.level,
          price: toMinor(level.price, currency),
        })),
      };
      return editing ? api.patch(`/products/${editing.id}`, body) : api.post('/products', body);
    },
    onSuccess: () => {
      toast.success(editing ? t('common.save') : t('products.new'));
      setOpen(false);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/products/${id}`),
    onSuccess: invalidate,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const adjust = useMutation({
    mutationFn: () => api.post(`/products/${stockFor!.id}/adjust-stock`, {
      delta: stockForm.delta,
      reason: stockForm.reason,
      kind: stockForm.kind,
      location: stockForm.location,
      lot: stockForm.lot,
    }),
    onSuccess: () => {
      toast.success(t('products.adjustStock'));
      setStockFor(null);
      setStockForm({ delta: 0, reason: '', kind: 'adjust', location: '', lot: '' });
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  // Assembling is a stock document, not a sheet edit: the kit must already exist
  // for the components to be picked from.
  const kitAction = useMutation({
    mutationFn: ({ kind, quantity }: { kind: 'assemble' | 'disassemble'; quantity: number }) =>
      api.post(`/products/${editing!.id}/${kind}`, { quantity }),
    onSuccess: (_result, variables) => {
      toast.success(t(variables.kind === 'assemble' ? 'products.assembled' : 'products.disassembled'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const tabLabels: Record<TabKey, string> = {
    general: t('products.tabGeneral'),
    purchasing: t('products.tabPurchasing'),
    logistics: t('products.tabLogistics'),
    finance: t('products.tabFinance'),
    pricing: t('products.tabPricing'),
    links: t('products.tabLinks'),
    stock: t('products.tabStock'),
    billing: t('products.tabBilling'),
    planning: t('products.tabPlanning'),
    contract: t('products.tabContract'),
    travel: t('products.tabTravel'),
    deliverables: t('products.tabDeliverables'),
  };

  const selectable = products.data?.data ?? [];
  const productName = (id: string) => selectable.find((item) => item.id === id)?.name ?? id;

  const alertLabel = (product: Product) =>
    product.stock_alert === 'out' ? t('products.outOfStock')
      : product.stock_alert === 'low' ? t('products.lowStock')
        : t('products.stockOk');

  const auditFields = [
    { label: t('products.createdBy'), value: editing?.created_by ?? null },
    { label: t('products.updatedBy'), value: editing?.updated_by ?? null },
    { label: t('products.revision'), value: String(editing?.revision ?? 1) },
    { label: t('products.createdAt'), value: editing?.created_at ? formatDate(editing.created_at) : null },
    { label: t('products.updatedAt'), value: editing?.updated_at ? formatDate(editing.updated_at) : null },
  ];

  return (
    <>
      <div className="mb-3">
        <SavedFilterBar list="products" query={search} onApply={setSearch} />
      </div>
      <PageHeader
        title={t('products.title')}
        subtitle={t('products.subtitle')}
        actions={<>
          <ExportCsvButton entity="products" />
          <GatedButton
            permission="products.write"
            variant="secondary"
            onClick={() => setFamilyAccountsOpen(true)}
            icon={<Landmark className="h-4 w-4" aria-hidden="true" />}
          >
            {t('products.familyAccounts')}
          </GatedButton>
          <GatedButton
            permission="products.write"
            variant="secondary"
            onClick={() => setImportSheetOpen(true)}
            icon={<Truck className="h-4 w-4" aria-hidden="true" />}
          >
            {t('products.importSheet')}
          </GatedButton>
          <GatedButton permission="products.write" onClick={() => openForm()} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('products.new')}</GatedButton>
        </>}
      />

      <SectionCard
        title={t('products.title')}
        actions={<SearchInput value={search} onChange={setSearch} placeholder={t('common.search')} className="w-full sm:w-64" />}
        bodyClassName="table-wrap"
      >
        <div className="grid grid-cols-2 gap-2 border-b border-line bg-surface/60 px-4 py-3 sm:grid-cols-4">
          <Select
            aria-label={t('products.filterType')}
            value={filters.item_type}
            onChange={(event) => setFilters({ ...filters, item_type: event.target.value })}
          >
            <option value="">{t('products.all')} — {t('products.filterType')}</option>
            {ITEM_TYPES.map((type) => <option key={type} value={type}>{ITEM_TYPE_LABELS[type]}</option>)}
          </Select>
          <Select
            aria-label={t('products.filterStatus')}
            value={filters.lifecycle_status}
            onChange={(event) => setFilters({ ...filters, lifecycle_status: event.target.value })}
          >
            <option value="">{t('products.all')} — {t('products.filterStatus')}</option>
            {LIFECYCLE_STATUSES.map((status) => <option key={status} value={status}>{LIFECYCLE_LABELS[status]}</option>)}
          </Select>
          <Select
            aria-label={t('products.filterFamily')}
            value={filters.family}
            onChange={(event) => setFilters({ ...filters, family: event.target.value })}
          >
            <option value="">{t('products.all')} — {t('products.filterFamily')}</option>
            {(products.data?.families ?? []).map((family) => <option key={family} value={family}>{family}</option>)}
          </Select>
          <Select
            aria-label={t('products.filterStock')}
            value={filters.stock}
            onChange={(event) => setFilters({ ...filters, stock: event.target.value })}
          >
            <option value="">{t('products.all')} — {t('products.filterStock')}</option>
            <option value="low">{t('products.lowStock')}</option>
            <option value="out">{t('products.outOfStock')}</option>
          </Select>
        </div>

        {products.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : products.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('products.type')}</th>
                <th scope="col">{t('products.status')}</th>
                <th scope="col" className="text-right">{t('products.price')}</th>
                <th scope="col" className="text-right">{t('products.margin')}</th>
                <th scope="col" className="text-right">{t('products.stock')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {products.data.data.map((product) => (
                <tr key={product.id}>
                  <td>
                    <p className="font-medium">{product.name}</p>
                    <p className="text-xs text-muted">
                      {[product.product_key, product.family].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </td>
                  <td className="text-xs text-muted">{ITEM_TYPE_LABELS[product.item_type as keyof typeof ITEM_TYPE_LABELS] ?? product.item_type}</td>
                  <td className="text-xs">
                    <span className={product.lifecycle_status === 'active' ? 'text-success-600' : 'text-muted'}>
                      {LIFECYCLE_LABELS[product.lifecycle_status as keyof typeof LIFECYCLE_LABELS] ?? product.lifecycle_status}
                    </span>
                  </td>
                  <td className="text-right tabular-nums">{formatMoneyValue(product.unit_price, currency)}</td>
                  <td className="text-right tabular-nums">
                    {product.margin_rate === null ? '—' : `${product.margin_rate} %`}
                  </td>
                  <td className="text-right tabular-nums">
                    {product.item_type === 'service' ? (
                      <span className="text-muted">{BILLING_UNIT_LABELS[product.billing_unit as keyof typeof BILLING_UNIT_LABELS] ?? '—'}</span>
                    ) : product.track_quantity ? (
                      <span className={ALERT_CLASSES[product.stock_alert]}>
                        {product.quantity.toLocaleString(formatLocale())}
                        {product.stock_alert !== 'ok' ? ` · ${alertLabel(product)}` : ''}
                      </span>
                    ) : '—'}
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900"
                        aria-label={`${t('records.view')} ${product.name}`}
                        onClick={() => showRecord({
                        trace: { entityType: 'product', entityId: product.id },
                          title: product.name,
                          subtitle: [product.product_key, product.family, product.subfamily].filter(Boolean).join(' · ') || undefined,
                          fields: product.item_type === 'service'
                            ? [
                              { label: t('products.invoiceLabel'), value: product.invoice_label },
                              { label: t('products.serviceType'), value: SERVICE_TYPE_LABELS[product.service_type as keyof typeof SERVICE_TYPE_LABELS] },
                              { label: t('products.billingUnit'), value: BILLING_UNIT_LABELS[product.billing_unit as keyof typeof BILLING_UNIT_LABELS] },
                              { label: t('products.billingTrigger'), value: BILLING_TRIGGER_LABELS[product.billing_trigger as keyof typeof BILLING_TRIGGER_LABELS] },
                              { label: t('products.price'), value: formatMoneyValue(product.unit_price, currency) },
                              { label: t('products.minBillable'), value: product.min_billable.toLocaleString(formatLocale()) },
                              { label: t('products.loadedCost'), value: product.cost_masked ? '—' : formatMoneyValue(product.cost ?? 0, currency) },
                              { label: t('products.margin'), value: product.margin_rate === null ? '—' : `${product.margin_rate} %` },
                              { label: t('products.cpsRate'), value: `${product.cps_rate} %` },
                              { label: t('products.cpsAmount'), value: formatMoneyValue(product.cps_amount, currency) },
                              { label: t('products.estimatedHours'), value: product.estimated_hours.toLocaleString(formatLocale()) },
                              { label: t('products.skills'), value: product.skills },
                              { label: t('products.slaResponse'), value: `${product.sla_response_hours} h` },
                              { label: t('products.slaResolution'), value: `${product.sla_resolution_hours} h` },
                              { label: t('products.billingFrequency'), value: FREQUENCY_LABELS[product.billing_frequency] ?? product.billing_frequency },
                              { label: t('products.renewalMode'), value: RENEWAL_MODE_LABELS[product.renewal_mode as keyof typeof RENEWAL_MODE_LABELS] },
                              { label: t('products.noticeDays'), value: `${product.notice_days} j` },
                              { label: t('products.expenseMode'), value: EXPENSE_MODE_LABELS[product.expense_mode as keyof typeof EXPENSE_MODE_LABELS] },
                              { label: t('products.travelZone'), value: product.travel_zone ? TRAVEL_ZONE_LABELS[product.travel_zone as keyof typeof TRAVEL_ZONE_LABELS] : null },
                              { label: t('products.salesAccount'), value: product.sales_account },
                              { label: t('products.subcontractAccount'), value: product.subcontract_account },
                              { label: t('products.revenueRecognition'), value: REVENUE_RECOGNITION_LABELS[product.revenue_recognition as keyof typeof REVENUE_RECOGNITION_LABELS] },
                              { label: t('products.deliverables'), value: product.deliverables, wide: true },
                              { label: t('products.clientPrerequisites'), value: product.client_prerequisites, wide: true },
                              { label: t('products.revision'), value: String(product.revision) },
                              { label: t('common.description'), value: product.description, wide: true },
                            ]
                            : [
                              { label: t('products.itemType'), value: ITEM_TYPE_LABELS[product.item_type as keyof typeof ITEM_TYPE_LABELS] },
                              { label: t('products.status'), value: LIFECYCLE_LABELS[product.lifecycle_status as keyof typeof LIFECYCLE_LABELS] },
                              { label: t('products.price'), value: formatMoneyValue(product.unit_price, currency) },
                              { label: t('products.pricePro'), value: formatMoneyValue(product.price_pro, currency) },
                              { label: t('products.priceMember'), value: formatMoneyValue(product.price_member, currency) },
                              { label: t('products.cost'), value: product.cost_masked ? '—' : formatMoneyValue(product.cost ?? 0, currency) },
                              { label: t('products.margin'), value: product.margin_rate === null ? '—' : `${product.margin_rate} %` },
                              { label: t('products.marginTarget'), value: `${product.margin_target} %` },
                              { label: t('products.qtyOnHand'), value: product.track_quantity ? product.quantity.toLocaleString(formatLocale()) : '—' },
                              { label: t('products.suggestedReorder'), value: product.track_quantity ? product.suggested_reorder.toLocaleString(formatLocale()) : '—' },
                              { label: t('products.supplier'), value: product.supplier_name },
                              { label: t('products.supplierRef'), value: product.supplier_ref },
                              { label: t('products.leadTime'), value: product.lead_time_days ? `${product.lead_time_days} j` : null },
                              { label: t('products.stockMode'), value: STOCK_MODE_LABELS[product.stock_mode as keyof typeof STOCK_MODE_LABELS] },
                              { label: t('products.location'), value: product.warehouse_location },
                              { label: t('products.customsCode'), value: product.customs_code },
                              { label: t('products.valuation'), value: VALUATION_METHOD_LABELS[product.valuation_method as keyof typeof VALUATION_METHOD_LABELS] },
                              { label: t('products.landedCost'), value: product.cost_masked ? '—' : formatMoneyValue(product.landed_cost ?? 0, currency) },
                              { label: t('products.purchaseAccount'), value: product.purchase_account },
                              { label: t('products.salesAccount'), value: product.sales_account },
                              { label: t('products.stockAccount'), value: product.stock_account },
                              { label: t('products.analyticAxis'), value: product.analytic_axis },
                              { label: t('products.reorderPoint'), value: product.track_quantity ? product.reorder_point.toLocaleString(formatLocale()) : null },
                              { label: t('products.safetyStock'), value: product.track_quantity ? product.safety_stock.toLocaleString(formatLocale()) : null },
                              { label: t('products.replenishMode'), value: REPLENISH_MODE_LABELS[product.replenish_mode as keyof typeof REPLENISH_MODE_LABELS] },
                              { label: t('products.revision'), value: String(product.revision) },
                              { label: t('products.createdBy'), value: product.created_by },
                              { label: t('common.description'), value: product.description, wide: true },
                            ],
                        })}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                      {can('products.write') || can('stock.adjust') ? (
                        <>
                          {can('stock.adjust') && product.item_type !== 'service' ? (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900"
                              aria-label={`${t('products.adjustStock')} ${product.name}`}
                              onClick={() => { setStockFor(product); setStockForm({ delta: 0, reason: '', kind: 'adjust', location: product.warehouse_location ?? '', lot: '' }); }}
                            >
                              <History className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                          {can('stock.adjust') && product.lot_tracking !== 'none' ? (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900"
                              aria-label={`${t('products.lots')} ${product.name}`}
                              onClick={() => setLotsFor(product)}
                            >
                              <Package className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                          {can('stock.adjust') && product.track_quantity && product.lot_tracking === 'none' ? (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900"
                              aria-label={`${t('products.locations')} ${product.name}`}
                              onClick={() => setLocationsFor(product)}
                            >
                              <MapPin className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                          {can('products.write') && product.item_type !== 'service' ? (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900"
                              aria-label={`${t('products.vendors')} ${product.name}`}
                              onClick={() => setVendorsFor(product)}
                            >
                              <Truck className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900"
                            aria-label={`${t('products.links')} ${product.name}`}
                            onClick={() => setLinksFor(product)}
                          >
                            <Link2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('common.edit')} ${product.name}`} onClick={() => openForm(product)}>
                            <Pencil className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </>
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

      {/* ---------- Fiche article / fiche service ---------- */}
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? `${t('common.edit')} — ${editing.name}` : t('products.new')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={save.isPending} onClick={() => save.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-5">
          <div role="tablist" className="flex flex-wrap gap-1 rounded-xl bg-surface p-1">
            {visibleTabs.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={activeTab === key}
                onClick={() => setTab(key)}
                disabled={key === 'stock' && !editing}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
                  activeTab === key ? 'bg-white text-ink-950 shadow-sm' : 'text-muted hover:text-ink-900'
                } disabled:opacity-40`}
              >
                {tabLabels[key]}
              </button>
            ))}
          </div>

          {activeTab === 'general' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionGeneral')}</legend>
              <FormGrid>
                <Field label={t('common.name')} htmlFor="product_name" required>
                  <Input id="product_name" value={form.name} onChange={(event) => set('name', event.target.value)} />
                </Field>
                <Field label={t('products.sku')} htmlFor="product_key">
                  <Input id="product_key" value={form.product_key} onChange={(event) => set('product_key', event.target.value)} />
                </Field>
                <Field label={t('products.itemType')} htmlFor="item_type">
                  <Select id="item_type" value={form.item_type} onChange={(event) => set('item_type', event.target.value)}>
                    {ITEM_TYPES.map((type) => <option key={type} value={type}>{ITEM_TYPE_LABELS[type]}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.lifecycle')} htmlFor="lifecycle_status">
                  <Select id="lifecycle_status" value={form.lifecycle_status} onChange={(event) => set('lifecycle_status', event.target.value)}>
                    {LIFECYCLE_STATUSES.map((status) => <option key={status} value={status}>{LIFECYCLE_LABELS[status]}</option>)}
                  </Select>
                </Field>
                {isService ? (
                  <>
                    <Field label={t('products.invoiceLabel')} htmlFor="invoice_label">
                      <Input id="invoice_label" value={form.invoice_label} onChange={(event) => set('invoice_label', event.target.value)} />
                    </Field>
                    <Field label={t('products.serviceType')} htmlFor="service_type">
                      <Select id="service_type" value={form.service_type} onChange={(event) => set('service_type', event.target.value)}>
                        {SERVICE_TYPES.map((type) => <option key={type} value={type}>{SERVICE_TYPE_LABELS[type]}</option>)}
                      </Select>
                    </Field>
                  </>
                ) : null}
                <Field label={t('products.familyCol')} htmlFor="family" hint={t('products.familyHint')}>
                  <Input id="family" list="product-families" value={form.family} onChange={(event) => set('family', event.target.value)} />
                </Field>
                <Field label={t('products.subfamily')} htmlFor="subfamily">
                  <Input id="subfamily" value={form.subfamily} onChange={(event) => set('subfamily', event.target.value)} />
                </Field>
                <Field label={t('products.buyer')} htmlFor="buyer">
                  <Input id="buyer" value={form.buyer} onChange={(event) => set('buyer', event.target.value)} />
                </Field>
                <Field label={t('invoices.lineTax')} htmlFor="product_tax">
                  <Select id="product_tax" value={form.tax_rate} onChange={(event) => set('tax_rate', Number(event.target.value))}>
                    {taxRates.map((rate) => <option key={rate.rate} value={rate.rate}>{rate.rate} %</option>)}
                  </Select>
                </Field>
              </FormGrid>
              <Field label={t('common.description')} htmlFor="product_description">
                <Textarea id="product_description" value={form.description} onChange={(event) => set('description', event.target.value)} />
              </Field>
              <datalist id="product-families">
                {(products.data?.families ?? []).map((family) => <option key={family} value={family} />)}
              </datalist>
            </fieldset>
          ) : null}

          {activeTab === 'billing' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionBilling')}</legend>
              <FormGrid>
                <Field label={t('products.billingUnit')} htmlFor="billing_unit">
                  <Select id="billing_unit" value={form.billing_unit} onChange={(event) => set('billing_unit', event.target.value)}>
                    {BILLING_UNITS.map((unit) => <option key={unit} value={unit}>{BILLING_UNIT_LABELS[unit]}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.billingTrigger')} htmlFor="billing_trigger">
                  <Select id="billing_trigger" value={form.billing_trigger} onChange={(event) => set('billing_trigger', event.target.value)}>
                    {BILLING_TRIGGERS.map((trigger) => <option key={trigger} value={trigger}>{BILLING_TRIGGER_LABELS[trigger]}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.minBillable')} htmlFor="min_billable">
                  <Input id="min_billable" type="number" min="0" step="0.25" value={form.min_billable} onChange={(event) => set('min_billable', Number(event.target.value))} />
                </Field>
              </FormGrid>
              <div className="space-y-2">
                <p className="label">{t('products.overtimeRules')}</p>
                {form.overtime_rules.map((rule, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <Field label={t('products.overtimeLabel')} htmlFor={`overtime_label_${index}`} className="flex-1">
                      <Input
                        id={`overtime_label_${index}`}
                        value={rule.label}
                        onChange={(event) => set('overtime_rules', form.overtime_rules.map((item, position) => position === index ? { ...item, label: event.target.value } : item))}
                      />
                    </Field>
                    <Field label={t('products.overtimePercent')} htmlFor={`overtime_percent_${index}`} className="w-32">
                      <Input
                        id={`overtime_percent_${index}`}
                        type="number"
                        min="0"
                        max="300"
                        value={rule.percent}
                        onChange={(event) => set('overtime_rules', form.overtime_rules.map((item, position) => position === index ? { ...item, percent: Number(event.target.value) } : item))}
                      />
                    </Field>
                    <Button variant="secondary" onClick={() => set('overtime_rules', form.overtime_rules.filter((_, position) => position !== index))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  onClick={() => set('overtime_rules', [...form.overtime_rules, { label: 'Nuit', percent: 25 }])}
                >
                  {t('products.addOvertime')}
                </Button>
              </div>
            </fieldset>
          ) : null}

          {activeTab === 'pricing' && isService ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionServicePricing')}</legend>
              <FormGrid>
                <Field label={t('products.price')} htmlFor="unit_price" hint={t('products.hourlyRateHint')}>
                  <Input id="unit_price" type="number" min="0" value={form.unit_price} onChange={(event) => set('unit_price', Number(event.target.value))} />
                </Field>
                <Field label={t('products.loadedCost')} htmlFor="service_cost">
                  <Input id="service_cost" type="number" min="0" value={form.cost} onChange={(event) => set('cost', Number(event.target.value))} />
                </Field>
                <Field label={t('products.marginTarget')} htmlFor="margin_target">
                  <Input id="margin_target" type="number" min="0" max="100" value={form.margin_target} onChange={(event) => set('margin_target', Number(event.target.value))} />
                </Field>
                <Field label={t('products.cpsRate')} htmlFor="cps_rate">
                  <Input id="cps_rate" type="number" min="0" max="20" step="0.1" value={form.cps_rate} onChange={(event) => set('cps_rate', Number(event.target.value))} />
                </Field>
              </FormGrid>
              <div className="space-y-2">
                <p className="label">{t('products.expertiseLevels')}</p>
                {form.expertise_levels.map((level, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <Field label={t('products.expertiseLevel')} htmlFor={`level_name_${index}`} className="flex-1">
                      <Input
                        id={`level_name_${index}`}
                        value={level.level}
                        onChange={(event) => set('expertise_levels', form.expertise_levels.map((item, position) => position === index ? { ...item, level: event.target.value } : item))}
                      />
                    </Field>
                    <Field label={t('products.expertisePrice')} htmlFor={`level_price_${index}`} className="w-40">
                      <Input
                        id={`level_price_${index}`}
                        type="number"
                        min="0"
                        value={level.price}
                        onChange={(event) => set('expertise_levels', form.expertise_levels.map((item, position) => position === index ? { ...item, price: Number(event.target.value) } : item))}
                      />
                    </Field>
                    <Button variant="secondary" onClick={() => set('expertise_levels', form.expertise_levels.filter((_, position) => position !== index))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button
                  variant="secondary"
                  onClick={() => set('expertise_levels', [...form.expertise_levels, { level: 'Senior', price: form.unit_price }])}
                >
                  {t('products.addExpertise')}
                </Button>
              </div>
              <p className="text-xs text-muted">
                {t('products.cpsAmount')} : {formatMoneyValue(cpsAmount(toMinor(form.unit_price, currency), form.cps_rate), currency)}
                {' · '}
                {t('products.margin')} : {marginRate(toMinor(form.unit_price, currency), toMinor(form.cost, currency)) ?? '—'} %
              </p>
              <Field label={t('products.taxExemptionNote')} htmlFor="tax_exemption_note">
                <Textarea id="tax_exemption_note" value={form.tax_exemption_note} onChange={(event) => set('tax_exemption_note', event.target.value)} />
              </Field>
            </fieldset>
          ) : null}

          {activeTab === 'planning' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionPlanning')}</legend>
              <FormGrid>
                <Field label={t('products.estimatedHours')} htmlFor="estimated_hours">
                  <Input id="estimated_hours" type="number" min="0" step="0.25" value={form.estimated_hours} onChange={(event) => set('estimated_hours', Number(event.target.value))} />
                </Field>
                <Field label={t('products.projectTemplate')} htmlFor="project_template">
                  <Input id="project_template" value={form.project_template} onChange={(event) => set('project_template', event.target.value)} />
                </Field>
                <Field label={t('products.slaResponse')} htmlFor="sla_response_hours">
                  <Input id="sla_response_hours" type="number" min="0" value={form.sla_response_hours} onChange={(event) => set('sla_response_hours', Number(event.target.value))} />
                </Field>
                <Field label={t('products.slaResolution')} htmlFor="sla_resolution_hours">
                  <Input id="sla_resolution_hours" type="number" min="0" value={form.sla_resolution_hours} onChange={(event) => set('sla_resolution_hours', Number(event.target.value))} />
                </Field>
              </FormGrid>
              <Field label={t('products.skills')} htmlFor="skills">
                <Textarea id="skills" value={form.skills} onChange={(event) => set('skills', event.target.value)} />
              </Field>
            </fieldset>
          ) : null}

          {activeTab === 'contract' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionContract')}</legend>
              <FormGrid>
                <Field label={t('products.billingFrequency')} htmlFor="billing_frequency">
                  <Select id="billing_frequency" value={form.billing_frequency} onChange={(event) => set('billing_frequency', event.target.value)}>
                    {FREQUENCIES.map((frequency) => (
                      <option key={frequency} value={frequency}>{FREQUENCY_LABELS[frequency] ?? frequency}</option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('products.renewalMode')} htmlFor="renewal_mode">
                  <Select id="renewal_mode" value={form.renewal_mode} onChange={(event) => set('renewal_mode', event.target.value)}>
                    {RENEWAL_MODES.map((mode) => <option key={mode} value={mode}>{RENEWAL_MODE_LABELS[mode]}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.noticeDays')} htmlFor="notice_days">
                  <Input id="notice_days" type="number" min="0" max="730" value={form.notice_days} onChange={(event) => set('notice_days', Number(event.target.value))} />
                </Field>
                <Field label={t('products.priceRevisionIndex')} htmlFor="price_revision_index">
                  <Input id="price_revision_index" value={form.price_revision_index} onChange={(event) => set('price_revision_index', event.target.value)} />
                </Field>
              </FormGrid>
              <p className="text-xs text-muted">
                {t('products.nextBilling')} : {nextBillingDate(todayISO(), form.billing_frequency)}
              </p>
            </fieldset>
          ) : null}

          {activeTab === 'travel' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionTravel')}</legend>
              <FormGrid>
                <Field label={t('products.expenseMode')} htmlFor="expense_mode">
                  <Select id="expense_mode" value={form.expense_mode} onChange={(event) => set('expense_mode', event.target.value)}>
                    {EXPENSE_MODES.map((mode) => <option key={mode} value={mode}>{EXPENSE_MODE_LABELS[mode]}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.travelZone')} htmlFor="travel_zone" hint={t('products.travelZoneHint')}>
                  <Select id="travel_zone" value={form.travel_zone} onChange={(event) => set('travel_zone', event.target.value)}>
                    <option value="">—</option>
                    {TRAVEL_ZONES.map((zone) => <option key={zone} value={zone}>{TRAVEL_ZONE_LABELS[zone]}</option>)}
                  </Select>
                </Field>
              </FormGrid>
            </fieldset>
          ) : null}

          {activeTab === 'deliverables' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionDeliverables')}</legend>
              <Field label={t('products.deliverables')} htmlFor="deliverables">
                <Textarea id="deliverables" rows={4} value={form.deliverables} onChange={(event) => set('deliverables', event.target.value)} />
              </Field>
              <Field label={t('products.clientPrerequisites')} htmlFor="client_prerequisites">
                <Textarea id="client_prerequisites" rows={4} value={form.client_prerequisites} onChange={(event) => set('client_prerequisites', event.target.value)} />
              </Field>
            </fieldset>
          ) : null}

          {activeTab === 'purchasing' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionPurchasing')}</legend>
              <FormGrid>
                <Field label={t('products.supplier')} htmlFor="supplier_name">
                  <Input id="supplier_name" value={form.supplier_name} onChange={(event) => set('supplier_name', event.target.value)} />
                </Field>
                <Field label={t('products.supplierRef')} htmlFor="supplier_ref">
                  <Input id="supplier_ref" value={form.supplier_ref} onChange={(event) => set('supplier_ref', event.target.value)} />
                </Field>
                <Field label={t('products.purchasePrice')} htmlFor="purchase_price">
                  <Input id="purchase_price" type="number" min="0" value={form.purchase_price} onChange={(event) => set('purchase_price', Number(event.target.value))} />
                </Field>
                <Field label={t('products.purchaseCurrency')} htmlFor="purchase_currency">
                  <Select id="purchase_currency" value={form.purchase_currency} onChange={(event) => set('purchase_currency', event.target.value)}>
                    {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.moq')} htmlFor="moq">
                  <Input id="moq" type="number" min="0" step="0.001" value={form.moq} onChange={(event) => set('moq', Number(event.target.value))} />
                </Field>
                <Field label={t('products.orderMultiple')} htmlFor="order_multiple">
                  <Input id="order_multiple" type="number" min="0" step="0.001" value={form.order_multiple} onChange={(event) => set('order_multiple', Number(event.target.value))} />
                </Field>
                <Field label={t('products.leadTime')} htmlFor="lead_time_days" hint={t('products.leadTimeHint')}>
                  <Input id="lead_time_days" type="number" min="0" value={form.lead_time_days} onChange={(event) => set('lead_time_days', Number(event.target.value))} />
                </Field>
              </FormGrid>
            </fieldset>
          ) : null}

          {activeTab === 'logistics' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionLogistics')}</legend>
              <FormGrid>
                <Field label={t('products.stockMode')} htmlFor="stock_mode">
                  <Select id="stock_mode" value={form.stock_mode} onChange={(event) => set('stock_mode', event.target.value)}>
                    {STOCK_MODES.map((mode) => <option key={mode} value={mode}>{STOCK_MODE_LABELS[mode]}</option>)}
                  </Select>
                </Field>
                <Field label={t('products.location')} htmlFor="warehouse_location" hint={t('products.locationHint')}>
                  <Input id="warehouse_location" value={form.warehouse_location} onChange={(event) => set('warehouse_location', event.target.value)} />
                </Field>
                <Field label={t('products.customsCode')} htmlFor="customs_code">
                  <Input id="customs_code" value={form.customs_code} onChange={(event) => set('customs_code', event.target.value)} />
                </Field>
                <Field label={t('products.weightGross')} htmlFor="weight_gross_g">
                  <Input id="weight_gross_g" type="number" min="0" value={form.weight_gross_g} onChange={(event) => set('weight_gross_g', Number(event.target.value))} />
                </Field>
                <Field label={t('products.weightNet')} htmlFor="weight_net_g">
                  <Input id="weight_net_g" type="number" min="0" value={form.weight_net_g} onChange={(event) => set('weight_net_g', Number(event.target.value))} />
                </Field>
                <Field label={t('products.volume')} htmlFor="volume_cm3">
                  <Input id="volume_cm3" type="number" min="0" value={form.volume_cm3} onChange={(event) => set('volume_cm3', Number(event.target.value))} />
                </Field>
              </FormGrid>
            </fieldset>
          ) : null}

          {activeTab === 'finance' ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">
                {isService ? t('products.sectionServiceAccounting') : t('products.sectionValuation')}
              </legend>
              {isService ? (
                <FormGrid>
                  <Field label={t('products.salesAccount')} htmlFor="sales_account">
                    <Input id="sales_account" placeholder={DEFAULT_ACCOUNT_CODES.sales} value={form.sales_account} onChange={(event) => set('sales_account', event.target.value)} />
                  </Field>
                  <Field label={t('products.subcontractAccount')} htmlFor="subcontract_account">
                    <Input id="subcontract_account" placeholder="611000" value={form.subcontract_account} onChange={(event) => set('subcontract_account', event.target.value)} />
                  </Field>
                  <Field label={t('products.revenueRecognition')} htmlFor="revenue_recognition">
                    <Select id="revenue_recognition" value={form.revenue_recognition} onChange={(event) => set('revenue_recognition', event.target.value)}>
                      {REVENUE_RECOGNITIONS.map((mode) => <option key={mode} value={mode}>{REVENUE_RECOGNITION_LABELS[mode]}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('products.analyticAxis')} htmlFor="analytic_axis">
                    <Input id="analytic_axis" value={form.analytic_axis} onChange={(event) => set('analytic_axis', event.target.value)} />
                  </Field>
                </FormGrid>
              ) : (
                <FormGrid>
                  <Field label={t('products.valuation')} htmlFor="valuation_method">
                    <Select id="valuation_method" value={form.valuation_method} onChange={(event) => set('valuation_method', event.target.value)}>
                      {VALUATION_METHODS.map((method) => <option key={method} value={method}>{VALUATION_METHOD_LABELS[method]}</option>)}
                    </Select>
                  </Field>
                  <Field label={t('products.cost')} htmlFor="cost">
                    <Input id="cost" type="number" min="0" value={form.cost} onChange={(event) => set('cost', Number(event.target.value))} />
                  </Field>
                  <Field label={t('products.landedCost')} htmlFor="landed_cost" hint={t('products.landedCostComputed')}>
                    <div className="flex items-center gap-2">
                      {/* F4: the figure is computed from freight, duty and clearance, not typed. */}
                      <Input id="landed_cost" value={form.landed_cost} readOnly onChange={() => undefined} />
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!editing}
                        icon={<Calculator className="h-4 w-4" aria-hidden="true" />}
                        onClick={() => editing && setLandedFor(editing)}
                      >
                        {t('products.computeLandedCost')}
                      </Button>
                    </div>
                  </Field>
                  <Field label={t('products.purchaseAccount')} htmlFor="purchase_account">
                    <Input id="purchase_account" placeholder={inherited?.purchase_account ?? '607000'} value={form.purchase_account} onChange={(event) => set('purchase_account', event.target.value)} />
                  </Field>
                  <Field label={t('products.salesAccount')} htmlFor="sales_account">
                    <Input id="sales_account" placeholder={inherited?.sales_account ?? '707000'} value={form.sales_account} onChange={(event) => set('sales_account', event.target.value)} />
                  </Field>
                  <Field label={t('products.stockAccount')} htmlFor="stock_account">
                    <Input id="stock_account" placeholder={inherited?.stock_account ?? '370000'} value={form.stock_account} onChange={(event) => set('stock_account', event.target.value)} />
                  </Field>
                  <Field label={t('products.analyticAxis')} htmlFor="analytic_axis">
                    <Input id="analytic_axis" value={form.analytic_axis} onChange={(event) => set('analytic_axis', event.target.value)} />
                  </Field>
                </FormGrid>
              )}
              {!isService ? (
                <p className="text-xs text-muted">{t('products.familyAccountHint')}</p>
              ) : null}
              <div className="space-y-1 text-xs text-muted">
                <p className="text-sm font-semibold text-ink-950">{t('products.sectionAudit')}</p>
                {auditFields.map((field) => <p key={field.label}>{field.label} : {field.value ?? '—'}</p>)}
              </div>
            </fieldset>
          ) : null}

          {activeTab === 'pricing' && !isService ? (
            <fieldset className="space-y-4">
              <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionPricing')}</legend>
              <FormGrid>
                <Field label={t('products.price')} htmlFor="unit_price">
                  <Input id="unit_price" type="number" min="0" value={form.unit_price} onChange={(event) => set('unit_price', Number(event.target.value))} />
                </Field>
                <Field label={t('products.pricePro')} htmlFor="price_pro">
                  <Input id="price_pro" type="number" min="0" value={form.price_pro} onChange={(event) => set('price_pro', Number(event.target.value))} />
                </Field>
                <Field label={t('products.priceMember')} htmlFor="price_member">
                  <Input id="price_member" type="number" min="0" value={form.price_member} onChange={(event) => set('price_member', Number(event.target.value))} />
                </Field>
                <Field label={t('products.marginTarget')} htmlFor="margin_target">
                  <Input id="margin_target" type="number" min="0" max="100" value={form.margin_target} onChange={(event) => set('margin_target', Number(event.target.value))} />
                </Field>
                <Field label={t('products.stock')} htmlFor="quantity">
                  <Input id="quantity" type="number" step="0.001" value={form.quantity} onChange={(event) => set('quantity', Number(event.target.value))} />
                </Field>
              </FormGrid>
              <Checkbox label={t('products.trackStock')} checked={form.track_quantity} onChange={(event) => set('track_quantity', event.target.checked)} />
              {form.track_quantity ? (
                <Checkbox
                  label={t('products.allowNegativeStock')}
                  checked={form.allow_negative_stock}
                  onChange={(event) => set('allow_negative_stock', event.target.checked)}
                />
              ) : null}
              {form.track_quantity ? (
                <Field label={t('products.lotTracking')} htmlFor="lot_tracking">
                  <Select id="lot_tracking" value={form.lot_tracking} onChange={(event) => set('lot_tracking', event.target.value)}>
                    <option value="none">{t('products.lotTrackingNone')}</option>
                    <option value="lot">{t('products.lotTrackingLot')}</option>
                    <option value="serial">{t('products.lotTrackingSerial')}</option>
                  </Select>
                </Field>
              ) : null}

              <div className="space-y-2">
                <p className="label">{t('products.volumeDiscounts')}</p>
                {form.volume_discounts.map((rule, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <Field label={t('products.minQuantity')} htmlFor={`discount_min_${index}`} className="flex-1">
                      <Input
                        id={`discount_min_${index}`}
                        type="number"
                        min="1"
                        value={rule.min_quantity}
                        onChange={(event) => set('volume_discounts', form.volume_discounts.map((item, position) => position === index ? { ...item, min_quantity: Number(event.target.value) } : item))}
                      />
                    </Field>
                    <Field label={t('products.discountPercent')} htmlFor={`discount_percent_${index}`} className="flex-1">
                      <Input
                        id={`discount_percent_${index}`}
                        type="number"
                        min="0"
                        max="100"
                        value={rule.percent}
                        onChange={(event) => set('volume_discounts', form.volume_discounts.map((item, position) => position === index ? { ...item, percent: Number(event.target.value) } : item))}
                      />
                    </Field>
                    <Button variant="secondary" onClick={() => set('volume_discounts', form.volume_discounts.filter((_, position) => position !== index))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" onClick={() => set('volume_discounts', [...form.volume_discounts, { min_quantity: 10, percent: 5 }])}>
                  {t('products.addDiscount')}
                </Button>
                <p className="hint">{discountForQuantity(form.volume_discounts, form.quantity)} %</p>
              </div>
            </fieldset>
          ) : null}

          {activeTab === 'links' ? (
            <div className="space-y-6">
              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionKit')}</legend>
                <Field label={t('products.bomMode')} htmlFor="bom_mode">
                  <Select id="bom_mode" value={form.bom_mode} onChange={(event) => set('bom_mode', event.target.value)}>
                    {BOM_MODES.map((mode) => <option key={mode} value={mode}>{BOM_MODE_LABELS[mode]}</option>)}
                  </Select>
                </Field>
                <p className="label">{t('products.components')}</p>
                {form.bom.map((line, index) => (
                  <div key={index} className="flex items-end gap-2">
                    <Field label={t('products.component')} htmlFor={`bom_product_${index}`} className="flex-1">
                      <Select
                        id={`bom_product_${index}`}
                        value={line.product_id}
                        onChange={(event) => set('bom', form.bom.map((item, position) => position === index ? { ...item, product_id: event.target.value } : item))}
                      >
                        <option value="">—</option>
                        {selectable.filter((item) => item.id !== editing?.id).map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </Select>
                    </Field>
                    <Field label={t('products.componentQty')} htmlFor={`bom_qty_${index}`} className="w-32">
                      <Input
                        id={`bom_qty_${index}`}
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={line.quantity}
                        onChange={(event) => set('bom', form.bom.map((item, position) => position === index ? { ...item, quantity: Number(event.target.value) } : item))}
                      />
                    </Field>
                    <Button variant="secondary" onClick={() => set('bom', form.bom.filter((_, position) => position !== index))}>
                      <X className="h-4 w-4" aria-hidden="true" />
                    </Button>
                  </div>
                ))}
                <Button variant="secondary" onClick={() => set('bom', [...form.bom, { product_id: '', quantity: 1 }])}>
                  {t('products.addComponent')}
                </Button>
                {detail.data?.kit_available !== null && detail.data?.kit_available !== undefined ? (
                  <p className="hint">{t('products.kitAvailable')} : {detail.data.kit_available.toLocaleString(formatLocale())}</p>
                ) : null}
                {editing && form.item_type === 'kit' && form.bom.length ? (
                  <div className="flex items-end gap-2">
                    <Field label={t('products.assemblyQuantity')} htmlFor="kit_qty" className="w-32">
                      <Input
                        id="kit_qty"
                        type="number"
                        min="0.001"
                        step="0.001"
                        value={kitQty}
                        onChange={(event) => setKitQty(Number(event.target.value))}
                      />
                    </Field>
                    <Button
                      variant="secondary"
                      disabled={kitAction.isPending || kitQty <= 0}
                      onClick={() => kitAction.mutate({ kind: 'assemble', quantity: kitQty })}
                    >
                      {t('products.assemble')}
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={kitAction.isPending || kitQty <= 0}
                      onClick={() => kitAction.mutate({ kind: 'disassemble', quantity: kitQty })}
                    >
                      {t('products.disassemble')}
                    </Button>
                  </div>
                ) : null}
              </fieldset>

              <fieldset className="space-y-3">
                <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionLinks')}</legend>
                <p className="hint">{t('products.linkHint')}</p>
                {(['substitutes', 'accessories'] as const).map((key) => (
                  <div key={key} className="space-y-2">
                    <p className="label">{key === 'substitutes' ? t('products.substitutes') : t('products.accessories')}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {form[key].map((id) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-xs">
                          {productName(id)}
                          <button type="button" aria-label={t('common.delete')} onClick={() => set(key, form[key].filter((item) => item !== id))}>
                            <X className="h-3 w-3" aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                    </div>
                    <div className="flex items-end gap-2">
                      <Select aria-label={key} value={linkPick} onChange={(event) => setLinkPick(event.target.value)} className="flex-1">
                        <option value="">—</option>
                        {selectable.filter((item) => item.id !== editing?.id && !form[key].includes(item.id)).map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </Select>
                      <Button
                        variant="secondary"
                        onClick={() => {
                          if (!linkPick) return;
                          set(key, [...form[key], linkPick]);
                          setLinkPick('');
                        }}
                      >
                        {t('products.addLink')}
                      </Button>
                    </div>
                  </div>
                ))}
              </fieldset>
            </div>
          ) : null}

          {activeTab === 'stock' ? (
            <div className="space-y-5">
              <fieldset className="space-y-4">
                <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.sectionReplenishment')}</legend>
                <FormGrid>
                  <Field label={t('products.reorderPoint')} htmlFor="reorder_point">
                    <Input id="reorder_point" type="number" min="0" step="0.001" value={form.reorder_point} onChange={(event) => set('reorder_point', Number(event.target.value))} />
                  </Field>
                  <Field label={t('products.safetyStock')} htmlFor="safety_stock">
                    <Input id="safety_stock" type="number" min="0" step="0.001" value={form.safety_stock} onChange={(event) => set('safety_stock', Number(event.target.value))} />
                  </Field>
                  <Field label={t('products.maxStock')} htmlFor="max_stock">
                    <Input id="max_stock" type="number" min="0" step="0.001" value={form.max_stock} onChange={(event) => set('max_stock', Number(event.target.value))} />
                  </Field>
                  <Field label={t('products.replenishMode')} htmlFor="replenish_mode">
                    <Select id="replenish_mode" value={form.replenish_mode} onChange={(event) => set('replenish_mode', event.target.value)}>
                      {REPLENISH_MODES.map((mode) => <option key={mode} value={mode}>{REPLENISH_MODE_LABELS[mode]}</option>)}
                    </Select>
                  </Field>
                </FormGrid>
                <p className="text-xs text-muted">
                  {t('products.qtyOnHand')} : {form.quantity.toLocaleString(formatLocale())}
                  {editing ? ` · ${t('products.suggestedReorder')} : ${editing.suggested_reorder.toLocaleString(formatLocale())}` : ''}
                  {editing && editing.stock_value != null ? ` · ${t('products.stockValue')} : ${formatMoneyValue(editing.stock_value, currency)}` : ''}
                </p>
              </fieldset>

              {editing ? (
                <fieldset className="space-y-3">
                  <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.movements')}</legend>
                  {detail.isLoading ? <Skeleton className="h-16" /> : detail.data?.movements.length ? (
                    <div className="table-wrap">
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th scope="col">{t('common.date')}</th>
                            <th scope="col">{t('products.type')}</th>
                            <th scope="col" className="text-right">{t('products.stock')}</th>
                            <th scope="col">{t('products.reason')}</th>
                            <th scope="col">{t('common.user')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {detail.data.movements.map((movement) => (
                            <tr key={movement.id}>
                              <td className="text-xs text-muted">{formatDate(movement.created_at)}</td>
                              <td className="text-xs">
                                {movement.kind === 'in' ? t('products.movementIn')
                                  : movement.kind === 'out' ? t('products.movementOut')
                                    : movement.kind === 'transfer' ? t('products.movementTransfer')
                                      : t('products.movementAdjust')}
                              </td>
                              <td className={`text-right tabular-nums ${movement.quantity_milli < 0 ? 'text-danger-600' : 'text-success-600'}`}>
                                {movement.quantity > 0 ? '+' : ''}{movement.quantity.toLocaleString(formatLocale())}
                              </td>
                              <td className="text-xs text-muted">{movement.reason ?? '—'}</td>
                              <td className="text-xs text-muted">{movement.user_name || '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <p className="text-xs text-muted">{t('products.noMovements')}</p>}
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setStockFor(editing);
                      setStockForm({ delta: 0, reason: '', kind: 'adjust', location: form.warehouse_location, lot: '' });
                    }}
                  >
                    {t('products.adjustStock')}
                  </Button>
                </fieldset>
              ) : null}

              {editing && detail.data?.valuations?.length ? (
                <fieldset className="space-y-3">
                  <legend className="mb-2 text-sm font-semibold text-ink-950">{t('products.valuationJournal')}</legend>
                  <div className="table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th scope="col">{t('common.date')}</th>
                          <th scope="col">{t('products.reason')}</th>
                          <th scope="col" className="text-right">{t('products.valuationInbound')}</th>
                          <th scope="col" className="text-right">{t('products.valuationAfter')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.data.valuations.map((row) => (
                          <tr key={row.id}>
                            <td className="text-xs text-muted">{formatDate(row.created_at)}</td>
                            <td className="text-xs">{row.reason ?? '—'}</td>
                            <td className="text-right text-xs tabular-nums">
                              {formatMoneyValue(row.inbound_unit_cost, currency)} × {(row.inbound_milli / 1000).toLocaleString(formatLocale())}
                            </td>
                            <td className="text-right text-xs tabular-nums">{formatMoneyValue(row.cost_after, currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </fieldset>
              ) : null}

              <fieldset className="space-y-1 text-xs text-muted">
                <legend className="mb-1 text-sm font-semibold text-ink-950">{t('products.sectionAudit')}</legend>
                {auditFields.map((field) => <p key={field.label}>{field.label} : {field.value ?? '—'}</p>)}
              </fieldset>
            </div>
          ) : null}
        </div>
      </Modal>

      {/* ---------- Ajustement de stock ---------- */}
      <Modal
        open={stockFor !== null}
        onClose={() => setStockFor(null)}
        title={`${t('products.adjustStock')} — ${stockFor?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStockFor(null)}>{t('common.cancel')}</Button>
            <Button loading={adjust.isPending} onClick={() => adjust.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <p className="text-xs text-muted">
            {t('products.qtyOnHand')} : {(stockFor?.quantity ?? 0).toLocaleString(formatLocale())}
          </p>
          <FormGrid>
            <Field label={t('products.delta')} htmlFor="stock_delta">
              <Input id="stock_delta" type="number" step="0.001" value={stockForm.delta} onChange={(event) => setStockForm({ ...stockForm, delta: Number(event.target.value) })} />
            </Field>
            <Field label={t('products.type')} htmlFor="stock_kind">
              <Select id="stock_kind" value={stockForm.kind} onChange={(event) => setStockForm({ ...stockForm, kind: event.target.value })}>
                <option value="in">{t('products.movementIn')}</option>
                <option value="out">{t('products.movementOut')}</option>
                <option value="adjust">{t('products.movementAdjust')}</option>
                <option value="transfer">{t('products.movementTransfer')}</option>
              </Select>
            </Field>
            <Field label={t('products.reason')} htmlFor="stock_reason">
              <Input id="stock_reason" value={stockForm.reason} onChange={(event) => setStockForm({ ...stockForm, reason: event.target.value })} />
            </Field>
            <Field label={t('products.location')} htmlFor="stock_location">
              <Input id="stock_location" value={stockForm.location} onChange={(event) => setStockForm({ ...stockForm, location: event.target.value })} />
            </Field>
            <Field label={t('products.lot')} htmlFor="stock_lot">
              <Input id="stock_lot" value={stockForm.lot} onChange={(event) => setStockForm({ ...stockForm, lot: event.target.value })} />
            </Field>
          </FormGrid>
        </div>
      </Modal>

      {lotsFor ? <LotsModal product={lotsFor} onClose={() => setLotsFor(null)} /> : null}
      {locationsFor ? <LocationsModal product={locationsFor} onClose={() => setLocationsFor(null)} /> : null}
      {vendorsFor ? <VendorsModal product={vendorsFor} currency={currency} onClose={() => setVendorsFor(null)} /> : null}
      {linksFor ? <LinksModal product={linksFor} onClose={() => setLinksFor(null)} /> : null}
      {familyAccountsOpen ? <FamilyAccountsModal onClose={() => setFamilyAccountsOpen(false)} /> : null}
      {landedFor ? <LandedCostModal product={landedFor} onClose={() => setLandedFor(null)} /> : null}
      {importSheetOpen ? <ImportSheetModal onClose={() => setImportSheetOpen(false)} /> : null}
    </>
  );
}
