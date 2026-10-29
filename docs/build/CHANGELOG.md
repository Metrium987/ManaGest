## 2026-10-29 — R4 extension points written down (T-401, T-402, T-404)
- **Documents, not code**, as the owner decided: `docs/build/R4-EXTENSION-POINTS.md` specifies the client portal wrapper, the payment pending/failed states with a method registry, and the command palette.
- **Each row states what already exists**, so the later build reuses it instead of inventing a parallel mechanism: per-document links, allocations-based balances, the permission-aware search endpoint.
- **The security decisions are spelled out** where they are not obvious: a portal link lives in its own table so it can never be confused with a document link, every portal query is scoped by client in the `WHERE`, and every reader of payments must filter on `completed` — a pending payment that settles an invoice is a money bug.
- **T-403 stays blocked**: writing a « locations » specification would invent a business model before the owner has said which one.
- Gate: documentation only, no code touched, suite still 186/186.

## 2026-10-29 — The daily pass becomes visible and triggerable (T-104c)
- **The dashboard now says when the pass last ran**: `last_run` (day, status, start/finish, stored summary) on the dashboard payload, and a « Passage quotidien » card showing the last result, its date and the counts — in both dictionaries.
- **A button for the workspace that has no scheduler**: `POST /api/runs/daily/manual`, requiring `recurring.write`. It is not a second implementation — it shares the day claim with the machine endpoint, so a double click, or a click while the scheduler is running, still yields at most one pass. The card itself only needs `reports.read`.
- Gate: typecheck clean, **186/186 tests over 15 files**, production build clean. Live [EXECUTED]: dashboard returned `last_run` with its summary; the manual call answered `already_ran: true` instead of regenerating; the same call without the CSRF header was refused 403.
- **Not claimed:** no browser walk of the card, and the button has only been pressed on a day already run — its executing path is the same pipeline proven by the scheduled walk.

## 2026-10-29 — Reminders that remember what was already said (T-105)
- **The gap was memory, not scheduling**: a reminder existed only as a journal line, so nothing could tell whether this client had already been reminded. `invoice_reminders` stores (**invoice**, **level**) as a unique pair — levels 1, 2, 3, one per interval (7 days by default, a setting).
- **A pass records every missing level, in order**, so a client who fell three levels behind while the scheduler was off gets the sequence once instead of a single confusing entry — and never a repeat.
- **Manual and automatic cannot double up**: « Relancer » now records its level in the same table, so the next morning's pass knows the person already acted.
- Gate: typecheck clean, **186/186 tests over 15 files** (10 new), production build clean. Live [EXECUTED]: two invoices 10 days late → one pass recorded 3 levels with 3 journal entries; a following pass recorded **0** and the table stayed at 3 rows; a manual reminder on a draft invoice was correctly refused `409 INVOICE_NOT_OPEN`.
- **Not claimed:** no message leaves the machine — PQ-2 still gates delivery, so a reminder is a recorded, auditable intention; no screen shows the reminder history yet; the manual path was verified by its refusal and by unit tests rather than by a live success.

## 2026-10-29 — A daily pass that cannot run twice (T-104a/b)
- **The scheduler's entry point exists**: `POST /api/runs/daily`, authenticated by a platform secret in **constant time**, with **no session accepted** — a machine token, not a browser cookie. 10 attempts per hour per IP, missing or wrong token refused, missing secret refused with a message naming the secret.
- **Twice a day is a no-op, not a duplicate**: the Tahiti day is the primary key of `daily_runs`, claimed by a conditional insert, so the second call returns the first run's stored summary and generates nothing. A failed or skipped day remains retryable, and only one caller wins that retry.
- **Catch-up, bounded**: active templates generate their missed cycles one by one so numbering stays continuous, capped at 12 cycles per template and 50 templates per pass. Each template succeeds or fails on its own; a closed period makes the whole pass `skipped` instead of writing into locked books.
- **One engine, two callers**: the generation was extracted from the manual route into `server/services/recurring.ts`, so the button and the pipeline cannot drift apart on money.
- Gate: typecheck clean, **176/176 tests over 14 files** (18 new), production build clean. Live [EXECUTED]: three active templates (one two months late, one due today, one in November) → 4 invoices `FAC-2026-0008…0011`, count 7 → 11, all drafts and linked to their template; second call same day `already_ran` and count still 11; no token 401, wrong token 401, `Bearer` 200, 11th call 429, restart without the secret 503, journal entry written.
- **Not claimed:** no external scheduler was configured (PQ-1 stays with the owner), the 429 was measured from a single address, and reminders are still T-105. **Found by the walk:** a new recurring model is created as `draft`, so it does not auto-generate until it is activated — the pipeline only picks up `active` templates.

