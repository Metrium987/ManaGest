/**
 * Q2 — which account a line posts to.
 *
 * The order was agreed with the accountant: the line wins over the article, the
 * article over its family, the family over the chart default. The resolved account
 * is written **on the journal line** when the document is posted, so changing a
 * product sheet tomorrow cannot rewrite what was posted yesterday.
 *
 * The line level is carried by the resolver from day one even though the document
 * editors do not expose it yet: adding it later must not change the order.
 */
export interface AccountSources {
  line?: string | null;
  product?: string | null;
  family?: string | null;
  fallback: string;
}

const clean = (value: string | null | undefined): string | null =>
  (typeof value === 'string' && value.trim() ? value.trim() : null);

export function resolveAccount(sources: AccountSources): string {
  return clean(sources.line) ?? clean(sources.product) ?? clean(sources.family) ?? sources.fallback;
}

import { DEFAULT_ACCOUNT_CODES } from '../../shared/accounts';

export interface RevenueShare {
  account_code: string;
  amount: number;
}

/**
 * Sum what each account carries, in first-seen order so a document always posts
 * its lines in the same order. Amounts are rounded once, here; the caller gives
 * the last bucket the remainder so the total stays exactly equal to the revenue.
 */
export function groupRevenue(
  shares: { account: string; amount: number }[],
  fallback: string = DEFAULT_ACCOUNT_CODES.sales,
): RevenueShare[] {
  const order: string[] = [];
  const totals = new Map<string, number>();
  for (const share of shares) {
    const account = share.account.trim() || fallback;
    if (!totals.has(account)) order.push(account);
    totals.set(account, (totals.get(account) ?? 0) + share.amount);
  }
  return order.map((account) => ({ account_code: account, amount: Math.round(totals.get(account) ?? 0) }));
}
