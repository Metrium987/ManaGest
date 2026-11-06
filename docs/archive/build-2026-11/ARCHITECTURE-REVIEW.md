# Architecture, resource use and hosting limits — plain-language review

Written 2026-10-29 at the owner's request. Every figure below was measured on the current code, not
estimated from memory. Figures I could not verify are marked **UNVERIFIED** and paired with a test that
would settle them.

---

## 1. Verdict in one paragraph

The application is small, boring in a good way, and cheap to run. It is one Worker (a single server
program) plus a SQLite database, a React front end, and nine runtime libraries — no framework stack, no
queue, no container, no background daemon. A page load costs a handful of SQL queries; a PDF costs a few
tens of milliseconds of CPU. Nothing in the code grows with the number of *years* of history except the
activity journal, which needs a retention policy before it becomes the largest table. The real risks are
not performance: they are (a) missing rate limiting on the new public link endpoints, (b) the journal
growing without bound, (c) a missing composite index or two once there are tens of thousands of documents,
and (d) features that depend on platform capabilities I still cannot verify (outbound e-mail, scheduled
runs, file storage).

---

## 2. Measured facts

| Item | Value | Where it comes from |
|---|---|---|
| Server bundle | **1.9 MB** (1 946 514 bytes) | `dist/worker/index.js` |
| Browser bundle | **956 KB** including fonts | `dist/client` |
| Runtime dependencies | **9** (react, react-dom, react-router, tanstack query, hono, zod, pdf-lib, lucide, fonts) | `package.json` |
| Source files | **100** TypeScript/TSX files | `server/`, `src/`, `shared/` |
| Database tables / indexes | **34 tables / 29 explicit indexes** | `server/db/schema.ts` |
| Route registrations | **138** | `server/routes/*.ts` |
| Unit tests | **108**, run in ~0.5 s | `npm test` |
| List page size | capped at **100** rows per request (default 25) | `server/lib/validation.ts` |
| CSV export cap | 5 000 rows per export | `server/routes/export.ts` |

Per-request work: schema provisioning is cached per Worker instance, so a warm instance does **no** DDL and
no version query; a cold one runs two small `SELECT`s. A dashboard load issues about ten aggregate queries
(measured in `server/routes/dashboard.ts`), each hitting an index or a small table. The heaviest single
operation is PDF generation (pdf-lib, ~10–40 ms of CPU per document, no image processing).

---

## 3. What is genuinely well designed

1. **Thin, single-purpose server.** Hono routes call small modules; there is no ORM layer re-reading the
   schema, no dependency injection container, no background framework. Fewer moving parts means fewer
   surprises in two years.
2. **Money as integers, tax in one place.** Amounts are stored in minor units and every total comes from a
   single tax engine (`server/lib/tax.ts`), unit-tested, rather than from ad-hoc arithmetic spread across
   screens. This is the single most important decision for an invoicing product and it was made correctly.
3. **The database does the aggregating.** Reports, the VAT recap and the dashboard group in SQL instead of
   loading rows into the Worker and summing them there. Memory use therefore does not depend on how many
   invoices exist.
4. **A tax mirror instead of replaying JSON.** `invoice_tax_lines` is written from the same computation as
   the stored totals, so a VAT return is a `GROUP BY`, not a loop over documents.
5. **Server-side permissions, proven by a test.** Every route carries a permission check, and an invariant
   test fails the build if a new route is added without one (with a documented allowlist). This is rare and
   is what makes the multi-user story trustworthy.
6. **Audit trail with a hash chain.** The activity journal is append-only and verifiable, which matters for
   an accounting-adjacent product.
7. **Documents produced on demand.** No stored PDFs means no orphaned files, no storage bill, and a document
   always reflects the current template.
8. **Nothing hard-coded that the owner is likely to change.** Tax rates, wording, numbering patterns,
   categories, layout, language and sizes are settings (the R-A requirement), verified as rows, not constants.

---

## 4. Where it will hurt, and what to do about it

| Risk | Why it matters | Severity | Cheap mitigation |
|---|---|---|---|
| **Activity journal grows forever** | It is written on every sensitive action and never pruned. At a few hundred actions a day it stays small for years, but it becomes the biggest table and slows integrity checks. | Medium | Add a retention/archival job (export a year to CSV/R2, then delete) — same protected-endpoint mechanism as the daily run. |
| **No rate limiting on `/api/public/documents/*`** | Tokens are 256-bit so guessing is hopeless, but nothing stops someone hammering the endpoint and burning CPU (each call is a query; `/pdf` is CPU work). | Medium | Add a per-token counter (e.g. 60 views/hour) using the existing `public_link_access` table; refuse beyond it. |
| **Index coverage at volume** | 29 indexes for 34 tables is reasonable, but hot list queries filter on `status` + `date` and join on `client_id`. At ~50 000 invoices a full scan starts to show. | Low now, Medium later | Run `EXPLAIN QUERY PLAN` on the ten list screens with 50 000 seeded rows, add composite indexes where a scan appears. |
| **1.9 MB Worker bundle** | Almost all of it is pdf-lib, parsed on every cold start. Cold starts stay fast because nothing else is heavy, but it is the one number worth watching. | Low | If cold starts ever hurt, move PDF generation to a second Worker or a lighter renderer; not needed today. |
| **No global HTTP rate limit** | Sign-in counts failed attempts, but no other endpoint is throttled. | Low | Platform-level protection plus per-route counters if abuse appears. |
| **Reports recompute on every view** | A 12-month VAT recap is a grouped query — cheap at this size, but it is not cached. | Low | Cache the response for a minute per (report, range) if the screen is opened often. |
| **No automated backup yet** | T-000 recorded an export procedure, and the manual export exists, but nothing runs on its own. | Medium | Scheduled export to file storage (see §6), plus a restore drill already documented. |
| **Attachments not built** | Expense receipts and payment proofs (T-101) need object storage. Adding them later is fine; adding them *in the database* would be the mistake. | — | Use object storage, never base64 in D1. |

