# 06 — Correction backlog (functional terms, Freebuff stack respected)

Every row is a user-visible gap or defect derived from `05-parity-matrix.md` / `03-business-rules.md` / findings in `07`. No re-platforming suggestions. Severity: Blocker/Major/Minor/Cosmetic. Polynesia relevance: Critical/High/Medium/Low/None. Complexity S/M/L/XL. MoSCoW: Must/Should/Could/Won't. Releases: R1 (compliance-critical + document-lifecycle essentials), R2 (productivity & controls), R3 (nice-to-have / platform-dependent capabilities pending owner answers).

## R1 — Compliance & core lifecycle

| ID | Item (from parity row) | Reason | Sev | PF rel. | Cmplx | MoSCoW | Recommendation (plain words) | Acceptance criteria (GIVEN/WHEN/THEN) |
|---|---|---|---|---|---|---|---|---|
| BK-001 | Exonéré modelled as 0% slab instead of a status (PAR-LOC-001, PF-TVA-001/002) | DICP distinguishes taxable vs exempt vs franchise; a 0% line labelled "Exonéré" is not the legal presentation | Blocker | Critical | M | Must | Introduce a TVA status on documents/lines (taxable / exonéré / franchise) shown on PDF and reports; keep the three rates for taxable lines; franchise sentence stays company-driven | GIVEN an exempt line WHEN printed and reported THEN no TVA bucket shows a 0% "rate" — the line reads as exempt; GIVEN franchise company WHEN invoice prints THEN "TVA non applicable, franchise en base" appears |
| BK-002 | No reminders / no computed late fees (PAR-INV-012) | Default terms promise 10% + 5 000 XPF — currently phantom | Major | High | L | Must | Add overdue tracking + reminder log + optional late-fee line per settings, controlled by owner | GIVEN a sent invoice past due WHEN the reminder cycle runs (scheduled trigger) THEN a reminder is logged and, if enabled, a late fee line is added ≤ legal cap |
| BK-003 | Recurring invoices not auto-generated (PAR-REC-001) | Owner FRD-04 wants an engine; today manual /run | Major | High | M | Must | Scheduled trigger for recurring runs (+ reminders; same capability) | GIVEN an active recurring model WHEN its next date passes THEN a child invoice exists with correct number/date |
| BK-004 | Quote auto-expiry & unpaid/overdue status chips (PAR-QUO-001, PAR-INV-001) | Lifecycle parity | Minor | Medium | S | Should | Computed statuses (overdue/unpaid/expired) derived from dates in list/detail | GIVEN a quote past valid_until WHEN listed THEN it shows "expiré" state |
| BK-005 | Number gap register (BR-NUM-011) | Auditor evidence | Minor | High | S | Should | Record soft-deletes with their number as gap rows in a register view | GIVEN a deleted invoice number WHEN the register is opened THEN the gap appears with reason/user |
| BK-006 | Refunds on payments (PAR-PAY-002) | Real-world need | Major | Medium | M | Should | Partial/full refund action creating reverse allocation + payment status | GIVEN a paid invoice WHEN refund 1/3 THEN invoice balance restores, payment shows partially refunded |

## R2 — Productivity & controls

| ID | Item | Sev | PF rel. | Cmplx | MoSCoW | Recommendation |
|---|---|---|---|---|---|---|
| BK-010 | Attachment/document storage per entity (PAR-INV-010, PAR-EXP-003, PAR-OUT-003) | Major | Low | M | Should | File storage capability on platform (R2 bucket) + upload buttons per document/expense/client |
| BK-011 | CSV export of lists/reports (PAR-REP-001) | Major | Medium | S | Should | Export button generating CSV of current filter |
| BK-012 | CSV import (clients/products/invoices) (OQ-015) | Major | Medium | M | Should | Import wizard with preview + error listing |
| BK-013 | Kanban/task board + "invoice selected tasks" (PAR-PRJ-001/002) | Minor | Low | M | Could | Drag statuses; batch-invoice billable tasks |
| BK-014 | Rule-based bank matching (PAR-BANK-002) | Minor | Low | M | Could | Simple rules (label contains / amount equals) |
| BK-015 | SVG design/PDF layout variants (PAR-OUT-001) | Minor | Low | L | Could | Second layout selection per document type |
| BK-016 | Expense categories management (PAR-EXP-001) | Minor | Low | S | Should | Manage category list instead of fixed enum |

