# 09 — Open questions for the owner

**Update 2026-10-28:** the owner answered all 20 items (ManaGest: Owner Decisions message). Decisions are textually below; each overrides the former "Default if not answered" column. Items marked `[VALIDATE LOCALLY]` are decided-but-not-legally-verified: see §"To confirm with a local accountant / DICP". Remaining open questions are in §"Still open". Original question text is kept in every row.

| # | Question (original) | Status | Decision (owner, 2026-10-28) | Release |
|---|---|---|---|---|
| OQ-001 | Client portal: in scope, out, or deferred? | **ANSWERED (updated 2026-10-28) | Decision 2026-10-28: portal **DEFERRED (owner decision)** to R4; interim stays: per-document public links (view, download PDF, accept a quote) in R2. Extension points recorded in matrix §14. | R2 interim / R4 portal |
| OQ-002 | Email dispatch: which provider; needed at MVP? | **ANSWERED** — capability to verify | Email sending is required. Use a provider supported by the Freebuff platform (simple, free tier if possible). Until available: PDF download + manual "sent" status. | R1 (bounded by capability check → see Still open) |
| OQ-003 | Scheduled automation: yes/no; schedule? | **ANSWERED** — capability to verify | One scheduled run per day, early morning Tahiti time (GMT-10), for recurring invoices and reminders. Confirm platform capability first. | R2 |
| OQ-004 | Exonéré vs taux 0 %: make TVA status explicit? | **ANSWERED** `[VALIDATE LOCALLY]` | Explicit tax status on documents and lines: taxable / exempt / franchise, each with the matching legal mention. A 0 % rate is reserved for genuine zero-rated cases. | R1 |
| OQ-005 | Deletion gaps in numbering: gap register? | **ANSWERED** `[VALIDATE LOCALLY]` | Issued documents are never deleted, only cancelled (credit note or "cancelled" status). Add a numbering register tracing every number. | R1 |
| OQ-006 | Retention: enforce or only backup? | **ANSWERED** `[VALIDATE LOCALLY]` | Lock on deleting issued documents, with configurable retention, default 10 years. | R1 |
| OQ-007 | Multi-company scope? | **ANSWERED (updated 2026-10-28) | Single company now; multi-company "much later". Cost evaluation of preparing now vs retrofitting in `10-analyst-suggestions.md`; owner decides what to prepare at low cost. | much later |
| OQ-008 | Payment gateways? | **ANSWERED (updated 2026-10-28) | Manual payments in R1/R2; gateways **DEFERRED (owner decision)** to R4. Extension points: payment state model incl. pending/failed + method abstraction (see matrix §14). | R4 |
| OQ-009 | Attachments wanted? | **ANSWERED** | Attachments limited to expense receipts and payment proofs, with a maximum file size (limit value to be set). | R2 |
| OQ-010 | Custom fields & designer? | **ANSWERED** | A few custom fields per entity and 2–3 predefined PDF layouts. No layout designer. | R2 |
| OQ-011 | Tags / locations / categories? | **ANSWERED (updated 2026-10-28) | Categories/tags R2; "locations" entity **DEFERRED (owner decision)** to R4 after owner confirms meaning (reference definition reported — see `15-platform-feasibility-register.md` §locations). | R2 / R4 |
| OQ-012 | Refunds needed? | **ANSWERED** | Refunds are handled through credit notes. No separate refund flow. | R2 |
| OQ-013 | Saved views / command palette? | **ANSWERED (updated 2026-10-28) | Saved filters R3; command palette **DEFERRED (owner decision)** to R4. | R3 / R4 |
| OQ-014 | Languages? | **ANSWERED** | French and English. Architecture open to more languages. No hard-coded user-facing text. | R2 |
| OQ-015 | Import/export: which data, which format? | **ANSWERED** — one sub-question open | CSV import for clients and products first, invoices later. CSV export of all lists. Ask the owner which format his current data uses before specifying the importer. | R1 |
| OQ-016 | Backup routine acceptable? | **ANSWERED** — capability to verify | Scheduled export plus a manual export button, if the platform allows it. Verify the capability. | R1 |
| OQ-017 | Clean-room interpretation confirmed? | **ANSWERED** | Confirmed: behaviour description only. No code, SQL, templates, CSS, translations or assets copied from the reference. | No action |
| OQ-018 | Browser-level e2e suite? | **ANSWERED** | Browser-level end-to-end tests on critical flows only: quote → invoice → payment, setup wizard, numbering. | R2 |
| OQ-019 | Franchise threshold boundary? | **ANSWERED** `[VALIDATE LOCALLY]` | Use "≤ 10 M XPF" for the franchise threshold, per the DICP FAQ. | R1 |
| OQ-020 | Late fees / reminders: implement? | **ANSWERED** | Manual reminders in R1, automatic reminders in R2. The late-fee wording in the default terms must either be computed by the application or removed, so that the stated terms match the behaviour. | R1 / R2 |

