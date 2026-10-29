# 01 — ManaGest inventory (implementation under test)

Codebase root: ManaGest workspace root (see `00-recon.md`). Source: `server/**`, `src/**`, `shared/**`. The end-to-end audit executed 2026 session: 127/127 API checks pass (`.tmp/audit-api.mjs`), 41/41 unit tests pass — every `[EXECUTED]` tag below goes back to that run listed in `00-recon §2.3`. Line numbers cited from files as of audit day.

IDs: `MG-<MODULE>-<NNN>`, mirroring `IN-*` IDs so `05-parity-matrix.md` can cross-reference (MG module letters match IN's: INV, QUO, CRE, REC, PAY, CLI, EXP, PO, PRJTS, TASK, BANK, SET, AUTH, ACC, UI, JOBS, I18N, DATA).

---

## MG.A — Server architecture

| ID | Item | Evidence |
|---|---|---|
| MG-API-001 | One Worker; middleware chain: securityHeaders → withDatabase (schema ensure) → csrfProtection; API groups mounted under /api; unmatched /api/* → 404; everything else → ASSETS (SPA) | `server/worker.ts:18-27,60-67` `[OBSERVED]` |
| MG-API-002 | 19 route groups: setup, auth, clients, products, invoices, payments, quotes, credits, recurring-invoices, expenses, vendors, purchase-orders, projects, tasks, bank, dashboard, reports, search, settings, tax-rates, users, activity | `server/worker.ts:30-52` `[OBSERVED]` |

## MG.B — Accounting documents: invoices

| ID | Endpoint / rule | Behaviour | Evidence |
|---|---|---|---|
| MG-INV-001 | GET /api/invoices, /:id | List/detail with filters | `server/routes/invoices.ts:36,103` `[OBSERVED]` |
| MG-INV-002 | POST /api/invoices | Validation: zod schema per field (client_id, date, line_items with quantity/unit_price/tax_rate, discount) via `parseInput` then document totals computed by `computeTotals` (shared with client) | `server/routes/invoices.ts:141-193`; `shared/tax.ts:computeTotals` `[OBSERVED]` |
| MG-INV-003 | PATCH /api/invoices/:id | Edit draft-like invoices; after change recompute totals | `server/routes/invoices.ts:194-251` `[OBSERVED]` |
| MG-INV-004 | POST /:id/send | Draft (or sent-log) → SENT; stamps sent_at; cannot send if status not DRAFT (return 409); only existing transitions | `server/routes/invoices.ts:252-281` `[OBSERVED]` + `EXECUTED` (send twice → 409 second time, audit) |
| MG-INV-005 | POST /:id/cancel | Status → cancelled (if not paid?) | `server/routes/invoices.ts:282-312` `[OBSERVED]` |
| MG-INV-006 | POST /:id/duplicate | Duplicates as new draft + new number | `server/routes/invoices.ts:313-358` `[OBSERVED]` |
| MG-INV-007 | POST /:id/mark-paid | Requires payments.write; creates payment allocation & marks PAID; guard: cannot re-pay PAID (409) | `server/routes/invoices.ts:359-410` + e2e `cannot pay a paid invoice` 409 `[EXECUTED]` |
| MG-INV-008 | POST /:id/apply-credit | Applies existing credit note to invoice | `server/routes/invoices.ts:411-460` `[OBSERVED]` |
| MG-INV-009 | DELETE /:id | Soft delete — restricted to invoices.delete permission | `server/routes/invoices.ts:461-488` `[OBSERVED]` |
| MG-INV-010 | GET /:id/pdf | PDF generation (pdf-lib) | `server/routes/invoices.ts:489+`; e2e `invoice PDF` `%PDF-` `[EXECUTED]` |
| MG-INV-011 | Status machine | Statuses drawn from `DOCUMENT_STATUSES = ['draft','sent','partial','paid','cancelled']` — color derived from balance/paid | `shared/domain.ts:DOCUMENT_STATUSES` `[OBSERVED]` |
| MG-INV-012 | Numbering | `nextNumber` service: `{prefix}-{YYYY}-{####}` pattern + `number_sequences` table locking last used per entity+period | `server/lib/numbering.ts`, `server/db/schema.ts:number_sequences` `[OBSERVED]` |
| MG-INV-013 | Tax mirror sync | `syncInvoiceTaxLines` — one row per (invoice, rate) kept in sync with totals for reporting | `server/services/documents.ts`, `server/db/schema.ts:invoice_tax_lines` `[OBSERVED]` |

## MG.C — Quotes

| ID | Endpoint | Evidence |
|---|---|---|
| MG-QUO-001 | GET /, /:id, POST /, PATCH /:id CRUD | `server/routes/quotes.ts:29,62,74,119` `[OBSERVED]` |
| MG-QUO-002 | POST /:id/send; /:id/approve; /:id/reject; /:id/convert | Convert requires invoices.write, creates draft invoice; approve/reject statuses QUOTE_STATUSES `['draft','sent','approved','rejected','converted','expired']` | `server/routes/quotes.ts:150-255`; `shared/domain.ts:QUOTE_STATUSES` `[OBSERVED + EXECUTED (send/approve/convert in audit)]` |
| MG-QUO-003 | DELETE /:id | Soft delete | `server/routes/quotes.ts:256+` `[OBSERVED]` |

## MG.D — Credits (credit notes)

| ID | Endpoint | Evidence |
|---|---|---|
| MG-CRE-001 | GET/POST/PATCH, /:id/send, /:id/apply, DELETE | Balance & applied_amount maintained; apply updates invoice paid_total / balance | `server/routes/credits.ts:27-172` `[OBSERVED + EXECUTED (apply reduces credit balance & invoice balance in audit)]` |

## MG.E — Recurring

| ID | Endpoint | Evidence |
|---|---|---|
| MG-REC-001 | GET/POST/PATCH CRUD; POST /:id/status (start/pause/complete); POST /:id/run (on-demand generation); DELETE | Generates child invoice via `createDocumentFromRecurring`; advances next_run_date by monthly default etc. | `server/routes/recurring.ts:46-215` `[OBSERVED + EXECUTED (run creates invoice in audit)]` |
| MG-REC-002 | Frequency set: weekly/monthly/quarterly/semiannual/yearly | `shared/domain.ts:FREQUENCIES` `[OBSERVED]` |

## MG.F — Payments

| ID | Endpoint | Evidence |
|---|---|---|
| MG-PAY-001 | GET /, /:id; POST / (creates payment + allocations to given invoices); DELETE /:id | Allocation-backed payment recording; statuses simple; refund not implemented (see 07 defects) | `server/routes/payments.ts:33-171` `[OBSERVED]` |

## MG.G — Clients, products, expenses, vendors, POs, projects, tasks

| ID | Endpoint | Evidence |
|---|---|---|
| MG-CLI-001 | clients CRUD + /:id/statement + /:id/contacts | Statement uses invoices/credits/payments | `server/routes/clients.ts:33-234` `[OBSERVED]` |
| MG-PRD-001 | products CRUD + /:id/adjust-stock | Quantity tracked in thousandths (`quantity_milli`) | `server/routes/products.ts:24-104`; `server/db/schema.ts:products.quantity_milli` `[OBSERVED]` |
| MG-EXP-001 | expenses CRUD | Categories enum; vendor optional | `server/routes/operations.ts:34-127`; `shared/domain.ts:EXPENSE_CATEGORIES` `[OBSERVED]` |
| MG-VEN-001 | vendors CRUD | `server/routes/operations.ts:152-196` `[OBSERVED]` |
| MG-PO-001 | purchase_orders CRUD + /:id/status advancement | Statuses draft/sent/accepted/received/cancelled | `server/routes/operations.ts:217-283` + `shared/domain.ts:DOCUMENT_STATUSES` `[OBSERVED + EXECUTED (advance PO in audit)]` |
| MG-PRJ-001 | projects CRUD, tasks CRUD | statuses in shared/domain; `server/routes/operations.ts:304+` `[OBSERVED]` |

## MG.H — Bank & reconciliation

| ID | Endpoint | Evidence |
|---|---|---|
| MG-BANK-001 | bank accounts CRUD (GET/POST), transactions list, import, match, PATCH | match creates payment allocation and updates transaction status, invoice balance | `server/routes/bank.ts:16-133` `[OBSERVED + EXECUTED (import+match reduces invoice balance in audit)]` |

## MG.I — Reports & dashboard

| ID | Item | Evidence |
|---|---|---|
| MG-REP-001 | reports/:type supports revenue, profit-loss, tax, aging, client-sales, expenses | SQL aggregation with period filters; tax report reads `invoice_tax_lines` mirror | `server/routes/dashboard.ts:117+`; e2e `tax report returns rows` `[OBSERVED + EXECUTED]` |
| MG-UI-001 | dashboard endpoint returns KPIs + series; search endpoint across clients/invoices/quotes | `server/routes/dashboard.ts:16,258` `[OBSERVED]` |

## MG.J — Settings, users, periods, activity

| ID | Item | Evidence |
|---|---|---|
| MG-SET-001 | GET/PATCH company settings; tax_rates CRUD; users management (create/patch/reset-password); activity journal list + chain verify | `server/routes/settings.ts:58-319` `[OBSERVED]` |
| MG-SET-002 | Periods: POST /periods (close), DELETE /periods/:period (reopen), GET list; enforce-write guard checks document date → closed period | `server/routes/settings.ts:102-183`; `server/lib/locks.ts`; e2e `invoice blocked in a closed period` 409 `PERIOD_LOCKED` `[OBSERVED + EXECUTED]` |
| MG-SET-003 | `POST /settings/rebuild-tax-lines` — maintenance command to regenerate invoice_tax_lines | `settings.ts:184-200` `[OBSERVED + EXECUTED]` |
| MG-ACT-001 | `GET /activity` + `GET /activity/verify` — hash-chained journal (before/after JSON, ip, actor) | `server/lib/audit.ts` + e2e `chain intact` checks `[OBSERVED + EXECUTED]` |

## MG.K — Authentication, sessions, MFA

| ID | Item | Evidence |
|---|---|---|
| MG-AUTH-001 | POST /auth/login → session cookies (mg_session httpOnly)+CSRF cookie; login rate limit 8/15min via login_attempts table; DUMMY password hash for timing equalization | `server/routes/auth.ts:29-139`; `server/middleware.ts:csrfProtection` `[OBSERVED + EXECUTED (missing CSRF rejected)]` |
| MG-AUTH-002 | MFA: POST /auth/mfa/setup → base32 secret + otpauth URI (grouped display); /enable verifies TOTP and issues 10 recovery codes; /verify consumes 5-minute single-use challenge (password→TOTP two-step); /disable requires valid code; recovery codes hashed (SHA-256 of normalized code) | `server/routes/auth.ts:141-336` `[OBSERVED + EXECUTED (full MFA flow incl. challenged replay, recovery codes, disable)]` |
| MG-AUTH-003 | TOTP: RFC 6238, SHA-1, 6 digits, 30s window with ±1 drift; WebCrypto only (Workers compatible) | `server/lib/totp.ts` `[OBSERVED]` |
| MG-AUTH-004 | Sessions: idle+absolute expiry, sliding last_seen refresh, per-user session list & revoke-all-but-current, change-password revokes other sessions | `server/services/session.ts`; `auth.ts:402-470` `[OBSERVED]` |
| MG-AUTH-005 | Password policy: validatePassword (complexity + identity terms) | `server/lib/passwords.ts` `[OBSERVED]` |
| MG-AUTH-006 | CSRF: double-submit cookie + session-bound token + Origin check | `server/middleware.ts:csrfProtection` `[OBSERVED + EXECUTED (foreign origin + missing token blocked)]` |

## MG.L — Permissions & roles

| ID | Item | Evidence |
|---|---|---|
| MG-ROLES-001 | Roles: owner/admin/accountant/sales/viewer (ROLE_LABELS in French); permission list per role in ROLE_PERMISSIONS; owner=admin on permissions (last-owner protection on user mgmt); deletion restricted to owner/admin; accountant closes/reopens periods; viewer read-only without users/activity/periods reads | `shared/domain.ts:ROLES…ROLE_PERMISSIONS + comments` `[OBSERVED + EXECUTED (all role probes in audit pass, incl. negative permissions)]` |

## MG.M — i18n & localization

| ID | Item | Evidence |
|---|---|---|
| MG-I18N-001 | All user-facing text via `t(key)` from French single dictionary (`src/lib/i18n.ts`, ~707 lines); no other languages | `src/lib/i18n.ts` `[OBSERVED]` |
| MG-I18N-002 | Locale default fr-FR; timezone default Pacific/Tahiti; currency XPF (zero-decimals list also JPY); zero-decimal formatting | `shared/domain.ts:DEFAULT_*`, `src/lib/format.ts` `[OBSERVED]` |
| MG-I18N-003 | TVA_RATES: 16 / 13 / 5 / 0 (labelled "Exonéré" for 0) | `shared/domain.ts:TVA_RATES` `[OBSERVED]` — see 08 for the exonéré/franchise defect |

## MG.N — Front-end pages & shell

| ID | Page/route | Evidence |
|---|---|---|
| MG-PAGE-001 | /connexion (login), /installation (setup wizard) | `src/App.tsx:74-77` `[OBSERVED]` |
| MG-PAGE-002 | / (dashboard), /rapports, /clients, /clients/:id, /factures(+/nouvelle/:id/modifier), /devis(…), /paiements, /avoirs, /factures-recurrentes, /produits, /depenses, /fournisseurs, /bons-de-commande, /projets, /taches, /banque, /parametres, /parametres/utilisateurs, /journal, /profil | `src/App.tsx:82-113` `[OBSERVED]` |
| MG-UI-002 | AppShell nav: main (Dashboard/Reports), sales (clients/quotes/invoices/recurring/credits/payments), operations (products/expenses/vendors/PO/projects/tasks), finance (bank), admin (settings/users/journal) — permission-gated | `src/components/layout/AppShell.tsx:23-64` `[OBSERVED]` |
| MG-UI-003 | Global search; QuickAdd plus-menu; user menu w/ logout | `AppShell.tsx:82-231` `[OBSERVED]` |
| MG-UI-004 | Empty/loading states, toasts, modals, forms | `src/components/ui/{Layout,Toast,Modal,Form,Button}.tsx` `[OBSERVED]` |

## MG.O — Persistence

| ID | Item | Evidence |
|---|---|---|
| MG-DATA-001 | 15-table schema in `server/db/schema.ts` (owner's tables: app_meta, company, users, sessions, login_attempts, number_sequences, clients, client_contacts, products, tax_rates, invoices, payments, payment_allocations, quotes, credits, credit_allocations, recurring_invoices, expenses, vendors, purchase_orders, projects, tasks, bank_accounts, bank_transactions, activities, mfa_challenges, period_locks, invoice_tax_lines) plus legacy drop | `server/db/schema.ts` (449 lines, read) `[OBSERVED]` |
| MG-DATA-002 | Soft-delete columns (deleted_at) on main entities; archive flag on clients only | schema lines `[OBSERVED]` |
| MG-DATA-003 | Seed: 5 clients, 6 products, 7 invoices (mix statuses incl. partial), 1 quote, 1 vendor, 5 expenses, 1 project + 3 tasks, 1 recurring active, 1 bank account | `server/services/seed.ts` `[OBSERVED]` |

## MG.P — Known defects/restrictions discovered during build (carried to `07`)

- Payment refunds (partial/full) not implemented. `server/routes/payments.ts` has no refund endpoint.[OBSERVED]
- No client portal (admin-only app by design vs baseline's portal) — parity `DEVIATION-INTENTIONAL?` → owner question.
- Email sending absent: no SMTP/provider integration; documents dispatched without email.
- Recurring engine: manual runs + statuses; no cron scheduler inside the Worker (Workers cron bindings not configured) — next_run_date advanced on run only.

---
### Orientation note (course-correction, applies to this file)
This audit is a **functional/behavioural** comparison: ManaGest stays on the Freebuff platform stack the owner chose; the parity target is what a user can see, do and obtain. Entries above that describe server internals are kept only where they underpin a user-visible rule (e.g. `computeTotals` → what a user reads as HT/TVA/TTC). Any earlier storage/jobs/middleware framing in `docs/audit` evolution history has been replaced by `04-functional-entities-comparison.md`; platform effects are judged with `EQUIVALENT-BY-PLATFORM` / `PLATFORM-DEPENDENT` per mission §9, not as stack-fidelity gaps.
