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

## 2026-10-28 — T-002b/c/d, T-005 (manual), T-007 DONE (M4/M10)
- T-002c: per-line TVA status selector (Assujetti / Exonéré) in the shared line editor; exempt lines carry no rate.
- T-002d: the TVA report now separates the taxable base and tax from the exempt base and its document count, and drops any 0 % bucket row; the reports screen shows the two extra cards.
- T-005 (manual half): "Relancer" action on overdue invoices, journalled (`activity.invoice_reminded`); default payment terms rewritten so they no longer promise a late fee the application does not compute. Automatic reminders stay in R2.
- T-007: quotes expose a computed `expired` flag and show the chip on list and detail; invoice overdue computation already existed.
- T-002b: invoice PDF prints "Exonéré" per exempt line plus the tax-status paragraph; the quote PDF cannot be covered because ManaGest has no quote PDF output at all (recorded as a gap, not silently claimed).
- Gate: 65/65 tests, typecheck + build clean; live walk [EXECUTED]: mixed invoice FAC-2026-0082 → total 16 600 with a single 16 % bucket on base 10 000; tax report summary base 2 717 900 / tax 339 940 / exempt 110 000 (1 doc); DEV-2026-0017 expired=true; reminder on FAC-2026-0080 → 200 + journal.

## 2026-10-29 — T-102a CSV import backend DONE (M7)
- `server/lib/import.ts`: pure CSV parser (delimiter auto-detect, quoted cells, BOM), column specs that mirror the export headers (round-trip), template generator with an annotation row, validation (required fields, booleans, integers, email shape, duplicate keys inside the file).
- `server/routes/import.ts`: `GET /api/import/template/:entity`, `GET /api/import/columns/:entity`, `POST /api/import/preview/:entity`, `POST /api/import/commit/:entity`. Per-entity permission guard on every registration; preview and commit run the same validation; commit is one D1 batch (atomic) and is journalled as `activity.data_imported`.
- Rules relaxed during verification: only *required* columns must be present (optional columns take defaults); missing required column is named in French; invalid rows block the commit unless the caller explicitly sets `skip_invalid`, and the count is reported back.
- Bug found and fixed by the live walk: `clients.country` is NOT NULL, so an empty country column crashed the commit; it now defaults to « Polynésie française ».
- Gate: 77/77 tests (11 new import tests), typecheck + build clean; live walk [EXECUTED]: anonymous 401, missing required column 422, duplicate rows flagged (2/2), commit refused 409, explicit skip 201 (2 created, 2 skipped), re-import same email 201 updated 1, product insert 201, journal entries present.
- Still open in M7: T-102b wizard screen, T-102c invoices import, XLSX (platform-unverified).
