/**
 * Bank matching rules (T-204). Pure and deterministic so the suggestion list can
 * be unit-tested: the route only loads the candidates and persists the outcome.
 *
 * Two rules, as the bank sheet asks: **amount equals** and **label contains**.
 * They are additive — a transaction whose label carries the invoice number *and*
 * whose amount matches scores highest — and the reason list is kept so the screen
 * can say why a line was proposed instead of showing an unexplained ranking.
 */

export interface MatchTransaction {
  amount: number;
  label: string;
  reference?: string | null;
}

export interface MatchCandidate {
  id: string;
  number: string;
  client_name: string | null;
  balance: number;
  date: string;
}

export interface MatchSuggestion {
  invoice_id: string;
  number: string;
  client_name: string | null;
  balance: number;
  date: string;
  score: number;
  reasons: string[];
}

const MAX_SUGGESTIONS = 5;
// A partial amount on its own (20) is noise: nearly every invoice would match
// every smaller transfer. It only becomes a proposal once the label confirms it.
const MIN_SCORE = 40;

function normalise(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function contains(haystack: string, needle: string): boolean {
  const target = normalise(needle).trim();
  if (target.length < 3) return false;
  return normalise(haystack).includes(target);
}

/**
 * Only an incoming amount can settle an invoice, and only an invoice that still
 * carries a balance can be settled: proposing a fully paid document would be the
 * first step to paying it twice.
 */
export function suggestMatches(
  transaction: MatchTransaction,
  candidates: readonly MatchCandidate[],
): MatchSuggestion[] {
  if (transaction.amount <= 0) return [];
  const haystack = `${transaction.label} ${transaction.reference ?? ''}`;

  const suggestions: MatchSuggestion[] = [];
  for (const candidate of candidates) {
    if (candidate.balance <= 0) continue;
    const reasons: string[] = [];
    let score = 0;

    if (candidate.balance === transaction.amount) {
      score += 60;
      reasons.push('amount_exact');
    } else if (candidate.balance > transaction.amount) {
      // A smaller transfer against a larger balance is a legitimate partial
      // payment, so it stays a candidate — just a weaker one.
      score += 20;
      reasons.push('amount_partial');
    }

    if (contains(haystack, candidate.number)) {
      score += 50;
      reasons.push('number_in_label');
    }
    if (candidate.client_name && contains(haystack, candidate.client_name)) {
      score += 20;
      reasons.push('client_in_label');
    }

    if (score < MIN_SCORE) continue;
    suggestions.push({
      invoice_id: candidate.id,
      number: candidate.number,
      client_name: candidate.client_name,
      balance: candidate.balance,
      date: candidate.date,
      score,
      reasons,
    });
  }

  return suggestions
    .sort((a, b) => b.score - a.score || a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
    .slice(0, MAX_SUGGESTIONS);
}

export interface LedgerDocument {
  date: string;
  kind: 'invoice' | 'payment' | 'expense';
  reference: string;
  label: string;
  /** Money coming in (a client invoice issued). */
  debit: number;
  /** Money going out or already collected (payment, expense). */
  credit: number;
}

export interface LedgerEntry extends LedgerDocument {
  balance: number;
}

/**
 * The bank sheet's ledger row: every document, chronologically, with a running
 * balance. Invoices open the receivable, payments and expenses close it; the
 * balance starts from the account's opening balance so the last line is what the
 * account should hold.
 */
export function buildLedger(
  documents: readonly LedgerDocument[],
  openingBalance: number,
): LedgerEntry[] {
  let balance = openingBalance;
  const ordered = [...documents].sort(
    (a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference),
  );
  return ordered.map((document) => {
    balance += document.debit - document.credit;
    return { ...document, balance };
  });
}
