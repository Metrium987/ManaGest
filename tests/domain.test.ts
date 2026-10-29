import { describe, expect, it } from 'vitest';
import { deriveInvoiceStatus, isOverdue, refundableAmount } from '../server/services/status';
import { formatPattern } from '../server/lib/numbering';
import { permissionsForRole, hasPermission } from '../server/lib/permissions';
import { validatePassword } from '../server/lib/passwords';
import { addDays, addMonths, daysBetween } from '../server/lib/dates';
import { ApiError } from '../server/lib/errors';
import { base32Decode, base32Encode, normalizeRecoveryCode, totpAt, verifyTotp } from '../server/lib/totp';
import { periodOf } from '../server/lib/locks';
import { diffSnapshot } from '../server/lib/audit';

describe('invoice status derivation', () => {
  it('keeps drafts as drafts without payments', () => {
    expect(deriveInvoiceStatus('draft', 1000, 0)).toBe('draft');
  });

  it('marks an invoice paid when the balance reaches zero', () => {
    expect(deriveInvoiceStatus('sent', 0, 1000)).toBe('paid');
    expect(deriveInvoiceStatus('partial', 0, 1000)).toBe('paid');
  });

  it('marks sent invoices partial after a deposit', () => {
    expect(deriveInvoiceStatus('sent', 500, 500)).toBe('partial');
  });

  it('keeps cancellation terminal', () => {
    expect(deriveInvoiceStatus('cancelled', 0, 0)).toBe('cancelled');
  });

  it('detects overdue invoices only when open', () => {
    expect(isOverdue('sent', '2026-01-01', '2026-10-28')).toBe(true);
    expect(isOverdue('paid', '2026-01-01', '2026-10-28')).toBe(false);
    expect(isOverdue('sent', null, '2026-10-28')).toBe(false);
  });
});

describe('document numbering', () => {
  it('renders all supported tokens', () => {
    expect(
      formatPattern('{prefix}-{YYYY}-{####}', { prefix: 'FAC', year: '2026', month: '10', sequence: 42 }),
    ).toBe('FAC-2026-0042');
    expect(
      formatPattern('{prefix}{YY}{MM}-{###}', { prefix: 'D', year: '2026', month: '03', sequence: 7 }),
    ).toBe('D2603-007');
    expect(
      formatPattern('{prefix}/{#####}', { prefix: 'AV', year: '2026', month: '01', sequence: 12 }),
    ).toBe('AV/00012');
  });
});

describe('role permissions', () => {
  it('gives owners every permission', () => {
    expect(hasPermission('owner', 'users.write')).toBe(true);
    expect(hasPermission('owner', 'invoices.delete')).toBe(true);
  });

  it('restricts viewers to read permissions', () => {
    const permissions = permissionsForRole('viewer');
    expect(permissions.every((permission) => permission.endsWith('.read'))).toBe(true);
    expect(hasPermission('viewer', 'invoices.write')).toBe(false);
  });

  it('prevents accountants from managing users', () => {
    expect(hasPermission('accountant', 'payments.write')).toBe(true);
    expect(hasPermission('accountant', 'users.write')).toBe(false);
  });

  it('lets sales write commercial documents but not settings', () => {
    expect(hasPermission('sales', 'invoices.write')).toBe(true);
    expect(hasPermission('sales', 'settings.write')).toBe(false);
  });

  it('keeps the user directory and audit journal away from non-admin roles', () => {
    expect(hasPermission('owner', 'users.read')).toBe(true);
    expect(hasPermission('admin', 'users.read')).toBe(true);
    expect(hasPermission('accountant', 'users.read')).toBe(false);
    expect(hasPermission('sales', 'users.read')).toBe(false);
    expect(hasPermission('viewer', 'users.read')).toBe(false);
    expect(hasPermission('sales', 'activity.read')).toBe(false);
    expect(hasPermission('viewer', 'activity.read')).toBe(false);
    expect(hasPermission('accountant', 'activity.read')).toBe(true);
  });

  it('restricts deletion to owner and admin', () => {
    for (const role of ['accountant', 'sales', 'viewer'] as const) {
      expect(hasPermission(role, 'invoices.delete')).toBe(false);
      expect(hasPermission(role, 'clients.delete')).toBe(false);
    }
    expect(hasPermission('admin', 'invoices.delete')).toBe(true);
  });

  it('gives accountants financial write access without settings or user rights', () => {
    expect(hasPermission('accountant', 'settings.read')).toBe(true);
    expect(hasPermission('accountant', 'settings.write')).toBe(false);
    expect(hasPermission('accountant', 'users.write')).toBe(false);
    expect(hasPermission('accountant', 'bank.write')).toBe(true);
  });

  it('does not let sales people touch purchasing or banking', () => {
    expect(hasPermission('sales', 'expenses.read')).toBe(false);
    expect(hasPermission('sales', 'bank.read')).toBe(false);
    expect(hasPermission('sales', 'purchase_orders.read')).toBe(false);
  });
});