## R3 — Depends on owner answers (verdicts pending)

| ID | Item | Gate |
|---|---|---|
| BK-020 | Client portal (PAR rows equality) | OQ-001 |
| BK-021 | Outbound email + templates + history (PAR-OUT-002) | OQ-002 |
| BK-022 | Scheduled automation beyond recurring (reminders/exports) | OQ-003 |
| BK-023 | Payment gateways/tokens/auto-billing | OQ-008 |
| BK-024 | Recurring expenses | owner |
| BK-025 | Tags/locations/custom fields/groups | OQ-010/011 |
| BK-026 | Multi-language | OQ-014 |
| BK-027 | OAuth/SSO/passkeys | priority decision |
| BK-028 | Retention policy enforcement | OQ-006 |

Dependencies: BK-002 and BK-003 share the scheduled-trigger capability; BK-010 precedes BK-011 export-of-attachments; BK-012 before BK-016 (categories knà). Order within R1: BK-001 → BK-003 → BK-002 → BK-004 → BK-005 → BK-006.
## Decision pass — release re-assignment per owner answers (2026-10-28)

Source: `09-open-questions.md` (ANSWERED rows) + verdict re-run in `05-parity-matrix.md` §"Verdict re-run". This section re-buckets the backlog items; the earlier R1/R2/R3 grouping above stays as history but the mapping below governs.

### Out of scope (removed from backlog)
- BK-023 payment gateways/tokenisation/auto-billing → **out of scope** (OQ-008)
- Multi-company → **out of scope** (OQ-007)
- Client portal full → replaced by "per-document public link" (OQ-001, below)
- Command palette → **out of scope** (OQ-013)
- Locations entity → **out of scope** (OQ-011)
- Standalone refund flow → **replaced by credit-notes-as-refunds** (OQ-012)

### R1 (committed; [VALIDATE LOCALLY] items to confirm with a local accountant / DICP — not legally verified)
| Item | Owner decision ref | Acceptance (GIVEN/WHEN/THEN) |
|---|---|---|
| BK-001 tax status taxable/exonéré/franchise + matching legal mention; 0% reserved for genuinely zero-rated | OQ-004 | GIVEN an exempt line WHEN printed/reported THEN it reads as exempt (no 0% bucket); GIVEN franchise company WHEN invoice prints THEN « TVA non applicable, franchise en base » |
| No-delete for issued documents (cancel/credit-note only) + full numbering register | OQ-005 (upgrades BK-005 to Must) | GIVEN an issued document WHEN delete is attempted THEN 409; GIVEN any issued number WHEN registry opens THEN every number since 1 appears (issued / cancelled / gap) |
| Delete-lock with configurable retention (default 10 years) | OQ-006 | GIVEN retained-config N WHEN an issued document older than N would be purged THEN purge refused |
| Manual reminders (in-app, no email) | OQ-020 | GIVEN overdue sent invoice WHEN reminder recorded THEN log visible in invoice history |
| Late-fee wording fixed: compute or remove from default terms | OQ-020 | GIVEN default terms WHEN saved THEN text matches what app computes (or the penalty sentence is absent) |
| CSV import clients + products (invoices later) | OQ-015 | GIVEN import file WHEN previewed THEN errors listed per row; GIVEN confirm WHEN run THEN records created with next numbers |
| CSV export of all lists | OQ-015 | GIVEN filtered list WHEN export pressed THEN CSV downloads with current filter |
| Scheduled + manual export | OQ-016 — `PLATFORM-DEPENDENT` (capability OQ-016-a) | GIVEN platform export capability WHEN schedule set THEN DB dump produced; manual button exports on demand |

### R2
- Per-document secure public link (view / PDF / accept-quote) — OQ-001
- Email sending once provider confirmed — OQ-002 `PLATFORM-DEPENDENT` (OQ-002-a); automatic reminders + late fees then — OQ-020
- Scheduled recurring run (daily, early Tahiti time) — OQ-003 `PLATFORM-DEPENDENT` (OQ-003-a)
- Attachments: expense receipts + payment proofs, max file size — OQ-009 `PLATFORM-DEPENDENT` (OQ-009-a)
- Custom fields (a few per entity) + 2–3 predefined PDF layouts — OQ-010
- User-editable expense categories + simple tags — OQ-011
- Refund UX via credit notes (link from payment) — OQ-012
- French + English with extendable i18n; no hard-coded user text — OQ-014
- Browser e2e on critical flows (quote→invoice→payment, setup wizard, numbering) — OQ-018

