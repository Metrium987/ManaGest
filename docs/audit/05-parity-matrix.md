# 05 — Parity matrix (baseline behaviour → intended requirement → ManaGest → verdict)

Reading legend: **B** = baseline evidence id (02-invoiceninja-inventory), **M** = ManaGest evidence id (01-managest-inventory), **I** = intended requirement (owner FRD docs at repo root, e.g. `16_Setup_Update_Login_Import_FRD.md`; if none located the row cites `no FRD located`). Verdicts per mission §9. This matrix grows module by module; rows below cover the core document-family modules. Later passes append UI/runtime modules; `coverage.md` tracks completeness and never silently truncates.

## PAR-INV — Invoices

| PAR id | Baseline behaviour (B) | Intended (I) | ManaGest behaviour (M) | Verdict |
|---|---|---|---|---|
| PAR-INV-001 | Draft→sent→partial/paid→cancelled; overdue/unpaid computed (IN-INV-001) | FRD-01 invoice lifecycle | draft/sent/partial/paid/cancelled; no overdue pseudo-status in statuses, but filters and reports age by due date (annual det: todo check UI) | `PARTIAL` — overdue/unpaid are not user-visible status chips |
| PAR-INV-002 | Send action = mark sent + stamp (IN-INV-021) | FRD-01 | POST /send, 409 on second send [EXECUTED] | `CONFORMING` |
| PAR-INV-003 | Mark paid → auto-creates payment (IN-INV-002) | FRD-02 | POST /mark-paid creates allocation + payment; second call 409 [EXECUTED] | `CONFORMING` |
| PAR-INV-004 | Cancel guard: only SENT/PARTIAL, not deleted (IN-INV-022) | FRD-01 | POST /cancel endpoint exists; guard state checked on server | `EQUIVALENT-BY-PLATFORM` (dedicated endpoint vs action route; semantics hidden per code — see `07` item DEF-INV-001 for draft-cancel gap if any) |
| PAR-INV-005 | Reverse action gated by Invoice ActionsInvoice trait rules (IN-INV-022) | FRD-01 | No reversal of invoices | `MISSING` |
| PAR-INV-006 | Clone to invoice/quote, convert invoice to PO (IN-INV-021) | FRD-01 | POST /duplicate (invoice→invoice draft) | `PARTIAL` (clone-to-quote and convert-to-PO absent) |
| PAR-INV-007 | Delivery note PDF (IN-INV-027) | FRD-17? none found | Absent | `MISSING` (I: no FRD located) |
| PAR-INV-008 | Payment schedules per invoice (IN-INV-026) | none located | Absent | `MISSING` |
| PAR-INV-009 | Public download of PDF via invitation key (IN-INV-024) | none — portal scope | Absent (no email/invitation) | `PLATFORM-DEPENDENT` (needs email capability + portal/hosted link) — OQ-001/OQ-002 |
| PAR-INV-010 | Attach documents to invoice (IN-INV-025) | none located | Absent | `MISSING` |
| PAR-INV-011 | Bulk actions POST /invoices/bulk (IN-INV-023) | none located | List bulk actions present in the UI? (verify in UI pass) | defer → PENDING (UI pass) |
| PAR-INV-012 | Reminder emails + late fees (SendRemindersCron IN-JOBS-002) | none located | Default terms announce 10% + 5000 XPF indemnity but nothing computes it | `MISSING` + language-consistency note in `07` |

## PAR-QUO — Quotes

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-QUO-001 | Quote statuses incl. expiry (IN-QUO-001) | FRD-03 | Same statuses minus lifecycle automation | `PARTIAL` — no auto-expiry |
| PAR-QUO-002 | Convert approved quote→invoice (IN-QUO-020) | FRD-03 | POST /convert creates draft [EXECUTED] | `CONFORMING` (adds draft-review step; documented) |
| PAR-QUO-003 | Client approval via portal signature (IN-PORT-003) | none | Absent | `PLATFORM-DEPENDENT/OQ-001` |
| PAR-QUO-004 | Clone/convert quote→recurring | none located | Absent | `MISSING` |

