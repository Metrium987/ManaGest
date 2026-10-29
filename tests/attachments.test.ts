import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_CHUNK_BYTES,
  DEFAULT_ATTACHMENT_MAX_MB,
  MAX_ATTACHMENT_MAX_MB,
  MIN_ATTACHMENT_MAX_MB,
  attachmentMaxMb,
  contentDisposition,
  decodeBase64Strict,
  encodeBase64,
  isAttachmentEntity,
  joinChunks,
  sanitizeFilename,
  sha256Hex,
  splitChunks,
  validateAttachment,
} from '../server/lib/attachments';
import { ApiError } from '../server/lib/errors';

function codeOf(run: () => unknown): string {
  try {
    run();
    return 'NO_ERROR';
  } catch (error) {
    return error instanceof ApiError ? error.code : 'NOT_AN_API_ERROR';
  }
}

describe('attachment size ceiling (a workspace setting, clamped to 1–25 MB)', () => {
  it('falls back to 10 MB when the setting is absent or unreadable', () => {
    expect(attachmentMaxMb(undefined)).toBe(DEFAULT_ATTACHMENT_MAX_MB);
    expect(attachmentMaxMb(null)).toBe(DEFAULT_ATTACHMENT_MAX_MB);
    expect(attachmentMaxMb('')).toBe(DEFAULT_ATTACHMENT_MAX_MB);
    expect(attachmentMaxMb('many')).toBe(DEFAULT_ATTACHMENT_MAX_MB);
  });

  it('reads a stored value', () => {
    expect(attachmentMaxMb('4')).toBe(4);
    expect(attachmentMaxMb('25')).toBe(MAX_ATTACHMENT_MAX_MB);
  });

  it('clamps rather than refusing, so a bad setting cannot block uploads', () => {
    expect(attachmentMaxMb('0')).toBe(MIN_ATTACHMENT_MAX_MB);
    expect(attachmentMaxMb('-3')).toBe(MIN_ATTACHMENT_MAX_MB);
    expect(attachmentMaxMb('900')).toBe(MAX_ATTACHMENT_MAX_MB);
  });
});

describe('filename safety (a receipt may be named, but not addressed)', () => {
  it('keeps the last path segment only', () => {
    expect(sanitizeFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('C:\\Users\\Ana\\facture.pdf')).toBe('facture.pdf');
    expect(sanitizeFilename('/tmp/recu 2026.pdf')).toBe('recu 2026.pdf');
  });

  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeFilename('recu\u0000\u001f  photo.png')).toBe('recu photo.png');
  });

  it('truncates an absurd name instead of storing it whole', () => {
    expect(sanitizeFilename(`${'a'.repeat(300)}.pdf`)).toHaveLength(120);
  });

  it('refuses an empty or dot-only name', () => {
    expect(codeOf(() => sanitizeFilename(''))).toBe('INVALID_FILENAME');
    expect(codeOf(() => sanitizeFilename('..'))).toBe('INVALID_FILENAME');
    expect(codeOf(() => sanitizeFilename('/tmp/'))).toBe('INVALID_FILENAME');
  });
});

describe('upload validation (the decoded bytes decide, not the client)', () => {
  const base = { filename: 'facture.pdf', mimeType: 'application/pdf', maxBytes: 1024 };

  it('accepts a PDF and a photo', () => {
    expect(validateAttachment({ ...base, sizeBytes: 10 }).mimeType).toBe('application/pdf');
    for (const mimeType of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(validateAttachment({ ...base, mimeType, sizeBytes: 10 }).mimeType).toBe(mimeType);
    }
  });

  it('refuses an empty file', () => {
    expect(codeOf(() => validateAttachment({ ...base, sizeBytes: 0 }))).toBe('FILE_EMPTY');
    expect(codeOf(() => validateAttachment({ ...base, sizeBytes: -1 }))).toBe('FILE_EMPTY');
    expect(codeOf(() => validateAttachment({ ...base, sizeBytes: 1.5 }))).toBe('FILE_EMPTY');
  });

  it('accepts exactly the ceiling and refuses one byte more', () => {
    expect(codeOf(() => validateAttachment({ ...base, sizeBytes: 1024 }))).toBe('NO_ERROR');
    expect(codeOf(() => validateAttachment({ ...base, sizeBytes: 1025 }))).toBe('FILE_TOO_LARGE');
  });

  it('refuses a type that is not a document or a photo', () => {
    for (const mimeType of ['text/html', 'application/zip', 'image/svg+xml', 'application/x-php', '']) {
      expect(codeOf(() => validateAttachment({ ...base, mimeType, sizeBytes: 10 }))).toBe('UNSUPPORTED_FILE_TYPE');
    }
  });
});

describe('base64 transport (the browser sends bytes as text)', () => {
  it('round-trips arbitrary bytes, including zero and high values', () => {
    const bytes = Uint8Array.from([0, 1, 127, 128, 200, 255]);
    expect(Array.from(decodeBase64Strict(encodeBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it('accepts padding and line-wrapped input', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
    expect(Array.from(decodeBase64Strict('AQID\r\nBAU='))).toEqual(Array.from(bytes));
  });

  it('refuses something that is not base64 at all', () => {
    expect(codeOf(() => decodeBase64Strict('not base64!'))).toBe('INVALID_BASE64');
    expect(codeOf(() => decodeBase64Strict(''))).toBe('INVALID_BASE64');
    expect(codeOf(() => decodeBase64Strict('   '))).toBe('INVALID_BASE64');
  });
});

describe('chunking (a file larger than one database row)', () => {
  it('splits at the documented size and never loses a byte', () => {
    const bytes = new Uint8Array(ATTACHMENT_CHUNK_BYTES * 2 + 17).fill(7);
    const chunks = splitChunks(bytes);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(ATTACHMENT_CHUNK_BYTES);
    expect(chunks[2]).toHaveLength(17);
    expect(Array.from(joinChunks(chunks))).toEqual(Array.from(bytes));
  });

  it('handles an exact multiple without an empty trailing chunk', () => {
    expect(splitChunks(new Uint8Array(8), 4)).toHaveLength(2);
  });

  it('keeps a single small file in one chunk', () => {
    const chunks = splitChunks(Uint8Array.from([1, 2, 3]));
    expect(chunks).toHaveLength(1);
    expect(Array.from(joinChunks(chunks))).toEqual([1, 2, 3]);
  });

  it('reassembles chunks out of order when the caller sorts them', () => {
    const bytes = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const chunks = splitChunks(bytes, 2);
    expect(Array.from(joinChunks([chunks[0], chunks[1], chunks[2]]))).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe('checksum and download headers', () => {
  it('computes the SHA-256 of the bytes, so a truncated file is detectable', async () => {
    expect(await sha256Hex(new TextEncoder().encode('abc')))
      .toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(await sha256Hex(new TextEncoder().encode('abd')))
      .not.toBe(await sha256Hex(new TextEncoder().encode('abc')));
  });

  it('quotes an accent-free fallback and carries the real name for the browser', () => {
    const header = contentDisposition('reçu 2026.pdf');
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).toContain("filename*=UTF-8''re%C3%A7u%202026.pdf");
  });

  it('neutralises a quote that would break the header', () => {
    expect(contentDisposition('a"b.pdf')).toContain('filename="a\'b.pdf"');
  });

  it('recognises exactly the two supported record types', () => {
    expect(isAttachmentEntity('expense')).toBe(true);
    expect(isAttachmentEntity('payment')).toBe(true);
    for (const other of ['invoice', 'Expense', '', null, 1]) expect(isAttachmentEntity(other)).toBe(false);
  });
});
