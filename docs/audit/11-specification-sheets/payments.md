# Build spec — Payments (« Paiements ») & credit notes (voir quotes-credits sheet for credits)

## 1. Menu tree
Ventes → **Paiements** (list) → payment detail. Quick-add "+" → Paiement.

## 2. Module contents
- **List**: columns n°, date, client, méthode, montant, affecté, statut; filters (client/méthode/période); row actions: voir, détail affectations, supprimer (owner/admin).
- **R4 extension point (gateway deferred, owner)**: payment state model currently completed-at-creation; before R4, introduce `pending`/`failed` states + configurable method registry (matrix §14; `16-hardcoding-audit.md` item 4) — spec row only, no build.
- **Create form**: client (required), date (required), montant (required >0), méthode (transfer/cash/cheque/card/direct debit/credit/other — French labels), référence (optional), notes.
- **Allocation panel**: list of the client's open invoices (sent/partial with balance >0) each showing balance; either auto-apply (oldest first, capped) or manual amounts; total allocated cannot exceed payment amount nor any invoice balance (`exceeds_amount` / `AMOUNT_EXCEEDS_BALANCE` — verified `01` MG-F).
- **Payment detail**: allocations with invoice numbers and amounts; activity.
- **Bank reconciliation alternative** (Banque module): imported transaction → "rapprocher" → creates the same allocation.

## 3. Rules
- GIVEN payment amount allocated WHEN confirm THEN invoice status recomputed (partial/payée) atomically.
- GIVEN paid invoice WHEN allocation attempted THEN refused (can't over-pay a paid invoice `[EXECUTED]`).
- GIVEN delete of payment WHEN confirmed (owner/admin) THEN allocations removed, invoices recomputed, activity logged.
- Refunds: NOT via payment refund endpoints (OQ-012 → credit notes).

## 4. Verdicts
Manual payments + allocations + bank-match: `CONFORMING` [EXECUTED]. Refunds standalone: `NOT-APPLICABLE` (OQ-012). Gateway rows: `DEFERRED (owner decision)` R4 (supersedes NOT-APPLICABLE — OQ-008 update 2026-10-28). Receipts/proof attachments R2 (OQ-009).
