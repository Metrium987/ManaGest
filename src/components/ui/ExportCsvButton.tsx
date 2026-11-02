import { useState } from 'react';
import { Download } from 'lucide-react';
import { downloadFile } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useToast } from '@/components/ui/Toast';

/**
 * Read-only "Exporter CSV" action for the list pages (T-006).
 *
 * A plain link used to be here, and it looked right in an API test: the route
 * answers `text/csv` with `Content-Disposition: attachment`. In a browser the
 * click is a *navigation*, and the asset router serves the SPA for navigations —
 * the file never downloaded, the URL bar just changed. The export therefore goes
 * through `downloadFile`, which fetches the CSV as data and hands the browser a
 * blob, so the outcome no longer depends on how the host routes navigations.
 */
export function ExportCsvButton({ entity, searchQuery }: { entity: string; searchQuery?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const params = new URLSearchParams();
  if (searchQuery) params.set('q', searchQuery);
  const suffix = params.toString() ? `?${params.toString()}` : '';

  const run = async () => {
    setBusy(true);
    try {
      await downloadFile(`/export/${entity}${suffix}`, `${entity}.csv`);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void run()}
      disabled={busy}
      className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface transition-colors disabled:opacity-60"
      aria-label={t('common.export')}
    >
      <Download className="h-4 w-4" aria-hidden="true" />
      {t('common.export')}
    </button>
  );
}
