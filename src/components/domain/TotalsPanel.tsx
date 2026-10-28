import type { LineItem } from '@/lib/types';
import { computeTotals } from '@shared/tax';
import { formatMoney } from '@/lib/format';
import { t } from '@/lib/i18n';

export function TotalsPanel({
  lines,
  discountType,
  discountValue,
  taxExempt,
  currency,
}: {
  lines: LineItem[];
  discountType: 'percent' | 'amount';
  discountValue: number;
  taxExempt: boolean;
  currency: string;
}) {
  const totals = computeTotals(lines, { discount_type: discountType, discount_value: discountValue }, taxExempt);

  return (
    <div className="rounded-xl bg-surface/70 p-4">
      <dl className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted">{t('common.subtotal')}</dt>
          <dd className="font-medium tabular-nums text-ink-900">{formatMoney(totals.subtotal, currency)}</dd>
        </div>
        {totals.discount_total > 0 ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">{t('common.discount')}</dt>
            <dd className="font-medium tabular-nums text-danger-600">
              − {formatMoney(totals.discount_total, currency)}
            </dd>
          </div>
        ) : null}
        {taxExempt ? (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted">{t('common.tax')}</dt>
            <dd className="text-xs font-medium text-muted">{t('invoices.taxExemptNote')}</dd>
          </div>
        ) : (
          totals.tax_buckets.map((bucket) => (
            <div key={bucket.rate} className="flex items-center justify-between gap-4">
              <dt className="text-muted">
                {t('common.tax')} {bucket.rate} % <span className="text-xs">({formatMoney(bucket.base, currency)})</span>
              </dt>
              <dd className="font-medium tabular-nums text-ink-900">{formatMoney(bucket.amount, currency)}</dd>
            </div>
          ))
        )}
        <div className="flex items-baseline justify-between gap-4 border-t border-line pt-3">
          <dt className="font-display text-base font-semibold text-ink-950">Total TTC</dt>
          <dd className="font-display text-xl font-semibold tabular-nums text-ink-950">
            {formatMoney(totals.total, currency)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