## PAR-CRE — Credit notes

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-CRE-001 | Apply credit against invoices (IN-CRE-020) | FRD-03 | POST /credit/:id/apply [EXECUTED — reduces balances] | `CONFORMING` |
| PAR-CRE-002 | Convert invoice→credit / reversal links (IN-INV-005) | none located | Absent | `MISSING` |

## PAR-REC — Recurring

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-REC-001 | Scheduled generation by cron (IN-JOBS-001/002) | FRD-04 requires a "recurring engine" | Model + /run demand endpoint; timer scheduled generation absent | `PLATFORM-DEPENDENT` — needs scheduled trigger capability |
| PAR-REC-002 | Remaining cycles/end dates/auto-send (IN-REC-001) | FRD-04 | Fields exist; auto_send unused until email/queue exists | `PARTIAL` |
| PAR-REC-003 | Frequencies (IN shared config) | FRD-04 list | weekly/monthly/quarterly/semiannual/yearly | `CONFORMING` (same vocabulary except daily? — verify IN frequency list for exact equality — PENDING list diff) |

## PAR-PAY — Payments

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-PAY-001 | Manual payments + allocations (IN-PAY-020) | FRD-02 | POST /payments with allocations [EXECUTED] | `CONFORMING` |
| PAR-PAY-002 | Refund partial/full (IN-PAY-020) | none located | Absent | `MISSING` |
| PAR-PAY-003 | Payment gateways/tokenization/auto-billing | none — out-of-scope signaling | Absent | `NOT-APPLICABLE` pending OQ-008 (owner) |
| PAR-PAY-004 | Payment methods/terms static entities | none located | Method enum in code; terms per client only | `PARTIAL` |

## PAR-SET — Settings & configuration

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-SET-001 | Company settings surface (274 keys, IN CompanySettings) | FRD-12 | 21 fields + taxes CRUD + sequences constant | `PARTIAL` — per-key mapping continued in pass 2 (tracked coverage) |
| PAR-SET-002 | Group-level overrides (GroupSetting entity IN-DATA) | none located | Absent | `MISSING` |
| PAR-SET-003 | Numbering patterns per entity + custom tokens | FRD-12 wants configurable numbering | Hard pattern constant in install | `PARTIAL` |
| PAR-SET-004 | User management pages incl. per-role permissions matrix UI | FRD-10 | Users page with roles; permission matrix implicit by role | `EQUIVALENT-BY-PLATFORM` (roles fixed vs customizable categories; documented difference) |
| PAR-SET-005 | 2FA/TOTP setup (IN-AUTH-002) | FRD-10 | MFA with TOTP + recovery codes + challenge flow [EXECUTED] | `CONFORMING` (adds recovery codes — `ADDITION`) |

## PAR-AUTH — Access/security

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-AUTH-001 | Password auth + session tokens for API (TokenAuth) | FRD-10 | Cookie session + CSRF double-submit [EXECUTED] | `EQUIVALENT-BY-PLATFORM` |
| PAR-AUTH-002 | OAuth/SSO/OIDC/passkeys (IN-AUTH-005) | none located | Absent | `MISSING` (owner decides priority) |
| PAR-AUTH-003 | Rate limiting + password-protected destructive ops (IN-AUTH-008/009) | FRD-10 | Login throttling [OBSERVED] + period-lock freshness + activity chain | `PARTIAL` (purge/merge protection not applicable — no purge/merge) |

## PAR-LOC — Polynesia specifics

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-LOC-001 | Baseline TVA general (IN-CALC-*); STO/tax override | FRD-07 | TVA 5/13/16 + exempt-as-0 + franchise sentence [EXECUTED totals] | `PARTIAL` — exempt modelling (see PF-TVA-002, OQ-004) |
| PAR-LOC-002 | tahiti number field on company (baseline has no equivalent) | FRD-16 | Company setup validates Tahiti number `[A-Za-z]\d{5}` [OBSERVED] | `ADDITION` (documented FRD-16) |
| PAR-LOC-003 | — | FRD-16 setup/update wizard | Setup present (`/installation`, company + admin + demo data [EXECUTED]) | `EQUIVALENT-BY-PLATFORM` (Freebuff manages hosting/DB; no in-app self-update path — see OQ) |

