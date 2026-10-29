## 2026-10-29 — T-108 second PDF layout + per-document choice DONE (M4, OQ-010 / BK-015)
- `server/services/pdf-style.ts`: two documented layouts only — `classic` (colour header band, filled table header, accent total block) and `compact` (thin rule, accent text headers, denser totals). No layout designer, as the owner decided.
- The workspace default is the `pdf_layout` setting (Paramètres → Facturation → « Modèle de document PDF », journalled, 422 for an unknown value). A single document can use the other layout through `?layout=` on the invoice, quote and credit PDF routes, so the choice is per document without a schema change.
- `GET /extras` now lists four keys; the shared key/default list moved to `server/lib/settings-extra.ts` so the settings screen and the PDF routes cannot drift apart.
- « PDF compact » button on the invoice record; other screens follow the workspace default.
- Gate: 99/99 tests (5 new), typecheck + build clean; live walk [EXECUTED]: invoice classic 2 723 B vs compact 2 706 B, quote and credit compact both 200 with %PDF magic, `?layout=fancy` falls back to the classic output, switching the default to compact makes the plain URL return the compact file, invalid default 422, restored to classic.

## 2026-10-29 — T-010 English interface DONE (M0, R-A / OQ-014)
- `src/lib/i18n-en.ts`: the full English dictionary, key-for-key identical to the French tree (774 keys). `t()` now resolves through the active dictionary and falls back to French for any key a future language does not define yet.
- `tests/i18n.test.ts` enforces the contract: same key set both ways, no empty value, placeholder interpolation, and unknown keys returned verbatim — so a missing translation fails the build instead of showing a blank label.
- Language is a workspace setting, not a hard-coded choice: Paramètres → Entreprise → « Langue de l'interface » (fr/en), stored in `settings_extra.ui_language`, journalled, refused with 422 for an unsupported code. The English *variant* (US/GB spelling) is left to the owner, per the plan review.
- `GET /api/public/language` lets the sign-in and setup screens read the language before a session exists; `src/main.tsx` reads it before the first render and falls back to French when offline.
- `api.put` added to the client (the setting endpoint is a PUT).
- Gate: 94/94 tests (7 new), typecheck + build clean; live walk [EXECUTED]: public endpoint 200, switch to en 200 → endpoint returns en, unsupported code 422, switch back to fr 200 → endpoint returns fr, two journal entries.

## 2026-10-29 — T-107 editable expense categories DONE (M6, R-A / DEF-SESSION-02)
- New `expense_categories` table (key, label, sort, archived) seeded with the 12 former enum values, so existing expenses keep a readable label; schema bumped to v5 with an additive, idempotent migration.
- `GET/POST/PATCH/DELETE /api/settings/expense-categories` (settings.read to list, settings.write to change); adding or renaming a category is journalled (`activity.expense_category_added|updated`), and a category that already has expenses can only be archived, never deleted, so history stays readable.
- `POST/PUT /api/expenses` now validates the category against the table (an unknown **or archived** key is refused with 422 `details.category = unknown`) instead of the removed `EXPENSE_CATEGORIES` constant; the constant is deleted from `shared/domain.ts`.
- UI: the expense form lists the active categories from the API and links to the new management card in Paramètres → Facturation (add, rename, archive); every label comes from the dictionary, with `categories.<key>` kept only as a translation fallback for the seeded keys.
- Gate: 87/87 tests (3 new), typecheck + build clean; live walk [EXECUTED]: 12 seeded categories listed, new « Entretien véhicules » created 201, expense with it 201, unknown key 422, archived key 422, three journal entries present.

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

