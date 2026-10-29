# ManaGest — Build Plan (2026-10-28; plans only, no code)

Sources cited per item: audit files `docs/audit/00-18`, specification sheets `docs/audit/11-specification-sheets/`.

## Guiding principles
1. **Audit-driven**: every task cites a backlog ID (`06-correction-backlog.md`), parity row, spec-sheet section or owner decision. Anything not in the audit lands in "Suggestions", not the plan.
2. **Platform-respecting**: only CONFIRMED platform capabilities are used; NOT DOCUMENTED items (nightly scheduler, outbound email, scheduled export) get the accepted platform-native fallbacks, never undocumented assumptions (`15-platform-feasibility-register.md`).
3. **R-A/R-B/R-C inside every module** (not bolted on). Polynesian verdicts of file 18 govern: ADOPT rows build as modelled; ADAPT/REPLACE rows build the local variant; SKIP rows are never built.
4. **Gate discipline** (`VERIFICATION-GATES.md`): no task or module is DONE with a failed/skipped check; blockers stop work, never loosen tests.
5. **French-first text**, every string through i18n keys (R-A), English architecture open to more languages (OQ-014).

## Release structure
- **R1 — Compliance & core correctness** (immediately startable): foundations (per-entity numbering + gap register, TVA status model, timezone/footer/security settings), documents chain corrections (tax statuses on lines, refunds→credit notes), in-app CSV export, manual reminders consistent with default terms (OQ-020), validation updates for the [VALIDATE LOCALLY] items pending confirmation.
- **R2 — Productivity & platform-dependent capabilities**: attachments (R2 bucket), import wizard + templates + round-trip, public per-document links, manual→provider email interpolation (BLOCKED-BY PQ-2 for the provider part only), `POST /api/runs/daily` protected endpoint + external-scheduler contract (OQ-003; caller is external — runtime capability already proven by probe), quote expiry/overdue chips.
- **R3 — Owner-answer-dependent**: custom roles & permission matrix UI (BLOCKED-BY OQ-021), read-only "Voir" completion everywhere (CC-RB-1), bank reconciliation depth & ledger, kanban, saved filters (OQ-013 part already: palette moved to R4).
- **R4 — extension points only** (CC-DEF-1): portal wrapper, gateways, locations slot, command palette. No implementation.

## Module order (dependency-first) and why
| # | Module | Depends on | Why this order |
|---|---|---|---|
| 0 | Foundations: settings framework, numbering(+prefix/pattern per entity), tax-status model, i18n en, security settings | — | everything else inherits parameterisation & money rules |
| 1 | Permissions & roles core | M0 | R-C server checks extend before features use them |
| 2 | Clients & contacts | M0, M1 | first entity exercises R-A/R-B/R-C end-to-end |
| 3 | Products (incl. categories, stock) | M0, M1 | second entity; source for document lines |
| 4 | Documents core: quotes → invoices → payments → credits | M2, M3, M0 | the audit's money-critical chain; BK-001 tax status; BK-005 gap register; BK-006 refunds via credits (OQ-012) |
| 5 | Recurring engine | M4 | child invoices of document chain; night-run endpoint (OQ-003) |
| 6 | Expenses | M0, M1 | categories setting (CC-RA-2); attachments groundwork → R2 |
| 7 | Import/Export | M2, M3, M4 | round-trip OQ-015 spec; XLSX UNVERIFIED → CSV first |
| 8 | Vendors & purchase orders | M2-pattern | reuse entity patterns; BK-028 retention not applicable |
| 9 | Projects/Tasks & Bank | M4, M6 | kanban/bank-matching; ledger view |
| 10 | Reports & dashboard (incl. BEYOND-REFERENCE local outputs) | M4, M6 | consumption of all entities; declaration-exports |
| 11 | Admin & settings consolidation (users, links, view screens sweep) | M0–M7 | close remaining parity covers |
| 12 | R4 extension points | deferred | specification rows only |

## Dependency graph
```
M0 Foundations ──► M1 Permissions ──► M2 Clients ──► M4 Documents ──► M5 Recurring ─┐
      │                │                │            │  │                              │
      │                │                └─► M3 Products┘  ├─► M7 Import/Export           │
      │                └─► M8 Vendors/POs ◄─────────────────┘  ├─► M10 Reports ◄────────────┘
      └─► M6 Expenses ─► M9 Projects/Bank ◄─ M4                └─► M11 Admin/settings
```

## Foundation work (cross-cutting, once)
- Settings storage: single parameterised row/columns + values list for enumerated settings, always company-scoped by id column (low-cost multi-company prep per `10-analyst-suggestions.md` OQ-007 analysis).
- Numbering engine extension: per-entity pattern + editable prefix + gap register (`BR-PF-NUM`, BK-005, CC-RA-1).
- Tax-status model: `taxable / exonéré / franchise` on documents & lines, official DICP wording reach the PDF/reports (BK-001, OQ-004) `[VALIDATE LOCALLY]`.
- i18n: en-GB message file alongside fr (OQ-014 foundation).
- Permissions: extend `shared/domain.ts` matrix (fixed roles first); audit helper for tests (R-C).

## Risks
1. Scheduled night runs & email remain NOT DOCUMENTED on the platform — the plan uses the accepted external-scheduler endpoint and manual/interim fallbacks; both R2.
2. Retention lock and DICP validations are `[VALIDATE LOCALLY]` — implemented but flagged, never presented as legal.
3. Custom permissions/roles depend on OQ-021; fixed-role R-C work is unblocked.
4. XLSX import feasibility unverified at build time (CSV-first design).

## Blockers (owner of the blocker)
| Blocker | Blocks | Unblocker |
|---|---|---|
| OQ-021 default permission model (owner) | M1 custom roles (R3 part), role matrix UI | owner confirmation |
| PQ-1..PQ-5 (platform) | night scheduler caller (PQ-1), email provider (PQ-2), upload ceiling numerical (PQ-3), XLSX path (unverified) | platform support answers |
| OQ-019/004/005/006 local validations (accountant/DICP) | finalisation of tax wording, retention lock | owner + accountant |
| OQ-001 "locations" meaning (owner) | locations extension-point slot wording (R4) | owner |


## Revised execution order (2026-10-29)

The original ordering mixed release labels with dependency order. It is replaced by seven phases in `TODO.md`:

1. Parameters and foundations (T-100 fiscal defaults — done, T-107, T-010)
2. Document output (T-108a quote/credit PDFs, T-108 second layout)
3. Sharing and files (T-103 public links, T-101 attachments)
4. Automation (T-104a → T-104b → T-104c → T-105 → T-106)
5. Permissions and admin screens (T-202a/b/c, T-201a/b/c, T-203)
6. Operations and reporting (T-204, T-205, T-206, T-207)
7. R4 extension-point specifications only (T-401…T-404)

Two additions explain the change: **T-108a** exists because the audit had wrongly recorded quote and credit-note PDFs as present; **T-103** therefore cannot start before it. **T-100** exists because the owner decided that, with no accountant available, standard default values are adopted as ordinary settings instead of blocking progress: retention 10 years, franchise ceiling 10 000 000 XPF, tax-regime wording driven by the company record. Nothing in the plan now waits on an external accountant.
