# 00 — Executive summary (final, 2026-10-28)

**What ManaGest is today.** A French-first ERP for French Polynesia on the Freebuff platform: setup wizard, clients/contacts, products, quotes → invoices (send, partial payments, cancel, duplicate, PDF), credit notes applied to invoices, recurring invoices with manual run, payments, expenses, vendors, purchase orders, projects/tasks, bank module, reports/dashboard, settings/users, and a hash-chained activity journal (verified {ok:true, checked:208} over 208 entries).

**What was executed this audit.** The 16 critical steps of the session run (login guards, client/product creation, quote→approve→convert→invoice→send→partial payment→credit note→apply→recurring run→expense→export CSV) all behaved correctly [EXECUTED]; one transient anomaly logged (14-A). Screens themselves were reviewed from code, not by browser automation: screen rows are [OBSERVED], flow rows [EXECUTED].

**Top 10 priorities (backlog `06-correction-backlog.md`).**
1. R1 — Tax status picklist (taxable/exempt/franchise) with legal wording (OQ-004) `[VALIDATE LOCALLY]`
2. R1 — Retention lock configurable, 10-year default (OQ-006) `[VALIDATE LOCALLY]`
3. R1 — Import CSV/XLSX with owner templates + round-trip export (XLSX feasibility to verify)
4. R1 — In-app export buttons everywhere (primary export; primary confirmed by owner)
5. R1 — Timezone and footer-text settings
6. R2 — `POST /api/runs/daily` protected endpoint for the external scheduler (OQ-003) + dashboard last-run card
7. R2 — Outbound email with provider key in platform Secrets; manual "sent" fallback until PQ-2/PQ-5 answered
8. R2 — Attachments (receipts, payment proofs), configurable size default 10 MB (OQ-009)
9. R2 — Public per-document links with token security requirements (OQ-001)
10. R2/R3 — User-editable expense categories (OQ-011, currently fixed enum) and bank reconciliation depth (R3)

**Platform questions still pending (PQ-1…PQ-5 in `data/platform-questions.md`):** scheduled triggers, supported email pattern, upload ceiling, database export, egress policy. Capabilities that depend on them are marked `PLATFORM-DEPENDENT`.

**Items to validate locally.** Franchise threshold "≤ 10 M XPF" (OQ-019), tax statuses and mentions (OQ-004), retention 10 y (OQ-005/006), numbering-register legibility with the DICP — grouped under a "To confirm with a local accountant / DICP" section of `09-open-questions.md`.

**Results.** Self-verification: 62 entries re-checked over two passes, 3 errors found and corrected (≈4.8%). Settings coverage: 14 groups — 5 CONFORMING, 4 PARTIAL, 4 NOT-APPLICABLE (owner decisions), 1 MISSING. FRD walk: 8 CONFORMING, 9 PARTIAL/N-A. Route matrix: 111 handlers mapped, no orphans (an earlier false orphan was corrected). Licence note: Invoice Ninja reference repo is used as a behavioural reference under its own licence terms found in that repository; nothing was copied, and ManaGest code remained read-only during the audit.

## 2026-10-28 — final update (owner-deferred features & cross-cutting rules)
**New status.** Portal, gateways, "locations", command palette: `DEFERRED (owner decision)` → R4 with documented extension points (matrix §14, `15-platform-feasibility-register.md`). Multi-company: "much later", retro-fit cost analysis written (`10-analyst-suggestions.md`); the owner decides whether to apply the two low-cost preparation items now.

**What is confirmed feasible platform-natively** (`15`): SQL database, object storage, secrets (rotatable), auth & realtime bindings, runtime outbound HTTPS (probed HTTP 200). **What is NOT DOCUMENTED** (external caller needed): scheduled runs, scheduled export, outbound email. **What is UNVERIFIED**: upload ceiling, XLSX parsing at build.

**Cross-cutting rules** applied to the audit: R-A → `16-hardcoding-audit.md` (2 Major: expense categories enum, single shared numbering pattern with literal prefixes; 6 Minor; business rules intentionally in code, listed). R-B → `17-view-edit-permissions-audit.md` (9 areas missing read-only views, R3). R-C → server enforcement confirmed on ~96 handlers; fixed role set and missing role UI are the gaps (R3). Proposed default permission matrix offered in OQ-021.

**Decisions awaiting the owner.** OQ-021 default permission model; OQ-015 format question (answered separately); multi-company preparation items; the "locations" meaning confirmation; the five platform questions PQ-1…PQ-5.

## 2026-10-28 — Polynesian relevance filter (file 18) — final
One relevance verdict for each of the 87 baseline behaviours + the ManaGest-only additions: **ADAPT 61 · ADOPT AS IS 5 · REPLACE 2 (online gateways → manual/deferred) · SKIP 3 (engine, e-invoicing, wizard check pages) · DEFER 16**. The heaviest local adapts are the tax wording/buckets (DICP sentences, franchise threshold), numbering continuity/gap register (DGAE continuity, metropolitan fallback flagged), the payment model (manual first; baseline pending/failed states kept as the R4 extension),the Tahiti business-day schedule, and French-first texts. One open local question remains (front-office quote-mention display — owner to confirm with the accountant).
Final self-verification pass 3: 30 entries (12 money/tax), **2 real corrections applied** (IN-ACC family rows re-verdicted ADAPT); cumulative 92 entries / 3 errors ≈ 3.3%.
