import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Activity, ShieldCheck } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { t } from '@/lib/i18n';
import { formatDateTime } from '@/lib/format';
import type { ActivityEntry, ListResponse } from '@/lib/types';
import { EmptyState, PageHeader, Pagination, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

function label(entry: ActivityEntry): string {
  const template = t(`activityMessages.${entry.summary}`);
  if (template === `activityMessages.${entry.summary}`) return entry.summary;
  const vars: Record<string, string> = {
    name: entry.first_name ? `${entry.first_name} ${entry.last_name ?? ''}`.trim() : '—',
  };
  if (entry.meta) {
    try {
      Object.assign(vars, Object.fromEntries(
        Object.entries(JSON.parse(entry.meta) as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      ));
    } catch {
      /* meta is decorative: keep the defaults */
    }
  }
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '—');
}

/** Parsed before/after pairs for a single audited change. */
function changesOf(entry: ActivityEntry): { key: string; before: string; after: string }[] {
  if (!entry.before_json || !entry.after_json) return [];
  try {
    const before = JSON.parse(entry.before_json) as Record<string, unknown>;
    const after = JSON.parse(entry.after_json) as Record<string, unknown>;
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].map((key) => ({
      key,
      before: String(before[key] ?? '—'),
      after: String(after[key] ?? '—'),
    }));
  } catch {
    return [];
  }
}

export function ActivityPage() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const activity = useQuery({
    queryKey: ['activity', page],
    queryFn: () => api.get<ListResponse<ActivityEntry>>(`/activity${toQuery({ page, per_page: 30 })}`),
  });

  const verify = useMutation({
    mutationFn: () => api.get<{ ok: boolean; checked: number; broken_at?: string }>('/activity/verify'),
    onSuccess: (result) => {
      if (result.ok) toast.success(t('journal.integrityOk', { count: result.checked }));
      else toast.error(t('journal.integrityBroken', { id: result.broken_at ?? '—' }));
    },
    onError: () => toast.error(t('errors.generic')),
  });

  return (
    <>
      <PageHeader
        title={t('activity.title')}
        subtitle={t('activity.subtitle')}
        actions={
          <Button
            variant="secondary"
            loading={verify.isPending}
            onClick={() => verify.mutate()}
            icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
          >
            {verify.isPending ? t('journal.verifying') : t('journal.verify')}
          </Button>
        }
      />
      <SectionCard title={t('activity.title')} bodyClassName="table-wrap">
        {activity.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : activity.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('activity.date')}</th>
                <th scope="col">{t('activity.user')}</th>
                <th scope="col">{t('activity.action')}</th>
                <th scope="col">{t('journal.changes')}</th>
                <th scope="col">{t('activity.entity')}</th>
              </tr>
            </thead>
            <tbody>
              {activity.data.data.map((entry) => {
                const changes = changesOf(entry);
                return (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-muted">
                      {formatDateTime(entry.created_at)}
                      {entry.ip ? <span className="mt-0.5 block text-[11px]">{entry.ip}</span> : null}
                    </td>
                    <td>{entry.first_name ? `${entry.first_name} ${entry.last_name ?? ''}` : '—'}</td>
                    <td className="font-medium">{label(entry)}</td>
                    <td>
                      {changes.length ? (
                        <ul className="space-y-0.5 text-xs">
                          {changes.map((change) => (
                            <li key={change.key} className="text-muted">
                              <span className="font-medium text-ink-800">{change.key}</span> :{' '}
                              <span className="line-through decoration-danger-300">{change.before}</span>{' '}
                              <span aria-hidden="true">→</span>{' '}
                              <span className="text-success-700">{change.after}</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="text-xs text-muted">{t('journal.noChanges')}</span>
                      )}
                    </td>
                    <td className="text-muted">{entry.entity_type}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<Activity className="h-6 w-6" aria-hidden="true" />} title={t('activity.empty')} />
        )}
        {activity.data ? <Pagination page={page} totalPages={activity.data.meta.total_pages} total={activity.data.meta.total} onChange={setPage} /> : null}
      </SectionCard>
    </>
  );
}
