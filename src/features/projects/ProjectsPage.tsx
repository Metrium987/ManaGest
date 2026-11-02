import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Eye, FolderKanban, Plus } from 'lucide-react';
import { toMinor } from '@shared/money';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatDuration, formatMoney, todayISO } from '@/lib/format';
import type { Client, ListResponse, Project } from '@/lib/types';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select, Textarea } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { GatedButton } from '@/components/ui/GatedButton';
import { showRecord } from '@/components/ui/RecordDrawer';

interface ProjectTemplate {
  id: string;
  name: string;
  description: string | null;
  archived: boolean;
  current_version: number | null;
  task_count: number | null;
  total_minutes: number | null;
  version_count: number;
}

interface TemplateTaskForm {
  title: string;
  minutes: number;
  hourly_rate: number;
  billable: boolean;
}

const EMPTY_TEMPLATE_TASK: TemplateTaskForm = { title: '', minutes: 0, hourly_rate: 0, billable: true };

/**
 * Q9/Q10: a template is a name and a stack of task estimates. Saving it stores the
 * first version; a project is then created from the version it was priced from, in
 * `planned`, with its tasks `todo` — the same path an accepted quote takes.
 */
function ProjectTemplatesModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [tasks, setTasks] = useState<TemplateTaskForm[]>([{ ...EMPTY_TEMPLATE_TASK }]);

  const templates = useQuery({
    queryKey: ['project-templates'],
    queryFn: () => api.get<ListResponse<ProjectTemplate>>('/project-templates'),
  });
  const clients = useQuery({
    queryKey: ['clients', 'options'],
    queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100'),
  });

  const setTask = (index: number, patch: Partial<TemplateTaskForm>) => {
    setTasks(tasks.map((task, cursor) => (cursor === index ? { ...task, ...patch } : task)));
  };

  const create = useMutation({
    mutationFn: () => api.post('/project-templates', {
      name,
      tasks: tasks.filter((task) => task.title.trim()).map((task) => ({
        title: task.title,
        minutes: task.minutes,
        hourly_rate: toMinor(task.hourly_rate, 'XPF'),
        billable: task.billable,
      })),
    }),
    onSuccess: () => {
      toast.success(t('projects.templateCreated'));
      setName('');
      setTasks([{ ...EMPTY_TEMPLATE_TASK }]);
      queryClient.invalidateQueries({ queryKey: ['project-templates'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const instantiate = useMutation({
    mutationFn: (template: ProjectTemplate) => api.post(`/project-templates/${template.id}/instantiate`, {
      client_id: clientId || null,
    }),
    onSuccess: () => {
      toast.success(t('projects.templateInstantiated'));
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <Modal open title={t('projects.templates')} onClose={onClose} size="lg">
      <div className="space-y-5">
        <p className="text-xs text-muted">{t('projects.templateIntro')}</p>

        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink-950">{t('projects.templates')}</p>
          {templates.data?.data.length ? (
            <ul className="space-y-2 text-sm">
              {(templates.data?.data ?? []).map((template) => (
                <li key={template.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2">
                  <span>
                    <span className="font-medium text-ink-950">{template.name}</span>
                    <span className="ml-2 text-xs text-muted">
                      v{template.current_version ?? 1} · {template.task_count ?? 0} {t('projects.templateTasks')} · {formatDuration(template.total_minutes ?? 0)}
                    </span>
                  </span>
                  <GatedButton
                    permission="projects.write"
                    variant="secondary"
                    size="sm"
                    loading={instantiate.isPending}
                    onClick={() => instantiate.mutate(template)}
                  >
                    {t('projects.templateInstantiate')}
                  </GatedButton>
                </li>
              ))}
            </ul>
          ) : <p className="text-xs text-muted">{t('projects.templateNone')}</p>}
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <Field label={t('projects.templateName')} htmlFor="template_name" required>
            <Input id="template_name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={t('projects.clientForProject')} htmlFor="template_client">
            <Select id="template_client" value={clientId} onChange={(event) => setClientId(event.target.value)}>
              <option value="">{t('common.none')}</option>
              {(clients.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
            </Select>
          </Field>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-ink-950">{t('projects.templateTask')}</p>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setTasks([...tasks, { ...EMPTY_TEMPLATE_TASK }])}
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t('projects.templateAddTask')}
              </Button>
            </div>
            {tasks.map((task, index) => (
              <div key={index} className="grid gap-2 sm:grid-cols-3">
                <Input
                  aria-label={t('projects.templateTask')}
                  value={task.title}
                  onChange={(event) => setTask(index, { title: event.target.value })}
                />
                <Input
                  type="number" min="0" aria-label={t('projects.templateMinutes')}
                  value={task.minutes} onChange={(event) => setTask(index, { minutes: Number(event.target.value) })}
                />
                <Input
                  type="number" min="0" aria-label={t('projects.templateRate')}
                  value={task.hourly_rate} onChange={(event) => setTask(index, { hourly_rate: Number(event.target.value) })}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button loading={create.isPending} disabled={!name.trim()} onClick={() => create.mutate()}>
            {t('projects.templateCreate')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function ProjectsPage() {
  const { company } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [open, setOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [form, setForm] = useState({
    name: '', description: '', client_id: '', status: 'active', budget: 0, start_date: todayISO(), deadline: '',
  });

  const projects = useQuery({ queryKey: ['projects'], queryFn: () => api.get<ListResponse<Project>>('/projects?per_page=100') });
  const clients = useQuery({ queryKey: ['clients', 'options'], queryFn: () => api.get<ListResponse<Client>>('/clients?per_page=100') });

  const create = useMutation({
    mutationFn: () => api.post('/projects', { ...form, client_id: form.client_id || null, budget: toMinor(form.budget, currency), deadline: form.deadline || null }),
    onSuccess: () => {
      toast.success(t('projects.new'));
      setOpen(false);
      setForm({ name: '', description: '', client_id: '', status: 'active', budget: 0, start_date: todayISO(), deadline: '' });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <>
      <PageHeader
        title={t('projects.title')}
        subtitle={t('projects.subtitle')}
        actions={<>
          <GatedButton
            permission="projects.write"
            variant="secondary"
            onClick={() => setTemplatesOpen(true)}
            icon={<FolderKanban className="h-4 w-4" aria-hidden="true" />}
          >
            {t('projects.templates')}
          </GatedButton>
          <GatedButton permission="projects.write" onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('projects.new')}</GatedButton>
        </>}
      />

      {projects.isLoading ? <Skeleton className="h-64" /> : projects.data?.data.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.data.map((project) => (
            <article key={project.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink-950">{project.name}</h2>
                  <p className="text-xs text-muted">{project.client_name ?? t('common.none')}</p>
                  <button
                    type="button"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-brand-700 hover:underline"
                    onClick={() => showRecord({
                        trace: { entityType: 'project', entityId: project.id },
                      title: project.name,
                      subtitle: project.client_name ?? undefined,
                      status: project.status,
                      fields: [
                        { label: t('projects.budget'), value: formatMoney(project.budget, currency) },
                        { label: t('common.date'), value: formatDate(project.start_date) },
                        { label: t('projects.deadline'), value: formatDate(project.deadline) },
                        { label: t('projects.tasks'), value: project.task_count ?? 0 },
                        { label: t('projects.timeSpent'), value: formatDuration(project.total_minutes ?? 0) },
                        { label: t('common.description'), value: project.description, wide: true },
                      ],
                    })}
                  >
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                    {t('records.view')}
                  </button>
                </div>
                <StatusBadge status={project.status} />
              </div>
              {project.description ? <p className="mt-2 line-clamp-2 text-sm text-muted">{project.description}</p> : null}
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div><dt className="text-xs text-muted">{t('projects.budget')}</dt><dd className="font-medium tabular-nums">{formatMoney(project.budget, currency)}</dd></div>
                <div><dt className="text-xs text-muted">{t('projects.deadline')}</dt><dd className="font-medium">{formatDate(project.deadline)}</dd></div>
                <div><dt className="text-xs text-muted">{t('projects.tasks')}</dt><dd className="font-medium tabular-nums">{project.task_count ?? 0}</dd></div>
                <div><dt className="text-xs text-muted">{t('projects.timeSpent')}</dt><dd className="font-medium tabular-nums">{formatDuration(project.total_minutes ?? 0)}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      ) : (
        <SectionCard title={t('projects.title')}>
          <EmptyState icon={<FolderKanban className="h-6 w-6" aria-hidden="true" />} title={t('projects.empty')} />
        </SectionCard>
      )}

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={t('projects.new')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={create.isPending} onClick={() => create.mutate()}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Field label={t('common.name')} htmlFor="project_name" required>
            <Input id="project_name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </Field>
          <FormGrid>
            <Field label={t('invoices.client')} htmlFor="project_client">
              <Select id="project_client" value={form.client_id} onChange={(event) => setForm({ ...form, client_id: event.target.value })}>
                <option value="">{t('common.none')}</option>
                {(clients.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)}
              </Select>
            </Field>
            <Field label={t('common.status')} htmlFor="project_status">
              <Select id="project_status" value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                <option value="active">{t('status.active')}</option>
                <option value="completed">{t('status.completed')}</option>
                <option value="archived">{t('status.archived')}</option>
              </Select>
            </Field>
            <Field label={t('projects.budget')} htmlFor="project_budget">
              <Input id="project_budget" type="number" min="0" value={form.budget || ''} onChange={(event) => setForm({ ...form, budget: Number(event.target.value) })} />
            </Field>
            <Field label={t('common.date')} htmlFor="project_start">
              <Input id="project_start" type="date" value={form.start_date} onChange={(event) => setForm({ ...form, start_date: event.target.value })} />
            </Field>
            <Field label={t('projects.deadline')} htmlFor="project_deadline">
              <Input id="project_deadline" type="date" value={form.deadline} onChange={(event) => setForm({ ...form, deadline: event.target.value })} />
            </Field>
          </FormGrid>
          <Field label={t('common.description')} htmlFor="project_description">
            <Textarea id="project_description" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
        </div>
      </Modal>

      {templatesOpen ? <ProjectTemplatesModal onClose={() => setTemplatesOpen(false)} /> : null}
    </>
  );
}
