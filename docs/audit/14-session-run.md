# 14 — Executed session run (2026-10-28, local runtime wrangler dev / workerd)

App state: instance already configured ("Fenua Services", XPF) from earlier seed; setup wizard re-ran → correct refusal `ALREADY_CONFIGURED` [EXECUTED].
Login with the seeded owner account → 200, session cookies incl. CSRF cookie [EXECUTED];
wrangler-dev processes stopped after the session; no deployment touched.

| # | Flow step | Result | Observation |
|---|---|---|---|
| 1 | GET /api/health | 200 | |
| 2 | POST /api/setup/install (already configured) | 400 ALREADY_CONFIGURED | correct guard |
| 3 | POST /api/auth/login (wrong creds in first attempt script) | 401 INVALID_CREDENTIALS | correct |
| 4 | Login owner → GET /api/auth/me, /api/dashboard | 200 | |
| 5 | POST /api/clients | 201 | number CLI-0018 auto |
| 6 | POST /api/clients/:id/contacts | 201 | |
| 7 | POST /api/products | 201 | |
| 8 | POST /api/quotes → send → approve → convert | 200 each | DEV-2026-0010 → FAC-2026-0051 |
| 9 | POST /api/invoices/:id/send | 200 | |
| 10 | POST /api/payments partial (10 000) | 201 | REG-2026-0026, allocated 10 000; invoice status → partial |
| 11 | POST /api/credits | 201 | AV-2026-0011 |
| 12 | POST /api/credits/:id/apply inside chained seq | non-2xx once; immediate retry → {ok:true}; isolated repro → ok | logged as anomaly 14-A |
| 13 | POST /api/recurring-invoices + /run | 200 | invoice generated |
| 14 | POST /api/expenses (category slug) | 201 |
| 15 | GET settings, tax-rates, activity, /api/activity chain verify | 200; verify {ok:true, checked:208} |
| 16 | GET /api/clients?format=csv | 200 CSV | round-trip header present |

Validation errors seen (script-side field-name faults, but they expose the real schemas): `display_name` (clients), `unit_price` + line `id`/`tax_rate` required per line (quotes/credits/invoices/recurring), expense `category` is a **server-side fixed enum (supplies…other)** — OQ-011 promised user-editable categories; currently the API enforces a fixed list → recorded as PARTIAL in the backlog R2.

Tag convention rows here: [EXECUTED]. Screens were NOT claimed — no browser automation in this environment; screen descriptions in the sheets stay [OBSERVED]-only.
ANOMALY 14-A (RESOLVED 2026-10-28): root cause = audit-script payload omission (`amount` missing in the first apply call of the walk script); the application behaved correctly in all reproduction runs — see the RESOLUTION section of `07-managest-defects.md`. DEF-SESSION-01 closed as no defect.
