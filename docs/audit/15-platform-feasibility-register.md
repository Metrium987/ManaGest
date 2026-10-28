# 15 — Platform feasibility register (2026-10-28)

Per-capability register: verdict (`CONFIRMED` / `UNSUPPORTED` / `NOT DOCUMENTED` / `UNVERIFIED` / `DEFERRED`), source, model constraint. Sources: `data/platform-sources.md` (S1 tool docs, S2 manifests, S4 freebuff.com) + probes.

| # | Capability | Verdict | Source / note |
|---|---|---|---|
| 1 | SQL database (D1, env.DB) | CONFIRMED | S1 `sites_add_storage` (kind d1) — current runtime |
| 2 | Object storage (R2, env.FILES, attachments) | CONFIRMED | S1 `sites_add_storage` (kind r2); per-file ceiling UNVERIFIED (PQ-3) |
| 3 | Secrets (env-stored keys, e.g. email provider, scheduler token) | CONFIRMED | S1 `sites_set_secret`; rotation via new requestId |
| 4 | Authentication | CONFIRMED | S1 `sites_enable_auth` (unused by current app design) |
| 5 | Realtime | CONFIRMED | S1 (unused in scope) |
| 6 | Runtime outbound HTTPS (calls to external providers) | CONFIRMED | probe `.tmp/probe-http` HTTP 200 — pending platform egress-policy answer (PQ-5) |
| 7 | Scheduled/background runs | **NOT DOCUMENTED** | S1 deploy manifest has no schedule field; S4 silent → external-scheduler endpoint accepted (OQ-003) |
| 8 | Outbound email | **NOT DOCUMENTED** | no platform surface documented → interim manual "sent" (OQ-002), provider key in Secrets at R2 |
| 9 | Manual database export (D1 SQL) | CONFIRMED | wrangler D1 export runbook (secondary to in-app primary export) |
| 10 | Scheduled export | **NOT DOCUMENTED** | → in-app export primary |
| 11 | XLSX parsing in-code | UNVERIFIED | feasible in JS (need build-time validation in R1) |
| 12 | Upload ceiling | UNVERIFIED | PQ-3; app-level cap 10 MB configurable regardless |
| 13 | Full client portal | **DEFERRED (owner)** | R4; extension points = per-doc public links, tokens, access logs (already spec'd) |
| 14 | Payment gateways | **DEFERRED (owner)** | R4; extension points: payment state model (pending/failed states + method abstraction — payments are currently completed-at-creation), payment-method registry |
| 15 | "Locations" entity | **DEFERRED (owner)** | R4 after owner confirms meaning; extension points: per-document address lines; see §locations below |
| 16 | Command palette | **DEFERRED (owner)** | R4; extension: nav labels already i18n-driven; no rework |
| 17 | Multi-company | much later (owner) | cost analysis in `10-analyst-suggestions.md` |

## §locations — what Invoice Ninja's "locations" actually is (owner, confirm what you meant)
In the reference (`app/Models/Location.php:1-80`), a **location** is a named address record **attached to one client (or one vendor)**: name (unique per company), address line 1/2, city, state, postal code, country, an "is shipping location" flag, and 4 custom values. Documents (quotes, invoices, credits) may carry a `location_id` validated against that client's locations (`StoreInvoiceRequest.php:88`). In user terms: **"adresses du client — siège, annexe, chantier ou point de livraison — choosing which address appears on a document"**. It is per-client addressing for multi-site customers, not a warehouse/stock-location concept. → Owner question recorded in `09-open-questions.md`: is this what you meant?

## Polynesian relevance cross-ref (2026-10-28)
SKIP rows of `18` (designer engine IN-DES-001, e-invoicing IN-EINV-*) are **not** platform capability questions — they are owner-relevance decisions; the register keeps only platform-verdict rows unchanged.
