import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ListChecks, Plus, Trash2 } from 'lucide-react';
import { TASK_STATUSES } from '@shared/domain';
import { toMinor } from '@shared/money';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDuration, formatMoney } from '@/lib/format';
import type { ListResponse, Project, Task } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export function TasksPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    title: '', description: '', project_id: '', status: 'todo', hours: 0, hourly_rate: 0, billable: true,
  });

  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.get<ListResponse<Task>>('/tasks?per_page=100') });
  const projects = useQuery({ queryKey: ['projects', 'options'], queryFn: () => api.get<ListResponse<Project>>('/projects?per_page=100') });

  const create = useMutation({
    mutationFn: () =>
      api.post('/tasks', {
        title: form.title,
        description: form.description,
        project_id: form.project_id || null,
        status: form.status,
        minutes: Math.round(form.hours * 60),
        hourly_rate: toMinor(form.hourly_rate, currency),
        billable: form.billable,
      }),
    onSuccess: () => {
      toast.success(t('tasks.new'));
      setOpen(false);
      setForm({ title: '', description: '', project_id: '', status: 'todo', hours: 0, hourly_rate: 0, billable: true });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const updateStatus = useMutation({
    mutationFn: ({ task, status }: { task: Task; status: string }) =>
      api.patch(`/tasks/${task.id}`, {
        title: task.title,
        description: task.description,
        project_id: task.project_id,
        client_id: task.client_id,
        status,
        minutes: task.minutes,
        hourly_rate: task.hourly_rate,
        billable: Boolean(task.billable),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={can('tasks.write') ? <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('tasks.new')}</Button> : null}
      />

      <SectionCard title={t('tasks.title')} bodyClassName="table-wrap">
        {tasks.isLoading ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : tasks.data?.data.length ? (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('common.description')}</th>
                <th scope="col">{t('tasks.project')}</th>
                <th scope="col">{t('tasks.duration')}</th>
                <th scope="col" className="text-right">{t('tasks.hourlyRate')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {tasks.data.data.map((task) => (
                <tr key={task.id}>
                  <td className="font-medium">{task.title}</td>
                  <td className="text-muted">{task.project_name ?? '—'}</td>
                  <td className="text-muted">{formatDuration(task.minutes)}</td>
                  <td className="text-right tabular-nums">{formatMoney(task.hourly_rate, currency)}</td>
                  <td>
                    <Select
                      aria-label={`${t('common.status')} — ${task.title}`}
                      value={task.status}
                      onChange={(event) => updateStatus.mutate({ task, status: event.target.value })}
                      className="h-8 w-36 py-0 text-xs"
                    >
                      {TASK_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
                    </Select>
                  </td>
                  <td className="text-right">
                    {can('tasks.delete') ? (
                      <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600" aria-label={`${t('common.delete')} ${task.title}`} onClick={() => remove.mutate(task.id)}>
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <EmptyState icon={<ListChecks className="h-6 w-6" aria-hidden="true" />} title={t('tasks.empty')} />
        )}
      </SectionCard>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('tasks.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('common.description')} htmlFor="task_title" required>
            <Input id="task_title" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
          </Field>
          <FormGrid>
            <Field label={t('tasks.project')} htmlFor="task_project">
              <Select id="task_project" value={form.project_id} onChange={(event) => setForm({ ...form, project_id: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {(projects.data?.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
              </Select>
            </Field>
            <Field label={t('common.status')} htmlFor="task_status">
              <Select id="task_status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                {TASK_STATUSES.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('tasks.duration')} htmlFor="task_hours">
              <Input id="task_hours" type="number" min="0" step="0.25" value={form.hours || ''} onChange={(event) => setForm({ ...form, hours: Number(event.target.value) })} />
            </Field>
            <Field label={t('tasks.hourlyRate')} htmlFor="task_rate">
              <Input id="task_rate" type="number" min="0" value={form.hourly_rate || ''} onChange={(event) => setForm({ ...form, hourly_rate: Number(event.target.value) })} />
            </Field>
          </FormGrid>
          <Checkbox label={t('tasks.billable')} checked={form.billable} onChange={(event) => setForm({ ...form, billable: event.target.checked })} />
        </div>
      </Modal>
    </>
  );
}
