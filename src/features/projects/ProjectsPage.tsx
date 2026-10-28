import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderKanban, Plus } from 'lucide-react';
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

export function ProjectsPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [open, setOpen] = useState(false);
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
        actions={can('projects.write') ? <Button onClick={() => setOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('projects.new')}</Button> : null}
      />

      {projects.isLoading ? <Skeleton className="h-64" /> : projects.data?.data.length ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {projects.data.data.map((project) => (
            <article key={project.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h2 className="font-display text-base font-semibold text-ink-950">{project.name}</h2>
                  <p className="text-xs text-muted">{project.client_name ?? t('common.none')}</p>
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
    </>
  );
}