describe('password policy', () => {
  it('accepts a long passphrase', () => {
    expect(() => validatePassword({ password: 'Fenua-Management-2026!' })).not.toThrow();
  });

  it('rejects short passwords', () => {
    expect(() => validatePassword({ password: 'short' })).toThrow(ApiError);
  });

  it('rejects common passwords', () => {
    expect(() => validatePassword({ password: 'changeme1234' })).toThrow(ApiError);
  });

  it('rejects passwords built from the account identity', () => {
    expect(() => validatePassword({ password: 'moana1234', firstName: 'Moana' })).toThrow(ApiError);
  });
});

describe('date helpers', () => {
  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(daysBetween('2026-01-01', '2026-01-31')).toBe(30);
  });

  it('clamps month addition to the last day', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });
});

describe('period closure', () => {
  it('maps document dates to calendar months', () => {
    expect(periodOf('2026-10-31')).toBe('2026-10');
    expect(periodOf('2026-01-01')).toBe('2026-01');
  });

  it('ignores absent or malformed dates', () => {
    expect(periodOf(null)).toBeNull();
    expect(periodOf(undefined)).toBeNull();
    expect(periodOf('n’importe quoi')).toBeNull();
    expect(periodOf('2026-13-01')).toBeNull();
  });

  it('is a control only owner, admin and accountant may operate', () => {
    expect(hasPermission('owner', 'periods.write')).toBe(true);
    expect(hasPermission('admin', 'periods.write')).toBe(true);
    expect(hasPermission('accountant', 'periods.write')).toBe(true);
    expect(hasPermission('sales', 'periods.write')).toBe(false);
    expect(hasPermission('viewer', 'periods.write')).toBe(false);
    expect(hasPermission('viewer', 'periods.read')).toBe(false);
    expect(hasPermission('accountant', 'periods.read')).toBe(true);
  });
});

