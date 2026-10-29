import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Lock, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '@shared/domain';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { ListResponse } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { EmptyState, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface RoleRow {
  key: string;
  name: string;
  is_system: number;
  users: number;
  permissions: Permission[];
}

interface Account {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  role_key?: string | null;
  is_active: number;
}

const SYSTEM_KEYS = Object.keys(ROLE_PERMISSIONS) as Role[];

/**
 * Role management (T-202c). The matrix is read-only on purpose: the five fixed
 * roles are the contract every route guard was written against, so they are shown
 * but never edited. A custom role is a name plus a permission list, and an account
 * carries it — the server resolves the list on the next request.
 */
export function RolesPanel() {
  const { can } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const canWrite = can('users.write');

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Permission[]>([]);

  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get<{ roles: RoleRow[] }>('/roles') });
  const users = useQuery({
    queryKey: ['users', 'roles'],
    queryFn: () => api.get<ListResponse<Account>>('/users?per_page=100'),
    enabled: can('users.read'),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['roles'] });
    queryClient.invalidateQueries({ queryKey: ['users'] });
    queryClient.invalidateQueries({ queryKey: ['me'] });
  };

  const save = useMutation({
    mutationFn: () =>
      editing
        ? api.patch(`/roles/${editing}`, { name: name.trim(), permissions: selected })
        : api.post('/roles', { name: name.trim(), permissions: selected }),
    onSuccess: () => {
      toast.success(t(editing ? 'roles.updated' : 'roles.created'));
      setOpen(false);
      setEditing(null);
      setName('');
      setSelected([]);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (key: string) => api.delete(`/roles/${key}`),
    onSuccess: () => {
      toast.success(t('roles.deleted'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const assign = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api.patch(`/roles/assign/${userId}`, { role }),
    onSuccess: () => {
      toast.success(t('roles.assigned'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const startCreate = () => {
    setEditing(null);
    setName('');
    setSelected([]);
    setOpen(true);
  };

  const startEdit = (role: RoleRow) => {
    setEditing(role.key);
    setName(role.name);
    setSelected(role.permissions);
    setOpen(true);
  };

  const toggle = (permission: Permission) =>
    setSelected((current) =>
      current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission],
    );

  const rows = roles.data?.roles ?? [];
  const accounts = users.data?.data ?? [];

  return (
    <>
      <SectionCard
        title={t('roles.title')}
        subtitle={t('roles.subtitle')}
        actions={
          canWrite ? (
            <Button onClick={startCreate} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('roles.new')}</Button>
          ) : (
            <span className="text-xs text-muted">{t('roles.noWrite')}</span>
          )
        }
      >
        {roles.isLoading ? (
          <Skeleton className="m-4 h-32" />
        ) : rows.length ? (
          <ul className="divide-y divide-line">
            {rows.map((role) => (
              <li key={role.key} className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-medium text-ink-900">
                    {role.is_system ? <Lock className="h-3.5 w-3.5 text-muted" aria-hidden="true" /> : null}
                    {role.name}
                    <span className={`badge ${role.is_system ? 'border-line bg-surface text-muted' : 'border-brand-200 bg-brand-50 text-brand-700'}`}>
                      {role.is_system ? t('roles.system') : t('roles.custom')}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {role.permissions.length} {t('roles.permissions').toLowerCase()} · {role.users} {t('roles.users').toLowerCase()}
                  </p>
                </div>
                {canWrite ? (
                  role.is_system ? (
                    <span className="text-xs text-muted">{t('roles.systemLocked')}</span>
                  ) : (
                    <div className="flex gap-1">
                      <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('common.edit')} ${role.name}`} onClick={() => startEdit(role)}>
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                        aria-label={`${t('common.delete')} ${role.name}`}
                        onClick={async () => {
                          if (await confirm({ title: t('common.delete'), description: t('roles.deleteConfirm'), danger: true, confirmLabel: t('common.confirm') })) {
                            remove.mutate(role.key);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={<ShieldCheck className="h-6 w-6" aria-hidden="true" />} title={t('roles.empty')} />
        )}
      </SectionCard>

      {can('users.read') ? (
        <SectionCard title={t('roles.users')} subtitle={t('roles.assignHint')} bodyClassName="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('activity.user')}</th>
                <th scope="col">{t('common.email')}</th>
                <th scope="col">{t('roles.assign')}</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.id}>
                  <td className="font-medium">{account.first_name} {account.last_name}</td>
                  <td className="text-muted">{account.email}</td>
                  <td>
                    <select
                      className="input h-8 w-56 py-0 text-xs"
                      aria-label={`${t('roles.assign')} — ${account.email}`}
                      value={account.role_key ?? account.role}
                      disabled={!canWrite || assign.isPending}
                      onChange={(event) => assign.mutate({ userId: account.id, role: event.target.value })}
                    >
                      {SYSTEM_KEYS.map((key) => (
                        <option key={key} value={key}>{ROLE_LABELS[key] ?? key}</option>
                      ))}
                      {rows.filter((role) => !role.is_system).map((role) => (
                        <option key={role.key} value={role.key}>{role.name}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </SectionCard>
      ) : null}

      <SectionCard title={t('roles.matrix')} subtitle={t('roles.matrixHint')} bodyClassName="table-wrap">
        <table className="data-table text-xs">
          <thead>
            <tr>
              <th scope="col">{t('roles.permissions')}</th>
              {rows.map((role) => (
                <th key={role.key} scope="col" className="text-center">{role.name}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PERMISSIONS.map((permission) => (
              <tr key={permission}>
                <td className="font-mono text-[11px] text-muted">{permission}</td>
                {rows.map((role) => (
                  <td key={`${role.key}-${permission}`} className="text-center">
                    {role.permissions.includes(permission) ? (
                      <Check className="mx-auto h-3.5 w-3.5 text-success-700" aria-label="✓" />
                    ) : (
                      <span className="text-line-strong" aria-hidden="true">·</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={editing ? t('common.edit') : t('roles.new')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={save.isPending} disabled={name.trim().length < 2} onClick={() => save.mutate()}>{t('roles.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('roles.name')} htmlFor="role_name" required>
            <Input id="role_name" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} />
          </Field>
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-ink-900">{t('roles.permissions')}</legend>
            <div className="grid max-h-80 gap-1.5 overflow-y-auto rounded-xl border border-line p-3 sm:grid-cols-2">
              {PERMISSIONS.map((permission) => (
                <label key={permission} className="flex items-center gap-2 text-xs text-ink-800">
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
    </>
  );
}