None of these is a design flaw. Two of them (journal retention, public endpoint throttling) are small,
well-understood pieces of work that the plan can absorb.

---

## 5. Hosting limits: what I can state, what I cannot

From the platform documentation available to me in this environment:

| Limit | Value | Consequence for ManaGest |
|---|---|---|
| Deployed code + assets per publish | 10 MiB total, 1 000 assets max | Current 1.9 MB Worker + 956 KB front end fits with room to spare. |
| Customer variables (secrets/settings) per project | 25 names across preview and production | Enough for an e-mail key, a scheduler token and a few others; must be tracked. |
| Published sites per account | 6 | Irrelevant unless several environments are published at once. |
| Secret file size | 5 120 bytes | Ample for API keys. |
| Storage bindings | SQL database (D1) and object storage (R2) can be provisioned per environment | The database is D1 today; R2 is the right home for attachments and backups. |

What I could **not** verify from the platform documentation, and would not guess:

1. **Database size ceiling and daily row-read/row-write quotas** on the plan in use. The underlying service
   publishes such quotas; I could not confirm the figures applicable here. **UNVERIFIED**.
2. **CPU time per request and per day** allowed to the Worker. A PDF is tens of milliseconds; a bulk import
   of 5 000 rows is heavier. The exact ceiling is **UNVERIFIED**.
3. **Whether scheduled triggers can be configured** on this platform (see §6.2).
4. **Whether outbound HTTPS requests from the Worker are allowed without restriction** (see §6.1).
5. **Maximum object size and total storage** for R2 on this plan. **UNVERIFIED**.

A practical way to settle 1–2 without risk: seed a scratch environment with 50 000 invoices and 200 000
lines, then time the dashboard, a list page, the VAT recap and a PDF. That is a measurement, not a guess,
and it can be deleted afterwards.

---

## 6. Undocumented capabilities — proposals to test

The owner asked for the best available option even when the platform is silent, on the understanding that
we test it and fall back if it fails. Each item below is one small experiment with a clear success
criterion and a fallback that already works.

### 6.1 Outbound e-mail (OQ-002)
- **Proposal.** Call a transactional e-mail HTTP API (Resend or Brevo: one `POST` with a JSON body) from the
  Worker using `fetch`, with the key stored as a platform secret. No SMTP, no library.
- **Test.** Send one message to the owner's own address from a temporary "Envoyer un e-mail de test" button;
  success = message received, provider dashboard shows the event, key never appears in the browser.
- **If it fails.** Keep the current fallback: PDF download + manual « marquée envoyée » + public link, which
  already lets a client read and accept a quote.

### 6.2 Daily scheduled run (OQ-003 / PQ-1)
- **Proposal A.** A platform-native scheduled trigger (cron) if one can be configured for this Worker.
- **Proposal B (works regardless).** A protected endpoint `POST /api/maintenance/daily-run` guarded by a
  secret header, idempotent per Tahiti calendar day, plus an external free scheduler calling it once each
  morning. This is the design already specified in the plan (T-104a).
- **Test.** Call the endpoint twice on the same day: the second call must report "already run today" and
  create no document. Then call it with a wrong secret: 403. Then with the right secret after clearing the
  day marker: documents generated once.
- **Fallback.** A manual « Lancer la génération du jour » button on the dashboard, already planned in T-104c.

### 6.3 File storage for attachments (OQ-009 / T-101)
- **Proposal.** Object storage (R2) bound to the Worker; a receipt is uploaded to the private bucket and the
  database keeps only its key, size and type. Downloads go through a permission-checked route, never a public
  URL.
- **Test.** Upload a 5 MB PDF and a 12 MB file: the first is accepted, the second refused with a clear French
  message; download returns the exact bytes; a user without the permission gets 403.
- **Fallback if object storage is unavailable.** Keep the 10 MB limit as a setting but disable attachments
  rather than storing files in the database — base64 in SQLite would inflate every backup and slow queries.

### 6.4 XLSX import (OQ-015 follow-up)
- **Proposal.** Accept `.xlsx` by converting it to CSV **in the browser** before upload, using a small
  spreadsheet reader loaded only on the import screen. The server keeps receiving the CSV it already
  validates; nothing changes in the import engine.
- **Test.** Convert a 2 000-row workbook and import it: every row appears in the preview, totals match.
- **Fallback.** CSV only (already working, with a downloadable template).

### 6.5 Backups
- **Proposal.** The in-app export (already built) plus a scheduled export to object storage: one CSV per
  table per month, retained 12 months, with the restore procedure from T-000.
- **Test.** Export, restore into a scratch copy, compare row counts and a checksum of the money columns.

---

## 7. Sustainability recommendations, in priority order

1. **Throttle the public document endpoints** (small, protects CPU).
2. **Journal retention**: archive then prune after the legal retention period (10 years by default, a setting).
3. **Scheduled backup to object storage**, with a quarterly restore drill.
4. **Query-plan review at volume** (50 000 invoices), then add composite indexes only where a scan appears.
5. **Keep the dependency list short.** Nine runtime libraries today; every added library is bundle bytes on
   a cold start and a future upgrade.
6. **Keep the money tests green.** The tax engine and the report shaping are the parts where a regression is
   expensive; they are already covered by unit tests, and the export/import round-trip is covered too.
