import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { localDateTimeIn, todayIn } from '../lib/dates';
import { DEFAULT_TIMEZONE } from '../../shared/domain';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import {
  PLANNING_DEFAULTS,
  SLA_DEFAULT_POLICIES,
  addBusinessMinutes,
  businessHoursError,
  holidayError,
  missingHolidaySeeds,
  missingSlaDefaults,
  slaTierError,
  unassignedMinutes,
  weeklyLoads,
  type PlanningCalendar,
} from '../../shared/planning';
import type { AppEnv } from '../types';

/**
 * G2/G3 — planning and SLA, fully parametrable.
 *
 * The calendar, the capacity and the response/resolution targets are rows: the
 * workspace owns them and can change them at any time. The module is mounted
 * under `/api/planning` and never stores a rule in code.
 */
export const planningRoutes = new Hono<AppEnv>();
planningRoutes.use('*', requireAuth);

const SETTINGS_KEY = 'planning';

/** SLA clocks run on the company wall clock, never on UTC. */
async function companyTimezone(database: D1Database): Promise<string> {
  const row = await database.prepare(`SELECT timezone FROM company LIMIT 1`)
    .first<{ timezone: string | null }>();
  return row?.timezone || DEFAULT_TIMEZONE;
}

interface PlanningSettings {
  weekly_capacity_minutes: number;
  working_days: number[];
  business_start: string;
  business_end: string;
}

async function readSettings(database: D1Database): Promise<PlanningSettings> {
  const row = await database
    .prepare(`SELECT value FROM settings_extra WHERE key = ?`)
    .bind(SETTINGS_KEY)
    .first<{ value: string }>();
  const stored = row?.value ? (JSON.parse(row.value) as Partial<PlanningSettings>) : {};
  return {
    weekly_capacity_minutes: Number(stored.weekly_capacity_minutes ?? PLANNING_DEFAULTS.weeklyCapacityMinutes),
    working_days: Array.isArray(stored.working_days) ? stored.working_days : [...PLANNING_DEFAULTS.workingDays],
    business_start: stored.business_start ?? PLANNING_DEFAULTS.businessStart,
    business_end: stored.business_end ?? PLANNING_DEFAULTS.businessEnd,
  };
}

async function readCalendar(database: D1Database): Promise<PlanningCalendar> {
  const settings = await readSettings(database);
  const rows = await database.prepare(`SELECT day FROM non_working_days`).all<{ day: string }>();
  return {
    workingDays: settings.working_days,
    businessStart: settings.business_start,
    businessEnd: settings.business_end,
    holidays: (rows.results ?? []).map((row) => row.day),
  };
}

/** The calendar starts pre-filled with the local public holidays. The rows are
 * editable: seeding only fills a year that has no row yet, so a deleted day is
 * never re-created and a new year is ready without any data entry. */
async function seedCalendar(database: D1Database): Promise<void> {
  const rows = await database.prepare(`SELECT day FROM non_working_days`).all<{ day: string }>();
  const missing = missingHolidaySeeds((rows.results ?? []).map((row) => row.day));
  if (!missing.length) return;
  const now = nowISO();
  for (const holiday of missing) {
    await database
      .prepare(`INSERT OR IGNORE INTO non_working_days (day, label, created_at) VALUES (?, ?, ?)`)
      .bind(holiday.date, holiday.label, now)
      .run();
  }
}

planningRoutes.get('/settings', requirePermission('projects.read'), async (c) => {
  await seedCalendar(c.env.DB);
  const settings = await readSettings(c.env.DB);
  const holidays = await c.env.DB.prepare(`SELECT day, label FROM non_working_days ORDER BY day`).all();
  return c.json({ settings, non_working_days: holidays.results ?? [] });
});

