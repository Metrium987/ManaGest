import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import {
  createProjectFromTemplate,
  insertTemplateVersion,
  loadTemplateVersion,
} from '../lib/project-templates';
import { optionalIsoDate, optionalText, parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import type { AppEnv } from '../types';

/**
 * Q9 — project templates, versioned.
 *
 * A template is a name plus a stack of task estimates. Editing one never rewrites
 * what was already used: a new version is stored, and every project remembers the
 * version it came from, so a price agreed six months ago stays explainable.
 */
export const projectTemplateRoutes = new Hono<AppEnv>();
projectTemplateRoutes.use('*', requireAuth);

const taskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  minutes: z.coerce.number().int().min(0).max(100_000).default(0),
  hourly_rate: z.coerce.number().int().min(0).max(9_999_999).default(0),
  billable: z.boolean().default(true),
});

const templateSchema = z.object({
  name: z.string().trim().min(1).max(160),
  description: optionalText(2000),
  notes: optionalText(2000),
  tasks: z.array(taskSchema).min(1).max(100),
});

projectTemplateRoutes.get('/', requirePermission('projects.read'), async (c) => {
  const rows = await c.env.DB.prepare(
    `SELECT t.*,
       (SELECT version FROM project_template_versions v WHERE v.template_id = t.id
         ORDER BY v.version DESC LIMIT 1) AS current_version,
       (SELECT task_count FROM project_template_versions v WHERE v.template_id = t.id
         ORDER BY v.version DESC LIMIT 1) AS task_count,
       (SELECT total_minutes FROM project_template_versions v WHERE v.template_id = t.id
         ORDER BY v.version DESC LIMIT 1) AS total_minutes,
       (SELECT COUNT(*) FROM project_template_versions v WHERE v.template_id = t.id) AS version_count
     FROM project_templates t ORDER BY t.archived ASC, t.name ASC`,
  ).all<Record<string, unknown>>();
  return c.json({
    data: (rows.results ?? []).map((row) => ({
      ...row,
      archived: Boolean(row.archived),
      current_version: row.current_version === null ? null : Number(row.current_version),
      version_count: Number(row.version_count ?? 0),
    })),
  });
});

projectTemplateRoutes.get('/:id', requirePermission('projects.read'), async (c) => {
  const id = c.req.param('id');
  const template = await c.env.DB.prepare(`SELECT * FROM project_templates WHERE id = ?`).bind(id).first();
  if (!template) return fail(404, 'NOT_FOUND');
  const versions = await c.env.DB.prepare(
    `SELECT id, version, name, description, notes, task_count, total_minutes, created_at
       FROM project_template_versions WHERE template_id = ? ORDER BY version DESC`,
  ).bind(id).all();
  const current = await loadTemplateVersion(c.env.DB, id);
  return c.json({ ...template, versions: versions.results ?? [], current });
});

projectTemplateRoutes.get('/:id/versions/:version', requirePermission('projects.read'), async (c) => {
  const loaded = await loadTemplateVersion(c.env.DB, c.req.param('id'), Number(c.req.param('version')));
  if (!loaded) return fail(404, 'NOT_FOUND');
  return c.json(loaded);
});

projectTemplateRoutes.post('/', requirePermission('projects.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(templateSchema, await c.req.json().catch(() => ({})));
  const now = nowISO();
  const templateId = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO project_templates (id, name, description, archived, created_by, created_at, updated_at)
     VALUES (?, ?, ?, 0, ?, ?, ?)`,
  ).bind(templateId, body.name, body.description ?? null, user.id, now, now).run();

  const created = await insertTemplateVersion(c.env.DB, {
    templateId, name: body.name, description: body.description, notes: body.notes,
    tasks: body.tasks, userId: user.id,
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'project_template',
    entityId: templateId,
    summary: 'activity.project_template_created',
    meta: { name: body.name, version: created.version, tasks: body.tasks.length },
  });

  return c.json({ id: templateId, version: created.version, version_id: created.versionId }, 201);
});

/** A new version, never an edit: the previous one keeps serving the projects made
 * from it. */
projectTemplateRoutes.post('/:id/versions', requirePermission('projects.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const template = await c.env.DB.prepare(`SELECT id, name, archived FROM project_templates WHERE id = ?`)
    .bind(id).first<{ id: string; name: string; archived: number }>();
  if (!template) return fail(404, 'NOT_FOUND');
  if (Number(template.archived)) return fail(409, 'TEMPLATE_ARCHIVED');

  const body = parseInput(templateSchema, await c.req.json().catch(() => ({})));
  const created = await insertTemplateVersion(c.env.DB, {
    templateId: id,
    name: body.name || template.name,
    description: body.description,
    notes: body.notes,
    tasks: body.tasks,
    userId: user.id,
  });

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'project_template_version',
    entityId: created.versionId,
    summary: 'activity.project_template_versioned',
    meta: { template: template.name, version: created.version, tasks: body.tasks.length },
  });

  return c.json({ id, version: created.version, version_id: created.versionId }, 201);
});

const instantiateSchema = z.object({
  client_id: z.string().max(60).nullish(),
  name: z.string().trim().min(1).max(160).nullish(),
  description: optionalText(2000),
  version: z.coerce.number().int().min(1).nullish(),
  start_date: optionalIsoDate,
  deadline: optionalIsoDate,
  budget: z.coerce.number().int().min(0).max(9_999_999_999).default(0),
});

projectTemplateRoutes.post('/:id/instantiate', requirePermission('projects.write'), async (c) => {
  const user = c.get('user')!;
  const id = c.req.param('id');
  const body = parseInput(instantiateSchema, await c.req.json().catch(() => ({})));

  const created = await createProjectFromTemplate(c.env.DB, {
    templateId: id,
    version: body.version ?? null,
    clientId: body.client_id ?? null,
    name: body.name ?? null,
    description: body.description ?? null,
    startDate: body.start_date ?? null,
    deadline: body.deadline ?? null,
    budget: body.budget,
    userId: user.id,
  });
  if (!created) return fail(404, 'NOT_FOUND');

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'created',
    entityType: 'project',
    entityId: created.projectId,
    summary: 'activity.project_created',
    meta: { template_version: created.version, tasks: created.taskCount },
  });
  return c.json(created, 201);
});

/** Archiving keeps the template and its versions readable: a project may still
 * point at one of them. */
projectTemplateRoutes.delete('/:id', requirePermission('projects.write'), async (c) => {
  const result = await c.env.DB.prepare(`UPDATE project_templates SET archived = 1, updated_at = ? WHERE id = ?`)
    .bind(nowISO(), c.req.param('id')).run();
  if (!result.meta.changes) return fail(404, 'NOT_FOUND');
  return c.json({ ok: true });
});
