# ManaGest — Master TODO (execution order revised 2026-10-29; gates in VERIFICATION-GATES.md)

Ordering rule: a task starts only when everything it depends on is DONE. Phases follow the dependency chain, not the module numbers. Every row cites its evidence and records its gate result.

Legend: Eff S/M/L/XL · statuses TODO | IN PROGRESS | DONE | BLOCKED.

## Dependency graph (start here)

```
T-100 fiscal defaults ─┐
T-107 expense categories ├─> T-207 local reports
T-010 English ─────────┘
T-108a quote/credit PDFs ──> T-108 second layout ──> T-103 public links ──> T-404 palette spec
T-101 attachments (needs PQ-3 only to display the platform ceiling)
T-104a endpoint ──> T-104b pipeline ──> T-104c dashboard card ──> T-105 auto reminders ──> T-106 email (PQ-2)
T-202a roles schema ──> T-202b role API ──> T-202c role UI ──> T-203 button gating
T-201a ──> T-201b ──> T-201c view screens ──> T-206 saved filters
T-204 bank matching ──> T-205 projects/kanban
```

## Phase 1 — Parameters and foundations

| ID | Title | Module | Evidence | Deps | Blockers | Eff | Status / gate |
|---|---|---|---|---|---|---|---|
| T-100 | Fiscal defaults as settings: retention years, franchise ceiling, tax-regime wording | M0 | OQ-004/005/006/019; owner decision 2026-10-29 (no accountant) | — | — | S | **DONE** (Paramètres → Taxes: « Valeurs fiscales par défaut », 10 ans / 10 000 000 XPF, editable, journalled; live GET/PATCH/422 verified) |
| T-107 | Expense categories management screen (remove the fixed enum) | M6 | BK-016; CC-RA-2 (DEF-SESSION-02) | T-100 | — | S | TODO |
| T-010 | Full English translation + language switch (variant is a setting, French stays default) | M0-fallback | OQ-014 | T-100 | — | M | TODO |

## Phase 2 — Document output (must precede sharing)

| ID | Title | Module | Evidence | Deps | Blockers | Eff | Status / gate |
|---|---|---|---|---|---|---|---|
| T-108a | Quote and credit-note PDF output (same builder, same wording rules) | M4 | parity PAR-OUT-001 corrected 2026-10-29: no quote/credit PDF existed | T-002 | — | M | **DONE** (new builder `pdf-documents.ts`; `GET /quotes/:id/pdf` and `GET /credits/:id/pdf`; links on the quote detail and each credit row; 3 unit tests; live 200 application/pdf, %PDF magic, anonymous 401) |
| T-108 | Second PDF layout + per-document choice | M4 | BK-015; OQ-010 | T-108a | — | M | TODO |

## Phase 3 — Sharing and files

| ID | Title | Module | Evidence | Deps | Blockers | Eff | Status / gate |
|---|---|---|---|---|---|---|---|
| T-103 | Public per-document links: token, expiry, revocation, access log, accept-quote | M4 | OQ-001 interim; portal sheet security rows | T-108a | — | M | TODO |
| T-101 | Attachments for expense receipts and payment proofs (configurable size, default 10 MB) | M6 | BK-010; OQ-009 | T-100 | PQ-3 only to display the platform ceiling | M | TODO |

## Phase 4 — Automation

| ID | Title | Module | Evidence | Deps | Blockers | Eff | Status / gate |
|---|---|---|---|---|---|---|---|
| T-104a | Daily-run endpoint: secret token, rate limit, Tahiti-day idempotency | M5 | OQ-003 | T-100 | PQ-1 (scheduling) for the trigger itself | M | TODO |
| T-104b | Run pipeline: recurring invoices + reminders + stored result | M5 | BK-003 | T-104a | — | M | TODO |
| T-104c | Dashboard « dernier passage » card + manual run button | M5 | OQ-003 spec §5-6 | T-104b | — | S | TODO |
| T-105 | Automatic reminders through the pipeline | M5 | BK-002 | T-104b | PQ-2 for actually sending mail | S | TODO |
| T-106 | Outbound e-mail provider (key in platform Secrets) | M11 | BK-021; OQ-002 | T-105 | **PQ-2 + owner provider choice** | M | BLOCKED |

