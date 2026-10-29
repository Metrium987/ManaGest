import { Hono } from 'hono';
import { z } from 'zod';
import { nowISO } from '../db';
import { logActivity } from '../lib/audit';
import {
  ATTACHMENT_MIME_TYPES,
  ENTITY_PERMISSIONS,
  ENTITY_TABLES,
  attachmentMaxMb,
  contentDisposition,
  decodeBase64Strict,
  encodeBase64,
  isAttachmentEntity,
  joinChunks,
  sha256Hex,
  splitChunks,
  validateAttachment,
  type AttachmentEntity,
} from '../lib/attachments';
import { fail } from '../lib/errors';
import { assertPermission } from '../lib/permissions';
import { getExtra } from '../lib/settings-extra';
import { parseInput } from '../lib/validation';
import { requireAuth } from '../middleware';
import type { AppEnv } from '../types';
import type { Permission, Role } from '../../shared/domain';

export const attachmentRoutes = new Hono<AppEnv>();
attachmentRoutes.use('*', requireAuth);

interface AttachmentRow {
  id: string;
  entity_type: string;
  entity_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  checksum: string;
  uploaded_by: string | null;
  created_at: string;
}

/** The required permission is the one of the record the file belongs to. */
function requireEntityPermission(role: Role, entity: AttachmentEntity, action: 'read' | 'write'): void {
  assertPermission(role, ENTITY_PERMISSIONS[entity][action] as Permission);
}

async function entityExists(database: D1Database, entity: AttachmentEntity, id: string): Promise<boolean> {
  const row = await database
    .prepare(`SELECT id FROM ${ENTITY_TABLES[entity]} WHERE id = ? AND deleted_at IS NULL`)
    .bind(id)
    .first<{ id: string }>();
  return Boolean(row);
}

async function maxBytesOf(database: D1Database): Promise<number> {
  return attachmentMaxMb(await getExtra(database, 'attachment_max_mb')) * 1024 * 1024;
}

attachmentRoutes.get('/limits', async (c) => {
  const maxBytes = await maxBytesOf(c.env.DB);
  return c.json({
    max_bytes: maxBytes,
    max_mb: Math.round(maxBytes / (1024 * 1024)),
    allowed_types: ATTACHMENT_MIME_TYPES,
    storage: 'database',
  });
});

attachmentRoutes.get('/', async (c) => {
  const entity = c.req.query('entity');
  const entityId = c.req.query('entity_id') ?? '';
  if (!isAttachmentEntity(entity)) return fail(422, 'VALIDATION_ERROR', { entity: 'unsupported' });
  if (!entityId) return fail(422, 'VALIDATION_ERROR', { entity_id: 'required' });

  const actor = c.get('user')!;
  requireEntityPermission(actor.role, entity, 'read');

  const rows = await c.env.DB.prepare(
    `SELECT a.id, a.filename, a.mime_type, a.size_bytes, a.created_at, a.uploaded_by,
            u.first_name, u.last_name
       FROM attachments a
       LEFT JOIN users u ON u.id = a.uploaded_by
      WHERE a.entity_type = ? AND a.entity_id = ? AND a.deleted_at IS NULL
      ORDER BY a.created_at DESC`,
  )
    .bind(entity, entityId)
    .all<Record<string, unknown>>();

  return c.json({
    attachments: rows.results.map((row) => ({
      id: row.id as string,
      filename: row.filename as string,
      mime_type: row.mime_type as string,
      size_bytes: row.size_bytes as number,
      created_at: row.created_at as string,
      uploaded_by_name: row.first_name ? `${row.first_name} ${row.last_name ?? ''}`.trim() : null,
    })),
  });
});

attachmentRoutes.post('/', async (c) => {
  const body = parseInput(
    z.object({
      entity: z.enum(['expense', 'payment']),
      entity_id: z.string().min(8).max(60),
      filename: z.string().min(1).max(200),
      mime_type: z.string().min(1).max(100),
      content_base64: z.string().min(1),
    }),
    await c.req.json().catch(() => ({})),
  );

  const actor = c.get('user')!;
  requireEntityPermission(actor.role, body.entity, 'write');
  if (!(await entityExists(c.env.DB, body.entity, body.entity_id))) return fail(404, 'NOT_FOUND');

  // The declared size is never trusted: the decoded bytes decide.
  const bytes = decodeBase64Strict(body.content_base64);
  const { filename, mimeType } = validateAttachment({
    filename: body.filename,
    mimeType: body.mime_type,
    sizeBytes: bytes.length,
    maxBytes: await maxBytesOf(c.env.DB),
  });

  const id = crypto.randomUUID();
  const createdAt = nowISO();
  const checksum = await sha256Hex(bytes);
  const chunks = splitChunks(bytes);

  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO attachments (id, entity_type, entity_id, filename, mime_type, size_bytes, checksum, storage, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'database', ?, ?)`,
    ).bind(id, body.entity, body.entity_id, filename, mimeType, bytes.length, checksum, actor.id, createdAt),
    ...chunks.map((chunk, seq) =>
      c.env.DB.prepare(`INSERT INTO attachment_chunks (attachment_id, seq, content) VALUES (?, ?, ?)`)
        .bind(id, seq, encodeBase64(chunk)),
    ),
  ]);

  await logActivity(c.env.DB, {
    userId: actor.id,
    action: 'created',
    entityType: body.entity,
    entityId: body.entity_id,
    summary: 'activity.attachment_added',
    meta: { filename, size_bytes: bytes.length, mime_type: mimeType },
  });

  return c.json({ id, filename, mime_type: mimeType, size_bytes: bytes.length, created_at: createdAt }, 201);
});

attachmentRoutes.get('/:id/download', async (c) => {
  const actor = c.get('user')!;
  const row = await c.env.DB.prepare(`SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL`)
    .bind(c.req.param('id'))
    .first<AttachmentRow>();
  if (!row || !isAttachmentEntity(row.entity_type)) return fail(404, 'NOT_FOUND');
  requireEntityPermission(actor.role, row.entity_type, 'read');

  const chunks = await c.env.DB.prepare(`SELECT content FROM attachment_chunks WHERE attachment_id = ? ORDER BY seq`)
    .bind(row.id)
    .all<{ content: string }>();
  const bytes = joinChunks(chunks.results.map((chunk) => decodeBase64Strict(chunk.content)));
  if (bytes.length !== row.size_bytes) return fail(409, 'ATTACHMENT_INCOMPLETE');

  return new Response(bytes, {
    headers: {
      'Content-Type': row.mime_type,
      'Content-Length': String(bytes.length),
      'Content-Disposition': contentDisposition(row.filename),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

attachmentRoutes.delete('/:id', async (c) => {
  const actor = c.get('user')!;
  const row = await c.env.DB.prepare(`SELECT * FROM attachments WHERE id = ? AND deleted_at IS NULL`)
    .bind(c.req.param('id'))
    .first<AttachmentRow>();
  if (!row || !isAttachmentEntity(row.entity_type)) return fail(404, 'NOT_FOUND');
  requireEntityPermission(actor.role, row.entity_type, 'write');

  const deletedAt = nowISO();
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE attachments SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL`).bind(deletedAt, row.id),
    c.env.DB.prepare(`DELETE FROM attachment_chunks WHERE attachment_id = ?`).bind(row.id),
  ]);

  await logActivity(c.env.DB, {
    userId: actor.id,
    action: 'deleted',
    entityType: row.entity_type,
    entityId: row.entity_id,
    summary: 'activity.attachment_deleted',
    meta: { filename: row.filename, size_bytes: row.size_bytes },
  });

  return c.body(null, 204);
});