planningRoutes.put('/settings', requirePermission('projects.write'), async (c) => {
  const body = parseInput(
    z.object({
      weekly_capacity_minutes: z.coerce.number().int().min(60).max(10_080),
      working_days: z.array(z.coerce.number().int().min(0).max(6)).min(1).max(7),
      business_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
      business_end: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    }),
    await c.req.json().catch(() => ({})),
  );
  const hoursError = businessHoursError(body.business_start, body.business_end);
  if (hoursError) {
    const field = hoursError === 'invalid_time' ? 'business_start' : 'business_end';
    return fail(422, 'VALIDATION_ERROR', { [field]: hoursError });
  }
  if (new Set(body.working_days).size !== body.working_days.length) {
    return fail(422, 'VALIDATION_ERROR', { working_days: 'duplicate' });
  }
  const user = c.get('user')!;
  await c.env.DB.prepare(
    `INSERT INTO settings_extra (key, value, updated_by, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
  ).bind(SETTINGS_KEY, JSON.stringify(body), user.id, nowISO()).run();
  await logActivity(c.env.DB, {
    userId: user.id, action: 'updated', entityType: 'settings', entityId: SETTINGS_KEY,
    summary: 'activity.settings_extra_changed', meta: { key: SETTINGS_KEY },
  });
  return c.json({ ok: true, settings: body });
});

planningRoutes.post('/calendar', requirePermission('projects.write'), async (c) => {
  const body = parseInput(
    z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), label: z.string().trim().max(120).nullish() }),
    await c.req.json().catch(() => ({})),
  );
  const dayError = holidayError(body.day);
  if (dayError) return fail(422, 'VALIDATION_ERROR', { day: dayError });
  await c.env.DB.prepare(
    `INSERT INTO non_working_days (day, label, created_at) VALUES (?, ?, ?)
     ON CONFLICT(day) DO UPDATE SET label = excluded.label`,
  ).bind(body.day, body.label ?? null, nowISO()).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'created', entityType: 'non_working_day', entityId: body.day, summary: 'activity.working_day_added', meta: { day: body.day } });
  return c.json({ ok: true }, 201);
});

planningRoutes.delete('/calendar/:day', requirePermission('projects.write'), async (c) => {
  const day = c.req.param('day');
  const result = await c.env.DB.prepare(`DELETE FROM non_working_days WHERE day = ?`)
    .bind(day).run();
  if (!result.meta.changes) return fail(404, 'NOT_FOUND');
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'deleted', entityType: 'non_working_day', entityId: day, summary: 'activity.working_day_removed', meta: { day } });
  return c.json({ ok: true });
});

planningRoutes.get('/capacities', requirePermission('projects.read'), async (c) => {
  const settings = await readSettings(c.env.DB);
  const rows = await c.env.DB
    .prepare(
      `SELECT u.id, u.first_name, u.last_name, u.role, u.is_active, w.weekly_minutes
       FROM users u LEFT JOIN weekly_capacities w ON w.user_id = u.id
       WHERE u.deleted_at IS NULL ORDER BY u.first_name COLLATE NOCASE`,
    )
    .all<{ id: string; weekly_minutes: number | null; is_active: number }>();
  const data = (rows.results ?? []).map((row) => ({
    ...row,
    weekly_minutes: row.weekly_minutes === null ? settings.weekly_capacity_minutes : row.weekly_minutes,
    is_default: row.weekly_minutes === null,
  }));
  return c.json({ data, default_minutes: settings.weekly_capacity_minutes });
});

planningRoutes.put('/capacities/:userId', requirePermission('projects.write'), async (c) => {
  const body = parseInput(
    z.object({ weekly_minutes: z.coerce.number().int().min(0).max(10_080) }),
    await c.req.json().catch(() => ({})),
  );
  await c.env.DB.prepare(
    `INSERT INTO weekly_capacities (user_id, weekly_minutes, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET weekly_minutes = excluded.weekly_minutes, updated_at = excluded.updated_at`,
  ).bind(c.req.param('userId'), body.weekly_minutes, nowISO()).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'updated', entityType: 'weekly_capacity', entityId: c.req.param('userId'), summary: 'activity.capacity_updated', meta: { minutes: body.weekly_minutes } });
  return c.json({ ok: true });
});

/** Assign (or unassign) a task and give it planned dates. Both are optional: a
 * task can carry only a date, only an owner, or neither. */
planningRoutes.put('/tasks/:taskId', requirePermission('tasks.write'), async (c) => {
  const taskId = c.req.param('taskId');
  const task = await c.env.DB.prepare(`SELECT id FROM tasks WHERE id = ? AND deleted_at IS NULL`)
    .bind(taskId).first<{ id: string }>();
  if (!task) return fail(404, 'NOT_FOUND');
  const body = parseInput(
    z.object({
      assignee_id: z.string().max(60).nullish(),
      planned_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      planned_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    }),
    await c.req.json().catch(() => ({})),
  );
  if (body.assignee_id) {
    const assignee = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ? AND deleted_at IS NULL`)
      .bind(body.assignee_id).first<{ id: string }>();
    if (!assignee) return fail(422, 'VALIDATION_ERROR', { assignee_id: 'not_found' });
  }
  if (body.planned_start && body.planned_end && body.planned_end < body.planned_start) {
    return fail(422, 'VALIDATION_ERROR', { planned_end: 'before_start' });
  }
  await c.env.DB.prepare(
    `INSERT INTO task_planning (task_id, assignee_id, planned_start, planned_end, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET assignee_id = excluded.assignee_id,
       planned_start = excluded.planned_start, planned_end = excluded.planned_end, updated_at = excluded.updated_at`,
  ).bind(taskId, body.assignee_id ?? null, body.planned_start ?? null, body.planned_end ?? null, nowISO()).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'planned', entityType: 'task', entityId: taskId, summary: 'activity.task_planned', meta: { assignee: body.assignee_id ?? null, start: body.planned_start ?? null, end: body.planned_end ?? null } });
  return c.json({ ok: true });
});