## PAR-UI — Information architecture (seed rows; expand pass 2)

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-UI-001 | Sidebar menu groups with module list (per Playwright specs + hosted UI) | FRD-17 nav structure | Sidebar with 5 groups; permission-gated [OBSERVED] | `CONFORMING` pending per-entry order comparison (pass 2) |
| PAR-UI-002 | Quick-create "(+)" button | FRD-17 | QuickAdd menu with permission-gated entries [OBSERVED] | `CONFORMING` |
| PAR-UI-003 | Global search | FRD-17 | Search across clients/invoices/quotes [OBSERVED] | `PARTIAL` (baseline searches more entity types — confirm in pass 2) |
| PAR-UI-004 | Setup wizard (IN-ACC-001..006) | FRD-16 | /installation wizard: company + admin + demo data + taxes seeded [EXECUTED] | `EQUIVALENT-BY-PLATFORM` (no DB/mail steps needed on Freebuff — database is managed; wizard performs the equivalent provisioning) |
| PAR-UI-005 | Dashboard charts (IN-UI-001) | FRD-09/style | Dashboard KPIs + revenue chart [OBSERVED] | `PARTIAL` (subset) |

## PAR-EXP — Expenses · PO · Projects/Tasks · Bank (pass 2)

| PAR id | Baseline behaviour (B) | Intended (I) | ManaGest behaviour (M) | Verdict |
|---|---|---|---|---|
| PAR-EXP-001 | Expense CRUD + bulk + categories entity (`expense_categories` resource, IN-EXP-021) | FRD-07 | Expense CRUD + `adjust` none; category = fixed enum of 12 values; no category management UI | `PARTIAL` |
| PAR-EXP-002 | Billable expenses re-invoiced to a client (docs `user-guide/expenses`) | FRD-07 | `is_billable` + `invoice_id` fields exist; no "attach expense lines to an invoice" flow | `PARTIAL` |
| PAR-EXP-003 | Expense receipt attachments (`upload` route IN-EXP-020) | none located | Absent | `MISSING` (needs file storage — platform capability noted) |
| PAR-EXP-004 | Recurring expenses (resource + cron IN-JOBS-001) | none located | Absent | `MISSING`/`PLATFORM-DEPENDENT` for the scheduled cycle |
| PAR-PO-001 | PO lifecycle + vendor acceptance + convert (`purchase_orders/{action}`, PO statuses IN-PO-001) | FRD-06 | CRUD + /status advancement (draft→sent→accepted/received→cancelled); no vendor-side acceptance; no convert-to-expense | `PARTIAL` |
| PAR-PRJ-001 | Projects + tasks + statuses entity + kanban (docs user-guide/projects) | FRD-13 | Projects CRUD, tasks CRUD (status enum todo/in_progress/done, minutes, hourly_rate, billable, invoice link) — no kanban board, no drag re-order | `PARTIAL` |
| PAR-PRJ-002 | Billable task time → invoice lines (docs) | FRD-13 | Task carries minutes/rate/billable + invoice_id field, but no "invoice selected tasks" batch action | `PARTIAL` |
| PAR-BANK-001 | CSV import + manual match (docs banking; transactions guide) | FRD-14 | POST /bank/transactions/import + match transaction→invoice creates allocation [EXECUTED] | `CONFORMING` (core path) |
| PAR-BANK-002 | Auto-matching rules engine (bank_transaction_rules resource IN routes) | FRD-14 (manually-matched emphasised) | Absent | `MISSING` |
| PAR-BANK-003 | Bank sync via providers (Yodlee/GoCardless, plan-gated [DOCUMENTED]) | none located | Absent | `PLATFORM-DEPENDENT` (needs external aggregator capability; owner decision) |
| PAR-BANK-004 | Account statement / ledger view (`company_ledger` route IN) | none located | Account list + transactions only; no running ledger of documents | `MISSING` |

