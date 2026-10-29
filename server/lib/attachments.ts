import { ApiError } from './errors';
import type { Permission } from '../../shared/domain';

/**
 * Receipts and payment proofs (T-101). The bytes live in the workspace database,
 * split into chunks so that a single file never approaches D1's per-row limit;
 * nothing here needs an object bucket, so the feature works on any deployment.
 */

/** 256 KiB of raw bytes per row: base64 fits comfortably under the D1 row limit. */
export const ATTACHMENT_CHUNK_BYTES = 256 * 1024;

export const DEFAULT_ATTACHMENT_MAX_MB = 10;
export const MIN_ATTACHMENT_MAX_MB = 1;
export const MAX_ATTACHMENT_MAX_MB = 25;

/** What a receipt legitimately is: a PDF or a photo of paper. Anything else is refused. */
export const ATTACHMENT_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'] as const;
export type AttachmentMimeType = (typeof ATTACHMENT_MIME_TYPES)[number];

export type AttachmentEntity = 'expense' | 'payment';

export const ATTACHMENT_ENTITIES: AttachmentEntity[] = ['expense', 'payment'];

/** The permission depends on the record the file is attached to, never on the uploader. */
export const ENTITY_PERMISSIONS: Record<AttachmentEntity, { read: Permission; write: Permission }> = {
  expense: { read: 'expenses.read', write: 'expenses.write' },
  payment: { read: 'payments.read', write: 'payments.write' },
};

export const ENTITY_TABLES: Record<AttachmentEntity, string> = {
  expense: 'expenses',
  payment: 'payments',
};

export function isAttachmentEntity(value: unknown): value is AttachmentEntity {
  return value === 'expense' || value === 'payment';
}

/**
 * The ceiling is a workspace setting (1–25 MB, default 10 MB). An out-of-range
 * value is clamped rather than rejected: a bad stored setting must not make
 * uploads impossible.
 */
export function attachmentMaxMb(raw: string | null | undefined): number {
  const parsed = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_ATTACHMENT_MAX_MB;
  return Math.min(MAX_ATTACHMENT_MAX_MB, Math.max(MIN_ATTACHMENT_MAX_MB, parsed));
}

/** Keeps the user's own filename readable but never lets a path or a control character through. */
export function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new ApiError(422, 'INVALID_FILENAME');
  return cleaned;
}

export function validateAttachment(input: {
  filename: string;
  mimeType: string;
  sizeBytes: number;
  maxBytes: number;
}): { filename: string; mimeType: AttachmentMimeType } {
  const filename = sanitizeFilename(input.filename);
  if (!(ATTACHMENT_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    throw new ApiError(422, 'UNSUPPORTED_FILE_TYPE', { mime_type: 'unsupported' });
  }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes <= 0) {
    throw new ApiError(422, 'FILE_EMPTY');
  }
  if (input.sizeBytes > input.maxBytes) {
    throw new ApiError(422, 'FILE_TOO_LARGE', { max_bytes: String(input.maxBytes) });
  }
  return { filename, mimeType: input.mimeType as AttachmentMimeType };
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const step = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
  }
  return btoa(binary);
}

export function decodeBase64Strict(value: string): Uint8Array {
  const compact = value.replace(/\s+/g, '');
  if (!compact || /[^A-Za-z0-9+/=]/.test(compact)) throw new ApiError(422, 'INVALID_BASE64');
  let binary: string;
  try {
    binary = atob(compact);
  } catch {
    throw new ApiError(422, 'INVALID_BASE64');
  }
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function splitChunks(bytes: Uint8Array, size = ATTACHMENT_CHUNK_BYTES): Uint8Array[] {
  if (size <= 0) throw new Error('chunk size must be positive');
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += size) {
    chunks.push(bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return chunks;
}

export function joinChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Header-safe filename: an ASCII fallback plus the RFC 5987 form for accents. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