## 2026-10-29 — Receipts for expenses and proofs for payments (T-101)
- **The file lives in the database, chunked**: 256 KiB rows, so a receipt does not need an object bucket that this hosting may not have. The 10 MB ceiling (1–25) is a setting, clamped rather than refused when someone stores nonsense.
- **The permission is the record's, not the uploader's**: a receipt needs `expenses.read/write`, a proof needs `payments.read/write`, through one helper the route-guard invariant now pins. A read-only account can open a receipt and cannot delete it — verified both ways.
- **Nothing is taken on trust**: the decoded bytes decide the size (not the declared one), only PDF/JPEG/PNG/WebP are accepted, the filename is reduced to its last path segment, and a download is sent as an attachment with `nosniff` — it is never rendered inline.
- Gate: typecheck clean, **158/158 tests across 13 files** (22 new), production build clean. Live on the local D1 [EXECUTED]: upload 201, list names the uploader, download returns the **same SHA-256** as the source, unsupported type 422, broken base64 422, unknown record 404, 1.5 MB refused once the ceiling is set to 1 MB, viewer reads 200 / deletes 403, payment proof 201, delete 204 then download 404, anonymous 401, two `attachment_added` and one `attachment_deleted` journalled.
- **Not claimed:** the MIME type is the browser's claim rather than a content sniff (bounded by never rendering inline), there is no antivirus pass, the panel was never opened in a browser, and multi-chunk reassembly is proven by unit test — the live walk moved 1.5 MB at most.

## 2026-10-29 — E-mail delivery finished, and the build it had broken (T-106)
- **The module was written but never verified**: no test, no TODO row, no changelog, and **`npm run build` failed** — `worker-mailer` imports `cloudflare:sockets`, which the Worker bundle did not mark external. `build:worker` now passes `--external:cloudflare:*`, because a runtime built-in cannot be bundled. A second type defect fell out of writing the tests: `MailSecrets` did not declare the keys the dispatcher actually reads, which had forced two `as` casts; the interface now names them.
- **What ships.** One settings row for the whole workspace: `manual` (the default — nothing leaves the machine), Resend, Brevo, or an explicit SMTP relay, each with per-document subject and body templates (`{{document_number}}`, `{{client_name}}`, `{{company_name}}`). Credentials are encrypted with AES-GCM under `MAIL_CONFIG_ENCRYPTION_KEY`; the API returns only `has_api_key` / `has_smtp_password`, and platform secrets (`RESEND_API_KEY`, `BREVO_API_KEY`, `SMTP_PASSWORD`) win over the stored ciphertext so a key can be rotated without touching the database.
- **Two deliberate restrictions.** SMTP is limited to ports 465/587 with a validated hostname (no IPv4 literal, no `localhost`/`.local`/`.internal`, no embedded port) so a workspace cannot aim the relay at the platform itself; and an outbound message is only sent by a person pressing « Envoyer » — no template is ever dispatched by a timer that does not exist yet.
- **Honest state.** A draft becomes `sent` **only** after the provider accepted the message; a failure answers 502 and leaves the document untouched, which is what the walk proves.
- Gate: typecheck clean, **136/136 tests across 12 files** (28 new), production build clean again (1.9 MB Worker). Live on a fresh local D1 [EXECUTED]: anonymous 401, owner GET 200, resend without credentials 422, key without encryption secret 503, write without CSRF 403, viewer refused on read, write and send (403), unknown kind/document 404, manual send 409 with the invoice still `draft`, saved credential stored as `v1.` ciphertext and never echoed, invalid provider key 502 with the document still `draft`, three journal entries.
- **Not claimed:** nothing was delivered — there is no provider credential, and 502 does not tell a provider rejection from a blocked call (checked separately: Resend answers 401 without a key). No browser walk of the panel; SMTP never opened a socket.