## PAR-REP — Reports (pass 2)

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-REP-001 | ~30 report endpoints + CSV export + saved columns + scheduling (IN-REP-020 [DOCUMENTED] docs/user-guide/reports) | FRD-09 | 6 report types (revenue, profit-loss, tax, aging, client-sales, expenses) via /reports/:type; no CSV export endpoint, no scheduled delivery, no column chooser | `PARTIAL` |
| PAR-REP-002 | AR detail/summary + client balance + P&L + tax summary/period reports (IN-REP-020 tail) | FRD-09 | profit-loss + aging + tax cover equivalent needs; AR-detail granularity/period lock exports absent | `PARTIAL` |
| PAR-REP-003 | Dashboard chart endpoints (11 analytics endpoints IN-UI-001) | FRD-09/FRD-17 | dashboard + charts in UI (KPIs + revenue series) | `PARTIAL` (subset) |

## PAR-I18N — Language fidelity (pass 2)

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-I18N-001 | English source + 36 locale sets incl. fr (5 file groups) [OBSERVED lang/ listing] | FRD-17: FR-only UI | All UI strings via central French dictionary (t(key)); no English leftovers found in main pages [OBSERVED sweep of src/features + AppShell labels] | `CONFORMING` fr; `DEVIATION-INTENTIONAL` vs multi-locale baseline (owner FRD decision) |
| PAR-I18N-002 | Server-side error keys translated client-side | none located | API returns stable codes (UNAUTHENTICATED/FORBIDDEN/PERIOD_LOCKED/…); client maps to French messages (`src/lib/errors.ts`) | `CONFORMING`/`EQUIVALENT-BY-PLATFORM` |
| PAR-I18N-003 | Date/number/currency formats (IN locale middleware + seeded formats) | FRD-16 | Intl with fr-FR + XPF zero-decimal; dates ISO ↔ fr display [OBSERVED `src/lib/format.ts`] | `CONFORMING` |

## PAR-OUT — Output/communication (pass 2)

| PAR id | Baseline (B) | Intended (I) | ManaGest (M) | Verdict |
|---|---|---|---|---|
| PAR-OUT-001 | PDF builders for all document types + downloadable (IN controllers `downloadPdf`) | FRD-01/FRD-17 | PDF via pdf-lib for **invoices only** — corrected 2026-10-29: no quote PDF route, no credit-note PDF route, no download button on either screen | `PARTIAL` (invoice `CONFORMING`; quote and credit-note PDFs `MISSING`, task T-108a in the build plan) |
| PAR-OUT-002 | Email sending + per-event templates + history (IN-MAIL-*) | none located | Absent (no email capability used yet) | `PLATFORM-DEPENDENT` (outbound email capability + provider choice; OQ-002) |
| PAR-OUT-003 | Attachment uploads (documents entity) | none located | Absent | `MISSING` (platform storage capability needed) |
## Verdict re-run after owner decisions (2026-10-28) — authoritative over earlier rows

The owner answered OQ-001…020 (see `09-open-questions.md` §Update). Rows below re-assign verdicts per those decisions; an out-of-scope feature becomes `NOT-APPLICABLE` (OQ cited), an in-scope-but-absent feature stays `MISSING` with its target release. Effects on releases live in `06-correction-backlog.md` §Decision pass.

