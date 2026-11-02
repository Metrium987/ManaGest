/**
 * Q9 — project templates are versioned and immutable.
 *
 * A template describes how a kind of project is run: its tasks and the time each one
 * is expected to take. Once a quotation has been priced from a template, changing the
 * template must not silently change what was sold, so an edit produces a **new
 * version** and every project keeps the version it was created from.
 */

export interface TemplateTaskInput {
  title: string;
  description?: string | null;
  minutes?: number;
  hourly_rate?: number;
  billable?: boolean;
}

export interface TemplateTask {
  title: string;
  description: string | null;
  minutes: number;
  hourly_rate: number;
  billable: boolean;
  sort_order: number;
}

export const MAX_TEMPLATE_TASKS = 100;

/**
 * Clean a template's task list: titles are trimmed, an empty title is not a task and
 * is dropped rather than stored, and the numbers are clamped to what the platform
 * accepts. The order of the rows is the order the project will follow.
 */
export function normaliseTemplateTasks(input: TemplateTaskInput[]): TemplateTask[] {
  const tasks: TemplateTask[] = [];
  for (const task of input.slice(0, MAX_TEMPLATE_TASKS)) {
    const title = String(task.title ?? '').trim();
    if (!title) continue;
    tasks.push({
      title: title.slice(0, 200),
      description: task.description ? String(task.description).trim().slice(0, 2000) || null : null,
      minutes: Math.min(Math.max(Math.round(Number(task.minutes) || 0), 0), 100_000),
      hourly_rate: Math.min(Math.max(Math.round(Number(task.hourly_rate) || 0), 0), 9_999_999),
      billable: task.billable !== false,
      sort_order: tasks.length,
    });
  }
  return tasks;
}

/** What the template says the work will take, in minutes. */
export function templateEstimateMinutes(tasks: { minutes?: number }[]): number {
  return tasks.reduce((total, task) => total + Math.max(Math.round(Number(task.minutes) || 0), 0), 0);
}

/**
 * The next version of a template. Versions only ever grow: reusing a number would
 * make two different snapshots answer to the same reference.
 */
export function nextVersion(versions: number[]): number {
  const highest = versions.reduce((max, version) => (Number(version) > max ? Number(version) : max), 0);
  return highest + 1;
}