## 2026-10-29 — architecture, resource and hosting-limits review (no code changed)
- `docs/build/ARCHITECTURE-REVIEW.md`: measured figures (1.9 MB Worker, 956 KB browser bundle, 9 runtime
  libraries, 100 source files, 34 tables / 29 indexes, 138 routes, 108 tests), the eight design decisions
  worth keeping, eight scale risks with cheap mitigations, the platform limits I can state (10 MiB / 1 000
  assets per publish, 25 variables, 5 120-byte secrets, D1 + R2 bindings) and the five I cannot
  (database quotas, CPU ceilings, scheduled triggers, outbound HTTPS, object-storage size), each with a
  concrete test that would settle it.
- Proposes - to be tested, not assumed - outbound e-mail over an HTTP provider, a protected daily-run
  endpoint with an external scheduler, object storage for attachments, browser-side XLSX conversion, and a
  scheduled export backup.

## 2026-10-29 — T-207 local report outputs DONE (M10)
- **Two new reports, in the shape a Polynesian business actually hands in.** « Récapitulatif TVA » groups the taxable base and the VAT collected by month *and* by rate, with the exempt base kept in its own column; « Chiffre d'affaires mensuel » gives the turnover invoiced per month split taxable / exempt, plus the cash actually collected that month.
- Both read the same figures as the invoices (the `invoice_tax_lines` mirror, repaired on demand, and the invoice totals), so nothing is re-keyed and the reports cannot disagree with the documents.
- **Server-side CSV**: `GET /api/reports/export/:type` produces the file with French headers and a UTF-8 BOM, and writes `activity.data_exported` when it is used. The exempt base appears once per month in the CSV so a column total is never double-counted; the merge logic is a pure, unit-tested function.
- Both report types are selectable in Rapports, with summary cards; their export button uses the server file.
- Gate: 108/108 tests (5 new), typecheck + build clean; live walk [EXECUTED]: VAT recap 5 months, base 2 493 500 / tax 374 980 / exempt 110 000 / 54 documents, per-rate detail present; turnover taxable 3 311 880 + exempt 110 000 = 3 421 880, collected 1 902 700; both CSV exports 200 `text/csv` with the expected French header, unknown export type 404, two journal entries.

## 2026-10-29 — T-103 public per-document links DONE (M4, OQ-001 interim)
- **Model.** A link grants access to exactly one invoice, quote or credit note. The token is 32 random bytes, returned **once** at creation; only its SHA-256 digest is stored, so a database dump yields no working link. Lifetime is 1 to 365 days (default 30), and a link is `active`, `expired` or `revoked` — never two at once, with revocation winning over expiry.
- **Who may share.** Creating or revoking a link needs the *write* permission of that document's module (a read-only user can consult a document but cannot publish it); listing and the access log need *read*. The permission depends on the document type, so it is asserted inside the handler and pinned by the route-guard test.
- **Anonymous surface (token only).** `GET /api/public/documents/:token` returns the document and the company's public details; `/pdf` streams it in the workspace's layout; `POST /accept` accepts a quote, and only while it is still `sent` — the update is conditional, so two clicks cannot both succeed.
- **Traceability.** Every view, download and acceptance is written to `public_link_access` with IP and user agent, the counter is updated, and acceptance adds a journal entry (`activity.quote_accepted_public`); creation and revocation are journalled too.
- **UI.** A public page at `/p/:token` (outside the authenticated shell) shows the document, a PDF button and, for a quote, the acceptance form with an optional name. A « Partager » dialog on invoice and quote records creates a link, shows it once with a copy button, lists existing links with state and access count, and revokes them.
- Gate: 103/103 tests (4 new), typecheck + build clean; live walk [EXECUTED]: 201 on creation, anonymous view 200 JSON, anonymous PDF 200 `%PDF-` 2 722 B, owner list shows `active` with 2 accesses, anonymous acceptance 200 → quote becomes `approved`, second acceptance 409, revoke 200 → anonymous access 410, access log lists the acceptance, link to an unknown document 404.

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
