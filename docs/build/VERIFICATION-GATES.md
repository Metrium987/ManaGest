# Verification gates

## Task gate (per TODO row) — all applicable items checked with evidence
1. Change matches the specification sheet + acceptance criteria; no extra behaviour.
2. Automated tests written and green: unit (money/tax/rounding/numbering rules), API per endpoint incl. permission-denied (403) and validation-error (400/409/422) paths, boundary cases (XPF zero-decimal amounts, 0/100 tax rates, empty discounts).
3. `npm run typecheck`, lint, build clean; no skipped/disabled tests; failures fixed at cause, never masked.
4. No hard-coded user-facing text or configurable value introduced (R-A scan: grep new literals); French keys present, en ready (i18n file).
5. Server-side permission check present + tested (R-C); read-only View reachable (R-B).
6. Sensitive actions produce activity-journal entries (verified in test assertions).

## Module gate
All task gates of the module; money/tax/numbering/status rules re-tested incl. Polynesian cases (XPF zero decimals; taxable/exonéré/franchise wording; numbering continuity & gap register; Tahiti-day boundaries); full regression of all previously completed modules green; end-to-end walk of the module's critical flows recorded [EXECUTED]/[OBSERVED]; data migration without loss, no orphans; user-facing behaviour documentation updated; module report `docs/build/reports/<module>.md`.

## Release gate
Full regression; end-to-end walk of critical flows (setup wizard, client creation, quote→invoice→payment, credit note, import/export round-trip, settings, permissions incl. denial paths); re-check of [VALIDATE LOCALLY] items; parity matrix updated; owner report.

## Checklists
- [ ] Task gate: spec ✓ tests ✓ typecheck/build ✓ i18n/R-A ✓ permissions/R-C ✓ view/R-B ✓ journal ✓
- [ ] Module gate: rules ✓ regression ✓ e2e [EXECUTED] ✓ data ✓ docs ✓ report ✓
- [ ] Release gate: regression ✓ flows ✓ validations ✓ matrix ✓
- Stop rule: gates failing → fix cause → re-run; spec/audit flaw → PLAN-OPEN-QUESTIONS.md; unrunnable check reported honestly (e.g. browser unavailable) — never claimed as passed.

## Note
Legacy critical-flow walk evidence lives in `docs/audit/14-session-run.md`; each module re-walks its flows per the module gate.
