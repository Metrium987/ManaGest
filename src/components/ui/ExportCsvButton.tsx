import { Download } from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * Read-only "Exporter CSV" action for the list pages (T-006).
 * A plain link works because the session rides on the cookie; the server
 * journals every export and gates it on the entity's `.read` permission
 * (viewer may export what it may read, per the OQ-021 matrix).
 */
export function ExportCsvButton({ entity, searchQuery }: { entity: string; searchQuery?: string }) {
  const params = new URLSearchParams();
  if (searchQuery) params.set('q', searchQuery);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return (
    <a
      href={`/api/export/${entity}${suffix}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface transition-colors"
      aria-label={t('common.export')}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('common.export')}
    </a>
  );
}
