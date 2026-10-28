# 10 — Analyst suggestions (method & deliverables; implemented only with owner approval)

| # | Suggestion | Rationale |
|---|---|---|
| 1 | Run the ≥30-entry Phase-6 self-check BEFORE the executive summary is frozen, then again a spot 10% recheck after parity rows pass 3 | Prevents the summary from certifying numbers that later change |
| 2 | Treat the parity matrix as the single source of backlog truth: each non-conforming row gets auto-linked backlog id (BK-…) | Avoids drift between 05/06 and keeps coverage counting coherent |
| 3 | Add a one-page "verdict distribution" chart (counts per verdict per module) to the executive summary | The owner reads numbers first |
| 4 | Group OQ items into decision-ready blocks (portal+email+cron as one "customer communication" decision; payments as one; documents as one) | Owner is not technical; fewer, higher-level questions |
| 5 | Consider a small demo tenant with seeded data as a permanent acceptance harness for each R-release (screenshots auto-uploaded to docs/audit/screenshots/) | Makes R1/R2 acceptance verifiable at UI level, not only API |
| 6 | For language fidelity: add a build-time check that every t() key exists in the dictionary and no leftover English strings ship | Auditable guarantee vs manual sweep |
| 7 | Numbering-gap register as an append-only log rather than a view over invoices | Simpler, tamper-evident, matches the hash-chain design already in place |

## 2026-10-28 — Decision assessments (OQ-001 public links, OQ-007 single company) + platform options

### Assessment A — OQ-001: replace the full client portal with per-document public links
**What the owner loses vs the baseline** (evidence: `routes/client.php` portal surface, `02` §IN-H): the baseline portal lets a client log in and self-serve — see all their documents, pay online in one click from any document, download history, view projects/tasks/statements, ask for cancellation of a recurring invoice, and manage payment methods. Public links deliver only: view one document, download its PDF, accept a quote. So the standing loss is: one-click online payment (out of scope anyway per OQ-008), portal-side documents, statements, subscription self-service, and client notifications.
**Risk analysis (public links)**: a public link is an authentication surface in itself. Requirements before shipping (R2): unguessable token (≥128-bit random, keyed to company+document), expiry setting (default e.g. 30 days), explicit revocation from the document page, access logging in the activity journal (who-nothing → but token-id/IP/date), rate limiting on the public routes, and PDFs only generated for the linked document. `IN` does this via invitation keys + `token_auth`/`verify_hash` middlewares — the same control design, mapped to a link.
**Recommendation: KEEP the decision**, with the link-security requirements above written into the R2 work item. Revisit trigger: if the owner later wants client-side payment intake or recurring cancellation requests, the portal conversation reopens (baseline evidence shows those flows need a contact identity).
**Single-company (OQ-007) cross-note**: portals and multi-company interact in the baseline (contact identity is per company). With single-company scope the public-link model is *simpler* — one hostname, one issuer — so OQ-007 removes a whole risk class from OQ-001. Coherent.

