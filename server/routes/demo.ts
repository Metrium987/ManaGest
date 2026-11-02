import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { parseInput } from '../lib/validation';
import { requireAuth, requirePermission } from '../middleware';
import { DEFAULT_TAX_RATE, DEFAULT_TIMEZONE } from '../../shared/domain';
import { seedDemoData } from '../services/seed';
import type { AppEnv } from '../types';

/**
 * Q13 — starting the demonstration over.
 *
 * A demo tenant fills up with test invoices, test clients and test movements until
 * the screens no longer show anything useful. This route empties the transactional
 * tables and reseeds the demonstration set, and touches **nothing** that describes
 * the workspace: company details, users, roles, settings, tax rates, numbering,
 * expense categories, import tariff and tax rules, profit centres and project
 * templates all stay.
 *
 * Two locks, because a reset button on a live database would be a catastrophe: the
 * demonstration flag has to be on (`app_meta.demo_mode`), or the deployment has to
 * carry `DEMO_RESET=1`. The activity journal is kept, and the reset itself is
 * journalled, so the audit trail shows what happened even after the data is gone.
 */
export const demoRoutes = new Hono<AppEnv>();
demoRoutes.use('*', requireAuth);

/** Tables that describe the workspace rather than record its activity. */
const KEEP = new Set([
  'company', 'users', 'roles', 'settings', 'settings_extra', 'tax_rates', 'app_meta',
  'expense_categories', 'entity_numbering', 'number_sequences', 'periods', 'period_locks',
  'profit_centers', 'tariff_codes', 'import_tax_rules', 'project_templates',
  'project_template_versions', 'project_template_tasks', 'activities', 'bank_accounts',
  'saved_filters',
  // G2/G3: the working calendar, the capacities and the SLA policies describe the
  // workspace, not its activity — a demo reset must not erase them.
  'non_working_days', 'weekly_capacities', 'sla_policies',
]);

/** Prefixes that always describe configuration or access, never transactions. */
const KEEP_PREFIXES = ['settings', 'user', 'role', 'session', 'mfa', 'login', 'api_token'];

async function demoMode(database: D1Database): Promise<boolean> {
  const row = await database
    .prepare(`SELECT value FROM app_meta WHERE key = 'demo_mode'`)
    .first<{ value: string }>();
  return row?.value === '1';
}

demoRoutes.get('/', requirePermission('settings.read'), async (c) => {
  return c.json({ demo_mode: await demoMode(c.env.DB) });
});

demoRoutes.put('/mode', requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  const body = parseInput(
    z.object({ enabled: z.boolean() }),
    await c.req.json().catch(() => ({})),
  );
  await c.env.DB.prepare(
    `INSERT INTO app_meta (key, value) VALUES ('demo_mode', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).bind(body.enabled ? '1' : '0').run();
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'updated',
    entityType: 'settings',
    entityId: 'demo_mode',
    summary: 'activity.demo_mode_changed',
    meta: { enabled: body.enabled },
  });
  return c.json({ ok: true, demo_mode: body.enabled });
});

demoRoutes.post('/reset', requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  const envFlag = (c.env as unknown as Record<string, unknown>).DEMO_RESET === '1';
  const flag = await demoMode(c.env.DB);
  if (!flag && !envFlag) return fail(409, 'DEMO_RESET_DISABLED');

  const body = parseInput(
    z.object({ reseed: z.boolean().default(true) }).default({ reseed: true }),
    await c.req.json().catch(() => ({})),
  );

  const tables = await c.env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  ).all<{ name: string }>();
  const cleared: string[] = [];
  const skipped: string[] = [];
  for (const { name } of tables.results ?? []) {
    // `_cf_*` tables belong to the platform (the D1 KV cache), never to the app.
    if (name.startsWith('_cf_') || KEEP.has(name) || KEEP_PREFIXES.some((prefix) => name.startsWith(prefix))) continue;
    try {
      await c.env.DB.prepare(`DELETE FROM ${name}`).run();
      cleared.push(name);
    } catch {
      // A table this build does not know about is reported, never guessed at.
      skipped.push(name);
    }
  }

  let seeded = false;
  if (body.reseed) {
    const company = await c.env.DB.prepare(
      `SELECT id, currency, default_tax_rate, timezone FROM company LIMIT 1`,
    ).first<{ id: string; currency: string; default_tax_rate: number; timezone: string }>();
    if (company) {
      await seedDemoData({
        db: c.env.DB,
        companyId: company.id,
        userId: user.id,
        currency: company.currency || 'XPF',
        timezone: company.timezone || DEFAULT_TIMEZONE,
        taxRate: Number(company.default_tax_rate) || DEFAULT_TAX_RATE,
      });
      seeded = true;
    }
  }

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'deleted',
    entityType: 'demo',
    entityId: 'reset',
    summary: 'activity.demo_reset',
    meta: { tables: cleared.length, skipped, reseeded: seeded, at: nowISO() },
  });

  return c.json({ ok: true, cleared, skipped, reseeded: seeded });
});
