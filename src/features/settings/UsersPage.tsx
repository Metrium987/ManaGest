import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Plus, Trash2, UserCog } from 'lucide-react';
import { ROLES, ROLE_LABELS, type Role } from '@shared/domain';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDateTime, initials } from '@/lib/format';
import type { User } from '@/lib/types';
import { Avatar, EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export function UsersPage() {
  const { user: currentUser, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [resetUser, setResetUser] = useState<User | null>(null);
  const [password, setPassword] = useState('');
  const [form, setForm] = useState({ first_name: '', last_name: '', email: '', role: 'viewer' as Role, password: '' });
  const [editForm, setEditForm] = useState<{ first_name: string; last_name: string; role: Role; is_active: boolean }>({ first_name: '', last_name: '', role: 'viewer', is_active: true });

  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get<{ data: User[] }>('/users') });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({
    mutationFn: () => api.post('/users', form),
    onSuccess: () => {
      toast.success(t('settings.addUser'));
      setCreateOpen(false);
      setForm({ first_name: '', last_name: '', email: '', role: 'viewer', password: '' });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const update = useMutation({
    mutationFn: () => api.patch(`/users/${editing?.id}`, editForm),
    onSuccess: () => {
      toast.success(t('settings.saved'));
      setEditing(null);
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const resetPassword = useMutation({
    mutationFn: () => api.post(`/users/${resetUser?.id}/reset-password`, { password }),
    onSuccess: () => {
      toast.success(t('settings.passwordChanged'));
      setResetUser(null);
      setPassword('');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/users/${id}`),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const openEdit = (user: User) => {
    setEditing(user);
    setEditForm({ first_name: user.first_name, last_name: user.last_name, role: user.role, is_active: user.is_active !== 0 });
  };

  return (
    <>
      <PageHeader
        title={t('users.title')}
        subtitle={t('users.subtitle')}
        actions={can('users.write') ? <Button onClick={() => setCreateOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('settings.addUser')}</Button> : null}
      />

      <SectionCard title={t('users.title')} subtitle={t('settings.roleHint')} bodyClassName="table-wrap">
        {users.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : users.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.name')}</th>
                <th scope="col">{t('common.email')}</th>
                <th scope="col">{t('common.role')}</th>
                <th scope="col">{t('settings.lastLogin')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {users.data.data.map((user) => (
                <tr key={user.id}>
                  <td>
                    <div className="flex items-center gap-2.5">
                      <Avatar initials={initials(user.first_name, user.last_name)} size="sm" />
                      <div>
                        <p className="font-medium">{user.first_name} {user.last_name}</p>
                        {user.id === currentUser?.id ? <p className="text-xs text-muted">{t('settings.currentSession')}</p> : null}
                      </div>
                    </div>
                  </td>
                  <td className="text-muted">{user.email}</td>
                  <td>{ROLE_LABELS[user.role]}</td>
                  <td className="text-muted">{user.last_login_at ? formatDateTime(user.last_login_at) : t('settings.never')}</td>
                  <td>
                    <span className={`badge ${user.is_active === 0 ? 'border-slate-200 bg-slate-100 text-slate-600' : 'border-success-200 bg-success-50 text-success-700'}`}>
                      {user.is_active === 0 ? t('status.archived') : t('settings.active')}
                    </span>
                  </td>
                  <td>
                    <div className="flex justify-end gap-1">
                      {can('users.write') ? (
                        <>
                          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('common.edit')} ${user.first_name}`} onClick={() => openEdit(user)}>
                            <UserCog className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={t('settings.resetPassword')} onClick={() => setResetUser(user)}>
                            <KeyRound className="h-4 w-4" aria-hidden="true" />
                          </button>
                          {user.id !== currentUser?.id ? (
                            <button
                              type="button"
                              className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                              aria-label={`${t('common.delete')} ${user.first_name}`}
                              onClick={async () => {
                                if (await confirm({ title: t('common.delete'), description: t('settings.deleteUserConfirm'), danger: true, confirmLabel: t('common.delete') })) remove.mutate(user.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden="true" />
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<UserCog className="h-6 w-6" aria-hidden="true" />} title={t('common.noResults')} />
        )}
      </SectionCard>

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t('settings.addUser')}
        footer={<><Button variant="secondary" onClick={() => setCreateOpen(false)}>{t('common.cancel')}</Button><Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button></>}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t('common.firstName')} htmlFor="user_first"><Input id="user_first" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} /></Field>
            <Field label={t('common.lastName')} htmlFor="user_last"><Input id="user_last" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} /></Field>
          </FormGrid>
          <Field label={t('common.email')} htmlFor="user_email"><Input id="user_email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></Field>
          <Field label={t('common.role')} htmlFor="user_role">
            <Select id="user_role" value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as Role })}>
              {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </Select>
          </Field>
          <Field label={t('settings.password')} htmlFor="user_password" hint={t('setup.passwordHint')}>
            <Input id="user_password" type="password" autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={t('common.edit')}
        footer={<><Button variant="secondary" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button loading={update.isPending} onClick={() => update.mutate()}>{t('common.save')}</Button></>}
      >
        <div className="space-y-4">
          <FormGrid>
            <Field label={t('common.firstName')} htmlFor="edit_first"><Input id="edit_first" value={editForm.first_name} onChange={(event) => setEditForm({ ...editForm, first_name: event.target.value })} /></Field>
            <Field label={t('common.lastName')} htmlFor="edit_last"><Input id="edit_last" value={editForm.last_name} onChange={(event) => setEditForm({ ...editForm, last_name: event.target.value })} /></Field>
          </FormGrid>
          <Field label={t('common.role')} htmlFor="edit_role">
            <Select id="edit_role" value={editForm.role} onChange={(event) => setEditForm({ ...editForm, role: event.target.value as Role })}>
              {ROLES.map((role) => <option key={role} value={role}>{ROLE_LABELS[role]}</option>)}
            </Select>
          </Field>
          <Checkbox label={t('settings.active')} checked={editForm.is_active} onChange={(event) => setEditForm({ ...editForm, is_active: event.target.checked })} />
        </div>
      </Modal>

      <Modal
        open={Boolean(resetUser)}
        onClose={() => setResetUser(null)}
        title={t('settings.resetPassword')}
        description={resetUser ? `${resetUser.first_name} ${resetUser.last_name}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setResetUser(null)}>{t('common.cancel')}</Button><Button loading={resetPassword.isPending} onClick={() => resetPassword.mutate()}>{t('common.confirm')}</Button></>}
      >
        <Field label={t('settings.newPassword')} htmlFor="reset_password" hint={t('setup.passwordHint')}>
          <Input id="reset_password" type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        </Field>
      </Modal>
    </>
  );
}