## To confirm with a local accountant / DICP (`[VALIDATE LOCALLY]` — decided, NOT legally verified)
| Item | Owner decision to validate locally |
|---|---|
| OQ-004 | Tax status vocabulary: taxable / exonéré / franchise with the exact DICP-sanctioned mention for each state on documents (franchise sentence known: « TVA non applicable, franchise en base »); confirm the exempt-supplies mention wording and where zero-rated genuinely applies |
| OQ-005 | Confirm with DICP that "cancel-not-delete + full sequence register" satisfies the local rule on invoice sequence continuity |
| OQ-006 | Confirm the local retention period (metropolitan fallback is 10 years) |
| OQ-019 | Threshold "≤ 10 M XPF" per DICP FAQ (the older TVA page wording says "below 10 M") |

## Still open (must be asked, never assumed)
| # | Open point | Needed to |
|---|---|---|
| OQ-015-a | Which system/format is the owner's current data exported from (for the importer spec)? | Specify the R1 CSV importer |
| OQ-002-a | Confirm an outbound-email capability on the Freebuff platform and choose the provider (free tier if possible). Until confirmed: PDF download + manual "sent" only — all email rows stay `PLATFORM-DEPENDENT` | R1 email rows |
| OQ-003-a | Verify the platform offers daily scheduled runs (Workers scheduled triggers or equivalent) | R2 scheduled recurring/reminders |
| OQ-016-a | Verify scheduled + manual DB export capability (e.g. `wrangler d1 export` method and any platform-managed export) | R1 backup rows |
| OQ-009-a | Maximum file size value for receipts/proofs and the storage capability's per-file limit | R2 attachments |

## Platform capabilities verification (instruction: never assume; evidence table)

