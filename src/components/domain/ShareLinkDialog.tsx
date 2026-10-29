import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Link2, Trash2, X } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Form';

/**
 * T-103: create, copy and revoke the public link of one document. The token is
 * returned once, when it is created; it is never readable afterwards, so the
 * dialog insists on copying it immediately.
 */

interface LinkRow {
  id: string;
  token_hint: string;
  expires_at: string;
  revoked_at: string | null;
  state: 'active' | 'expired' | 'revoked';
  access_count: number;
  last_access_at: string | null;
}

export function ShareButton({
  entityType,
  entityId,
}: {
  entityType: 'invoice' | 'quote' | 'credit';
  entityId: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)} icon={<Link2 className="h-4 w-4" aria-hidden="true" />}>
        {t('share.button')}
      </Button>
      {open ? <ShareLinkDialog entityType={entityType} entityId={entityId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function ShareLinkDialog({
  entityType,
  entityId,
  onClose,
}: {
  entityType: 'invoice' | 'quote' | 'credit';
  entityId: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [days, setDays] = useState('30');
  const [created, setCreated] = useState<{ url: string; expires_at: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const links = useQuery({
    queryKey: ['public-links', entityType, entityId],
    queryFn: () =>
      api.get<{ data: LinkRow[] }>(`/public-links?entity_type=${entityType}&entity_id=${entityId}`),
  });

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const create = async () => {
    setBusy(true);
    try {
      const result = await api.post<{ url: string; expires_at: string }>('/public-links', {
        entity_type: entityType,
        entity_id: entityId,
        days: Number(days),
      });
      setCreated(result);
      await queryClient.invalidateQueries({ queryKey: ['public-links', entityType, entityId] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await api.delete(`/public-links/${id}`);
      toast.success(t('share.revoked'));
      await queryClient.invalidateQueries({ queryKey: ['public-links', entityType, entityId] });
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      toast.success(t('share.copied'));
    } catch {
      toast.error(t('errors.generic'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-8">
      <div className="card w-full max-w-xl p-5 sm:p-6" role="dialog" aria-modal="true" aria-label={t('share.title')}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold">{t('share.title')}</h2>
            <p className="mt-1 text-sm text-muted">{t('share.hint')}</p>
          </div>
          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface" aria-label={t('common.close')} onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <Field label={t('share.expiresIn')} htmlFor="share_days">
            <Select id="share_days" value={days} onChange={(event) => setDays(event.target.value)} className="w-40">
              <option value="7">{t('share.days', { count: 7 })}</option>
              <option value="30">{t('share.days', { count: 30 })}</option>
              <option value="90">{t('share.days', { count: 90 })}</option>
              <option value="365">{t('share.days', { count: 365 })}</option>
            </Select>
          </Field>
          <Button loading={busy} onClick={create} icon={<Link2 className="h-4 w-4" aria-hidden="true" />}>
            {t('share.create')}
          </Button>
        </div>

        {created ? (
          <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50/40 p-3">
            <p className="text-xs font-medium text-brand-800">{t('share.created')}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-2 py-1.5 text-xs">{created.url}</code>
              <Button variant="secondary" size="sm" onClick={copy} icon={<Copy className="h-3.5 w-3.5" aria-hidden="true" />}>
                {t('share.copy')}
              </Button>
            </div>
            <p className="mt-2 text-xs text-muted">{t('share.expiresOn', { date: created.expires_at.slice(0, 10) })}</p>
          </div>
        ) : null}

        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('share.existing')}</p>
          {links.isLoading ? (
            <p className="mt-2 text-sm text-muted">{t('common.loading')}</p>
          ) : (links.data?.data ?? []).length === 0 ? (
            <p className="mt-2 text-sm text-muted">{t('share.none')}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {(links.data?.data ?? []).map((link) => (
                <li key={link.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <p className="font-mono text-xs">{link.token_hint}……</p>
                    <p className="text-xs text-muted">
                      {t(`share.state.${link.state}`)} · {t('share.accesses', { count: link.access_count })} · {t('share.expiresOn', { date: link.expires_at.slice(0, 10) })}
                    </p>
                  </div>
                  {link.state === 'active' ? (
                    <button
                      type="button"
                      className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                      aria-label={t('share.revoke')}
                      onClick={() => revoke(link.id)}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-5 flex justify-end">
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
        </div>
      </div>
    </div>
  );
}
