import { useId } from 'react';
import { t } from '@/lib/i18n';

interface ChartPoint {
  key: string;
  invoiced: number;
  collected: number;
}

const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function monthLabel(key: string): string {
  const [year, month] = key.split('-');
  return `${MONTHS[Number(month) - 1] ?? month} ${year.slice(2)}`;
}

export function RevenueChart({ data, height = 240 }: { data: ChartPoint[]; height?: number }) {
  const gradientId = useId().replace(/:/g, '');
  const width = 720;
  const padding = { top: 18, right: 16, bottom: 28, left: 48 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  const max = Math.max(1, ...data.flatMap((point) => [point.invoiced, point.collected]));
  const step = chartWidth / Math.max(1, data.length - 1);
  const yFor = (value: number) => padding.top + chartHeight - (value / max) * chartHeight;

  const buildPath = (values: number[]) =>
    values
      .map((value, index) => `${index === 0 ? 'M' : 'L'} ${padding.left + index * step} ${yFor(value)}`)
      .join(' ');

  const buildArea = (values: number[]) =>
    `${buildPath(values)} L ${padding.left + (values.length - 1) * step} ${padding.top + chartHeight} L ${padding.left} ${padding.top + chartHeight} Z`;

  const invoiced = data.map((point) => point.invoiced);
  const collected = data.map((point) => point.collected);
  const gridValues = [0, 0.25, 0.5, 0.75, 1].map((ratio) => Math.round(max * ratio));

  return (
    <div className="w-full">
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-brand-500" aria-hidden="true" />
          {t('dashboard.invoiced')}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-sand-400" aria-hidden="true" />
          {t('dashboard.collected')}
        </span>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={t('dashboard.chartTitle')}
      >
        <defs>
          <linearGradient id={`${gradientId}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0E7C86" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#0E7C86" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {gridValues.map((value) => {
          const y = yFor(value);
          return (
            <g key={value}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} stroke="#E2E9E9" strokeWidth="1" />
              <text x={padding.left - 8} y={y + 3} textAnchor="end" fontSize="9" fill="#7C8B8A">
                {Math.round(value / 1000)}k
              </text>
            </g>
          );
        })}
        <path d={buildArea(invoiced)} fill={`url(#${gradientId}-fill)`} />
        <path d={buildPath(invoiced)} fill="none" stroke="#0E7C86" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
        <path d={buildPath(collected)} fill="none" stroke="#E29A2A" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" />
        {data.map((point, index) => (
          <g key={point.key}>
            <circle cx={padding.left + index * step} cy={yFor(point.invoiced)} r="6" fill="transparent">
              <title>{`${monthLabel(point.key)} — ${t('dashboard.invoiced')} : ${point.invoiced} XPF`}</title>
            </circle>
            <circle cx={padding.left + index * step} cy={yFor(point.invoiced)} r="3" fill="#fff" stroke="#0E7C86" strokeWidth="2" />
            <circle cx={padding.left + index * step} cy={yFor(point.collected)} r="2.5" fill="#E29A2A" />
            <text
              x={padding.left + index * step}
              y={height - 8}
              textAnchor="middle"
              fontSize="9"
              fill="#7C8B8A"
            >
              {monthLabel(point.key)}
            </text>
          </g>
        ))}
      </svg>
      <table className="sr-only">
        <caption>{t('dashboard.chartTitle')}</caption>
        <thead>
          <tr>
            <th scope="col">Mois</th>
            <th scope="col">{t('dashboard.invoiced')}</th>
            <th scope="col">{t('dashboard.collected')}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.key}>
              <th scope="row">{monthLabel(point.key)}</th>
              <td>{point.invoiced}</td>
              <td>{point.collected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function MiniBars({ values, tone = 'brand' }: { values: number[]; tone?: 'brand' | 'sand' }) {
  const max = Math.max(1, ...values);
  return (
    <div className="flex h-10 items-end gap-1" aria-hidden="true">
      {values.map((value, index) => (
        <span
          key={index}
          className={`w-full rounded-sm ${tone === 'brand' ? 'bg-brand-400' : 'bg-sand-400'}`}
          style={{ height: `${Math.max(6, (value / max) * 100)}%`, opacity: 0.45 + (index / values.length) * 0.55 }}
        />
      ))}
    </div>
  );
}