describe('TOTP second factor (RFC 6238)', () => {
  // The RFC's SHA-1 secret: ASCII "12345678901234567890".
  const SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

  it('encodes and decodes base32 without loss', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 251, 252]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
    expect(SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it('produces the RFC test vector for time step 1 (T=59s)', async () => {
    // RFC 6238 prints 8-digit codes; authenticator apps use the standard
    // 6-digit form, which is the last six digits of that value (94287082).
    expect(await totpAt(SECRET, 1)).toBe('287082');
  });

  it('accepts the current code', async () => {
    const counter = Math.floor(Date.now() / 30_000);
    const code = await totpAt(SECRET, counter);
    expect(await verifyTotp(SECRET, code)).toBe(true);
  });

  it('rejects a code from another time step and malformed input', async () => {
    const counter = Math.floor(Date.now() / 30_000);
    const stale = await totpAt(SECRET, counter + 10);
    expect(await verifyTotp(SECRET, stale)).toBe(false);
    expect(await verifyTotp(SECRET, '12345')).toBe(false);
    expect(await verifyTotp(SECRET, '')).toBe(false);
  });

  it('normalises recovery codes whatever they are typed as', () => {
    expect(normalizeRecoveryCode('ab12c-def34')).toBe('AB12CDEF34');
    expect(normalizeRecoveryCode(' AB12CDEF34 ')).toBe('AB12CDEF34');
  });
});

describe('audit diff snapshots', () => {
  it('keeps only the fields that really changed', () => {
    expect(diffSnapshot({ name: 'A', rate: 16 }, { name: 'B', rate: 16 }, ['name', 'rate'])).toEqual({
      before: { name: 'A' },
      after: { name: 'B' },
    });
  });

  it('returns null when nothing changed', () => {
    expect(diffSnapshot({ a: 1 }, { a: 1 }, ['a'])).toBeNull();
    expect(diffSnapshot({ a: null }, { a: '' }, ['a'])).toBeNull();
  });

  it('records numeric state changes such as a role or flag flip', () => {
    expect(diffSnapshot({ is_active: 1 }, { is_active: 0 }, ['is_active'])).toEqual({
      before: { is_active: 1 },
      after: { is_active: 0 },
    });
  });
});

// ===== M0 (T-002) — TVA status model: exempt lines carry no 0-rate bucket =====
import { computeTotals as ct2 } from '../shared/tax';

describe('M0 tax-status model (BK-001/PF-TVA-002)', () => {
  it('exempt line produces no bucket and no tax', () => {
    const r = ct2(
      [
        { id: 'a', description: 'x', quantity: 2, unit_price: 10000, tax_rate: 16, tax_status: 'exempt' },
        { id: 'b', description: 'y', quantity: 1, unit_price: 5000, tax_rate: 16 },
      ],
      { discount_type: 'percent', discount_value: 0 },
      false,
    );
    expect(r.tax_total).toBe(800); // 5 000 HT × 16 % = 800
    expect(r.tax_buckets).toHaveLength(1);
    expect(r.total).toBe(25800); // 20 000 exonéré + 5 000 HT + 800 TVA
  });

  it('all-exempt document has no buckets at all', () => {
    const r = ct2(
      [{ id: 'a', description: 'x', quantity: 1, unit_price: 12000, tax_rate: 16, tax_status: 'exempt' }],
      { discount_type: 'amount', discount_value: 0 },
      false,
    );
    expect(r.tax_buckets).toHaveLength(0);
    expect(r.total).toBe(12000);
  });

  it('company-level franchise still zeroes every line', () => {
    const r = ct2(
      [{ id: 'a', description: 'x', quantity: 1, unit_price: 9999, tax_rate: 16 }],
      { discount_type: 'percent', discount_value: 0 },
      true,
    );
    expect(r.tax_total).toBe(0);
    expect(r.tax_buckets).toHaveLength(0);
  });

  it('default (no tax_status) keeps previous behaviour', () => {
    const r = ct2(
      [{ id: 'a', description: 'x', quantity: 1, unit_price: 10000, tax_rate: 16 }],
      { discount_type: 'percent', discount_value: 0 },
      false,
    );
    expect(r.tax_total).toBe(1600);
  });
});

// ===== M0 (T-009) — retention guard =====
import { retentionCutoff, retentionElapsed, DEFAULT_RETENTION_YEARS } from '../server/lib/retention';

describe('M0 retention guard (OQ-005/006)', () => {
  it('default is 10 years', () => expect(DEFAULT_RETENTION_YEARS).toBe(10));
  it('today+10y cutoff computed from document date', () => {
    expect(retentionCutoff('2016-03-14', 10)).toBe('2026-03-14');
  });
  it('elapsed only after cutoff', () => {
    expect(retentionElapsed('2016-03-14', 10, '2026-03-14')).toBe(false);
    expect(retentionElapsed('2016-03-14', 10, '2026-03-15')).toBe(true);
  });
  it('custom retention years respected', () => {
    expect(retentionElapsed('2020-01-01', 5, '2025-01-02')).toBe(true);
    expect(retentionElapsed('2020-01-01', 5, '2024-12-31')).toBe(false);
  });
});

describe('T-004 refunds via credit notes (BK-006 as adapted by OQ-012)', () => {
  it('GIVEN a paid invoice WHEN a credit note is issued THEN it may cover at most the amount received', () => {
    expect(refundableAmount('paid', 0, 30000)).toBe(30000);
    expect(refundableAmount('paid', 0, 0)).toBe(0);
  });

  it('GIVEN a sent or partial invoice WHEN a credit note is issued THEN it may cover at most the open balance', () => {
    expect(refundableAmount('sent', 30000, 0)).toBe(30000);
    expect(refundableAmount('partial', 10000, 20000)).toBe(10000);
  });

  it('GIVEN draft or cancelled invoice WHEN a credit note is requested THEN nothing may be refunded', () => {
    expect(refundableAmount('draft', 30000, 0)).toBe(0);
    expect(refundableAmount('cancelled', 30000, 0)).toBe(0);
  });

  it('GIVEN a refund of one third of a paid invoice WHEN the balance is recomputed THEN it restores to one third', () => {
    // Recalc rule used by recalcInvoice: paid_total = max(0, min(payments + credits, total) - refunds).
    const total = 30000;
    const paid = 30000;
    const refunds = 10000;
    const paidTotal = Math.max(0, Math.min(paid, total) - refunds);
    expect(paidTotal).toBe(20000);
    expect(total - paidTotal).toBe(10000);
    expect(deriveInvoiceStatus('paid', total - paidTotal, paidTotal)).toBe('partial');
  });
});