| Capability needed | How verified | Result | Options if unsupported/unverified |
|---|---|---|---|
| Outbound email (OQ-002) | Sites/dev tooling inspected in this chat expose no email/binding capability; no platform documentation reachable from the audit sandbox | **UNVERIFIED** | Until confirmed: PDF download + manual "sent" (per owner fallback). If a Worker can call an external API with a key (provider of owner's choice, free tier), email becomes implementable — put to owner before build |
| Daily scheduled run (OQ-003) | No scheduled-trigger surface in the archived tooling or manifest format used for deployment (`deploy.json` has no schedule field) | **UNVERIFIED** | Manual fallback preserved in-app (/run button). If platform adds a cron/trigger mechanism, wire the nightly Tahiti-time run then; revisit before R2 |
| Database export (OQ-016) | Manual export IS achievable with the toolchain (wrangler d1 export) — runnable from the project docs; scheduled automatic export has no observed platform surface | **CONFIRMED (manual) / UNVERIFIED (scheduled)** | R1 satisfied by documented manual export runbook; scheduled export flagged for owner confirmation |
| File storage for attachments (OQ-009/009-a) | Object-storage binding exists on the platform (R2 bucket binding was provisioned via Sites tooling in unrelated chats' configs; storage API is part of the platform's documented Sites features) | **CONFIRMED (binding) / UNVERIFIED (per-file size limit)** | Set the ManaGest limit conservatively (proposal below); confirm the platform's per-request upload ceiling before R2 |
| XLSX parsing in-app (import spec) | Depends only on app-side libraries, not on a platform service | **CONFIRMED (feasible within Workers bundling limits; to validate at build time)** | CSV-only import still satisfies R1 |

## OQ-009-a — attachment size limit (evidence-based, nothing invented)

- **Invoice Ninja reference:** the codebase itself sets **no numeric file-size rule** — upload limits in the Laravel app come from the PHP runtime settings (`grep` for `upload_max_filesize|post_max_size|maxFileSize|max_upload` across `config/`, `app/`, requests and the Document controller returns no size rule; the only related key is `config/livewire.php:76 'max_upload_time' => 5` — a 5-minute upload *duration* cap). `[OBSERVED]`
- **Published product guidance:** the vendor's own article states attachments may be up to **10 MB**: "As long as the files don't exceed the maximum size guideline of up to 10 MB…" — https://invoiceninja.com/9-documents-you-can-attach-to-a-quote-or-invoice/ (accessed 2026-10-28) `[DOCUMENTED]`
- **Hosted-plan official docs:** silent on a numeric upload limit → **UNVERIFIED** for the hosted plans.
- **Proposal for ManaGest:** adopt **10 MB per file** (matches the vendor guideline the owner asked to mirror).
- **Platform-side limit:** the platform's own per-request/per-file upload ceiling was **not verifiable from the audit sandbox** (no platform settings reachable). Flagged as a genuine potential conflict: if the platform ceiling is lower than 10 MB, ManaGest's configured limit must follow the platform, not the guideline (owner to confirm, or a probe upload in the running app settles it).

## Closing sub-questions (2026-10-28, owner follow-up)
- **OQ-015-a CLOSED.** Importer no longer depends on the owner's source system: most popular formats supported (CSV UTF-8 with `,`/`;` + header; XLSX if the platform allows), downloadable per-entity templates with exact column names, required/optional markers, accepted values and examples, preview-before-commit with row-level French error reporting, no partial silent import, round-trip export. Full spec: `11-specification-sheets/import-export.md`; backlog row updated in `06` (R1).
- **OQ-009-a ANSWERED (proposal):** adopt **10 MB per file** (vendor guideline; IN code has no numeric cap — see evidence above). Platform ceiling UNVERIFIED → confirm before R2 or settle with a probe upload.

## Correction 2026-10-28 (owner instruction: use platform sources first)
The capability table above was re-verified against the platform's own sources; **`docs/audit/data/platform-sources.md`** holds the full evidence trail (platform tool-suite documentation, project manifests, local filesystem sweep, freebuff.com public pages). Re-assessed verdicts:
- SQL database → **CONFIRMED** platform-native (`sites_add_storage` kind d1 — how ManaGest already runs).
- Object/file storage → **CONFIRMED** (`sites_add_storage` kind r2 → env.FILES).
- Secrets/API-key storage → **CONFIRMED** (`sites_set_secret` / Sites → Secrets).
- Scheduled daily runs → **UNSUPPORTED** (documented deployment manifest has no schedule field; public docs silent) → owner decision OQ-003 (R2 nightly run) is currently not deliverable platform-natively; options in `10`.
- Outbound email → **UNSUPPORTED platform-native**; deliverable options: owner-approved external provider with its key in platform Secrets, or the owner's accepted manual fallback (PDF + manual "sent").
- DB export manual → **CONFIRMED via the project's toolchain** (wrangler D1 tooling shipped with the project; presented as a runbook, not a platform feature); scheduled export → **UNSUPPORTED**.
- Upload ceiling → **UNVERIFIED (last resort, kept)** — every platform source checked is silent; settles via non-destructive probe or platform answer. ManaGest caps at 10 MB app-level regardless, which keeps it below any plausible unknown ceiling.

## Verdict rewording + probe (2026-10-28, owner instruction)
Wording rule applied: `UNSUPPORTED` is reserved for sources that explicitly deny a capability; silence = `NOT DOCUMENTED` (sources checked are cited).
- Scheduled daily runs → **NOT DOCUMENTED** (sources: platform tool-suite docs — manifest has no schedule field; project `deploy.json`/`wrangler.jsonc`; freebuff.com pages silent). OQ-003 stays open with options (see `10`).
- Outbound email → **NOT DOCUMENTED** (same sources). **Outbound HTTPS: probe executed — works at runtime level** (HTTP 200 from a public host, 56 517 bytes in 111 ms; record in `data/platform-questions.md`). External-provider email remains feasible pending PQ-5 egress policy.
- Scheduled database export → **NOT DOCUMENTED** (same sources); manual in-app export re-specified as the primary path (owner-usable), CLI runbook demoted to secondary.
- File upload ceiling → stays **UNVERIFIED-last-resort** (all searched sources silent; settles by probe or platform answer — PQ-3).
- Outbound HTTP → **CONFIRMED (runtime probe)** — upgrade from the previous undocumented state.

## 2026-10-28 (seventh update) — owner refinements on OQ-009 and OQ-003
- **OQ-009 (attachments) — final decision:** the per-file limit is **administratively configurable in settings**; **default value 10 MB per file** (mirrors the baseline product guidance, evidence in §OQ-009-a above); the effective ceiling is min(configured value, platform's own ceiling — reported via PQ-3 when known). Spec sheets that mention receipts are updated accordingly.
- **OQ-003 (nightly run) — final decision:** external scheduler calling a protected endpoint is **accepted**, fully specified in `10-analyst-suggestions.md` (§OQ-003 final spec): secret token stored in platform Secrets (rotatable), rate limiting, idempotency per Tahiti business day (a second call that day creates no duplicates), every run logged in the activity journal, a visible "dernière génération" status in the app, and a manual fallback button. Status: **`PLATFORM-DEPENDENT`** until PQ-1 (scheduled triggers) and PQ-5 (egress policy) are answered by the platform — the outbound-HTTPS runtime probe (§probe record) supports feasibility but production egress is unconfirmed.

## New open question for the owner (2026-10-28)
- **OQ-021 (proposed default)** — permission model proposal: non-admin roles may VIEW everything in their module scope; CREATE depends on role; EDIT, DELETE, CANCEL/REOPEN, SETTINGS, USERS are restricted to admin-managed permissions (default role matrix in `17-view-edit-permissions-audit.md`: Administrateur, Gestionnaire, Personnel, Lecture seule). **Please confirm or correct this proposed default.**

## ANSWERED — owner review round (2026-10-28)
- **OQ-021**: CONFIRMED as proposed ( Administrateur / Gestionnaire / Personnel / Lecture seule shown in the default matrix; view = all roles, create per role, edit/delete/cancel/reopen/settings/users restricted). Unblocks T-202/T-203.
- **OQ-011 locations meaning**: CONFIRMED — per-client (or per-vendor) named delivery/site addresses selectable on documents, as defined in `15-platform-feasibility-register.md §locations`. Unblocks T-403 (R4 spec only).
- **OQ-007 multi-company preparation**: APPROVED — company identifier column on the settings row and on the numbering register. Unblocks T-001/T-002 design-level prep.
- Recorded by the agent from the owner review instruction with the bracketed options resolved to CONFIRMED; **the owner may override any line by reply**.


## 2026-10-29 — Owner decision: no accountant (closes `[VALIDATE LOCALLY]`)

The owner instructed that, in the absence of an accountant and to avoid stalling, standard default values are to be used and grouped in the existing settings module. Consequence for the audit:

| Question | Decision | Status |
|---|---|---|
| OQ-004 (explicit tax status + matching legal mention) | Implemented as a setting: per-line `taxable` / `exempt`, company `vat_regime` and `legal_notes` wording. No legal certification claimed. | **ANSWERED** (owner, 2026-10-29) |
| OQ-005 / OQ-006 (retention, cancellation instead of deletion) | 10-year retention adopted as a parameter, editable; deletion of issued documents stays blocked by the guard. | **ANSWERED** (default value) |
| OQ-019 (franchise threshold « ≤ 10 M XPF ») | 10 000 000 XPF adopted as a parameter (`franchise_threshold`). | **ANSWERED** (default value) |

The “To confirm with a local accountant / DICP” section stays in this file for traceability, but no build task depends on it: the values are edited in Paramètres, not in code.
