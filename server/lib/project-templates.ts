import { nowISO } from '../db';
import { nextVersion, normaliseTemplateTasks, type TemplateTaskInput } from '../../shared/project-template';

/**
 * Q9/Q10 — the one place that turns a template version into a real project.
 *
 * Shared by the template screen, the instantiate route and the quotation approval,
 * so a project created from an accepted quote is the same object as one created by
 * hand: status `planned`, tasks `todo`, each task carrying its expected minutes.
 */

export interface TemplateVersionRow {
  id: string;
  template_id: string;
  version: number;
  name: string;
  description: string | null;
  notes: string | null;
  task_count: number;
  total_minutes: number;
  created_at: string;
}

export interface TemplateTaskRow {
  id: string;
  version_id: string;
  title: string;
  description: string | null;
  minutes: number;
  hourly_rate: number;
  billable: number;
  sort_order: number;
}

/** The version asked for, or the current one when no version is given. */
export async function loadTemplateVersion(
  database: D1Database,
  templateId: string,
  version?: number | null,
): Promise<{ version: TemplateVersionRow; tasks: TemplateTaskRow[] } | null> {
  const row = version
    ? await database.prepare(
      `SELECT * FROM project_template_versions WHERE template_id = ? AND version = ?`,
    ).bind(templateId, version).first<TemplateVersionRow>()
    : await database.prepare(
      `SELECT * FROM project_template_versions WHERE template_id = ?
        ORDER BY version DESC LIMIT 1`,
    ).bind(templateId).first<TemplateVersionRow>();
  if (!row) return null;
  const tasks = await database.prepare(
    `SELECT * FROM project_template_tasks WHERE version_id = ? ORDER BY sort_order ASC`,
  ).bind(row.id).all<TemplateTaskRow>();
  return { version: row, tasks: tasks.results ?? [] };
}

export interface InstantiateInput {
  templateId: string;
  version?: number | null;
  clientId?: string | null;
  name?: string | null;
  description?: string | null;
  startDate?: string | null;
  deadline?: string | null;
  budget?: number;
  quoteId?: string | null;
  userId: string;
}

export interface InstantiatedProject {
  projectId: string;
  versionId: string;
  version: number;
  taskCount: number;
  totalMinutes: number;
}

/**
 * Create the project and its tasks from one version. The project is `planned`: it
 * exists because the work is sold, not because it has started.
 */
export async function createProjectFromTemplate(
  database: D1Database,
  input: InstantiateInput,
): Promise<InstantiatedProject | null> {
  const loaded = await loadTemplateVersion(database, input.templateId, input.version ?? null);
  if (!loaded) return null;

  const now = nowISO();
  const projectId = crypto.randomUUID();
  const statements = [
    database.prepare(
      `INSERT INTO projects
         (id, client_id, name, description, status, budget, start_date, deadline,
          template_version_id, quote_id, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'planned', ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      projectId,
      input.clientId || null,
      (input.name || loaded.version.name).slice(0, 160),
      (input.description ?? loaded.version.description) || null,
      Math.max(Math.round(Number(input.budget) || 0), 0),
      input.startDate || null,
      input.deadline || null,
      loaded.version.id,
      input.quoteId || null,
      input.userId,
      now,
      now,
    ),
    ...loaded.tasks.map((task) => database.prepare(
      `INSERT INTO tasks
         (id, project_id, client_id, title, description, status, minutes, hourly_rate, billable,
          created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), projectId, input.clientId || null, task.title, task.description,
      Number(task.minutes) || 0, Number(task.hourly_rate) || 0, Number(task.billable) ? 1 : 0,
      input.userId, now, now,
    )),
  ];
  await database.batch(statements);

  return {
    projectId,
    versionId: loaded.version.id,
    version: Number(loaded.version.version),
    taskCount: loaded.tasks.length,
    totalMinutes: loaded.tasks.reduce((total, task) => total + (Number(task.minutes) || 0), 0),
  };
}

/** Does this template version exist? A quote pointing at nothing is refused. */
export async function templateVersionExists(
  database: D1Database,
  templateId: string,
  version?: number | null,
): Promise<number | null> {
  const row = version
    ? await database.prepare(
      `SELECT version FROM project_template_versions WHERE template_id = ? AND version = ?`,
    ).bind(templateId, version).first<{ version: number }>()
    : await database.prepare(
      `SELECT version FROM project_template_versions WHERE template_id = ?
        ORDER BY version DESC LIMIT 1`,
    ).bind(templateId).first<{ version: number }>();
  return row ? Number(row.version) : null;
}

/** Store one immutable snapshot of a template: a version is never rewritten. */
export async function insertTemplateVersion(
  database: D1Database,
  input: {
    templateId: string;
    name: string;
    description?: string | null;
    notes?: string | null;
    tasks: TemplateTaskInput[];
    userId: string;
  },
): Promise<{ versionId: string; version: number }> {
  const existing = await database.prepare(
    `SELECT version FROM project_template_versions WHERE template_id = ?`,
  ).bind(input.templateId).all<{ version: number }>();
  const version = nextVersion((existing.results ?? []).map((row) => Number(row.version)));
  const versionId = crypto.randomUUID();
  const now = nowISO();
  const tasks = normaliseTemplateTasks(input.tasks);

  await database.batch([
    database.prepare(
      `INSERT INTO project_template_versions
         (id, template_id, version, name, description, notes, task_count, total_minutes, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId, input.templateId, version, input.name.slice(0, 160), input.description ?? null,
      input.notes ?? null, tasks.length,
      tasks.reduce((total, task) => total + task.minutes, 0), input.userId, now,
    ),
    ...tasks.map((task) => database.prepare(
      `INSERT INTO project_template_tasks
         (id, version_id, title, description, minutes, hourly_rate, billable, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(), versionId, task.title, task.description, task.minutes,
      task.hourly_rate, task.billable ? 1 : 0, task.sort_order,
    )),
    database.prepare(`UPDATE project_templates SET updated_at = ? WHERE id = ?`).bind(now, input.templateId),
  ]);

  return { versionId, version };
}
