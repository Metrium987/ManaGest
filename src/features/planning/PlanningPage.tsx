import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarDays, Clock, Plus, Target } from 'lucide-react';
import { Link } from 'react-router-dom';
import { SLA_DEFAULT_POLICIES, addDays, capacityUsagePercent, weekDates, weekStart } from '@shared/planning';
import { api, toQuery } from '@/lib/api';
import { errorMessage, fieldErrors } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { formatDate, todayISO } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

interface PlanningSettings {
  weekly_capacity_minutes: number;
  working_days: number[];
  business_start: string;
  business_end: string;
}

interface NonWorkingDay {
  day: string;
  label: string | null;
  created_at?: string;
}

interface CapacityRow {
  id: string;
  first_name: string;
  last_name: string;
  role: string;
  is_active: number;
  weekly_minutes: number;
  is_default: boolean;
}

interface WeekLoad {
  week: string;
  assignee_id: string;
  minutes: number;
  capacity: number;
  overloaded: boolean;
}

interface ReportResponse {
  from: string;
  weeks: WeekLoad[];
  overloads: WeekLoad[];
  unassigned_minutes: number;
  settings: PlanningSettings;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  minutes: number;
  client_id: string | null;
  project_id: string | null;
}

interface SlaAssignment {
  task_id: string;
  title: string;
  client_id: string | null;
  client_name: string | null;
  policy_name: string | null;
  policy_scope: string | null;
  priority: string;
  response_due: string | null;
  resolution_due: string | null;
  response_overdue: boolean;
  resolution_overdue: boolean;
}

interface SlaPolicy {
  id: string;
  name: string;
  scope: 'client' | 'contract';
  client_id: string | null;
  contract_id: string | null;
  priority: string;
  response_minutes: number;
  resolution_minutes: number;
  is_active: number;
}

type Tab = 'report' | 'settings' | 'calendar' | 'sla';

const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

function minutesLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} ${t('planning.minutesShort')}`;
  return rest ? `${hours} h ${String(rest).padStart(2, '0')}` : `${hours} ${t('planning.hoursShort')}`;
}

export function PlanningPage() {
  const { can } = useSession();
  const toast = useToast();
  const { confirm } = useConfirm();
  const queryClient = useQueryClient();
  const canWrite = can('projects.write');

  const [tab, setTab] = useState<Tab>('report');
  const [week, setWeek] = useState(() => weekStart(todayISO()));
  const [assignDraft, setAssignDraft] = useState({ taskId: '', assignee: '', start: '', end: '' });

  const settingsQuery = useQuery({
    queryKey: ['planning', 'settings'],
    queryFn: () => api.get<{ settings: PlanningSettings; non_working_days: NonWorkingDay[] }>('/planning/settings'),
  });
  const capacities = useQuery({
    queryKey: ['planning', 'capacities'],
    queryFn: () => api.get<{ data: CapacityRow[]; default_minutes: number }>('/planning/capacities'),
  });
  const report = useQuery({
    queryKey: ['planning', 'report', week],
    queryFn: () => api.get<ReportResponse>(`/planning/report${toQuery({ from: week })}`),
  });
  const tasks = useQuery({
    queryKey: ['planning', 'tasks'],
    queryFn: () => api.get<{ data: TaskRow[] }>('/tasks?per_page=200'),
  });
  const policies = useQuery({
    queryKey: ['planning', 'sla-policies'],
    queryFn: () => api.get<{ data: SlaPolicy[] }>('/planning/sla-policies'),
  });
  const assignments = useQuery({
    queryKey: ['planning', 'sla-assignments'],
    queryFn: () => api.get<{ at: string; data: SlaAssignment[] }>('/planning/sla-assignments'),
  });
  const breaches = useQuery({
    queryKey: ['planning', 'sla-breaches'],
    queryFn: () => api.get<{ at: string; data: { task_id: string; priority: string; response_due: string | null; resolution_due: string | null; title: string; client_id: string | null; client_name: string | null }[] }>('/planning/sla-breaches'),
  });
  const clients = useQuery({
    queryKey: ['clients', 'planning'],
    queryFn: () => api.get<{ data: { id: string; display_name: string }[] }>('/clients?per_page=100'),
  });
  const contracts = useQuery({
    queryKey: ['planning', 'contracts'],
    queryFn: () => api.get<{ data: { id: string; client_name: string }[] }>('/recurring-invoices?per_page=100'),
  });

  const settings = settingsQuery.data?.settings;
  const [settingsDraft, setSettingsDraft] = useState<PlanningSettings | null>(null);
  const effectiveSettings = settingsDraft ?? settings;
  const days = useMemo(() => weekDates(week), [week]);

  const saveSettings = useMutation({
    mutationFn: (payload: PlanningSettings) => api.put('/planning/settings', payload),
    onSuccess: () => {
      toast.success(t('planning.settingsSaved'));
      queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });

  const saveCapacity = useMutation({
    mutationFn: ({ userId, minutes }: { userId: string; minutes: number }) =>
      api.put(`/planning/capacities/${userId}`, { weekly_minutes: minutes }),
    onSuccess: () => {
      toast.success(t('planning.saveCapacity'));
      queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });

  const assign = useMutation({
    mutationFn: () => api.put(`/planning/tasks/${assignDraft.taskId}`, {
      assignee_id: assignDraft.assignee || null,
      planned_start: assignDraft.start || null,
      planned_end: assignDraft.end || null,
    }),
    onSuccess: () => {
      toast.success(t('planning.assignSaved'));
      setAssignDraft({ taskId: '', assignee: '', start: '', end: '' });
      queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });

  const [dayDraft, setDayDraft] = useState({ day: '', label: '' });
  const saveDay = useMutation({
    mutationFn: () => api.post('/planning/calendar', { day: dayDraft.day, label: dayDraft.label || null }),
    onSuccess: () => {
      toast.success(t('planning.settingsSaved'));
      setDayDraft({ day: '', label: '' });
      queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });
  const removeDay = useMutation({
    mutationFn: (day: string) => api.delete(`/planning/calendar/${day}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planning'] }),
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });

  // A new tier starts from the shared standard values, never from a literal here.
  const standardTier = SLA_DEFAULT_POLICIES[0];
  const emptyPolicyDraft = {
    editingId: '',
    name: '',
    scope: 'client' as 'default' | 'client' | 'contract',
    target: '',
    priority: standardTier.priority,
    response: standardTier.response_minutes,
    resolution: standardTier.resolution_minutes,
  };
  const [policyDraft, setPolicyDraft] = useState(emptyPolicyDraft);
  const createPolicy = useMutation({
    mutationFn: () => {
      const payload = {
        name: policyDraft.name,
        scope: policyDraft.scope,
        client_id: policyDraft.scope === 'client' ? policyDraft.target || null : null,
        contract_id: policyDraft.scope === 'contract' ? policyDraft.target || null : null,
        priority: policyDraft.priority,
        response_minutes: policyDraft.response,
        resolution_minutes: policyDraft.resolution,
      };
      return policyDraft.editingId
        ? api.put(`/planning/sla-policies/${policyDraft.editingId}`, payload)
        : api.post('/planning/sla-policies', payload);
    },
    onSuccess: () => {
      toast.success(t('planning.policySaved'));
      setPolicyDraft(emptyPolicyDraft);
      queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });
  const disablePolicy = useMutation({
    mutationFn: (id: string) => api.delete(`/planning/sla-policies/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['planning'] }),
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });

  const [slaTask, setSlaTask] = useState('');
  const [slaPriority, setSlaPriority] = useState('');
  const applySla = useMutation({
    mutationFn: () => api.post<{ response_due: string | null; resolution_due: string | null; priority: string }>(
      `/planning/tasks/${slaTask}/sla`,
      slaPriority ? { priority: slaPriority } : {},
    ),
    onSuccess: () => {
      toast.success(t('planning.applied'));
      queryClient.invalidateQueries({ queryKey: ['planning'] });
    },
    onError: (error) => toast.error(Object.values(fieldErrors(error))[0] ?? errorMessage(error)),
  });

  const userById = new Map((capacities.data?.data ?? []).map((user) => [user.id, user]));
  // The report returns every week that has a load; the screen shows the one the
  // operator selected, so « semaine suivante » actually changes what is read.
  const weekRows = (report.data?.weeks ?? []).filter((load) => load.week === week);
  const weekOverloads = weekRows.filter((load) => load.overloaded);

  return (
    <>
      <PageHeader
        title={t('planning.title')}
        subtitle={t('planning.subtitle')}
        actions={
          <div className="flex flex-wrap gap-1">
            {(['report', 'settings', 'calendar', 'sla'] as Tab[]).map((value) => (
              <Button
                key={value}
                size="sm"
                variant={tab === value ? 'primary' : 'secondary'}
                onClick={() => setTab(value)}
              >
                {t(`planning.tabs.${value}`)}
              </Button>
            ))}
          </div>
        }
      />

      {tab === 'report' ? (
        <>
          <SectionCard
            title={t('planning.week')}
            subtitle={`${formatDate(days[0])} → ${formatDate(days[6])}`}
            actions={
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, -7))}>{t('planning.previousWeek')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setWeek(weekStart(todayISO()))}>{t('planning.thisWeek')}</Button>
                <Button size="sm" variant="ghost" onClick={() => setWeek(addDays(week, 7))}>{t('planning.nextWeek')}</Button>
              </div>
            }
            bodyClassName="table-wrap"
          >
            {report.isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((index) => <Skeleton key={index} className="h-10" />)}</div>
            ) : weekRows.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('planning.assignee')}</th>
                    <th scope="col" className="text-right">{t('planning.capacity')}</th>
                    <th scope="col" className="text-right">{t('planning.load')}</th>
                    <th scope="col" className="text-right">%</th>
                    <th scope="col">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {weekRows.map((load) => {
                    const user = userById.get(load.assignee_id);
                    const percent = capacityUsagePercent(load.minutes, load.capacity);
                    return (
                      <tr key={`${load.week}-${load.assignee_id}`}>
                        <td className="font-medium">
                          {user ? `${user.first_name} ${user.last_name}` : load.assignee_id}
                        </td>
                        <td className="text-right tabular-nums">{minutesLabel(load.capacity)}</td>
                        <td className="text-right tabular-nums">{minutesLabel(load.minutes)}</td>
                        <td className="text-right tabular-nums">{percent} %</td>
                        <td>
                          {load.overloaded
                            ? <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-600"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('planning.over')}</span>
                            : <span className="text-xs text-success-700">{t('planning.ok')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />} title={t('planning.noLoad')} />
            )}
          </SectionCard>

          <SectionCard title={t('planning.unassigned')} subtitle={t('planning.unassignedHint')}>
            <p className="text-2xl font-semibold tabular-nums">{minutesLabel(report.data?.unassigned_minutes ?? 0)}</p>
            {weekOverloads.length ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-danger-600">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                {weekOverloads.length} {t('planning.overloads')}
              </p>
            ) : null}
          </SectionCard>

          <SectionCard title={t('planning.assign')} subtitle={t('planning.assignHint')}>
            <FormGrid>
              <Field label={t('planning.task')} htmlFor="plan_task" required>
                <Select id="plan_task" value={assignDraft.taskId} onChange={(event) => setAssignDraft({ ...assignDraft, taskId: event.target.value })}>
                  <option value="">—</option>
                  {(tasks.data?.data ?? []).map((task) => (
                    <option key={task.id} value={task.id}>{task.title} · {minutesLabel(task.minutes)}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('planning.assignee')} htmlFor="plan_assignee" hint={t('planning.unassignHint')}>
                <Select id="plan_assignee" value={assignDraft.assignee} onChange={(event) => setAssignDraft({ ...assignDraft, assignee: event.target.value })}>
                  <option value="">{t('planning.unassign')}</option>
                  {(capacities.data?.data ?? []).map((user) => (
                    <option key={user.id} value={user.id}>{user.first_name} {user.last_name}</option>
                  ))}
                </Select>
              </Field>
              <Field label={t('planning.plannedStart')} htmlFor="plan_start">
                <Input id="plan_start" type="date" value={assignDraft.start} onChange={(event) => setAssignDraft({ ...assignDraft, start: event.target.value })} />
              </Field>
              <Field label={t('planning.plannedEnd')} htmlFor="plan_end">
                <Input id="plan_end" type="date" value={assignDraft.end} onChange={(event) => setAssignDraft({ ...assignDraft, end: event.target.value })} />
              </Field>
            </FormGrid>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-xs text-muted">{t('planning.overWarn')}</p>
              <Button
                loading={assign.isPending}
                disabled={!canWrite || !assignDraft.taskId}
                onClick={() => assign.mutate()}
              >
                {t('common.save')}
              </Button>
            </div>
          </SectionCard>
        </>
      ) : null}

      {tab === 'settings' ? (
        <>
          <SectionCard title={t('planning.settings')} subtitle={t('planning.settingsHint')}>
            {effectiveSettings ? (
              <>
                <FormGrid>
                  <Field label={t('planning.weeklyCapacity')} htmlFor="planning_capacity" hint={t('planning.weeklyCapacityHint')}>
                    <Input
                      id="planning_capacity"
                      type="number"
                      min="1"
                      max="168"
                      step="0.5"
                      value={Math.round((effectiveSettings.weekly_capacity_minutes / 60) * 10) / 10}
                      onChange={(event) => setSettingsDraft({
                        ...effectiveSettings,
                        weekly_capacity_minutes: Math.round(Number(event.target.value) * 60),
                      })}
                    />
                  </Field>
                  <Field label={t('planning.businessStart')} htmlFor="planning_start">
                    <Input id="planning_start" type="time" value={effectiveSettings.business_start} onChange={(event) => setSettingsDraft({ ...effectiveSettings, business_start: event.target.value })} />
                  </Field>
                  <Field label={t('planning.businessEnd')} htmlFor="planning_end">
                    <Input id="planning_end" type="time" value={effectiveSettings.business_end} onChange={(event) => setSettingsDraft({ ...effectiveSettings, business_end: event.target.value })} />
                  </Field>
                </FormGrid>
                <fieldset className="mt-4">
                  <legend className="mb-2 text-sm font-semibold text-ink-950">{t('planning.workingDays')}</legend>
                  <div className="flex flex-wrap gap-3">
                    {WEEKDAYS.map((day) => (
                      <Checkbox
                        key={day}
                        label={t(`planning.weekday.${day}`)}
                        checked={effectiveSettings.working_days.includes(day)}
                        onChange={(event) => {
                          const next = event.target.checked
                            ? [...effectiveSettings.working_days, day]
                            : effectiveSettings.working_days.filter((value) => value !== day);
                          setSettingsDraft({ ...effectiveSettings, working_days: next });
                        }}
                      />
                    ))}
                  </div>
                </fieldset>
                <div className="mt-4 flex justify-end">
                  <Button
                    loading={saveSettings.isPending}
                    disabled={!canWrite || !settingsDraft}
                    onClick={() => settingsDraft && saveSettings.mutate(settingsDraft)}
                  >
                    {t('common.save')}
                  </Button>
                </div>
              </>
            ) : <Skeleton className="h-24" />}
          </SectionCard>

          <SectionCard title={t('planning.perUser')} subtitle={t('planning.perUserHint')} bodyClassName="table-wrap">
            {capacities.isLoading ? <Skeleton className="m-4 h-16" /> : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('activity.user')}</th>
                    <th scope="col" className="text-right">{t('planning.capacity')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {(capacities.data?.data ?? []).map((user) => (
                    <CapacityRowForm
                      key={user.id}
                      user={user}
                      canWrite={canWrite}
                      onSave={(minutes) => saveCapacity.mutate({ userId: user.id, minutes })}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </SectionCard>
        </>
      ) : null}

      {tab === 'calendar' ? (
        <>
          <SectionCard title={t('planning.calendar')} subtitle={t('planning.calendarHint')} bodyClassName="table-wrap">
            {settingsQuery.isLoading ? <Skeleton className="m-4 h-16" /> : settingsQuery.data?.non_working_days.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('planning.day')}</th>
                    <th scope="col">{t('planning.label')}</th>
                    <th scope="col" className="text-right">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {settingsQuery.data.non_working_days.map((day) => (
                    <tr key={day.day}>
                      <td className="font-medium tabular-nums">{formatDate(day.day)}</td>
                      <td className="text-muted">{day.label ?? '—'}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" disabled={!canWrite} onClick={() => setDayDraft({ day: day.day, label: day.label ?? '' })}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger-600 hover:bg-danger-50"
                            disabled={!canWrite}
                            onClick={async () => {
                              if (await confirm({ title: t('common.delete'), description: formatDate(day.day), danger: true, confirmLabel: t('common.delete') })) {
                                removeDay.mutate(day.day);
                              }
                            }}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <EmptyState icon={<CalendarDays className="h-6 w-6" aria-hidden="true" />} title={t('planning.noHolidays')} />
            )}
          </SectionCard>

          <SectionCard title={t('planning.addDay')}>
            <FormGrid>
              <Field label={t('planning.day')} htmlFor="calendar_day" required>
                <Input id="calendar_day" type="date" value={dayDraft.day} onChange={(event) => setDayDraft({ ...dayDraft, day: event.target.value })} />
              </Field>
              <Field label={t('planning.label')} htmlFor="calendar_label">
                <Input id="calendar_label" value={dayDraft.label} onChange={(event) => setDayDraft({ ...dayDraft, label: event.target.value })} />
              </Field>
            </FormGrid>
            <div className="mt-3 flex justify-end">
              <Button loading={saveDay.isPending} disabled={!canWrite || !dayDraft.day} onClick={() => saveDay.mutate()}>{t('common.save')}</Button>
            </div>
          </SectionCard>
        </>
      ) : null}

      {tab === 'sla' ? (
        <>
          <SectionCard title={t('planning.assignments')} subtitle={t('planning.assignmentsHint')} bodyClassName="table-wrap">
            {assignments.data?.data.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('planning.task')}</th>
                    <th scope="col">{t('planning.policy')}</th>
                    <th scope="col">{t('planning.priority')}</th>
                    <th scope="col">{t('planning.responseDue')}</th>
                    <th scope="col">{t('planning.resolutionDue')}</th>
                    <th scope="col">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody>
                  {assignments.data.data.map((row) => {
                    const overdue = row.response_overdue || row.resolution_overdue;
                    return (
                      <tr key={row.task_id}>
                        <td className="font-medium">{row.title}</td>
                        <td className="text-muted">{row.policy_name ?? '—'}</td>
                        <td><StatusBadge status={row.priority} /></td>
                        <td className={`tabular-nums ${row.response_overdue ? 'font-medium text-danger-600' : 'text-muted'}`}>{row.response_due ?? '—'}</td>
                        <td className={`tabular-nums ${row.resolution_overdue ? 'font-medium text-danger-600' : 'text-muted'}`}>{row.resolution_due ?? '—'}</td>
                        <td>
                          {overdue
                            ? <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-600"><AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />{t('planning.overdue')}</span>
                            : <span className="text-xs text-success-700">{t('planning.onTime')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : <EmptyState icon={<Clock className="h-6 w-6" aria-hidden="true" />} title={t('planning.noAssignments')} />}
          </SectionCard>

          <SectionCard title={t('planning.breaches')} subtitle={t('planning.breachesHint')} bodyClassName="table-wrap">
            {breaches.data?.data.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('planning.task')}</th>
                    <th scope="col">{t('planning.priority')}</th>
                    <th scope="col">{t('planning.responseDue')}</th>
                    <th scope="col">{t('planning.resolutionDue')}</th>
                    <th scope="col">{t('planning.client')}</th>
                  </tr>
                </thead>
                <tbody>
                  {breaches.data.data.map((row) => (
                    <tr key={row.task_id}>
                      <td className="font-medium">{row.title}</td>
                      <td><StatusBadge status={row.priority} /></td>
                      <td className="tabular-nums text-muted">{row.response_due ?? '—'}</td>
                      <td className="tabular-nums text-muted">{row.resolution_due ?? '—'}</td>
                      <td>
                        {row.client_id ? <Link className="text-brand-700 hover:underline" to={`/clients/${row.client_id}`}>{row.client_name ?? row.client_id}</Link> : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={<Target className="h-6 w-6" aria-hidden="true" />} title={t('planning.noBreaches')} />}
          </SectionCard>

          <SectionCard title={t('planning.sla')} subtitle={t('planning.slaHint')} bodyClassName="table-wrap">
            {policies.data?.data.length ? (
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('planning.name')}</th>
                    <th scope="col">{t('planning.scope')}</th>
                    <th scope="col">{t('planning.priority')}</th>
                    <th scope="col" className="text-right">{t('planning.response')}</th>
                    <th scope="col" className="text-right">{t('planning.resolution')}</th>
                    <th scope="col">{t('common.status')}</th>
                    <th scope="col" />
                  </tr>
                </thead>
                <tbody>
                  {policies.data.data.map((policy) => (
                    <tr key={policy.id}>
                      <td className="font-medium">{policy.name}</td>
                      <td className="text-muted">
                        {t(`planning.policyScope_${policy.scope}`)}
                        {' · '}
                        {policy.scope === 'client'
                          ? (clients.data?.data ?? []).find((client) => client.id === policy.client_id)?.display_name ?? policy.client_id
                          : (contracts.data?.data ?? []).find((contract) => contract.id === policy.contract_id)?.client_name ?? policy.contract_id}
                      </td>
                      <td><StatusBadge status={policy.priority} /></td>
                      <td className="text-right tabular-nums">{minutesLabel(policy.response_minutes)}</td>
                      <td className="text-right tabular-nums">{minutesLabel(policy.resolution_minutes)}</td>
                      <td className="text-muted">{Number(policy.is_active) ? t('planning.active') : t('planning.inactive')}</td>
                      <td className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!canWrite}
                            onClick={() => setPolicyDraft({
                              editingId: policy.id,
                              name: policy.name,
                              scope: policy.scope,
                              target: policy.scope === 'client' ? policy.client_id ?? '' : policy.contract_id ?? '',
                              priority: policy.priority,
                              response: policy.response_minutes,
                              resolution: policy.resolution_minutes,
                            })}
                          >
                            {t('common.edit')}
                          </Button>
                        {Number(policy.is_active) ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger-600 hover:bg-danger-50"
                            disabled={!canWrite}
                            onClick={async () => {
                              if (await confirm({ title: t('planning.deactivate'), description: policy.name, danger: true, confirmLabel: t('common.confirm') })) {
                                disablePolicy.mutate(policy.id);
                              }
                            }}
                          >
                            {t('planning.deactivate')}
                          </Button>
                        ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <EmptyState icon={<Target className="h-6 w-6" aria-hidden="true" />} title={t('planning.noPolicies')} />}
          </SectionCard>

          <SectionCard title={policyDraft.editingId ? t('planning.editPolicy') : t('planning.newPolicy')}>
            <FormGrid>
              <Field label={t('planning.name')} htmlFor="sla_name" required>
                <Input id="sla_name" value={policyDraft.name} onChange={(event) => setPolicyDraft({ ...policyDraft, name: event.target.value })} />
              </Field>
              <Field label={t('planning.scope')} htmlFor="sla_scope">
                <Select id="sla_scope" value={policyDraft.scope} onChange={(event) => setPolicyDraft({ ...policyDraft, scope: event.target.value as 'default' | 'client' | 'contract', target: '' })}>
                  <option value="default">{t('planning.policyScope_default')}</option>
                  <option value="client">{t('planning.policyScope_client')}</option>
                  <option value="contract">{t('planning.policyScope_contract')}</option>
                </Select>
              </Field>
              {policyDraft.scope === 'default' ? null : (
              <Field label={policyDraft.scope === 'client' ? t('planning.client') : t('planning.contract')} htmlFor="sla_target" required>
                <Select id="sla_target" value={policyDraft.target} onChange={(event) => setPolicyDraft({ ...policyDraft, target: event.target.value })}>
                  <option value="">—</option>
                  {policyDraft.scope === 'client'
                    ? (clients.data?.data ?? []).map((client) => <option key={client.id} value={client.id}>{client.display_name}</option>)
                    : (contracts.data?.data ?? []).map((contract) => <option key={contract.id} value={contract.id}>{contract.client_name}</option>)}
                </Select>
              </Field>
              )}
              <Field label={t('planning.priority')} htmlFor="sla_priority">
                <Input id="sla_priority" value={policyDraft.priority} onChange={(event) => setPolicyDraft({ ...policyDraft, priority: event.target.value })} />
              </Field>
              <Field label={t('planning.response')} htmlFor="sla_response" hint={t('planning.minutesHint')}>
                <Input id="sla_response" type="number" min="0" value={policyDraft.response} onChange={(event) => setPolicyDraft({ ...policyDraft, response: Number(event.target.value) })} />
              </Field>
              <Field label={t('planning.resolution')} htmlFor="sla_resolution" hint={t('planning.minutesHint')}>
                <Input id="sla_resolution" type="number" min="0" value={policyDraft.resolution} onChange={(event) => setPolicyDraft({ ...policyDraft, resolution: Number(event.target.value) })} />
              </Field>
            </FormGrid>
            <div className="mt-3 flex justify-end">
              <Button
                loading={createPolicy.isPending}
                disabled={!canWrite || !policyDraft.name || (policyDraft.scope !== 'default' && !policyDraft.target)}
                onClick={() => createPolicy.mutate()}
                icon={<Plus className="h-4 w-4" aria-hidden="true" />}
              >
                {t('common.save')}
              </Button>
            </div>
          </SectionCard>

          <SectionCard title={t('planning.applyTitle')} subtitle={t('planning.applyHint')}>
            <FormGrid>
              <Field label={t('planning.task')} htmlFor="sla_task" required>
                <Select id="sla_task" value={slaTask} onChange={(event) => setSlaTask(event.target.value)}>
                  <option value="">—</option>
                  {(tasks.data?.data ?? []).map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
                </Select>
              </Field>
              <Field label={t('planning.priority')} htmlFor="sla_priority_pick" hint={t('planning.priorityHint')}>
                <Select id="sla_priority_pick" value={slaPriority} onChange={(event) => setSlaPriority(event.target.value)}>
                  <option value="">{t('planning.priorityAuto')}</option>
                  {[...new Set((policies.data?.data ?? []).filter((policy) => Number(policy.is_active)).map((policy) => policy.priority))]
                    .map((priority) => <option key={priority} value={priority}>{priority}</option>)}
                </Select>
              </Field>
            </FormGrid>
            {slaTask && (assignments.data?.data ?? []).some((row) => row.task_id === slaTask) ? (
              <p className="mt-3 flex items-center gap-2 text-sm text-ink-800">
                <Clock className="h-4 w-4" aria-hidden="true" />
                {(() => {
                  const row = (assignments.data?.data ?? []).find((entry) => entry.task_id === slaTask)!;
                  return `${row.policy_name ?? '—'} · ${row.priority} · ${t('planning.responseDue')} ${row.response_due ?? '—'} · ${t('planning.resolutionDue')} ${row.resolution_due ?? '—'}`;
                })()}
              </p>
            ) : null}
            <div className="mt-3 flex justify-end">
              <Button loading={applySla.isPending} disabled={!canWrite || !slaTask} onClick={() => applySla.mutate()}>{t('planning.apply')}</Button>
            </div>
          </SectionCard>
        </>
      ) : null}
    </>
  );
}

function CapacityRowForm({ user, canWrite, onSave }: { user: CapacityRow; canWrite: boolean; onSave: (minutes: number) => void }) {
  const [hours, setHours] = useState(Math.round((user.weekly_minutes / 60) * 10) / 10);
  return (
    <tr>
      <td className="font-medium">
        {user.first_name} {user.last_name}
        {user.is_default ? <span className="ml-2 text-xs text-muted">{t('planning.defaultBadge')}</span> : null}
      </td>
      <td className="text-right">
        <Input
          type="number"
          min="0"
          max="168"
          step="0.5"
          className="w-24 text-right"
          value={hours}
          onChange={(event) => setHours(Number(event.target.value))}
          aria-label={`${t('planning.capacity')} ${user.first_name} ${user.last_name}`}
        />
      </td>
      <td className="text-right">
        <Button size="sm" variant="secondary" disabled={!canWrite} onClick={() => onSave(Math.round(hours * 60))}>
          {t('common.save')}
        </Button>
      </td>
    </tr>
  );
}
