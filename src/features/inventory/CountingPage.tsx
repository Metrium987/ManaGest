import { ActivityTrail } from '@/components/domain/ActivityTrail';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatLocale } from '@/lib/format';
import type { ListResponse, StockCount, StockCountDetail } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

const asUnits = (milli: number) => milli / 1000;
const asMilli = (units: number) => Math.round(units * 1000);

/**
 * Cycle counting (B1). The sheet shows the book figure frozen when the count was
 * opened and asks for the shelf figure; the gap becomes the adjustment, and the
 * screen keeps "not counted yet" distinct from "counted zero" — an empty field
 * must never silently empty a shelf.
 */
export function CountingPage() {
  const { can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [scope, setScope] = useState('all');
  const [scopeValue, setScopeValue] = useState('');
  const [note, setNote] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const countsQuery = useQuery({
    queryKey: ['stock-counts'],
    queryFn: () => api.get<ListResponse<StockCount>>('/stock-counts?per_page=50'),
  });

  const detail = useQuery({
    queryKey: ['stock-count', openId],
    queryFn: () => api.get<StockCountDetail>(`/stock-counts/${openId}`),
    enabled: Boolean(openId),
  });

  const session = detail.data;
  const isOpen = session?.status === 'open';

  useEffect(() => {
    if (!session) return;
    setCounts(
      Object.fromEntries(
        session.lines.map((line) => [
          line.product_id,
          line.counted_milli === null ? '' : String(asUnits(Number(line.counted_milli))),
        ]),
      ),
    );
  }, [session]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['stock-counts'] });
    queryClient.invalidateQueries({ queryKey: ['stock-count', openId] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  };

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/stock-counts', {
        scope,
        scope_value: scope === 'all' ? null : scopeValue.trim() || null,
        note: note.trim() || null,
      }),
    onSuccess: (created) => {
      toast.success(t('counts.createdToast'));
      setCreateOpen(false);
      setScope('all');
      setScopeValue('');
      setNote('');
      invalidate();
      setOpenId(created.id);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const save = useMutation({
    mutationFn: () =>
      api.patch(`/stock-counts/${openId}/lines`, {
        counts: (session?.lines ?? []).map((line) => {
          const raw = counts[line.product_id] ?? '';
          return {
            product_id: line.product_id,
            counted: raw.trim() === '' ? null : asMilli(Number(raw)),
          };
        }),
      }),
    onSuccess: () => {
      toast.success(t('counts.savedToast'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const validate = useMutation({
    mutationFn: () => api.post(`/stock-counts/${openId}/validate`, {}),
    onSuccess: (result: unknown) => {
      const adjusted = (result as { adjusted_lines?: number })?.adjusted_lines ?? 0;
      toast.success(`${t('counts.validatedToast')} (${adjusted})`);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const cancelCount = useMutation({
    mutationFn: () => api.post(`/stock-counts/${openId}/cancel`, {}),
    onSuccess: () => {
      toast.success(t('counts.cancelledToast'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rows = countsQuery.data?.data ?? [];
  const pendingInForm = (session?.lines ?? []).filter(
    (line) => (counts[line.product_id] ?? '').trim() === '',
  ).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t('counts.title')}
        subtitle={t('counts.subtitle')}
        actions={
          can('products.write') ? (
            <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>
              {t('counts.new')}
            </Button>
          ) : null
        }
      />

      <SectionCard title={t('counts.title')} subtitle={t('counts.openHint')}>
        {countsQuery.isLoading ? (
          <Skeleton className="h-32" />
        ) : !rows.length ? (
          <EmptyState
            title={t('counts.title')}
            description={t('counts.empty')}
            icon={<ClipboardList className="h-6 w-6" aria-hidden="true" />}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="py-2 pr-3">{t('counts.reference')}</th>
                  <th className="py-2 pr-3">{t('counts.scope')}</th>
                  <th className="py-2 pr-3">{t('counts.lines')}</th>
                  <th className="py-2 pr-3">{t('counts.createdAt')}</th>
                  <th className="py-2 pr-3">{t('counts.statusLabel')}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 font-medium text-ink-900">{row.reference}</td>
                    <td className="py-2 pr-3 text-muted">
                      {row.scope === 'all'
                        ? t('counts.scopeAll')
                        : `${row.scope === 'location' ? t('counts.scopeLocation') : t('counts.scopeFamily')} · ${row.scope_value ?? ''}`}
                    </td>
                    <td className="py-2 pr-3 text-muted">{row.line_count}</td>
                    <td className="py-2 pr-3 text-muted">{formatDate(row.created_at.slice(0, 10))}</td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={row.status} label={t(`counts.status.${row.status}`)} />
                    </td>
                    <td className="py-2 text-right">
                      <Button variant="ghost" size="sm" onClick={() => setOpenId(row.id)}>
                        {t('counts.open')}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('counts.new')}
        description={t('counts.openHint')}
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button>
            <Button
              loading={create.isPending}
              disabled={scope !== 'all' && !scopeValue.trim()}
              onClick={() => create.mutate()}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('counts.scope')} htmlFor="count_scope">
            <Select id="count_scope" value={scope} onChange={(event) => setScope(event.target.value)}>
              <option value="all">{t('counts.scopeAll')}</option>
              <option value="location">{t('counts.scopeLocation')}</option>
              <option value="family">{t('counts.scopeFamily')}</option>
            </Select>
          </Field>
          {scope !== 'all' ? (
            <Field label={t('counts.scopeValue')} htmlFor="count_scope_value">
              <Input
                id="count_scope_value"
                value={scopeValue}
                onChange={(event) => setScopeValue(event.target.value)}
              />
            </Field>
          ) : null}
          <Field label={t('counts.note')} htmlFor="count_note">
            <Input id="count_note" value={note} onChange={(event) => setNote(event.target.value)} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title={session ? `${session.reference}` : t('counts.title')}
        description={session ? t(`counts.status.${session.status}`) : undefined}
        size="lg"
        footer={
          isOpen ? (
            <>
              <Button variant="secondary" onClick={() => setOpenId(null)}>{t('common.close')}</Button>
              <Button
                variant="secondary"
                loading={cancelCount.isPending}
                onClick={() => cancelCount.mutate()}
              >
                {t('counts.cancel')}
              </Button>
              <Button variant="secondary" loading={save.isPending} onClick={() => save.mutate()}>
                {t('counts.save')}
              </Button>
              <Button
                loading={validate.isPending}
                disabled={pendingInForm > 0}
                onClick={() => validate.mutate()}
              >
                {t('counts.validate')}
              </Button>
              <ActivityTrail entityType="stock_count" entityId={openId ?? ''} />
    </>
          ) : (
            <Button variant="secondary" onClick={() => setOpenId(null)}>{t('common.close')}</Button>
          )
        }
      >
        {detail.isLoading || !session ? (
          <Skeleton className="h-40" />
        ) : (
          <div className="space-y-4">
            {isOpen && session.stale_product_ids.length ? (
              <p className="rounded-lg border border-warning-600/40 bg-warning-50 px-3 py-2 text-sm text-warning-700">
                {t('counts.staleWarning')}
              </p>
            ) : null}
            {isOpen && pendingInForm > 0 ? (
              <p className="text-sm text-muted">
                {pendingInForm} {t('counts.pending')}
              </p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                    <th className="py-2 pr-3">{t('counts.product')}</th>
                    <th className="py-2 pr-3 text-right">{t('counts.expected')}</th>
                    <th className="py-2 pr-3 text-right">{t('counts.counted')}</th>
                    <th className="py-2 text-right">{t('counts.delta')}</th>
                  </tr>
                </thead>
                <tbody>
                  {session.lines.map((line) => {
                    const raw = counts[line.product_id] ?? '';
                    const delta = raw.trim() === ''
                      ? 0
                      : asMilli(Number(raw)) - Number(line.expected_milli ?? 0);
                    return (
                      <tr key={line.id} className="border-b border-line/60 last:border-0">
                        <td className="py-2 pr-3">
                          <p className="font-medium text-ink-900">{line.name}</p>
                          <p className="text-xs text-muted">{line.product_key ?? ''}</p>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums text-muted">
                          {asUnits(Number(line.expected_milli ?? 0)).toLocaleString(formatLocale())}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Input
                            aria-label={`${t('counts.counted')} ${line.name}`}
                            className="w-28 text-right"
                            type="number"
                            min={0}
                            step="0.001"
                            disabled={!isOpen}
                            value={raw}
                            onChange={(event) =>
                              setCounts({ ...counts, [line.product_id]: event.target.value })
                            }
                          />
                        </td>
                        <td className={`py-2 text-right tabular-nums ${delta < 0 ? 'text-danger-600' : delta > 0 ? 'text-success-600' : 'text-muted'}`}>
                          {delta === 0 ? '—' : asUnits(delta).toLocaleString(formatLocale())}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