/**
 * G2 report: weekly load per person against their capacity, plus the charge of
 * tasks nobody owns. Overload is reported, never enforced — the owner chose an
 * alert, not a refusal.
 */
planningRoutes.get('/report', requirePermission('projects.read'), async (c) => {
  const from = c.req.query('from') ?? todayIn(await companyTimezone(c.env.DB));
  const rows = await c.env.DB.prepare(
    `SELECT t.id, t.minutes, t.project_id, p.assignee_id, p.planned_start, p.planned_end
     FROM tasks t LEFT JOIN task_planning p ON p.task_id = t.id
     WHERE t.deleted_at IS NULL AND t.status <> 'done'`,
  ).all<{ id: string; minutes: number; project_id: string | null; assignee_id: string | null; planned_start: string | null; planned_end: string | null }>();
  const tasks = rows.results ?? [];
  const settings = await readSettings(c.env.DB);
  const capacities = new Map(
    (await c.env.DB.prepare(`SELECT user_id, weekly_minutes FROM weekly_capacities`).all<{ user_id: string; weekly_minutes: number }>())
      .results?.map((row) => [row.user_id, row.weekly_minutes] as const) ?? [],
  );
  const weeks = weeklyLoads(tasks, capacities, settings.weekly_capacity_minutes);
  return c.json({
    from,
    weeks,
    overloads: weeks.filter((week) => week.overloaded),
    unassigned_minutes: unassignedMinutes(tasks),
    settings,
  });
});

const policySchema = z.object({
  name: z.string().trim().min(1).max(120),
  scope: z.enum(['default', 'client', 'contract']).default('client'),
  client_id: z.string().max(60).nullish(),
  contract_id: z.string().max(60).nullish(),
  priority: z.string().trim().min(1).max(30).default(SLA_DEFAULT_POLICIES[1].priority),
  response_minutes: z.coerce.number().int().min(0).max(100_000),
  resolution_minutes: z.coerce.number().int().min(0).max(100_000),
});

/** One active policy per (scope, target, priority): two tiers of the same name
 * on the same client would make the chosen deadline depend on row order. */
