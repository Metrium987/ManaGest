import { describe, expect, it } from 'vitest';
import { buildLedger, suggestMatches, type LedgerDocument } from '../server/lib/bank-match';

const invoice = (over: Partial<Parameters<typeof suggestMatches>[1][number]> = {}) => ({
  id: 'inv-1',
  number: 'FAC-2026-0001',
  client_name: 'Mango Studio',
  balance: 120_000,
  date: '2026-10-01',
  ...over,
});

describe('bank matching rules (T-204)', () => {
  it('proposes an invoice whose amount matches exactly', () => {
    const [first] = suggestMatches({ amount: 120_000, label: 'Virement' }, [invoice()]);
    expect(first.invoice_id).toBe('inv-1');
    expect(first.reasons).toContain('amount_exact');
  });

  it('uses the invoice number in the label', () => {
    const [first] = suggestMatches(
      { amount: 50_000, label: 'VIR FAC-2026-0001 MERCI' },
      [invoice({ balance: 200_000 })],
    );
    expect(first.reasons).toContain('number_in_label');
  });

  it('also reads the reference field', () => {
    const [first] = suggestMatches(
      { amount: 10, label: 'VIR', reference: 'fac-2026-0001' },
      [invoice()],
    );
    expect(first.number).toBe('FAC-2026-0001');
  });

  it('never proposes a paid invoice, even when the label names it', () => {
    expect(suggestMatches({ amount: 120_000, label: 'FAC-2026-0001' }, [invoice({ balance: 0 })]))
      .toEqual([]);
  });

  it('ignores an outgoing amount', () => {
    expect(suggestMatches({ amount: -120_000, label: 'FAC-2026-0001' }, [invoice()])).toEqual([]);
  });

  it('ranks an exact amount above a partial one, and caps the list', () => {
    const candidates = [
      invoice({ id: 'partial', number: 'FAC-1', balance: 999_999 }),
      invoice({ id: 'exact', number: 'FAC-2', balance: 120_000 }),
      ...Array.from({ length: 8 }, (_, index) =>
        invoice({ id: `other-${index}`, number: `FAC-9${index}`, balance: 120_000 }),
      ),
    ];
    const suggestions = suggestMatches({ amount: 120_000, label: 'Virement' }, candidates);
    expect(suggestions[0].invoice_id).not.toBe('partial');
    expect(suggestions.length).toBeLessThanOrEqual(5);
  });

  it('returns nothing when neither rule fires', () => {
    expect(suggestMatches({ amount: 1_000, label: 'Frais bancaires' }, [invoice({ balance: 5_000 })]))
      .toEqual([]);
  });
});

describe('ledger running balance', () => {
  const documents: LedgerDocument[] = [
    { date: '2026-10-02', kind: 'payment', reference: 'REG-1', label: 'Encaissement', debit: 0, credit: 50_000 },
    { date: '2026-10-01', kind: 'invoice', reference: 'FAC-1', label: 'Facture', debit: 80_000, credit: 0 },
    { date: '2026-10-03', kind: 'expense', reference: 'DEP-1', label: 'Achat', debit: 0, credit: 10_000 },
  ];

  it('orders by date and carries the balance forward', () => {
    const ledger = buildLedger(documents, 100_000);
    expect(ledger.map((entry) => entry.reference)).toEqual(['FAC-1', 'REG-1', 'DEP-1']);
    expect(ledger.map((entry) => entry.balance)).toEqual([180_000, 130_000, 120_000]);
  });

  it('starts from the account opening balance', () => {
    expect(buildLedger([], 42).length).toBe(0);
    expect(buildLedger([documents[0]], 0)[0].balance).toBe(-50_000);
  });
});
