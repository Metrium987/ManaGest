import { Hono } from 'hono';
import { logActivity } from '../lib/audit';
import {
  BackupError,
  d1BackupSource,
  exportDatabase,
  restoreDatabase,
} from '../lib/backup';
import { fail } from '../lib/errors';
import { requireAuth, requirePermission } from '../middleware';
import type { AppEnv } from '../types';

/**
 * P-03: the full export and its restore, owner only.
 *
 * A backup contains password hashes, session rows and every amount in the
 * workspace, so no other role may read it. Restoring is destructive by nature:
 * it requires `confirm: 'RESTORE'` and, when the workspace already holds rows,
 * the explicit `allow_overwrite` flag. Both actions are journalled after they
 * succeed, so the journal describes what was actually done.
 */
export const backupRoutes = new Hono<AppEnv>();

backupRoutes.use('*', requireAuth);

backupRoutes.get('/', requireAuth, requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'owner') return fail(403, 'FORBIDDEN');

  const dump = await exportDatabase(d1BackupSource(c.env.DB));
  const rows = dump.tables.reduce((sum, table) => sum + table.row_count, 0);
  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'exported',
    entityType: 'workspace_backup',
    summary: 'activity.backup_exported',
    meta: { tables: dump.tables.length, rows, schema_version: dump.schema_version },
  });

  const day = dump.exported_at.slice(0, 10);
  return new Response(JSON.stringify(dump), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="managest-${day}.json"`,
      'Cache-Control': 'no-store',
    },
  });
});

backupRoutes.post('/restore', requireAuth, requirePermission('settings.write'), async (c) => {
  const user = c.get('user')!;
  if (user.role !== 'owner') return fail(403, 'FORBIDDEN');

  const body = await c.req.json().catch(() => null) as
    | { dump?: unknown; confirm?: string; allow_overwrite?: boolean }
    | null;
  if (!body || body.confirm !== 'RESTORE') {
    return fail(422, 'VALIDATION_ERROR', { confirm: 'required' });
  }

  try {
    const report = await restoreDatabase(d1BackupSource(c.env.DB), body.dump, {
      allow_overwrite: Boolean(body.allow_overwrite),
    });
    await logActivity(c.env.DB, {
      userId: user.id,
      action: 'restored',
      entityType: 'workspace_backup',
      summary: 'activity.backup_restored',
      meta: {
        source_schema_version: report.source_schema_version,
        schema_version: report.schema_version,
        replaced: report.replaced,
        rows: report.tables.reduce((sum, table) => sum + table.rows, 0),
      },
    });
    return c.json({ ok: true, ...report });
  } catch (error) {
    if (error instanceof BackupError) {
      return fail(422, error.code, error.detail ? { detail: error.detail } : undefined);
    }
    throw error;
  }
});
