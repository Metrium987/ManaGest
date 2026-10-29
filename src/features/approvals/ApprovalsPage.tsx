import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ClipboardCheck, X } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDateTime, formatMoney } from '@/lib/format';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface ApprovalRow {
  id: string;
  entity_type: 'invoice' | 'credit' | 'expense';
  entity_id: string;
  amount: number;
  rule: string;
  status: string;
  requested_by: string | null;
  decided_by: string | null;
  note: string | null;
  created_at: string;
  decided_at: string | null;
  requested_email?: string | null;
  decided_email?: string | null;
}

const TABS = [
  { value: 'pending', label: 'approvals.pending' },
  { value: 'approved', label: 'approvals.approved' },
  { value: 'rejected', label: 'approvals.rejected' },
  { value: '', label: 'approvals.all' },
];

/**
 * Approval queue (AUDIT §7 P0.5). The thresholds that produced these rows are
 * settings; this screen only decides, and never shows a decision to the person
 * who requested it as a valid move — the server refuses self-approval.
 */
export function ApprovalsPage() {
  const { company, user, can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = company?.currency ?? 'XPF';
  const [status, setStatus] = useState('pending');
  const [rejecting, setRejecting] = useState<ApprovalRow | null>(null);
  const [note, setNote] = useState('');

  const approvals = useQuery({
    queryKey: ['approvals', status],
    queryFn: () => api.get<{ data: ApprovalRow[] }>(`/approvals${toQuery({ status })}`),
  });

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: 'approve' | 'reject'; note?: string }) =>
      api.post(`/approvals/${input.id}/${input.decision}`, input.note ? { note: input.note } : {}),
    onSuccess: () => {
      toast.success(t('approvals.decided'));
      setRejecting(null);
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['approvals'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rows = approvals.data?.data ?? [];
  const isOwnRequest = (row: ApprovalRow) => Boolean(user?.id && row.requested_by === user.id);

  return (
    <>
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />

      <div className="mb-4">
        <Tabs items={TABS.map((item) => ({ value: item.value, label: t(item.label) }))} value={status} onChange={setStatus} />
      </div>

      <SectionCard title={t('approvals.title')} bodyClassName="table-wrap">
        {approvals.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : rows.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('approvals.entity')}</th>
                <th scope="col">{t('approvals.rule')}</th>
                <th scope="col" className="text-right">{t('common.amount')}</th>
                <th scope="col">{t('approvals.requestedBy')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="font-medium">{t(`approvals.entities.${row.entity_type}`)}</td>
                  <td className="text-muted">{t(`approvals.rules.${row.rule}`)}</td>
                  <td className="text-right tabular-nums">{formatMoney(row.amount, currency)}</td>
                  <td className="text-muted">
                    {row.requested_email ?? '—'}
                    <span className="block text-[11px]">{formatDateTime(row.created_at)}</span>
                  </td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="text-right">
                    {row.status === 'pending' && can('approvals.write') ? (
                      isOwnRequest(row) ? (
                        <span className="text-[11px] text-muted">{t('approvals.selfNotAllowed')}</span>
                      ) : (
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={decide.isPending}
                            onClick={() => decide.mutate({ id: row.id, decision: 'approve' })}
                            icon={<Check className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            {t('approvals.approve')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => { setRejecting(row); setNote(''); }}
                            icon={<X className="h-3.5 w-3.5" aria-hidden="true" />}
                          >
                            {t('approvals.reject')}
                          </Button>
                        </div>
                      )
                    ) : row.status !== 'pending' ? (
                      <span className="text-[11px] text-muted">
                        {row.decided_email ?? '—'} · {row.decided_at ? formatDateTime(row.decided_at) : ''}
                      </span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<ClipboardCheck className="h-6 w-6" aria-hidden="true" />} title={t('approvals.empty')} />
        )}
      </SectionCard>

      <Modal
        open={Boolean(rejecting)}
        onClose={() => setRejecting(null)}
        title={t('approvals.reject')}
        description={rejecting ? `${t(`approvals.entities.${rejecting.entity_type}`)} · ${formatMoney(rejecting.amount, currency)}` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRejecting(null)}>{t('common.cancel')}</Button>
            <Button
              loading={decide.isPending}
              disabled={!note.trim()}
              onClick={() => rejecting && decide.mutate({ id: rejecting.id, decision: 'reject', note: note.trim() })}
            >
              {t('approvals.reject')}
            </Button>
          </>
        }
      >
        <label className="block text-sm font-medium" htmlFor="approval_note">{t('approvals.note')}</label>
        <Input id="approval_note" value={note} onChange={(event) => setNote(event.target.value)} placeholder={t('approvals.notePlaceholder')} />
      </Modal>
    </>
  );
}
