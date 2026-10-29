import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FileText, ListChecks, Plus, Trash2 } from 'lucide-react';
import { TASK_STATUSES } from '@shared/domain';
import { toMinor } from '@shared/money';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDuration, formatMoney } from '@/lib/format';
import type { ListResponse, Project, Task } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { GatedButton } from '@/components/ui/GatedButton';
import { showRecord } from '@/components/ui/RecordDrawer';
import { useToast } from '@/components/ui/Toast';

const COLUMNS = TASK_STATUSES;

export function TasksPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [view, setView] = useState<'board' | 'list'>('list');
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', description: '', project_id: '', status: 'todo', hours: 0, hourly_rate: 0, billable: true,
  });

  const tasks = useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<ListResponse<Task>>(`/tasks${toQuery({ per_page: 100 })}`),
  });
  const projects = useQuery({ queryKey: ['projects', 'options'], queryFn: () => api.get<ListResponse<Project>>('/projects?per_page=100') });

  const rows = tasks.data?.data ?? [];
  const billable = useMemo(
    () => rows.filter((task) => task.billable && !task.invoice_id && task.minutes > 0 && task.hourly_rate > 0),
    [rows],
  );

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
      api.patch(`/tasks/${task.id}/status`, { status }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/tasks/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['tasks'] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const bill = useMutation({
    mutationFn: () => api.post<{ id: string; number: string; tasks: number }>('/tasks/invoice', { task_ids: selected }),
    onSuccess: (result) => {
      toast.success(t('kanban.invoiceCreated', { number: result.number, count: result.tasks }));
      setSelected([]);
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const toggleSelected = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const toggleAll = () =>
    setSelected((current) => (current.length === billable.length ? [] : billable.map((task) => task.id)));

  const detail = (task: Task) =>
    showRecord({
      title: task.title,
      subtitle: task.project_name ?? task.client_name ?? undefined,
      status: task.status,
      fields: [
        { label: t('tasks.project'), value: task.project_name },
        { label: t('invoices.client'), value: task.client_name },
        { label: t('tasks.duration'), value: formatDuration(task.minutes) },
        { label: t('tasks.hourlyRate'), value: formatMoney(task.hourly_rate, currency) },
        { label: t('tasks.billable'), value: task.billable ? '✓' : '—' },
        { label: t('common.status'), value: <StatusBadge status={task.status} /> },
        { label: t('common.description'), value: task.description, wide: true },
      ],
    });

  const card = (task: Task) => (
    <article
      key={task.id}
      draggable={can('tasks.write')}
      onDragStart={() => setDragging(task.id)}
      onDragEnd={() => setDragging(null)}
      className={`card mb-2 cursor-grab p-3 ${dragging === task.id ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-ink-900">{task.title}</p>
        <button type="button" className="rounded p-1 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('records.view')} ${task.title}`} onClick={() => detail(task)}>
          <Eye className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className="mt-0.5 text-xs text-muted">{task.project_name ?? t('common.none')}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted">
        <span className="tabular-nums">{formatDuration(task.minutes)}</span>
        <span className="tabular-nums">{formatMoney(task.hourly_rate, currency)}</span>
        {task.invoice_id ? (
          <span className="badge border-success-200 bg-success-50 text-success-700">{t('kanban.invoiced')}</span>
        ) : task.billable ? (
          <button
            type="button"
            onClick={() => toggleSelected(task.id)}
            aria-pressed={selected.includes(task.id)}
            title={t('kanban.billTasks')}
            className={`badge ${selected.includes(task.id) ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-line bg-surface text-muted'}`}
          >
            {selected.includes(task.id) ? '✓ ' : ''}{t('kanban.unbilled')}
          </button>
        ) : null}
      </div>
    </article>
  );

  return (
    <>
      <PageHeader
        title={t('tasks.title')}
        subtitle={t('tasks.subtitle')}
        actions={
          <>
            <Tabs
              items={[{ value: 'list', label: t('kanban.list') }, { value: 'board', label: t('kanban.board') }]}
              value={view}
              onChange={(value) => setView(value as 'board' | 'list')}
            />
            {can('tasks.write') ? (
              <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('tasks.new')}</Button>
            ) : null}
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface/60 px-4 py-2.5">
        <p className="text-xs text-muted">
          {selected.length ? t('kanban.selected', { count: selected.length }) : t('kanban.hint')}
        </p>
        <div className="ml-auto flex items-center gap-2">
          {billable.length ? (
            <Button size="sm" variant="ghost" onClick={toggleAll}>
              {selected.length === billable.length
                ? t('kanban.clearAll')
                : t('kanban.selectAll', { count: billable.length })}
            </Button>
          ) : null}
          <GatedButton
            permission="invoices.write"
            size="sm"
            loading={bill.isPending}
            disabled={!selected.length}
            reason={!selected.length ? t('kanban.noneBillable') : undefined}
            onClick={() => bill.mutate()}
            icon={<FileText className="h-3.5 w-3.5" aria-hidden="true" />}
          >
            {t('kanban.billTasks')}
          </GatedButton>
        </div>
      </div>

      {tasks.isLoading ? (
        <Skeleton className="h-64" />
      ) : !rows.length ? (
        <SectionCard title={t('tasks.title')}>
          <EmptyState icon={<ListChecks className="h-6 w-6" aria-hidden="true" />} title={t('tasks.empty')} />
        </SectionCard>
      ) : view === 'board' ? (
        <div className="grid gap-4 md:grid-cols-3">
          {COLUMNS.map((status) => {
            const columnTasks = rows.filter((task) => task.status === status);
            return (
              <section
                key={status}
                className="rounded-xl border border-line bg-surface/40 p-3"
                aria-label={t(`status.${status}`)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  const task = rows.find((item) => item.id === dragging);
                  if (task && task.status !== status) updateStatus.mutate({ task, status });
                  setDragging(null);
                }}
              >
                <header className="mb-2 flex items-center justify-between px-1">
                  <h2 className="text-sm font-semibold text-ink-900">{t(`status.${status}`)}</h2>
                  <span className="text-xs tabular-nums text-muted">{columnTasks.length}</span>
                </header>
                <div className="min-h-[80px]">
                  {columnTasks.length ? (
                    columnTasks.map(card)
                  ) : (
                    <p className="px-1 py-6 text-center text-xs text-muted">{t('kanban.emptyColumn')}</p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      ) : (
        <SectionCard title={t('tasks.title')} bodyClassName="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col"><span className="sr-only">{t('kanban.unbilled')}</span></th>
                <th scope="col">{t('common.description')}</th>
                <th scope="col">{t('tasks.project')}</th>
                <th scope="col">{t('tasks.duration')}</th>
                <th scope="col" className="text-right">{t('tasks.hourlyRate')}</th>
                <th scope="col">{t('common.status')}</th>
                <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((task) => (
                <tr key={task.id}>
                  <td>
                    {task.billable && !task.invoice_id ? (
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5 rounded border-line-strong"
                        aria-label={`${t('kanban.billTasks')} — ${task.title}`}
                        checked={selected.includes(task.id)}
                        onChange={() => toggleSelected(task.id)}
                      />
                    ) : task.invoice_id ? (
                      <span className="badge border-success-200 bg-success-50 text-success-700">{t('kanban.invoiced')}</span>
                    ) : null}
                  </td>
                  <td className="font-medium">
                    <button type="button" className="text-left hover:text-brand-700" onClick={() => detail(task)}>
                      {task.title}
                    </button>
                  </td>
                  <td className="text-muted">{task.project_name ?? '—'}</td>
                  <td className="text-muted">{formatDuration(task.minutes)}</td>
                  <td className="text-right tabular-nums">{formatMoney(task.hourly_rate, currency)}</td>
                  <td>
                    <Select
                      aria-label={`${t('common.status')} — ${task.title}`}
                      value={task.status}
                      onChange={(event) => updateStatus.mutate({ task, status: event.target.value })}
                      disabled={!can('tasks.write')}
                      className="h-8 w-36 py-0 text-xs"
                    >
                      {COLUMNS.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
                    </Select>
                  </td>
                  <td className="text-right">
                    <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink-900" aria-label={`${t('records.view')} ${task.title}`} onClick={() => detail(task)}>
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    </button>
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
        </SectionCard>
      )}

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
                {COLUMNS.map((value) => <option key={value} value={value}>{t(`status.${value}`)}</option>)}
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
