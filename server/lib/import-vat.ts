import { DEFAULT_ACCOUNT_CODES, type AccountCodes } from '../../shared/accounts';
import type { DraftLine } from './accounting';

/**
 * Q1 — the import VAT entry.
 *
 * Import VAT is due at clearance, not when the broker sends his invoice: the
 * customs office collects it through the commissionnaire. It is deductible for a
 * business under the real regime, so it debits 445660 and credits whoever
 * advanced the money — the transitaire (401) or the bank when the business pays
 * the customs office directly.
 *
 * A business under the franchise en base cannot deduct it: the VAT is not on the
 * books at all, it belongs to the cost of the goods (the landed cost sheet already
 * carries it there), so no line is returned. Posting it to 445660 anyway would
 * invent a deductible VAT that the VAT return cannot claim.
 */

/** Where the disbursed VAT is owed. */
export type VatSettlement = 'supplier' | 'bank';

/** Default deductible-VAT account; the effective code is a workspace setting. */
export const VAT_ON_IMPORTS = DEFAULT_ACCOUNT_CODES.vatDeductible;

export function importVatLines(input: {
  vat: number;
  recoverable: boolean;
  settlement: VatSettlement;
  productName: string;
  reference: string;
  accounts?: AccountCodes;
}): DraftLine[] {
  const accounts = input.accounts ?? DEFAULT_ACCOUNT_CODES;
  const vat = Math.round(Number(input.vat) || 0);
  if (!input.recoverable || vat <= 0) return [];

  const label = `TVA à l’import ${input.reference} — ${input.productName}`;
  return [
    { account_code: accounts.vatDeductible, label, debit: vat, credit: 0 },
    { account_code: input.settlement === 'bank' ? accounts.bank : accounts.supplier, label, debit: 0, credit: vat },
  ];
}