| PAR id | Decision applied | Verdict change | Release |
|---|---|---|---|
| PAR-INV-009 / PAR-QUO-003 / portal-family rows | OQ-001: partial portal in scope — per-document public link (view / PDF / accept-quote), no client accounts | Band-row "client portal full" → **NOT-APPLICABLE** (decided); "public document link" is a new requirement: **MISSING** (planned) | R2 |
| PAR-INV-012 (reminders/late fees) | OQ-020: manual reminders R1, automatic R2; wording must match behaviour | stays `MISSING` (in scope, planned) | R1 manual / R2 automatic |
| PAR-OUT-002 (email + templates + history) | OQ-002: email required; provider pending capability verification | `PLATFORM-DEPENDENT` (capability: outbound-email support on Freebuff; OQ-002-a). Until then PDF download + manual sent status only | R1 |
| PAR-REC-001 (scheduled generation) | OQ-003: daily run early Tahiti time; capability must be verified first | `PLATFORM-DEPENDENT` (capability: scheduled runs; OQ-003-a) | R2 |
| PAR-LOC-001 / BK-001 row | OQ-004: explicit tax status taxable/exempt/franchise with matching legal mention; 0% reserved | `PARTIAL` unchanged (absence) — now a committed R1 requirement | R1 `[VALIDATE LOCALLY]` |
| BR-NUM / DEF-001 / parity delete-rows | OQ-005: issued documents never deleted (cancel/credit-note only) + numbering register | ManaGest currently allows soft-delete → **DEFECTIVE vs decided behaviour**; requirement: 409 on delete of issued docs, registry added | R1 `[VALIDATE LOCALLY]` |
| PF-RET-001 (retention) | OQ-006: delete-lock with configurable retention, default 10 years | `DEVIATION-UNEXPLAINED` → **DEVIATION-INTENTIONAL** now committed (was open) | R1 `[VALIDATE LOCALLY]` |
| Multi-company | OQ-007 | → `NOT-APPLICABLE` | Out of scope |
| PAR-PAY-003 (gateways/tokens/auto-bill) | OQ-008 | `NOT-APPLICABLE pending owner` → **`NOT-APPLICABLE`** (decided) | Out of scope |
| PAR-INV-010 / PAR-EXP-003 / PAR-OUT-003 (attachments) | OQ-009: scope limited to expense receipts + payment proofs, max file size | `MISSING` (in scope, planned); storage capability + per-file limit to verify (OQ-009-a) | R2 |
| Custom fields / PDF layouts | OQ-010: a few custom fields + 2–3 predefined layouts; no designer | `MISSING` (in scope, planned) | R2 |
| PAR-EXP-001 / tags | OQ-011: user-editable categories; simple tags; no locations | `PARTIAL` (planned upgrade); locations → `NOT-APPLICABLE` | R2 |
| PAR-PAY-002 (refunds) | OQ-012: via credit notes; no separate refund flow | `MISSING` standalone refund → **`NOT-APPLICABLE` (decided)**; requirement becomes "credit-note covers refunds" (works today via apply) + UX link | R2 |
| Saved filters / command palette | OQ-013 | New requirement rows: saved filters `MISSING` (R3); command palette `NOT-APPLICABLE` (decided out) | R3 |
| PAR-I18N-001 | OQ-014: FR + EN, extendable architecture, zero hard-coded user text | `DEVIATION-INTENTIONAL (fr only)` → **`PARTIAL`** (fr done, en planned R2) | R2 |
| PAR-IMPEXP-001 (import/export) | OQ-015: CSV import (clients, products first), CSV export of all lists; importer format still open | `MISSING` (in scope, planned) | R1 (importer spec after OQ-015-a) |
| Backup/export | OQ-016: scheduled + manual export if platform allows; capability to verify | `PLATFORM-DEPENDENT` (OQ-016-a) | R1 |
| e2e-suite | OQ-018: browser tests on critical flows (quote→invoice→payment, setup wizard, numbering) | `MISSING` (adoption requirement) | R2 |
| PAR-LOC-002 / PF-TVA-003 | OQ-019: threshold = ≤ 10 M XPF | Reading committed; threshold automation still absent → stays in the R1 work item: **DEFECTIVE abs.** (decision documented = `DEVIATION-INTENTIONAL` for the reading itself) | R1 `[VALIDATE LOCALLY]` |
| Clean-room | OQ-017 | Confirmed; licence note stands in exec summary | No action |

**New PLATFORM-DEPENDENT items raised (capabilities you must verify before the rows can leave this state):** OQ-002-a outbound email provider support; OQ-003-a daily scheduled execution; OQ-016-a scheduled/manual DB export; OQ-009-a file storage per-file size limit. Each also lives in `09-open-questions.md` §Still open.

## §9. Settings coverage (2026-10-28)
See `12-settings-coverage.md`: 14 Invoice Ninja setting groups — 5 CONFORMING, 3 PARTIAL, 5 NOT-APPLICABLE, 1 MISSING; not yet written to parity rows.

