export {
  currencyDecimals,
  fromMinor,
  roundMinor,
  toMinor,
  formatMoney,
} from '../../shared/money';

export function formatNumber(value: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: number, locale = 'fr-FR'): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value / 100);
}
