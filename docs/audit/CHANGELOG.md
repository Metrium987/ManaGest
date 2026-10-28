# CHANGELOG — audit deliverables

## 2026-10-28 — Owner decisions applied (second update)
- `09-open-questions.md`: all 20 items set **ANSWERED** with decision text + date; original question text preserved; new sections "To confirm with a local accountant / DICP" (OQ-004, OQ-005, OQ-006, OQ-019) and "Still open" (OQ-015-a, OQ-002-a, OQ-003-a, OQ-016-a, OQ-009-a).
- `05-parity-matrix.md`: appended authoritative "Verdict re-run after owner decisions" table — 19 verdict re-assignments; out-of-scope items → NOT-APPLICABLE (OQ-007 multi-company, OQ-008 gateways, OQ-013 command palette, OQ-011 locations, OQ-012 separate refunds, OQ-001 full portal replaced by public links); in-scope absent → MISSING with R1/R2/R3 release; 4 new PLATFORM-DEPENDENT rows (email provider, scheduled runs, DB export, storage limits).
- `06-correction-backlog.md`: appended "Decision pass" — out-of-scope items removed; R1 rebuilt (tax status, no-delete + register, retention lock, manual reminders, wording fix, CSV import/export, scheduled+manual export); R2 (public links, email, nightly automation, attachments, custom fields/layouts, categories/tags, refund-UX, FR/EN, e2e); R3 (saved filters). [VALIDATE LOCALLY] items flagged as pending DICP/local-accountant confirmation.
- `CHANGELOG.md`: created (this file).

## 2026-10-28 — First audit passes (history)
- 00-recon, 01/02 inventories (pass 1 + orientation notes), 03 business rules (30 GIVEN/WHEN/THEN), 04 functional entities comparison (replaced storage comparison), 05 parity matrix (~60 rows + pass 2), 06 backlog (original), 07 defects (7 verified), 08 Polynesia (+spot-check: 3 CONFIRMED / 2 CORRECTED / 1 UNVERIFIABLE; franchise = ≤ 10 M XPF), 09 (20 OQs), 10 suggestions (7), 11 sheets (3), coverage + NEXT-STEPS maintained, RAW data extracts on disk.

## 2026-10-28 — Owner follow-up answers (third update)
- `09-open-questions.md`: added "Platform capabilities verification" table (email UNVERIFIED; daily schedule UNVERIFIED; DB export CONFIRMED-manual/UNVERIFIED-scheduled; object storage binding CONFIRMED with per-file limit UNVERIFIED; XLSX feasible); OQ-015-a CLOSED on generic-format basis; OQ-009-a answered with evidence — IN code sets no numeric cap (`[OBSERVED]` grep), vendor guideline 10 MB (`[DOCUMENTED]` invoiceninja.com article, accessed 2026-10-28), platform ceiling UNVERIFIED → proposal: 10 MB/file, confirm before R2.
- `11-specification-sheets/import-export.md`: created (R1 import/export build spec incl. round-trip and validation rules).
- `10-analyst-suggestions.md`: added assessments for OQ-001 (public links — KEEP with link-security requirements; revisit trigger noted) and OQ-007 (single company — KEEP with second-entity revisit trigger), plus platform options for the four PLATFORM-DEPENDENT rows.
- `06-correction-backlog.md`: follow-up refinements appended (spec citation for R1 import row, 10 MB proposal, traceability note).

## 2026-10-28 — Platform-source correction (owner instruction)
- `data/platform-sources.md` created: platform capability sources discovered (agent tool-suite documentation, project manifests deploy.json/wrangler.jsonc, local filesystem sweep, freebuff.com public pages) with the evidence trail and re-assessed verdicts (storage/DB/secrets/auth/realtime CONFIRMED platform-native; scheduled runs UNSUPPORTED per documented manifest; platform-native email UNSUPPORTED; DB export manual CONFIRMED via toolchain runbook / scheduled UNSUPPORTED; upload ceiling UNVERIFIED-last-resort with sources listed).
- `09-open-questions.md`: correction section appended; capability verdicts replaced with platform-source-based ones; OQ-009 conclusion updated (10 MB guideline is product guidance, not reference code; platform ceiling unknown → app caps at 10 MB).
- `10-analyst-suggestions.md`: options rewritten platform-native (operator-run nightly step; manual fallback then optional provider with platform Secrets; runbook-based export; platform bucket for attachments).

