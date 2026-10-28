# Build spec — Invoices (menu « Factures »)

Written so a developer who has never seen Invoice Ninja can build the same result on any stack. Verdicts reference `05-parity-matrix.md`.

## 1. Menu tree
- Ventes → **Factures** → list; from it: **Nouvelle facture** (create/edit), detail page per invoice.
- Global: quick-add "+" → Facture.

## 2. Module contents
- **List**: columns n° facture, client, date, échéance, statut (brouillon/envoyée/partielle/payée/annulée + calculés impayée/en retard), total; filters client/statut/période; actions per row: voir, PDF, dupliquer, annuler, marquer payée (role-gated); bulk actions (mark sent/paid, delete) on server (`POST /invoices/bulk` parity — verify UI wiring in pass 3).
- **Numérotation — R-A CONFLICT (2026-10-28)**: the API exposes ONE shared number pattern for all entities and hard-codes prefixes FAC/DEV/AV/REG (`16-hardcoding-audit.md` item 2). Target: per-entity editable pattern + prefix (CC-RA-1, R1) — sheet claim 'per entity' relaxed to PARTIAL.
- **Create/Edit**: client search-select (required), date (required, default today), échéance (auto = date + payment_terms if empty), lines editor (description free text or prefill from product, quantity > 0, unit price, TVA rate per line from company rate list; discount line- or doc-level percent/amount; notes/terms/footer from settings; TVA status for exempt lines per BK-001).
- **Totals panel** (shared component): subtotal HT, discount, TVA per bucket, TTC — updates as user types; identical arithmetic to server (`computeTotals`).
- **Detail**: header (number, status chip, dates, client), lines table, totals, payments list (allocations), credits applied, activity history (who/when), action buttons by status: Envoyer (DRAFT), Marquer payée (if not full), Appliquer un avoir, Dupliquer, Annuler, PDF, Supprimer (owner/admin only).
- **PDF**: print layout with company block (name, address, Tahiti number, RCS, TVA regime mention), client block, lines + totals buckets, footer + legal notes; French throughout.

## 3. Flows
1. Create → numbered automatically (sequence, `{prefix}-{YYYY}-{####}`) as DRAFT → Editable until sent.
2. Envoyer → status envoyée (+sent date); blocked afterwards (409 in API; button disabled).
3. Payments arrive (manual payment or bank match or mark-paid) → partial/payée with zero balance.
4. Cancel → only when no payments; audit entry written.
5. Delete → soft-hidden (admin/owner); number gap register (BK-005).

## 4. Rules (GIVEN/WHEN/THEN)
- GIVEN sent invoice WHEN second send THEN error "facture déjà envoyée".
- GIVEN totals inconsistent with line edits/server, WHEN saved, THEN server recomputes and stores canonical totals (client preview informational only).
- GIVEN paid invoice WHEN mark-paid again THEN refusal.
- GIVEN invoice dated in closed period WHEN save THEN refusal with period name.

## 5. Verdicts (per 05)
- list/flow core: `CONFORMING`; overdue/expired chips: `PARTIAL` (BK-004); reverse & delivery note: `MISSING`; attachments: `MISSING`; email dispatch: `PLATFORM-DEPENDENT` (OQ-002).
