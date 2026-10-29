# Platform questions — ready to send to Freebuff support (2026-10-28)

Each question states which audit item it unblocks. Sources already searched are listed in `data/platform-sources.md`.

| # | Question (ready to copy) | Unblocks |
|---|---|---|
| PQ-1 | Does a hosted Sites project support scheduled/background execution (cron or equivalent) — e.g. a nightly job at a fixed Tahiti time? If yes, how is it declared (manifest field/dashboard) and what fidelity/limits apply? (Platform docs and the Sites deployment manifest we use show no schedule field.) | OQ-003 — nightly recurring-invoice/reminder run (R2, decision BK-003) |
| PQ-2 | Can a hosted site send outbound email — natively or via a configured provider integration? If external providers are intended to be called over HTTPS from the app, is that the platform's documented approach, and is the API key managed through Sites → Secrets the supported pattern? | OQ-002 — R1/R2 email rows (PAR-OUT-002) |
| PQ-3 | What is the maximum per-request/per-file upload size (and any rate/shaped limits) for a hosted Sites deployment? We plan a 10 MB app-level cap for expense receipts / payment proofs. | OQ-009-a — attachment limit (R2) |
| PQ-4 | Does the platform provide database export/backup for a hosted Sites project (manual button, scheduled dumps, or a documented official command)? If not, is the project's own wrangler-based D1 export an acceptable documented runbook? | OQ-016 — R1 backup rows |
| PQ-5 | Is outbound HTTPS from a hosted Sites app unrestricted (to arbitrary public hosts, e.g. provider APIs), or is there an egress allowlist/policy? | Confirms the OQ-002 email option + PQ-2 |

## Probe record (executed 2026-10-28, non-destructive)
- What ran: a tiny probe Worker (scratch file `.tmp/probe-http/worker.ts`, not part of the application's built/deployed code) running on the platform's local runtime (wrangler dev / workerd, same runtime family the deployment manifest targets), fetching `https://1.1.1.1/` with GET, no data, no email.
- Result: **success — HTTP 200, 56 517 bytes in 111 ms.** (An initial attempt to `example.com` timed out at 8 s; a retry against the fast-responder above succeeded, so the first result was endpoint-specific, not an egress block.)
- Interpretation: outbound HTTPS **works at runtime level** → the external-provider option for email (key stored in platform Secrets) is technically feasible from the app. Residual uncertainty: whether production egress has a platform policy — that is PQ-5.
- Reversibility/clean-up: probe processes were stopped after the run (ports closed: 8791, 8792 — verified); the app's local dev server on 8787 was also stopped in the cleanup (restartable with `npm run dev:api`). Scratch files remain under `.tmp/` only.