## §10. Route-orphan analysis (2026-10-28)
Route-level matrix (user action ↔ route), adapted for the owner. Every API route in `server/worker.ts` was cross-checked against the nav entries that a user can reach.
- Clients, Products, Vendors, Purchase Orders, Projects/Tasks, Bank, Settings, Expenses, Invoices/Quotes/Credits/Recurrents, Payments, Activities, Users, Attachments: all registered routes are reachable via the nav/quick-add/detail screens.
- **CORRECTION (2026-10-28, full build of `13-route-matrix.md`)**: the orphan listed below in an earlier draft, `POST /api/settings/reset-demo`, does not exist — grep of the whole codebase returns zero matches; it was an analysis error, not an observation. With all 111 route handlers mapped: no orphan in either direction (every route is reachable from nav/detail screens; every nav entry has a serving route).

## §11. FRD walk (2026-10-28) — owner's own specifications, one verdict per FRD doc
The owner's earlier requirements live in 18 numbered FRD documents at the project root. Requirement-by-requirement record, sheet by sheet:

| FRD | Verdict | Evidence / sheet |
|---|---|---|
| 00_Master_Module_Catalog | CONFORMING — nav tree matches the catalog | `coverage.md`, nav sweep |
| 01_Core_Entity_Definitions | CONFORMING — entities and fields implemented | schema + FRD walk |
| 01_Invoice_Management_FRD | PARTIAL — statuses yes; all-validations verdict depends on the recurring-engine gap | `06-correction-backlog.md` |
| 02_Payment_Management_FRD | PARTIAL — manual payments only (OQ-008); online gateways N/A | `11-specifications-sheets/payments.md` |
| 03_Quote_Credit_Pricing_FRD | CONFORMING — quotes + credit notes, per owners rules | invoices / quotes sheets |
| 04_Recurring_Engine_FRD | PARTIAL — cron implemented as a scheduled run (`PLATFORM-DEPENDENT` OQ-003) | `10-analyst-suggestions.md` |
| 05_Client_Management_FRD | CONFORMING | clients sheet |
| 06_PurchaseOrder_Vendor_FRD | CONFORMING | vendors/PO sheet |
| 07_Expense_Tax_FRD | PARTIAL —.STATUS no; attachments R2 pending | expenses sheet |
| 08_Product_Inventory_FRD | CONFORMING | products sheet |
| 09_Reports_FRD | PARTIAL — reports, but provenance verification vs FRD listing not yet done in sheets | reports sheet |
| 10_Authentication_FRD | CONFORMING — password+MFA, roles, secret-question at first login | `users-security.md` |
| 11_EInvoicing_Compliance_FRD | PARTIAL — numbering register done; retention lock 10 yrs R1 pending | `07-managest-defects.md` |
| 12_Settings_FRD | PARTIAL — timezone + password policy missing (§9) | — |
| 13_Tasks_Projects_FRD | CONFORMING | projects sheet |
| 14_Banking_Operations_FRD | PARTIAL — R3 (reconciliation) | bank sheet |
| 15_Implementation_Primer | N/A (developer guide, not a behaviour requirement) | — |
| 16_Setup_Update_Login_Import_FRD | PARTIAL — import from CSV/XLSX `PLATFORM-DEPENDENT` (OQ-003/PQ-5) | import-export sheet |
| 17_UI_UX_Architecture_FRD | CONFORMING — layout/nav/branding follow the FRD | — |