## Phase 5 — Permissions and admin screens

| ID | Title | Module | Evidence | Deps | Blockers | Eff | Status / gate |
|---|---|---|---|---|---|---|---|
| T-202a | Roles table + schema + permission resolution | M1 | CC-RC-1 | T-008 | — | M | TODO |
| T-202b | Role CRUD endpoints, journal, negative tests | M1 | CC-RC-1 | T-202a | — | M | TODO |
| T-202c | Role management UI + read-only permission matrix | M1 | CC-RC-1 | T-202b | — | M | TODO |
| T-201a | « Voir » screens: payments and expenses | M11 | CC-RB-1 tier 1 | T-008 | — | M | TODO |
| T-201b | « Voir » screens: vendors, POs, products, projects, tasks | M11 | CC-RB-1 tier 2 | T-201a | — | M | TODO |
| T-201c | « Voir » on bank, users, settings entries; row action everywhere | M11 | CC-RB-1 tier 3 | T-201b | — | M | TODO |
| T-203 | Button gating policy: disabled with a clear reason instead of hidden | M1 | CC-RC-2 | T-202c | — | S | TODO |

## Phase 6 — Operations and reporting

| ID | Title | Module | Evidence | Deps | Blockers | Eff | Status / gate |
|---|---|---|---|---|---|---|---|
| T-204 | Bank matching rules + ledger view | M9 | BK-014; bank sheet | T-004 | — | M | TODO |
| T-205 | Kanban board + billable-tasks-to-invoice flow | M9 | BK-013; projects sheet | T-204 | — | M | TODO |
| T-206 | Saved filters per list | M11 | OQ-013 (filters half) | T-201c | — | S | TODO |
| T-207 | Local report outputs: TVA recap, chiffre d'affaires | M10 | 18 REP rows; PF-ACCT-001 | T-100, T-002d | — | M | TODO |

## Phase 7 — R4 extension points (specification only, no build)

| ID | Title | Module | Evidence | Note |
|---|---|---|---|---|
| T-401 | Portal wrapper spec (reuses public links) | M12 | matrix §14 | spec rows only |
| T-402 | Payment pending/failed states + method registry spec | M12 | matrix §14 | spec only |
| T-403 | « Locations » address slot spec | M12 | 15 §locations | BLOCKED-BY owner meaning (OQ-011) |
| T-404 | Command palette spec | M12 | matrix §14 | spec only |

## Done — R1 (18 rows closed)

T-000 backup · T-001 numbering · T-002a/b/c/d TVA status (b: invoice PDF + reports; quote PDF reassigned to T-108a) · T-003 settings extras · T-004 refunds via credit notes · T-005 manual reminders + truthful terms · T-006 CSV export · T-007 computed chips · T-008 permission sweep · T-009 retention guard · T-102a import backend · T-102b import wizard · T-102c invoices import · R1 release gate 14/14.

## Why this order

1. **Parameters before anything that prints them** — T-100 closes the accountant blocker, so tax wording, retention and the franchise ceiling are settings, not assumptions. T-107 and T-010 ride on it.
2. **Document output before sharing** — a public link that cannot render a quote or a credit note would ship broken; T-108a then T-108 then T-103 is the only safe sequence.
3. **Storage before automation** — attachments (T-101) are independent, so they run beside the PDFs instead of blocking the scheduler.
4. **Automation is a chain** — endpoint, pipeline, dashboard, reminders, e-mail: each depends on the previous, and e-mail stays last because it alone needs a platform answer.
5. **Permissions before the admin screens** — role CRUD (T-202) decides what a « Voir » screen may show, so it precedes T-201 and the gating policy.
6. **Operations last** — bank matching, kanban, saved filters and local reports depend on documents, permissions and the fiscal defaults being settled.

## Blocker register

- **PQ-1** scheduled triggers → gates the trigger of T-104a.
- **PQ-2** outbound e-mail + provider choice → gates T-106 and the sending half of T-105.
- **PQ-3** upload ceiling → display only for T-101.
- **Owner OQ-011** meaning of « locations » → T-403.
- **No accountant available** → resolved by owner decision 2026-10-29: standard defaults adopted as parameters (T-100); nothing in the plan waits on an external accountant any more.