async function slaPriorityTaken(
  database: D1Database,
  scope: string,
  priority: string,
  clientId: string | null,
  contractId: string | null,
  excludeId: string | null,
): Promise<boolean> {
  const row = await database
    .prepare(
      `SELECT id FROM sla_policies
       WHERE is_active = 1 AND scope = ? AND priority = ?
         AND COALESCE(client_id, '') = COALESCE(?, '')
         AND COALESCE(contract_id, '') = COALESCE(?, '')
         AND id <> ? LIMIT 1`,
    )
    .bind(scope, priority, clientId, contractId, excludeId ?? '')
    .first<{ id: string }>();
  return Boolean(row);
}

/**
 * Creates the standard tiers once. The check is per scope and priority, so a
 * workspace that renamed, retimed or deactivated a tier keeps its choice, and a
 * second call inserts nothing.
 */
async function ensureSlaDefaults(database: D1Database): Promise<void> {
  const existing = await database
    .prepare(`SELECT priority FROM sla_policies WHERE scope = 'default'`)
    .all<{ priority: string }>();
  const missing = missingSlaDefaults(existing.results ?? []);
  if (!missing.length) return;
  const now = nowISO();
  for (const policy of missing) {
    await database.prepare(
      `INSERT INTO sla_policies (id, name, scope, client_id, contract_id, priority, response_minutes, resolution_minutes, is_active, created_at, updated_at)
       VALUES (?, ?, 'default', NULL, NULL, ?, ?, ?, 1, ?, ?)`,
    ).bind(crypto.randomUUID(), policy.name, policy.priority, policy.response_minutes, policy.resolution_minutes, now, now).run();
  }
}

planningRoutes.get('/sla-policies', requirePermission('projects.read'), async (c) => {
  await ensureSlaDefaults(c.env.DB);
  const rows = await c.env.DB.prepare(`SELECT * FROM sla_policies ORDER BY priority, name COLLATE NOCASE`).all();
  return c.json({ data: rows.results ?? [] });
});

planningRoutes.put('/sla-policies/:id', requirePermission('projects.write'), async (c) => {
  const body = parseInput(policySchema.partial(), await c.req.json().catch(() => ({})));
  const existing = await c.env.DB.prepare(`SELECT * FROM sla_policies WHERE id = ?`)
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!existing) return fail(404, 'NOT_FOUND');
  const merged = {
    name: body.name ?? String(existing.name),
    priority: body.priority ?? String(existing.priority),
    response_minutes: body.response_minutes ?? Number(existing.response_minutes),
    resolution_minutes: body.resolution_minutes ?? Number(existing.resolution_minutes),
  };
  const tierError = slaTierError(merged);
  if (tierError) {
    const field = tierError === 'resolution_before_response' ? 'resolution_minutes' : 'response_minutes';
    return fail(422, 'VALIDATION_ERROR', { [field]: tierError });
  }
  if (await slaPriorityTaken(
    c.env.DB,
    String(existing.scope),
    merged.priority,
    (existing.client_id as string | null) ?? null,
    (existing.contract_id as string | null) ?? null,
    c.req.param('id'),
  )) {
    return fail(422, 'VALIDATION_ERROR', { priority: 'duplicate' });
  }
  await c.env.DB.prepare(
    `UPDATE sla_policies SET name = ?, priority = ?, response_minutes = ?, resolution_minutes = ?, updated_at = ?
     WHERE id = ?`,
  ).bind(merged.name, merged.priority, merged.response_minutes, merged.resolution_minutes, nowISO(), c.req.param('id')).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'updated', entityType: 'sla_policy', entityId: c.req.param('id'), summary: 'activity.sla_policy_updated', meta: { name: merged.name, priority: merged.priority } });
  return c.json({ ok: true, policy: merged });
});