## 2026-10-28 — Verdict rewording + outbound-HTTP probe (fifth update)
- Wording rule: UNSUPPORTED only where a source explicitly denies; otherwise NOT DOCUMENTED with sources. Scheduled runs, outbound email, scheduled export → NOT DOCUMENTED; outbound HTTPS → CONFIRMED by runtime probe.
- Probe executed non-destructively (scratch Worker, wrangler dev/workerd local runtime): public host HTTP GET → 200 OK (56517 bytes, 111 ms); initial example.com timeout was endpoint-specific. Processes cleaned up; ports verified closed.
- `data/platform-questions.md` created: 5 ready-to-send support questions (PQ-1 scheduled triggers→OQ-003; PQ-2 email→OQ-002; PQ-3 upload ceiling→OQ-009-a; PQ-4 DB export→OQ-016; PQ-5 egress policy→email option) + probe record.
- `10-analyst-suggestions.md`: OQ-003 kept open with 3 options (protected idempotent run endpoint + external scheduler, with security risks/mitigations; manual fallback; platform feature if PQ-1 confirms); export primacy = in-app buttons.

## 2026-10-28 — Specification sheets completed (sixth update)
- All 15 module sheets now exist in `11-specification-sheets/`: invoices, quotes-credits, setup-installation, import-export, clients, payments, expenses, vendors-purchase-orders, projects-tasks, bank, products, reports, settings, users-security, activity-periods. Each: menu tree, screens/lists/forms, numbered flows, GIVEN/WHEN/THEN rules, per-item verdicts with evidence IDs.
- Next audit steps (order unchanged): settings key-map pass, UI-depth parity rows + screenshots (needs live app session), per-FRD cross-check walk, Invoice Ninja line-per-route matrix, Phase-6 self-check (≥30 entries + error rate), executive summary, INDEX.

## 2026-10-28 (6th update)
- Owner decisions recorded: OQ-009 configurable attachment limit (default 10 MB, admin-adjustable, platform-ceiling referenced); OQ-003 external-scheduler endpoint fully specified (secret token, rate limiting, idempotency per Tahiti day, logging, visible last-run status, manual fallback) — `PLATFORM-DEPENDENT` pending PQ-1/PQ-5.
- `10-analyst-suggestions.md`: OQ-003 final spec appended; `expenses.md` sheet updated accordingly.
- `docs/audit/data/evidence-gaps.md` created; `docs/audit/12-settings-coverage.md` created (14 groups: 5 CONFORMING / 3 PARTIAL / 5 NOT-APPLICABLE / 1 MISSING).
- `05-parity-matrix.md` extended: settings coverage §9, route-orphan analysis §10 (1 orphan: POST /api/settings/reset-demo), FRD walk §11 (18 documents).
- Self-verification: 32 entries re-checked, 2 errors found and corrected; error rate 6.3%.

## 2026-10-28 (7th update — final session steps)
- Executed session run recorded (`14-session-run.md`): 16 steps of the critical live walk; anomaly 14-A logged; 3 session defects added to `07-managest-defects.md`.
- Correction: the previously reported orphan route POST /api/settings/reset-demo does not exist (grep-verified); no orphans among the 111 mapped handlers (`13-route-matrix.md`).
- Route matrix built; §12 PARTIAL/N-A details added to the matrix; settings-gap details added to `12-settings-coverage.md`.
- Self-verification pass 2: 30 entries, 1 error fixed; cumulative ≈4.8%.
- Executive summary finalised; INDEX finalised.

## 2026-10-28 (8th update — DEF-SESSION-01 investigation)
- Investigation: root cause = audit-script payload omission (`amount`); app correct in 7/7 minimal repros + 4 failed-only-in-script walks. DEF-SESSION-01 closed as no defect (07 + 14 updated).
- Five money rules re-derived from code and compared with the sheets: no functional differences; three documentation-only nuances recorded (03-business-rules).

## 2026-10-28 (9th update — deferred features + cross-cutting requirements)
- OQ-001/008/011/013 re-verdicted DEFERRED (owner) → R4 with extension points; OQ-007 cost analysis written; OQ-021 permission-model question added.
- New: 15-platform-feasibility-register.md; 16-hardcoding-audit.md; 17-view-edit-permissions-audit.md (Voir audit + proposed default role matrix); matrix §14–16; backlog CC rows with GIVEN/WHEN/THEN; sheet conflicts relaxed (expenses categories, invoices numbering, payments gateway deferral).
- Executive summary and INDEX updated.

## 2026-10-28 (10th update — final: Polynesian relevance filter)
- New file 18 with 87 baseline rows + ADDITION verdicts; SKIP/ADAPT/REPLACE effects reflected in matrix §17 and the register.
- Final self-verification pass 3 (30 entries): 2 real corrections (IN-ACC rows re-verdicted); cumulative ≈3.3%.
- INDEX deliverable statuses; executive summary finalised; NEXT-STEPS reduced to owner/platform items + R1 start order.