### Assessment B — OQ-007: single company only
**What the owner loses vs the baseline**: hosted Invoice Ninja interlinks up to 10 companies under one login and ManaGest's data model would grow company-scoping on every entity if revisited. Evidence: baseline `accounts/companies` pivot + `company_user`; ManaGest `company` single-row.
**Risk**: if the owner operates (or plans) adjacent legal entities (e.g. a service activity + a property activity), document separation, TVA filing and the audit register would all be impossible to split later without a migration of every table.
**Recommendation: KEEP for now** (owner's stated reality), with an explicit revisiting trigger: the moment a second legal entity is contemplated, scope R-geography before any new entity is created in ManaGest (documented here so the deviation stays traceable). Note the resulting simplification is real: one numbering register, one retention lock, one franchise status — less compliance machinery.

### Platform options for the PLATFORM-DEPENDENT rows (evidence table lives in `09`)
1. **Outbound email (OQ-002)** — Option 1 (recommended): external provider called over HTTPS from the app with an API key stored in platform Secrets (cost ≈ free tier for small volumes); select provider at implementation time. Option 2: owner-accepted interim fallback — PDF download + manual "sent" status until a provider is chosen (owner decision OQ-002 requires email; the fallback is interim, not final).
2. **Scheduled run (OQ-003)** — Option 1: platform cron/trigger when/if available (verify first). Option 2: documented manual daily step ("run the evening generation from the dashboard") — behavioural difference must be visible in the UI (a "généré manuellement" stamp).
3. **DB export (OQ-016)** — Option 1 (recommended): documented manual export runbook (CONFIRMED feasible) + manual button in-app. Option 2: scheduled platform export when the capability is confirmed.
4. **Attachments (OQ-009)** — Option 1: platform object storage binding (CONFIRMED to exist) with the 10 MB app-level cap; verify the platform ceiling first. Option 2 (if storage unsupported): receipt reference numbers typed manually — degraded, flagged as fallback only.

## 2026-10-28 — Option rewrite per platform-native rule (owner correction)
The earlier external-provider-first options are replaced by the platform-source verdicts (`data/platform-sources.md`):
1. **Scheduled daily run (OQ-003) — UNSUPPORTED platform-native.** Recommended: run the nightly generation/reminders as a documented operator step in the app (dashboard action, visible "généré manuellement" stamp), and record R2's automation as blocked on a platform capability. Alternative owner decision: revisit if the platform later exposes a trigger.
2. **Outbound email (OQ-002) — no platform-native email.** Recommended sequencing: R1 keeps the owner's accepted fallback (PDF + manual "sent"); if email is wanted in R2, choose a provider then, with its API key stored **platform-natively** in Sites → Secrets and the provider selected by the owner at implementation time.
3. **Database export (OQ-016) — manual CONFIRMED via the project toolchain (runbook in docs, not marketed as a platform feature); scheduled UNSUPPORTED.** R1 ships the runbook + in-app manual export button (CSV) — no platform dependency.
4. **Attachments (OQ-009) — storage binding CONFIRMED platform-native (env.FILES).** Spec uses the platform bucket with the 10 MB app-level cap; the only open point is the platform's own ceiling (probe or platform answer before R2).

## 2026-10-28 — OQ-003 kept open: options for the nightly run (not downgraded)
Since the platform's scheduled-execution support is NOT DOCUMENTED (not explicitly denied), these are the options for the owner — none silently replaced by a manual step:
1. **Protected run endpoint + external scheduler** (recommended path to automation): an app endpoint `POST /api/runs/daily` that a scheduler calls once per night. Requirements: bearer secret token stored in platform Secrets (rotatable), rate-limited, **idempotent for a given day** (same-day re-run does not duplicate documents), fully logged in the activity journal, and returning the per-entity result so a scheduler health check is meaningful. External scheduler: the owner's own tooling (host cron, uptime-monitor job, or any free scheduler able to call an HTTPS endpoint).
   Security risks + mitigations: token leakage (platform secret storage, rotation, no logging of the header); replay/double-run (idempotency key = business day in Tahiti); exposure discovery (no endpoint in index, rate limit, audit log of every call); blast radius (endpoint limited to recurring + reminders, read-only reports unaffected).
2. **Manual daily step** (fallback): operator clicks "run daily generation" in the dashboard; every run stamped "généré manuellement" in the journal so automation gaps are visible.
3. **Platform feature if PQ-1 answers yes**: wire the nightly run to the platform's documented scheduler once documented.
## Export primacy (owner instruction)
- **Primary (R1): in-app manual export** — owner-usable, no command line: per-list "Exporter" CSV buttons (see `11-specification-sheets/import-export.md` round-trip spec) + a settings-page "Exporter mes données" (JSON/CSV bundle of the key tables).
- **Secondary:** the wrangler-based D1 export runbook, documented for the administrator, not required for daily use.

## 2026-10-28 — OQ-003 final specification (accepted; `PLATFORM-DEPENDENT` until PQ-1/PQ-5 answered)
Endpoint: `POST /api/runs/daily`, called once per night by an external scheduler (owner-run cron/monitor). Requirements, all required:
1. **Secret token**: bearer token stored in platform Secrets (`sites_set_secret`), rotatable; unknown/missing token → 403; header never written to logs.
2. **Rate limiting**: e.g. max 3 calls/5 min/IP beyond which 429 (prevents scheduler misconfiguration from cascading).
3. **Idempotency**: run key = the Tahiti business day (Pacific/Tahiti) being processed; a second call for an already-processed day returns the stored result and creates **no** duplicate invoices/reminders.
4. **Logging**: every call (success/limits/rejection) recorded in the hash-chained activity journal with the day key and per-entity result summary.
5. **Visible status**: dashboard "dernière génération automatique" card (date + result of the last scheduler call, last manual run separately stamped).
6. **Manual fallback**: "Générer maintenant" dashboard button running the same routine, stamped "manuel" in the journal.
`PLATFORM-DEPENDENT` verdict remains until: PQ-1 (does the platform document external calls/scheduler compatibility?) and PQ-5 (egress policy) are answered; the runtime probe already confirms HTTPS out is possible in the runtime.

## 2026-10-28 — OQ-007: cost of preparing for multi-company now vs later
Analysis across the current data model and settings surface (`server/db/schema.ts`, `server/routes/settings.ts`).
**Everything needing company-scoping later (each currently single-valued):** company details table itself; numbering sequences (`number_sequences` keys on entity+period only); tax rates/franchise regime + threshold; invoice defaults (terms/footer, pattern); users (the DB has a company column inherited from design — verify at build); activity journal entries; periods; email/PDF configuration; retention lock; expense categories; public-link token space.
**Prepared now at low cost (design rules only, no multi-company UI — recommended subset, owner decides):**
1. Keep all settings in one parameterised row with a `company_id` column defaulting to 1 — costs nothing now, avoids a schema rewrite later (already true for most tables if the column exists in the schema; flagged for verification).
2. Numbering: keep sequences keyed `(entity, period)` but store them with the owning company id in the register so per-company sequences can be added later without rebuilding.
3. Storage and exports stay single-company per database today: if a second company is ever wanted, the platform model is "one site database per company" — an order of magnitude cheaper than intra-database tenancy.
**Deferred expensive retrofit (not prepared now):** tax/franchise status and retention rules per company; intra-database scoping of activity journal and periods (already company-column-adapted if column exists).
**Recommendation:** prepare items 1–2 now (near-zero cost), treat a second company as a separate site/database on the Freebuff platform. Owner decides.