## 2026-10-29 — T-102b import wizard UI DONE (M7)
- New screen `/importer` ("Importer des données" under Administration, gated by the data type's write permission): step 1 pick clients/products and download the template, step 2 load a `.csv` file or paste its content, step 3 preview every row with its create/update action and French error wording, step 4 explicit confirm or explicit "exclude the rows in error" consent, step 5 result report with the imported identifiers and a link to the list.
- All wording goes through the French dictionary (new `import` block + `nav.import`); no string is hard-coded in the component.
- Gate: 77/77 tests, typecheck and build clean. The wizard consumes endpoints already verified live in T-102a; its own browser rendering could not be exercised in this environment (no browser), which is recorded rather than claimed.

## 2026-10-29 — T-102c invoices import DONE (M7, last R1 task)
- `server/lib/import-invoices.ts`: invoice template (one row per line item, two example rows of the same document), client resolution by e-mail / client number / exact name, grouping by invoice number, and validation of document-level consistency, unknown clients, existing numbers, ISO dates, positive quantities, integer amounts and TVA status.
- `POST /api/import/preview|commit/invoices`: preview lists the grouped documents and every row with its issues; commit refuses the whole file unless the user explicitly excludes invalid rows, applies the accounting-period lock, computes totals with the shared tax engine (tax buckets mirrored), and creates **draft** invoices so nothing is marked sent or paid by an import.
- `GET /api/export/invoices` now emits one row per line item with the import's exact headers, closing the round-trip for invoices.
- Fixes found while testing: the template's annotation row had to be skipped by the invoice validator too (it was counted as a data row); the template example client is a placeholder, documented in the test.
- Gate: 84/84 tests (7 new invoice-import tests), typecheck and build clean; live walk [EXECUTED]: preview grouped 2 rows into 1 document, commit 201 (FAC-2026-9001, draft, total 80 040 = 69 000 HT + 16 %), re-import refused 409, export header identical to the template with one row per line.

## 2026-10-29 — R1 release gate executed
- Full end-to-end walk on the running application (14 checks): client → quote → approve → convert → send → payment → paid → refund credit note → send → apply to another invoice → export → import → journal → viewer permission refusal. Report: `docs/build/reports/R1-release-gate.md`.
- Defect found and fixed: the invoice-side credit application updated the credit's counters manually and left a fully used credit in status « envoyé ». It now recomputes the credit from its allocations (`recalcCredit`), so the status reads « utilisé ». Re-verified live in the same walk.
- Regression: 84/84 unit tests, typecheck and build clean after the fix.

## 2026-10-29 — Accountant blocker closed + plan re-sequenced
- **T-100 DONE (owner decision, no accountant available).** The fiscal defaults are now ordinary settings grouped in Paramètres → Taxes → « Valeurs fiscales par défaut »: retention 10 years, franchise ceiling 10 000 000 XPF; tax-status wording stays driven by the company record (`vat_regime` + `legal_notes`). Server: `settings_extra` gains `franchise_threshold` and serves documented defaults; a new `PATCH /api/settings/extras` validates both values and journals one `activity.settings_extra_changed`. Interface states plainly that these are standard defaults, not a legal validation.
- Verified live: GET returns the defaults, PATCH saves and journals, an invalid retention (0) is refused with 422. 84/84 tests, typecheck and build clean.
- `TODO.md` rewritten as seven dependency-ordered phases with a graph and a blocker register; `BUILD-PLAN.md` records the revised order; `PLAN-OPEN-QUESTIONS.md` and audit `09-open-questions.md` close the accountant items.
- Two plan additions: **T-108a** (quote and credit-note PDFs — they do not exist) and **T-103** now depends on it; the parity matrix row PAR-OUT-001 was corrected accordingly.
- Remaining blockers are platform-only: PQ-1 (scheduled trigger), PQ-2 (outbound e-mail + provider), PQ-3 (upload ceiling), plus owner meaning of « locations ».

## 2026-10-29 — T-108a quote and credit-note PDFs DONE (M4)
- New builder `server/services/pdf-documents.ts` (shared typography with the invoice builder, which is left untouched): title DEVIS/AVOIR, client block, line table with per-line TVA status ("Exonéré" or rate), totals with the "Total avoir" label for credits, company legal mention, quote terms, footer, pagination.
- Routes `GET /api/quotes/:id/pdf` and `GET /api/credits/:id/pdf`, gated by `quotes.read` / `credits.read`, `Cache-Control: no-store`, filename from the document number.
- UI: « Télécharger le PDF » on the quote detail header and on every credits-list row (link carries the session cookie, like the existing invoice download).
- Gate: 87/87 tests (3 new PDF tests incl. pagination), typecheck and build clean. Live: DEV-2026-0020 → 200 `application/pdf`, 2 290 bytes, `%PDF` magic; AV-2026-0001 → 200, 2 115 bytes; anonymous request → 401.
- Audit correction closed: PAR-OUT-001 now `CONFORMING` for invoice, quote and credit note; only layout variety stays `PARTIAL` (T-108).