planningRoutes.post('/sla-policies', requirePermission('projects.write'), async (c) => {
  const body = parseInput(policySchema, await c.req.json().catch(() => ({})));
  if (body.scope === 'client' && !body.client_id) return fail(422, 'VALIDATION_ERROR', { client_id: 'required' });
  if (body.scope === 'contract' && !body.contract_id) return fail(422, 'VALIDATION_ERROR', { contract_id: 'required' });
  const tierError = slaTierError(body);
  if (tierError) {
    const field = tierError === 'resolution_before_response' ? 'resolution_minutes' : 'response_minutes';
    return fail(422, 'VALIDATION_ERROR', { [field]: tierError });
  }
  if (await slaPriorityTaken(c.env.DB, body.scope, body.priority, body.client_id ?? null, body.contract_id ?? null, null)) {
    return fail(422, 'VALIDATION_ERROR', { priority: 'duplicate' });
  }
  const id = crypto.randomUUID();
  const now = nowISO();
  await c.env.DB.prepare(
    `INSERT INTO sla_policies (id, name, scope, client_id, contract_id, priority, response_minutes, resolution_minutes, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).bind(id, body.name, body.scope, body.client_id ?? null, body.contract_id ?? null, body.priority,
    body.response_minutes, body.resolution_minutes, now, now).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'created', entityType: 'sla_policy', entityId: id, summary: 'activity.sla_policy_created', meta: { name: body.name, priority: body.priority } });
  return c.json({ id }, 201);
});

planningRoutes.delete('/sla-policies/:id', requirePermission('projects.write'), async (c) => {
  const result = await c.env.DB.prepare(`UPDATE sla_policies SET is_active = 0, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), c.req.param('id')).run();
  if (!result.meta.changes) return fail(404, 'NOT_FOUND');
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'deleted', entityType: 'sla_policy', entityId: c.req.param('id'), summary: 'activity.sla_policy_deleted' });
  return c.json({ ok: true });
});

/**
 * Applies the most specific active policy to a task: contract first, then the
 * client's. Deadlines are computed on the workspace calendar, so a policy set in
 * business hours never promises a Sunday evening.
 */
planningRoutes.post('/tasks/:taskId/sla', requirePermission('tasks.write'), async (c) => {
  const taskId = c.req.param('taskId');
  const task = await c.env.DB.prepare(
    `SELECT t.id, t.client_id, r.id AS contract_id FROM tasks t
     LEFT JOIN recurring_invoices r ON r.service_id = t.product_id AND r.deleted_at IS NULL
     WHERE t.id = ? AND t.deleted_at IS NULL`,
  ).bind(taskId).first<{ id: string; client_id: string | null; contract_id: string | null }>();
  if (!task) return fail(404, 'NOT_FOUND');

  await ensureSlaDefaults(c.env.DB);
  const requested = parseInput(z.object({ priority: z.string().trim().max(30).optional() }), await c.req.json().catch(() => ({})));
  const priority = requested.priority ?? (await c.env.DB.prepare(
    `SELECT priority FROM sla_policies WHERE is_active = 1 AND scope = 'default' ORDER BY priority LIMIT 1`,
  ).first<{ priority: string }>())?.priority;
  if (!priority) return fail(409, 'SLA_NO_PRIORITY');

  const policy = await c.env.DB.prepare(
    `SELECT * FROM sla_policies
     WHERE is_active = 1 AND priority = ? AND (
       (scope = 'contract' AND contract_id = ?) OR (scope = 'client' AND client_id = ?) OR scope = 'default'
     )
     ORDER BY CASE scope WHEN 'contract' THEN 0 WHEN 'client' THEN 1 ELSE 2 END, response_minutes
     LIMIT 1`,
  ).bind(priority, task.contract_id ?? '', task.client_id ?? '').first<{
    id: string; name: string; scope: string; priority: string; response_minutes: number; resolution_minutes: number;
  }>();
  if (!policy) return fail(404, 'SLA_POLICY_NOT_FOUND');

  const calendar = await readCalendar(c.env.DB);
  const openedAt = localDateTimeIn(await companyTimezone(c.env.DB));
  const responseDue = policy.response_minutes > 0 ? addBusinessMinutes(openedAt, policy.response_minutes, calendar) : null;
  const resolutionDue = policy.resolution_minutes > 0 ? addBusinessMinutes(openedAt, policy.resolution_minutes, calendar) : null;

  await c.env.DB.prepare(
    `INSERT INTO task_sla (task_id, policy_id, priority, opened_at, response_due, resolution_due)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(task_id) DO UPDATE SET policy_id = excluded.policy_id, priority = excluded.priority,
       opened_at = excluded.opened_at, response_due = excluded.response_due, resolution_due = excluded.resolution_due`,
  ).bind(taskId, policy.id, policy.priority, openedAt, responseDue, resolutionDue).run();
  await logActivity(c.env.DB, { userId: c.get('user')!.id, action: 'applied', entityType: 'task_sla', entityId: taskId, summary: 'activity.sla_applied', meta: { priority: policy.priority, policy: policy.name } });

  return c.json({
    policy_id: policy.id,
    policy_name: policy.name,
    policy_scope: policy.scope,
    priority: policy.priority,
    opened_at: openedAt,
    response_due: responseDue,
    resolution_due: resolutionDue,
  }, 201);
});

