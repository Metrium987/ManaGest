import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Plus, Trash2 } from 'lucide-react';
import { PERMISSIONS, type Permission } from '@shared/domain';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { EmptyState, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface TokenRow {
  id: string;
  user_id: string;
  name: string;
  prefix: string;
  abilities: Permission[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  user_email: string;
}

/**
 * API tokens (AUDIT §7 P0.6). The value is shown once; the list only carries the
 * prefix, the abilities and the dates, so a stolen database dump does not hand
 * anyone a working credential.
 */
export function ApiTokensPanel() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Permission[]>([]);
  const [lifetime, setLifetime] = useState('');
  const [created, setCreated] = useState<{ value: string; abilities: Permission[] } | null>(null);
  const [copied, setCopied] = useState(false);

  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: () => api.get<{ data: TokenRow[] }>('/api-tokens') });

  const create = useMutation({
    mutationFn: () => api.post<{ value: string; abilities: Permission[] }>('/api-tokens', {
      name: name.trim(),
      abilities: selected,
      ...(lifetime ? { lifetime_days: Number(lifetime) } : {}),
    }),
    onSuccess: (result) => {
      setCreated(result);
      setOpen(false);
      setName('');
      setSelected([]);
      setLifetime('');
      toast.success(t('tokens.createdMessage'));
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api-tokens/${id}`),
    onSuccess: () => {
      toast.success(t('tokens.revoked'));
      queryClient.invalidateQueries({ queryKey: ['api-tokens'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const allowed = PERMISSIONS.filter((permission) => can(permission));
  const toggle = (permission: Permission) =>
    setSelected((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission],
    );

  const active = (tokens.data?.data ?? []).filter((token) => !token.revoked_at);

  return (
    <>
      <SectionCard
        title={t('tokens.title')}
        subtitle={t('tokens.subtitle')}
        actions={
          <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('tokens.new')}</Button>
        }
        bodyClassName="divide-y divide-line"
      >
        {tokens.isLoading ? (
          <Skeleton className="m-4 h-24" />
        ) : active.length ? (
          active.map((token) => (
            <div key={token.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium">
                  <KeyRound className="h-4 w-4 text-muted" aria-hidden="true" />
                  {token.name}
                  <code className="rounded bg-surface px-1.5 py-0.5 text-[11px] text-muted">{token.prefix}…</code>
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  {t('tokens.abilities')} : {token.abilities.length}
                  {can('users.write') ? ` · ${token.user_email}` : ''}
                </p>
                <p className="text-xs text-muted">
                  {t('tokens.created')} {formatDateTime(token.created_at)} · {t('tokens.lastUsed')}{' '}
                  {token.last_used_at ? formatDateTime(token.last_used_at) : t('tokens.never')} · {t('tokens.expires')}{' '}
                  {token.expires_at ? formatDateTime(token.expires_at) : t('tokens.never')}
                </p>
              </div>
              <button
                type="button"
                className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                aria-label={`${t('tokens.revoke')} ${token.name}`}
                onClick={async () => {
                  if (await confirm({ title: t('tokens.revoke'), description: t('tokens.revokeConfirm'), danger: true, confirmLabel: t('common.confirm') })) {
                    revoke.mutate(token.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ))
        ) : (
          <EmptyState icon={<KeyRound className="h-6 w-6" aria-hidden="true" />} title={t('tokens.empty')} />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('tokens.new')}
        description={t('tokens.abilitiesHint')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} disabled={name.trim().length < 2} onClick={() => create.mutate()}>{t('tokens.new')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('tokens.name')} htmlFor="token_name" required>
            <Input id="token_name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('tokens.lifetime')} htmlFor="token_lifetime" hint={t('tokens.lifetimeHint')}>
            <Input
              id="token_lifetime"
              type="number"
              min="1"
              max="3650"
              value={lifetime}
              onChange={(event) => setLifetime(event.target.value)}
              placeholder="365"
              className="w-40"
            />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-900">{t('tokens.abilities')}</legend>
            <div className="grid max-h-64 gap-1.5 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-2">
              {allowed.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border-line-strong"
                    checked={selected.includes(permission)}
                    onChange={() => toggle(permission)}
                  />
                  <span className="font-mono">{permission}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Modal>

      <Modal
        open={Boolean(created)}
        onClose={() => { setCreated(null); setCopied(false); }}
        title={t('tokens.createdMessage')}
        description={t('tokens.valueWarning')}
        footer={<Button onClick={() => { setCreated(null); setCopied(false); }}>{t('records.close')}</Button>}
      >
        {created ? (
          <div className="space-y-3">
            <code className="block break-all rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-xs">
              {created.value}
            </code>
            <p className="text-xs text-muted">{t('tokens.header')} : <code>X-API-TOKEN: {created.value.slice(0, 8)}…</code></p>
            <Button
              variant="secondary"
              icon={<Copy className="h-4 w-4" aria-hidden="true" />}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(created.value);
                  setCopied(true);
                } catch {
                  setCopied(false);
                }
              }}
            >
              {copied ? t('mfa.copied') : t('mfa.copy')}
            </Button>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