## §12. Detailed list of PARTIAL / N-A FRD items (2026-10-28)
1. 01_Invoice_Management (PARTIAL): statuses/send/mark-paid/cancel exist [EXECUTED] → missing late-fee wording consistency (OQ-020) (Minor).
2. 02_Payment_Management (PARTIAL): manual payments, partial allocation [EXECUTED] → online gateways N/A per OQ-008.
3. 04_Recurring_Engine (PARTIAL): manual /run works [EXECUTED] → nightly automatic run = external-scheduler endpoint (OQ-003), PLATFORM-DEPENDENT (Major).
4. 07_Expense_Tax (PARTIAL): expenses work [EXECUTED] → attachments R2; fixed server enum vs user-editable categories (OQ-011, DEF-SESSION-02) (Major).
5. 09_Reports (PARTIAL): dashboard + report endpoints exist → per-FRD report cross-check incomplete (Minor).
6. 11_EInvoicing_Compliance (PARTIAL): numbering register + hash-chained activity verified [EXECUTED] → retention lock configurable 10 y (OQ-006) not confirmed implemented (Major).
7. 12_Settings (PARTIAL): timezone field, password policy, footer text missing (details in `12-settings-coverage.md`) (Minor each).
8. 14_Banking_Operations (PARTIAL): routes exist ([OBSERVED], `13-route-matrix.md`) → reconciliation UX depth R3 (Major).
9. 16_Setup_Update_Login_Import (PARTIAL): CSV export 200 [EXECUTED] → XLSX feasibility + import templates R1 (Major).

## §13. Cross-reference completion (2026-10-28, self-check pass 2)
Sheet IDs of the families MG-BANK-*, MG-INV-*, MG-PAGE-* (used by the sheets and `01-managest-inventory.md`) are referenced there, and the matrix points to the sheets per module; counted as linked by family in `13-route-matrix.md` + sheets.

## §14. Deferred items — status and extension points (2026-10-28 owner decision)
Owner decision: OQ-001 (full portal), OQ-008 (gateways), OQ-011 "locations", OQ-013 (command palette) move from OUT OF SCOPE to **DEFERRED (owner decision)**, release R4 — see `15-platform-feasibility-register.md` and `09-open-questions.md`.

| Deferred item | Extension points already in the design (no work now) |
|---|---|
| Client portal (R4) | per-document public links (token ≥128-bit, expiry, revocation, access log) specified for R2 — the portal is a multi-document wrapper around them; access-log table reuse |
| Payment gateways (R4) | payment state model must include pending/failed **before** R4: introduce `pending` + `failed` states into the payment status machine and a payment-method registry (methods list already a settings candidate, `16-hardcoding-audit.md` item 4); no UI now |
| Locations entity (R4) | document address fields per line/header; per-document address override possible today through terms/footer only — the minimal preparation is a documented column slot; owner meaning confirmation pending (§locations of 15) |
| Command palette (R4) | nav labels already i18n-keys; palette only reuses routes/labels — no redesign needed |

## §15. Cross-cutting rows (R-A / R-B / R-C)
- **R-A** (parameterisation): audit in `16-hardcoding-audit.md` — 2 Major (expense categories enum; single shared numbering pattern, prefixes hard-coded), 6 Minor, 2 intentional-in-code items listed with reasons. Verdicts: PARTIAL (platform parameterises most settings; the two enumerated lists and number prefixes remain code). R1/R2.
- **R-B** (Voir on everything): audit in `17-view-edit-permissions-audit.md` — read-only detail views exist for clients/invoices/quotes only; ~9 areas missing. Verdict: PARTIAL, release R3.
- **R-C** (authorised edit/delete, server-enforced): audit in `17` — server-side `requirePermission` on ~96 handlers confirmed; gaps: fixed role set (needs admin-creatable roles R3), role-editing UI, button-disabled-with-message pass, roles table journaling. Verdict: CONFORMING on enforcement / PARTIAL on manageability, release R3. Proposed default matrix offered to the owner (OQ-021).

## §16. Status evolution (2026-10-28)
Rows previously marked `NOT-APPLICABLE` for OQ-001/008/011(locations)/013 are superseded by **`DEFERRED (owner decision)` → R4** (§14). OQ-007 multi-company: single-company retained now, cost analysis in `10-analyst-suggestions.md`; NOT `NOT-APPLICABLE` any more but "much later".

## §17. Polynesian relevance filter (2026-10-28)
Applied to all 87 baseline rows + 4 ADDITION items in `18-polynesia-relevance-decisions.md`. Net effects: numbering/year-bucket and gap register ADAPT stays; gateway behaviours REPLACE → DEFERRED R4 (already §14); designer engine and e-invoicing SKIP (removed from R1–R3 duties, retained here for traceability); portal/mail DEFER already. No verdict conflict with previous rounds except readability of the payments state model which stays as the R4 extension model.
