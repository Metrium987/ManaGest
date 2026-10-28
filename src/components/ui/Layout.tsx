import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Inbox } from 'lucide-react';
import { t } from '@/lib/i18n';

export function PageHeader({
  title,
  subtitle,
  actions,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  breadcrumb?: ReactNode;
}) {
  return (
    <div className="mb-6">
      {breadcrumb ? <div className="mb-2 text-xs text-muted">{breadcrumb}</div> : null}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink-950 sm:text-[1.7rem]">
            {title}
          </h1>
          {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`card ${padded ? 'p-5 sm:p-6' : ''} ${className}`}>{children}</div>;
}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className = '',
  bodyClassName = '',
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`card overflow-hidden ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-ink-950">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </header>
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-700 border-slate-200',
  sent: 'bg-info-50 text-info-600 border-info-200',
  partial: 'bg-warning-50 text-warning-700 border-warning-200',
  paid: 'bg-success-50 text-success-700 border-success-200',
  cancelled: 'bg-slate-100 text-slate-500 border-slate-200',
  overdue: 'bg-danger-50 text-danger-700 border-danger-200',
  approved: 'bg-success-50 text-success-700 border-success-200',
  rejected: 'bg-danger-50 text-danger-700 border-danger-200',
  converted: 'bg-brand-50 text-brand-700 border-brand-200',
  expired: 'bg-slate-100 text-slate-500 border-slate-200',
  applied: 'bg-brand-50 text-brand-700 border-brand-200',
  active: 'bg-success-50 text-success-700 border-success-200',
  paused: 'bg-warning-50 text-warning-700 border-warning-200',
  completed: 'bg-slate-100 text-slate-600 border-slate-200',
  received: 'bg-success-50 text-success-700 border-success-200',
  void: 'bg-slate-100 text-slate-500 border-slate-200',
  todo: 'bg-slate-100 text-slate-600 border-slate-200',
  in_progress: 'bg-info-50 text-info-600 border-info-200',
  done: 'bg-success-50 text-success-700 border-success-200',
  archived: 'bg-slate-100 text-slate-500 border-slate-200',
  unmatched: 'bg-warning-50 text-warning-700 border-warning-200',
  matched: 'bg-success-50 text-success-700 border-success-200',
  ignored: 'bg-slate-100 text-slate-500 border-slate-200',
  draft_dot: 'bg-slate-400',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const style = STATUS_STYLES[status] ?? 'bg-slate-100 text-slate-600 border-slate-200';
  return (
    <span className={`badge border ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLES[`${status}_dot`] ?? 'bg-current'} opacity-70`} aria-hidden="true" />
      {label ?? t(`status.${status}`)}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        {icon ?? <Inbox className="h-6 w-6" aria-hidden="true" />}
      </div>
      <h3 className="text-base font-semibold text-ink-900">{title}</h3>
      {description ? <p className="mt-1 max-w-md text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  trend,
  accent = 'brand',
}: {
  label: string;
  value: string;
  hint?: string;
  trend?: { value: number; label: string } | null;
  accent?: 'brand' | 'success' | 'warning' | 'danger';
}) {
  const accents = {
    brand: 'bg-brand-500',
    success: 'bg-success-600',
    warning: 'bg-warning-600',
    danger: 'bg-danger-600',
  };
  return (
    <div className="card relative overflow-hidden p-5">
      <span className={`absolute inset-y-0 left-0 w-1 ${accents[accent]}`} aria-hidden="true" />
      <p className="text-xs font-semibold uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-950">{value}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
        {trend ? (
          <span
            className={`font-semibold ${trend.value >= 0 ? 'text-success-600' : 'text-danger-600'}`}
          >
            {trend.value >= 0 ? '+' : ''}{trend.value} %
          </span>
        ) : null}
        {trend ? <span className="text-muted">{trend.label}</span> : null}
        {hint ? <span className="text-muted">{hint}</span> : null}
      </div>
    </div>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onChange,
}: {
  page: number;
  totalPages: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (total === 0) return null;
  return (
    <nav className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3" aria-label="Pagination">
      <p className="text-xs text-muted">
        {total} {t('common.results')} · {t('common.page')} {page} {t('common.of')} {totalPages}
      </p>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange(page - 1)}
          disabled={page <= 1}
          aria-label={t('common.previous')}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          {t('common.previous')}
        </button>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= totalPages}
          aria-label={t('common.next')}
        >
          {t('common.next')}
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </nav>
  );
}

export function Tabs({
  items,
  value,
  onChange,
}: {
  items: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist" aria-label="Sections">
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={`whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition ${
            value === item.value
              ? 'border-brand-600 text-brand-700'
              : 'border-transparent text-muted hover:border-line-strong hover:text-ink-900'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function Avatar({ initials, size = 'md' }: { initials: string; size?: 'sm' | 'md' }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800 ${
        size === 'sm' ? 'h-7 w-7 text-[11px]' : 'h-9 w-9 text-xs'
      }`}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  const bounded = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-muted">
        <span>{label}</span>
        <span>{bounded} %</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-valuenow={bounded}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className="h-full rounded-full bg-brand-500" style={{ width: `${bounded}%` }} />
      </div>
    </div>
  );
}