/** The persisted engagement of one task — what the screen reads after a reload. */
planningRoutes.get('/tasks/:taskId/sla', requirePermission('projects.read'), async (c) => {
  const row = await c.env.DB.prepare(
    `SELECT s.*, p.name AS policy_name, p.scope AS policy_scope
     FROM task_sla s LEFT JOIN sla_policies p ON p.id = s.policy_id
     WHERE s.task_id = ?`,
  ).bind(c.req.param('taskId')).first();
  if (!row) return fail(404, 'NOT_FOUND');
  return c.json(row);
});

/**
 * Every engagement on record, with its overdue flags computed here so the screen
 * and the dashboard read the same verdict.
 */
planningRoutes.get('/sla-assignments', requirePermission('projects.read'), async (c) => {
  const at = c.req.query('at') ?? localDateTimeIn(await companyTimezone(c.env.DB));
  const rows = await c.env.DB.prepare(
    `SELECT s.task_id, s.priority, s.opened_at, s.response_due, s.resolution_due,
            s.acknowledged_at, s.closed_at, p.name AS policy_name, p.scope AS policy_scope,
            t.title, t.client_id, cl.display_name AS client_name
     FROM task_sla s JOIN tasks t ON t.id = s.task_id
     LEFT JOIN clients cl ON cl.id = t.client_id
     LEFT JOIN sla_policies p ON p.id = s.policy_id
     WHERE t.deleted_at IS NULL ORDER BY s.opened_at DESC LIMIT 200`,
  ).all<Record<string, unknown>>();
  return c.json({
    at,
    data: (rows.results ?? []).map((row) => ({
      ...row,
      response_overdue: !row.acknowledged_at && Boolean(row.response_due) && String(row.response_due) < at,
      resolution_overdue: !row.closed_at && Boolean(row.resolution_due) && String(row.resolution_due) < at,
    })),
  });
});

/** Breaches, read back for the dashboard and the client sheet (G3.5). */
planningRoutes.get('/sla-breaches', requirePermission('projects.read'), async (c) => {
  const at = c.req.query('at') ?? localDateTimeIn(await companyTimezone(c.env.DB));
  const rows = await c.env.DB.prepare(
    `SELECT s.task_id, s.priority, s.response_due, s.resolution_due, t.title, t.client_id,
            cl.display_name AS client_name
     FROM task_sla s JOIN tasks t ON t.id = s.task_id LEFT JOIN clients cl ON cl.id = t.client_id
     WHERE t.deleted_at IS NULL AND (
       (s.acknowledged_at IS NULL AND s.response_due IS NOT NULL AND s.response_due < ?) OR
       (s.closed_at IS NULL AND s.resolution_due IS NOT NULL AND s.resolution_due < ?)
     )`,
  ).bind(at, at).all();
  return c.json({ at, data: rows.results ?? [] });
});
