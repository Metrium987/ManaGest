## 2026-10-28 — build planning created (no code changed)
BUILD-PLAN, TODO (23 tasks + 4 R4 spec rows), module files M0-M12, VERIFICATION-GATES, TRACEABILITY, PLAN-OPEN-QUESTIONS.

## 2026-10-28 — plan review applied + M0 pilot executed
- T-000 backup task DONE (commit fb542f5 + D1 export + verified scratch restore).
- L/XL tasks split (T-002→4, T-102→3, T-104→3, T-201→3, T-202→3); new counts: R1 12, R2 13, R3 16 incl. new tasks; R4 4 spec rows; total 45.
- English variant rolled out: 'ui_language' setting (fr|en), variant = setting; full translation file task T-010 tracked.
- Owner answers recorded (OQ-021, locations, multi-company prep = CONFIRMED; override welcome).
- Coverage proof added to TRACEABILITY.md (0 unmapped, 2 justified exceptions).
- M0 built and verified: per-entity numbering + placeholder validation + gap register; TVA status model (unit tested); retention guard (live 409); settings extras; schema v4 additive migration. 49/49 unit tests; typecheck + build clean; live negative permission tests 403/manual fallbacks.
- Module report: docs/build/reports/M0.md. STOP after M0 per owner instruction — awaiting approval for M1.

## 2026-10-28 — M1 permissions core (T-008) DONE
- Static route-guard + role-matrix invariant tests; no unguarded route; live negative walk executed; full suite 3 files green; typecheck/build clean. Report: docs/build/reports/M1.md. STOP before M2 per protocol.

## 2026-10-28 — T-006 in-app CSV export DONE (M7 start, continuing per owner authorisation)
- server/routes/export.ts (9 entity specs, `.read` permission per entity, q filter, 5000-row cap, journal entry) + server/lib/csv.ts (RFC-compliant escape, semicolon delim, UTF-8 BOM) + tests/csv.test.ts.
- UI: ExportCsvButton added to Clients, Invoices, Quotes, Payments, Expenses, Products, Credits list headers; uses existing common.export key; component fixed to project t() (no react-i18next).
- Gate: 61/61 tests green (route-guard invariant extended: export allowed with documented handler-level hasPermission check asserted in FILE_LEVEL_GUARDS); typecheck + build clean; live walk [EXECUTED]: admin export clients → 200 text/csv with French round-trip headers; unknown entity → 404; journal shows `exported: activity.data_exported`; viewer export = 200 by design (export rides entity .read; documented in code comment), consistent with OQ-021 confirmed matrix.

## 2026-10-28 — T-004 refunds via credit notes DONE (M4)
- Rule extracted as a pure, unit-tested helper `refundableAmount(status, balance, paidTotal)` (server/services/status.ts): paid invoice → amount received; sent/partial → open balance; draft/cancelled → 0.
- `POST /api/invoices/:id/credit-note` no longer silently clamps the requested amount: it refuses an amount above the ceiling (409 AMOUNT_EXCEEDS_BALANCE) and a zero/negative amount (422), still creating a DRAFT credit pre-filled with one explanatory line and journaling `activity.credit_created_from_invoice`.
- UI: "Établir un avoir" button + modal (amount prefilled with the refundable amount, motif) on the invoice detail for paid/partial invoices, gated by `credits.write`.
- Gate: 65/65 tests green (4 new refund tests incl. the one-third-of-a-paid-invoice arithmetic), typecheck + build clean; live walk [EXECUTED]: over-ceiling → 409, refund 10 000 on FAC-2026-0038 → 201 AV-2026-0026 (draft, balance 10 000), zero → 422, journal entry present.
- Note: BK-006's "payment shows partially refunded" clause is superseded by OQ-012 (credit note is the refund record; no payment state change).
