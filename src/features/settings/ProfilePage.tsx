import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy, KeyRound, MonitorSmartphone, Save, ShieldCheck, Trash2, UserCircle2 } from 'lucide-react';
import { ROLE_LABELS } from '@shared/domain';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDateTime } from '@/lib/format';
import { PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { useConfirm } from '@/components/ui/Modal';
import { ApiTokensPanel } from './ApiTokensPanel';

interface SessionEntry {
  id: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  current: boolean;
}

export function ProfilePage() {
  const { user, refetch } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [profile, setProfile] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    email: user?.email ?? '',
  });
  const [passwords, setPasswords] = useState({ current_password: '', new_password: '', confirm: '' });
  const [mfaSecret, setMfaSecret] = useState<{ secret: string; otpauth_uri: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  const sessions = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api.get<{ data: SessionEntry[] }>('/auth/sessions'),
  });

  const saveProfile = useMutation({
    mutationFn: () => api.patch('/auth/profile', profile),
    onSuccess: async () => {
      toast.success(t('settings.profileSaved'));
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const changePassword = useMutation({
    mutationFn: () => api.post('/auth/change-password', { current_password: passwords.current_password, new_password: passwords.new_password }),
    onSuccess: () => {
      toast.success(t('settings.passwordChanged'));
      setPasswords({ current_password: '', new_password: '', confirm: '' });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/auth/sessions/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['sessions'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const revokeAll = useMutation({
    mutationFn: () => api.delete('/auth/sessions'),
    onSuccess: () => {
      toast.success(t('settings.revokeOthers'));
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const setupMfa = useMutation({
    mutationFn: () => api.post<{ secret: string; otpauth_uri: string }>('/auth/mfa/setup'),
    onSuccess: (result) => {
      setMfaSecret(result);
      setMfaCode('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const enableMfa = useMutation({
    mutationFn: () => api.post<{ recovery_codes: string[] }>('/auth/mfa/enable', { code: mfaCode }),
    onSuccess: async (result) => {
      setMfaSecret(null);
      setMfaCode('');
      setRecoveryCodes(result.recovery_codes);
      toast.success(t('mfa.enabled'));
      await refetch();
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const disableMfa = useMutation({
    mutationFn: () => api.post('/auth/mfa/disable', { code: disableCode }),
    onSuccess: async () => {
      setDisableCode('');
      toast.success(t('mfa.disabled'));
      await refetch();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const copyCodes = async () => {
    if (!recoveryCodes) return;
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const submitProfile = (event: FormEvent) => {
    event.preventDefault();
    saveProfile.mutate();
  };

  const submitPassword = (event: FormEvent) => {
    event.preventDefault();
    if (passwords.new_password !== passwords.confirm) {
      toast.error(t('errors.validation'));
      return;
    }
    changePassword.mutate();
  };

  return (
    <>
      <PageHeader title={t('settings.profile')} subtitle={`${ROLE_LABELS[user?.role ?? 'viewer']} · ${user?.email ?? ''}`} />

      <div className="grid gap-4 xl:grid-cols-2">
        <SectionCard title={t('settings.profile')} bodyClassName="p-5">
          <form onSubmit={submitProfile} className="space-y-4">
            <FormGrid>
              <Field label={t('common.firstName')} htmlFor="profile_first">
                <Input id="profile_first" value={profile.first_name} onChange={(event) => setProfile({ ...profile, first_name: event.target.value })} />
              </Field>
              <Field label={t('common.lastName')} htmlFor="profile_last">
                <Input id="profile_last" value={profile.last_name} onChange={(event) => setProfile({ ...profile, last_name: event.target.value })} />
              </Field>
            </FormGrid>
            <Field label={t('common.email')} htmlFor="profile_email">
              <Input id="profile_email" type="email" value={profile.email} onChange={(event) => setProfile({ ...profile, email: event.target.value })} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" loading={saveProfile.isPending} icon={<Save className="h-4 w-4" aria-hidden="true" />}>{t('common.save')}</Button>
            </div>
          </form>
        </SectionCard>

        <SectionCard title={t('settings.changePassword')} bodyClassName="p-5">
          <form onSubmit={submitPassword} className="space-y-4">
            <Field label={t('settings.currentPassword')} htmlFor="current_password">
              <Input id="current_password" type="password" autoComplete="current-password" value={passwords.current_password} onChange={(event) => setPasswords({ ...passwords, current_password: event.target.value })} />
            </Field>
            <FormGrid>
              <Field label={t('settings.newPassword')} htmlFor="new_password" hint={t('setup.passwordHint')}>
                <Input id="new_password" type="password" autoComplete="new-password" value={passwords.new_password} onChange={(event) => setPasswords({ ...passwords, new_password: event.target.value })} />
              </Field>
              <Field label={t('common.confirm')} htmlFor="confirm_password">
                <Input id="confirm_password" type="password" autoComplete="new-password" value={passwords.confirm} onChange={(event) => setPasswords({ ...passwords, confirm: event.target.value })} />
              </Field>
            </FormGrid>
            <div className="flex justify-end">
              <Button type="submit" variant="secondary" loading={changePassword.isPending} icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>{t('settings.changePassword')}</Button>
            </div>
          </form>
        </SectionCard>
      </div>

      <div className="mt-4">
        <SectionCard title={t('mfa.title')} subtitle={t('mfa.subtitle')} bodyClassName="p-5">
          {recoveryCodes ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-sm font-medium text-success-700">
                <Check className="h-4 w-4" aria-hidden="true" /> {t('mfa.enabled')}
              </div>
              <p className="text-sm text-muted">{t('mfa.recoveryHint')}</p>
              <ul className="grid gap-2 rounded-xl border border-line bg-surface p-3 font-mono text-sm sm:grid-cols-2">
                {recoveryCodes.map((value) => (
                  <li key={value} className="tabular-nums">{value}</li>
                ))}
              </ul>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={copyCodes} icon={<Copy className="h-4 w-4" aria-hidden="true" />}>
                  {copied ? t('mfa.copied') : t('mfa.copy')}
                </Button>
                <Button onClick={() => setRecoveryCodes(null)}>{t('mfa.close')}</Button>
              </div>
            </div>
          ) : mfaSecret ? (
            <div className="space-y-4">
              <p className="text-sm text-muted">{t('mfa.secretHint')}</p>
              <code className="block break-all rounded-xl border border-line bg-surface px-3 py-2.5 font-mono text-sm tracking-[0.2em]">
                {mfaSecret.secret}
              </code>
              <a
                href={mfaSecret.otpauth_uri}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
              >
                {t('mfa.verify')}
              </a>
              <form
                className="flex flex-wrap items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  enableMfa.mutate();
                }}
              >
                <Field label={t('mfa.codeLabel')} htmlFor="mfa_enable_code" required>
                  <Input
                    id="mfa_enable_code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={mfaCode}
                    onChange={(event) => setMfaCode(event.target.value)}
                    placeholder="123456"
                  />
                </Field>
                <Button type="submit" loading={enableMfa.isPending}>{t('mfa.verify')}</Button>
                <Button variant="ghost" onClick={() => { setMfaSecret(null); setMfaCode(''); }}>{t('common.cancel')}</Button>
              </form>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="h-5 w-5 text-muted" aria-hidden="true" />
                <span className={`badge border ${
                  user?.mfa_enabled
                    ? 'border-success-200 bg-success-50 text-success-700'
                    : 'border-line bg-surface text-muted'
                }`}>
                  {user?.mfa_enabled ? t('mfa.statusEnabled') : t('mfa.statusDisabled')}
                </span>
              </div>
              {user?.mfa_enabled ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    aria-label={t('mfa.codeLabel')}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={10}
                    placeholder={t('mfa.codeLabel')}
                    className="w-40"
                    value={disableCode}
                    onChange={(event) => setDisableCode(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    loading={disableMfa.isPending}
                    onClick={() => disableMfa.mutate()}
                  >
                    {t('mfa.disable')}
                  </Button>
                </div>
              ) : (
                <Button loading={setupMfa.isPending} onClick={() => setupMfa.mutate()} icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
                  {t('mfa.generate')}
                </Button>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      <div className="mt-4">
        <ApiTokensPanel />
      </div>

      <div className="mt-4">
        <SectionCard
          title={t('settings.sessions')}
          actions={<Button variant="secondary" size="sm" loading={revokeAll.isPending} onClick={() => revokeAll.mutate()}>{t('settings.revokeOthers')}</Button>}
          bodyClassName="divide-y divide-line"
        >
          {sessions.isLoading ? <Skeleton className="m-4 h-16" /> : (sessions.data?.data ?? []).map((session) => (
            <div key={session.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div className="flex items-center gap-3">
                <MonitorSmartphone className="h-4 w-4 text-muted" aria-hidden="true" />
                <div>
                  <p className="text-sm font-medium">
                    {session.ip ?? '—'} {session.current ? <span className="ml-2 badge border-success-200 bg-success-50 text-success-700">{t('settings.currentSession')}</span> : null}
                  </p>
                  <p className="max-w-md truncate text-xs text-muted">{session.user_agent ?? '—'}</p>
                  <p className="text-xs text-muted">{formatDateTime(session.last_seen_at)}</p>
                </div>
              </div>
              {!session.current ? (
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                  aria-label={t('settings.revoke')}
                  onClick={async () => {
                    if (await confirm({ title: t('settings.revoke'), description: t('settings.sessions'), danger: true, confirmLabel: t('common.confirm') })) revoke.mutate(session.id);
                  }}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          ))}
          {(sessions.data?.data ?? []).length === 0 ? (
            <div className="flex items-center gap-2 px-5 py-6 text-sm text-muted"><UserCircle2 className="h-4 w-4" aria-hidden="true" />{t('common.none')}</div>
          ) : null}
        </SectionCard>
      </div>
    </>
  );
}
