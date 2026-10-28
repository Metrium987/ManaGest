# Raw research — 2026 small-business ERP/invoicing best-practice expectations

Source agent: researcher_web, run 2026-10-28. Feeds sections `06-correction-backlog.md` (BEYOND-REFERENCE flags), `10-analyst-suggestions.md`, and the executive summary's "what mature products do" checks.

## Framing
- Invoice Ninja is invoicing/expense/workflow-first, not a general-ledger ERP; review risk is expecting general-ledger depth.
- Distinguish hosted plan tiers; several capabilities are plan-specific.
- "Present" items (gap-list must NOT include these): bank feeds + auto transaction matching (Yodlee/GoCardless, plan-gated), PEPPOL e-invoicing + access point, multicurrency invoicing with manually locked invoice exchange rates, offline-capable mobile apps.

## 1) Security
| Expectation | IN public evidence | Implication |
|---|---|---|
| MFA with enforceable policy; passkeys; SSO options | Google Play lists 2FA + Google login. Passkey request is a (converted) GitHub discussion, no current first-party docs found for enforced MFA policy / SAML-OIDC / passkeys on web. [docs not found → pointer to ask vendor] | Test actual build: MFA enforcement scope, recovery, deprovisioning. |
| Least-privilege RBAC | User Management docs per-category View/Create/Edit + Administrator flag (bookkeeper example). https://invoiceninja.github.io/docs/user-guide/advanced-settings | Basic RBAC exists; check granular action-level roles, bank/export access. OWASP least-privilege/deny-by-default: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html |
| Comprehensive searchable audit history | Record-level history + email history documented per entity (invoice history, recurring activity). No public evidence of unified tamper-resistant log (logins, settings, exports, permissions). | Ask retention/export/admin access/integrity. |

## 2) Finance ops
| Expectation | IN evidence | Implication |
|---|---|---|
| Bank feeds + matching automation | Present (plan/country-gated); it is transaction→payment/expense matching, not ledger reconciliation. | Verify plan/bank coverage. |
| Multicurrency + period-end FX revaluation | Multicurrency invoicing + per-invoice locked exchange rate documented. No public evidence of GL revaluation engine (unrealised gains/losses, reversal, period-end history). https://invoiceninja.com/features/ | FX revaluation typical ERP control (ref: Dynamics 365). |
| Accruals and deferrals | Not established publicly (GL function). | Verify where books live. |
| Internal approval workflows | Client approval/signature on quotes and POs exists (auto-convert to expenses). No multi-step internal approvals/thresholds/delegation documented. | Quote/PO approvals ≠ internal finance approvals. |
| Period close + dual approval of period locks | Advanced settings has invoice-level locks (when sent/paid) but no accounting-period close evidence. https://invoiceninja.github.io/docs/user-guide/advanced-settings | Document-level lock ≠ period close; dual control is a sound custom expectation. |

## 3) E-invoicing/compliance
| Expectation | IN evidence | Implication |
|---|---|---|
| PEPPOL BIS Billing 3 / EN 16931 | Documented strength (own access point; country pages). Belgium mandate EN16931/Peppol-BIS from 2026-01-01 (ec.europa.eu country page). | Verify profiles per jurisdiction; not a gap. |
| Factur-X (FR e-invoicing) | Supported-format list has PEPPOL, ZUGFeRD/XRechnung, Facturae, Verifactu, FatturaPA, FACT1, EN16931 — **no Factur-X**. https://invoiceninja.github.io/docs/user-guide/einvoicing | Real IN-format gap candidate; ask vendor; FNFE: https://fnfe-mpe.org/factur-x/factur-x_en/ |
| Spain VeriFactu | Alpha status per docs; AEAT distinction between verifiable/non-verifiable systems. https://sede.agenciatributaria.gob.es/.../sistemas-verifactu.html | Public compliance sign-off not established. |
| Other regimes | Format support list ≠ live connections per country. | Check mandate-by-mandate. |

## 4) Integrations
| Expectation | IN evidence | Implication |
|---|---|---|
| Open banking/PSD2 | Yodlee (US-heavy) + GoCardless (UK/EU) on supported plans. | Check aggregator/bank coverage for the customer's country. |
| Stripe/GoCardless/PayPal | Documented gateways incl. token billing and refunds (per provider). | Correctly classified as collection, not accounting sync. |
| Accounting sync | API + automations page (expenses ⇒ QuickBooks/Xero use case). | Verify object scope/direction; no blanket native bidirectional sync claim. |
| CRM/calendar/Zapier/n8n | Middleware connections documented; CRM-contact use case. | Native calendar/CRM sync not established. |

## 5) Productivity
| Expectation | IN evidence | Implication |
|---|---|---|
| Saved views/command palette | Filtering documented; no evidence of reusable saved views or command palette. | Hands-on test item. |
| Mobile quality & offline | Offline edits + biometric lock + pagination documented (F-Droid listing). | Strength; test sync conflicts/attachments. |
| Multi-tab continuity | Reopens-where-left + biometric + offline listed; no dedicated multi-tab workflow evidence. | Usability-test item. |

## 6) Data longevity
| Expectation | IN evidence | Implication |
|---|---|---|
| Portable export | GDPR page: CSV/XLS/JSON export; Enterprise ZIP of documents; company/client purge options. https://invoiceninja.com/gdpr/ | Check exports cover attachments/audit/config. |
| Backup/restore | Self-host guidance to back up .env/db/app folder. https://invoiceninja.github.io/docs/self-host/self-host-troubleshooting | Manual recovery only; ask RPO/RTO/automated restore tests. |
| Archive integrity chain | Per-entity history documented; no public evidence of cryptographic archive chain for all records. AEAT non-VeriFactu integrity/traceability criteria as reference. | Depends on retention regime/jurisdiction. |
| GDPR export/deletion | purge + export paths exist. | Not absolute deletion; retention law caveats. |

## Bottom line (cited abridged)
Strong basics: gateways, bank feeds+matching (plan-gated), API/automation, offline mobile, portable exports, multi-format e-invoicing. Validate for ERP review: GL accruals + FX revaluation, internal approvals, period close/dual control, audit-log depth/permissions, jurisdiction-specific compliance beyond listed formats. Do not flag bank feeds/PEPPOL/offline as missing; do flag plan/time limits and unverified compliance claims.
