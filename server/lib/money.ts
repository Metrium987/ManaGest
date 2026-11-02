import { DEFAULT_LOCALE } from '../../shared/domain';

export {
  currencyDecimals,
  fromMinor,
  roundMinor,
  toMinor,
  formatMoney,
} from '../../shared/money';

export function formatNumber(value: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale).format(value);
}

export function formatPercent(value: number, locale = DEFAULT_LOCALE): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(value / 100);
}
