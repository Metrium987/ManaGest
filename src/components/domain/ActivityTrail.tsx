import { useQuery } from '@tanstack/react-query';
import { api, toQuery } from '@/lib/api';
import { t } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import { useSession } from '@/lib/session';
import type { ActivityEntry, ListResponse } from '@/lib/types';
import { SectionCard } from '@/components/ui/Layout';

function label(entry: ActivityEntry): string {
  const template = t(`activityMessages.${entry.summary}`);
  return template === `activityMessages.${entry.summary}` ? entry.summary : template;
}

/**
 * Who did what, and when, for one record. Rendered only for accounts that may
 * read the journal (`activity.read`); everyone else gets nothing at all, neither
 * the section nor the request.
 */
export function ActivityTrail({ entityType, entityId }: { entityType: string; entityId: string }) {
  const { can } = useSession();
  const allowed = can('activity.read');
  const trail = useQuery({
    queryKey: ['activity', entityType, entityId],
    queryFn: () => api.get<ListResponse<ActivityEntry>>(
      `/activity${toQuery({ entity_type: entityType, entity_id: entityId, per_page: 20 })}`,
    ),
    enabled: allowed && Boolean(entityId),
  });

  if (!allowed) return null;
  const rows = trail.data?.data ?? [];

  return (
    <SectionCard title={t('journal.trailTitle')} subtitle={t('journal.trailHint')}>
      {trail.isLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted">{t('journal.trailEmpty')}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
              <span className="text-xs tabular-nums text-muted">{formatDateTime(entry.created_at)}</span>
              <span className="font-medium text-ink-900">
                {entry.first_name ? `${entry.first_name} ${entry.last_name ?? ''}`.trim() : t('journal.systemActor')}
              </span>
              <span className="text-ink-700">{label(entry)}</span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
