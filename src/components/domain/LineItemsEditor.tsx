import { Plus, Trash2 } from 'lucide-react';
import type { LineItem, Product } from '@/lib/types';
import { fromMinor, toMinor } from '@shared/money';
import { TVA_RATES } from '@shared/domain';
import { formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';

export function emptyLine(taxRate: number): LineItem {
  return {
    id: crypto.randomUUID(),
    product_id: null,
    description: '',
    quantity: 1,
    unit_price: 0,
    tax_rate: taxRate,
  };
}

export function LineItemsEditor({
  lines,
  onChange,
  products,
  currency,
  disabled,
}: {
  lines: LineItem[];
  onChange: (lines: LineItem[]) => void;
  products: Product[];
  currency: string;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<LineItem>) => {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  };

  const addLine = () => onChange([...lines, emptyLine(16)]);

  const removeLine = (index: number) => {
    if (lines.length === 1) {
      onChange([emptyLine(16)]);
      return;
    }
    onChange(lines.filter((_, i) => i !== index));
  };

  const applyProduct = (index: number, productId: string) => {
    const product = products.find((item) => item.id === productId);
    if (!product) {
      update(index, { product_id: null });
      return;
    }
    update(index, {
      product_id: product.id,
      description: product.description || product.name,
      unit_price: product.unit_price,
      tax_rate: product.tax_rate,
    });
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-ink-950">{t('invoices.lines')}</h2>
        <Button variant="secondary" size="sm" onClick={addLine} icon={<Plus className="h-4 w-4" aria-hidden="true" />} disabled={disabled}>
          {t('invoices.addLine')}
        </Button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[680px] border-separate border-spacing-y-2 text-sm">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-muted">
              <th className="pb-1 pl-1" scope="col">{t('invoices.lineDescription')}</th>
              <th className="w-20 pb-1 text-right" scope="col">{t('invoices.lineQuantity')}</th>
              <th className="w-32 pb-1 text-right" scope="col">{t('invoices.linePrice')}</th>
              <th className="w-24 pb-1 text-center" scope="col">{t('invoices.lineTax')}</th>
              <th className="w-32 pb-1 text-right" scope="col">{t('invoices.lineTotal')}</th>
              <th className="w-10 pb-1" scope="col"><span className="sr-only">{t('common.actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => {
              const total = Math.round(line.unit_price * line.quantity);
              const descriptionId = `line-desc-${index}`;
              return (
                <tr key={line.id} className="align-top">
                  <td className="rounded-l-xl border border-r-0 border-line bg-white p-2">
                    <label htmlFor={descriptionId} className="sr-only">
                      {t('invoices.lineDescription')} {index + 1}
                    </label>
                    <input
                      id={descriptionId}
                      className="input border-0 px-1.5 focus:ring-0"
                      value={line.description}
                      onChange={(event) => update(index, { description: event.target.value })}
                      placeholder={t('invoices.lineDescription')}
                      disabled={disabled}
                      required
                    />
                    <div className="mt-1 flex items-center gap-2 px-1.5">
                      <select
                        className="max-w-[220px] rounded border-0 bg-transparent p-0 text-xs text-muted focus:ring-0"
                        value={line.product_id ?? ''}
                        onChange={(event) => applyProduct(index, event.target.value)}
                        disabled={disabled}
                        aria-label={t('invoices.selectProduct')}
                      >
                        <option value="">{t('invoices.selectProduct')}</option>
                        {products.map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.name}
                          </option>
                        ))}
                      </select>
                      <span className="text-[11px] text-muted">
                        {formatMoney(line.unit_price, currency)} / {t('common.unitPrice').toLowerCase()}
                      </span>
                    </div>
                  </td>
                  <td className="border-y border-line bg-white p-2">
                    <label htmlFor={`line-qty-${index}`} className="sr-only">{t('invoices.lineQuantity')}</label>
                    <input
                      id={`line-qty-${index}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      className="input border-0 px-1 text-right focus:ring-0"
                      value={line.quantity}
                      onChange={(event) => update(index, { quantity: Number(event.target.value) })}
                      disabled={disabled}
                    />
                  </td>
                  <td className="border-y border-line bg-white p-2">
                    <label htmlFor={`line-price-${index}`} className="sr-only">{t('invoices.linePrice')}</label>
                    <input
                      id={`line-price-${index}`}
                      type="number"
                      min="0"
                      step={currency === 'XPF' ? '1' : '0.01'}
                      inputMode="decimal"
                      className="input border-0 px-1 text-right focus:ring-0"
                      value={fromMinor(line.unit_price, currency)}
                      onChange={(event) =>
                        update(index, { unit_price: toMinor(Number(event.target.value), currency) })
                      }
                      disabled={disabled}
                    />
                  </td>
                  <td className="border-y border-line bg-white p-2">
                    <label htmlFor={`line-tax-${index}`} className="sr-only">{t('invoices.lineTax')}</label>
                    <select
                      id={`line-tax-${index}`}
                      className="select border-0 px-1 text-center focus:ring-0"
                      value={line.tax_rate}
                      onChange={(event) => update(index, { tax_rate: Number(event.target.value) })}
                      disabled={disabled}
                    >
                      {TVA_RATES.map((rate) => (
                        <option key={rate.rate} value={rate.rate}>{rate.rate} %</option>
                      ))}
                    </select>
                  </td>
                  <td className="border-y border-line bg-white p-2 text-right">
                    <span className="inline-block px-1.5 py-2 font-medium tabular-nums text-ink-900">
                      {formatMoney(total, currency)}
                    </span>
                  </td>
                  <td className="rounded-r-xl border border-l-0 border-line bg-white p-2">
                    <button
                      type="button"
                      onClick={() => removeLine(index)}
                      className="mt-1 rounded-lg p-1.5 text-muted transition hover:bg-danger-50 hover:text-danger-600"
                      aria-label={`${t('common.delete')} — ${t('invoices.lineDescription')} ${index + 1}`}
                      disabled={disabled}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