### R3
- Saved filters — OQ-013

### Questions that still gate work (from 09 §Still open)
OQ-015-a import source/format; OQ-002-a email provider capability; OQ-003-a scheduled-run capability; OQ-016-a export capability; OQ-009-a attachment size + storage limits.

## 2026-10-28 — owner follow-up refinements
- **OQ-015-a closed.** R1 import/export row now cites the full build spec `11-specification-sheets/import-export.md` (CSV UTF-8 `,`/`;` + XLSX if platform allows, per-entity templates with exact columns/required markers/accepted values/examples, preview-before-commit, row-level French errors, no partial silent import, round-trip export).
- **OQ-009-a proposed value: 10 MB/file** (vendor guideline, `09` evidence section). Platform ceiling UNVERIFIED → confirm before R2 or probe-upload.
- **OQ-001/OQ-007 assessments written** to `10-analyst-suggestions.md`: decisions KEPT with explicit security requirements for public links (unguessable token, expiry, revocation, access log, rate limits) and a documented revisit trigger for multi-company.
- **Out-of-scope traceability note:** items decided out of scope (OQ-007 multi-company, OQ-008 gateways, OQ-011 locations, OQ-012 separate refunds, OQ-013 palette, OQ-001 full portal) remain recorded in `05-parity-matrix.md` §"Verdict re-run" as `NOT-APPLICABLE` with their OQ citations; they may leave the backlog but stay traceable in the matrix.

## Cross-cutting backlog rows (R-A/R-B/R-C) — 2026-10-28
| ID | Item | Severity | Release | Acceptance criteria |
|---|---|---|---|---|
| CC-RA-1 | Per-entity numbering: editable pattern+prefix per document type (FAC/DEV/AV/REG current literals), existing register preserved | Major | R1 | GIVEN the settings page WHEN an admin edits the facture pattern/prefix THEN the next invoice uses it AND the number register stays gapless; GIVEN a non-admin WHEN opening the tab THEN read-only view |
| CC-RA-2 | Expense categories from settings instead of fixed enum | Major | R2 | GIVEN admin adds a category WHEN creating an expense THEN the category is accepted and displays in French; GIVEN the API receives an old enum value THEN it continues to work against the stored list |
| CC-RA-3 | Tax rate/status list de-duplication (picklist = settings CRUD) | Minor | R1 | GIVEN admin changes the TVA list WHEN creating a document line THEN only stored rates appear; existing documents keep snapshots |
| CC-RA-4 | Security settings configurable (login attempts), method list, status colours, currencies — R3/R4 | Minor | R2–R4 | GIVEN a configuration change THEN it applies without redeploy |
| CC-RB-1 | Read-only detail views + "Voir" buttons on the ~9 missing areas (pay/dépenses/fournisseurs/bons de commande/produits/projets-tâches/banque/utilisateurs/settings entries) | Major | R3 | GIVEN a row in ANY list WHEN clicking "Voir" THEN a read-only detail shows all fields, with Edit only for permitted users |
| CC-RC-1 | Admin-creatable roles (roles table + per-role permission sets + role CRUD server-enforced + journaling of permission changes) | Major | R3 | GIVEN an admin creates a role with listed permissions THEN users of the role receive exactly those server-side checks; GIVEN a non-admin attempts a role change THEN 403 + journal entry |
| CC-RC-2 | Button gating policy: buttons visible-disabled with French explanation for unauthorised users | Minor | R3 | GIVEN a user without `invoices.write` WHEN opening a facture THEN Envoyer shows disabled with the reason |
| CC-DEF-1 | R4 extension points only (portal wrapper, payment pending/failed states + method registry, locations slot, palette) — specification rows, no build | Minor | R4 | GIVEN the deferred features are taken up later WHEN implemented THEN no rework of the documents/payments core is required beyond the listed extension points |
