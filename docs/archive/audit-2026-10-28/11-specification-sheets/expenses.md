# Build spec — Expenses (« Dépenses »)

## 1. Menu tree
Opérations → **Dépenses** (list) → expense edit. Quick-add "+" → Dépense.

## 2. Module contents
- **List**: columns date, catégorie, fournisseur, montant (HT), TVA, total; filters (catégorie/fournisseur/période/exonérable); row actions: voir, modifier, supprimer (owner/admin); totals row for the filtered period.
- **Create/Edit form**: date (required), catégorie — R-A CONFLICT (2026-10-28): current server enum hard-coded (`16-hardcoding-audit.md` item 1); target per OQ-011+R-A = user-editable category list in settings (CC-RA-2, R2) — verdict DIFFERS, montant HT (required >0), montant TVA, fournisseur (optional, validated), mode de paiement (same modes as payments), facturable à un client (billable flag), notes; receipt attachment (R2: OQ-009 — configurable limit, default 10 MB per file, administrator-adjustable in settings, capped by the platform ceiling when known; image/PDF).
- **Re-invoicing**: expenses marked billable can be surfaced as lines when drafting an R2-era invoice from a client (behavior target mirrors baseline docs; current app stores is_billable + invoice_id — the pick-and-add UI is the R2 item).

## 3. Rules (GIVEN/WHEN/THEN)
- GIVEN closed month WHEN expense dated inside THEN refused (PERIOD_LOCKED) `[EXECUTED]`.
- GIVEN billable expense WHEN attached to an invoice THEN it cannot be double-invoiced (binding recorded).
- GIVEN receipt upload WHEN file > 10 MB or wrong type THEN rejected with French message.

## 4. Verdicts
Core CRUD: `CONFORMING` `[OBSERVED/EXECUTED]`. Categories editable: `PARTIAL` → R2 (OQ-011). Receipts: `MISSING` → R2 (OQ-009). Recurring expenses: out of scope lifted? — baseline has them; owner has not requested → `NOT-APPLICABLE` pending owner (kept in 05).
