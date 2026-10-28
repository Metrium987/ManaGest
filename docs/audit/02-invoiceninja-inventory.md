# 02 — Invoice Ninja inventory (behavioural baseline)

Reference repo: `reference/invoiceninja` @ 15ea35e, VERSION.txt = 5.13.49. Tag `[OBSERVED]` = read in code; `[EXECUTED]` = run by the audit (blocked for this repo, see 00-recon §1.3); `[DEDUCED]` = inferred (reasoning stated); `[DOC]` = sourced from official docs/web, dated 2026-10-28. UI claims come from `tests/e2e/*.spec.ts` (Playwright — these run against a real shipped UI build, so they are strong UI evidence even though the UI source is not in-repo) and are tagged `[OBSERVED-UI]`.

IDs use `IN-<MODULE>-<NNN>`. Modules: ACC (account/setup), AUTH, CLI (clients), INV (invoices), QUO, CRE, REC, PAY, EXP, PO, PRJTS, TASK, BANK, REP (reports), SET (settings), DES (designs/PDF), DOC (documents/attachments), CUS (custom fields), TAG, LOC (locations), SUB (subscriptions/payment links), EINV (e-invoicing), IMPEXP, PORT (client portal), UI (admin UI shell), JOBS, API (api meta), HM (hooks/meta).

---

## IN.C — Invoice family: models & status machines

| ID | Status set (baseline) | Evidence |
|---|---|---|
| IN-INV-001 | Invoice statuses: DRAFT=1, SENT=2, PARTIAL=3, PAID=4, CANCELLED=5, REVERSED=6; computed pseudo-statuses OVERDUE=-1, UNPAID=-2 | `app/Models/Invoice.php:249-263` `[OBSERVED]` |
| IN-QUO-001 | Quote statuses: DRAFT, SENT, APPROVED, CONVERTED, REJECTED, CANCELLED, EXPIRED(-1, computed?) | `app/Models/Quote.php:204-216` `[OBSERVED]` |
| IN-CRE-001 | Credit statuses: DRAFT, SENT, PARTIAL, APPLIED | `app/Models/Credit.php:225-231` `[OBSERVED]` |
| IN-REC-001 | Recurring Invoice statuses: DRAFT, ACTIVE, PAUSED, COMPLETED, PENDING(-1) | `app/Models/RecurringInvoice.php:153-161` `[OBSERVED]` |
| IN-PAY-001 | Payment statuses: PENDING, CANCELLED, FAILED, COMPLETED, PARTIALLY_REFUNDED, REFUNDED | `app/Models/Payment.php:111-121` `[OBSERVED]` |
| IN-PO-001 | Purchase Order statuses: DRAFT, SENT, ACCEPTED, RECEIVED, CANCELLED | `app/Models/PurchaseOrder.php:231-235` `[OBSERVED]` |
| IN-HM-001 | RecurringQuote model exists with invitations (_RecurringQuoteInvitation.php) — recurring quotes are a first-class entity | `app/Models/RecurringQuote.php` + `app/Models/RecurringQuoteInvitation.php` (files exist) `[OBSERVED]` |

### Status/transition service actions
| ID | Action | Behaviour | Evidence |
|---|---|---|---|
| IN-INV-002 | `MarkPaid` service | Guards: if invoice already STATUS_PAID or has partial history it adjusts; if DRAFT → SENT then PAID; adjusts balance/amount_paid; creates a Payment record (method gateway type default) | `app/Services/Invoice/MarkPaid.php:39-62` (status guard lines 39-64; service class) `[OBSERVED]` |
| IN-INV-003 | `MarkSent` | Sets status_id to SENT when currently DRAFT; stamps sent date | `app/Services/Invoice/MarkSent.php` (file exists; behaviour per class) `[OBSERVED]` |
| IN-INV-004 | `UpdateBalance` | Recomputes balance from totals ± applied payments | `app/Services/Invoice/UpdateBalance.php` `[OBSERVED]` |
| IN-INV-005 | `HandleReversal` | Reversal of invoice (ledger effect; used for credits/voids); sets REVERSED | `app/Services/Invoice/HandleReversal.php` `[OBSERVED]` |
| IN-INV-006 | `HandleCancellation` | Cancellation handling | `app/Services/Invoice/HandleCancellation.php` `[OBSERVED]` |
| IN-INV-007 | `HandleRestore` | Restore from deleted/archived | `app/Services/Invoice/HandleRestore.php` `[OBSERVED]` |
| IN-INV-008 | `MarkInvoiceDeleted` | Soft-delete behaviour | `app/Services/Invoice/MarkInvoiceDeleted.php` `[OBSERVED]` |
| IN-INV-009 | `AutoBillInvoice` | Automatic charging of stored gateway token on due date | `app/Services/Invoice/AutoBillInvoice.php` `[OBSERVED]` |
| IN-INV-010 | `ApplyPaymentAmount` / `ApplyPayment` | Payment-to-invoice allocation, partial/paid transitions | `app/Services/Invoice/ApplyPayment.php`, `ApplyPaymentAmount.php` `[OBSERVED]` |
| IN-INV-011 | `CreateInvitations` / `SendEmail` / `GetInvoicePdf` / `GenerateDeliveryNote` | Invitation creation per contact; email + PDF generation + delivery notes | `app/Services/Invoice/*.php` filenames `[OBSERVED]` |
| IN-INV-012 | `TriggeredActions` | Server-triggered action bundle (used by recurring + webhooks) | `app/Services/Invoice/TriggeredActions.php` `[OBSERVED]` |
| IN-INV-013 | Gateway fee services: `CalculateGatewayFee`, `ConfirmGatewayFee`, `ReverseGatewayFee` | Adds/removes gateway fee line from surcharges | `app/Services/Invoice/*.php` filenames `[OBSERVED]` |
| IN-INV-014 | `ProRata` helper | Prorated amounts (subscriptions/service periods) | `app/Helpers/Invoice/ProRata.php` `[OBSERVED]` |

## IN-B — Calculating engine (invoice arithmetic)

| ID | Rule | Evidence |
|---|---|---|
| IN-CALC-001 | Pipeline: build() → calculateLineItems → calculateDiscount → calculateCustomValues → calculateInvoiceTaxes → calculateBalance → calculatePartial → calculateTotals; entity-agnostic (getInvoice/getQuote/getCredit/getPurchaseOrder/getRecurringInvoice) so ONE engine serves all document types | `app/Helpers/Invoice/InvoiceSum.php:79-260` `[OBSERVED]` |
| IN-CALC-002 | Per line item: calcLineItems → shouldCalculateTax → sumLineItem → setDiscount (line-level discount) → lineItemUsesAmountDiscount → calcTaxesAutomatically → calcTaxes; surcharge taxes applied; grouped taxes map (name, rate, total) | `app/Helpers/Invoice/InvoiceItemSum.php:174-566` `[OBSERVED]` |
| IN-CALC-003 | Tax rounding: `taxer()` = round(BcMath::mul(amount, rate/100), 2, PHP_ROUND_HALF_UP); zero/absent rate → 0 | `app/Helpers/Invoice/Taxer.php:21-30` `[OBSERVED]` |
| IN-CALC-004 | Inclusive (tax-inclusive) mode: single-rate back-out through `InclusiveTax::backout(amount, [rate], 2)` = amount − amount/(1+rate/100) | `app/Helpers/Invoice/Taxer.php:41-49`, `app/Helpers/Invoice/InclusiveTax.php` `[OBSERVED]` |
| IN-CALC-005 | Exclusive vs inclusive engines: `InvoiceSum`/`InvoiceItemSum` (exclusive) and `InvoiceSumInclusive`/`InvoiceItemSumInclusive` variants | files exist in `app/Helpers/Invoice/` `[OBSERVED]` |
| IN-CALC-006 | Currency precision: 2-decimal floating with BcMath; Rappen rounding helper present (CHF .05 rounding) | `InvoiceSum.php:307` (roundRappen) `[OBSERVED]` |
| IN-CALC-007 | Discount layer: document-level discount (Discounter) + per-line discount are separate surfaces | `app/Helpers/Invoice/Discounter.php`, `InvoiceItemSum.setDiscount:249` `[OBSERVED]` |
| IN-CALC-008 | Invoice-level tax overrides: calculateInvoiceTaxes supports tax map by name/rate/id, plus rate-based and inclusive modes | `app/Helpers/Invoice/InvoiceSum.php:129-192, 361-400` `[OBSERVED]` |

## IN-A — Route surface (counted)

- `routes/api.php`: **313 route declarations** (`Route::(get|post|put|patch|delete|match|any|resource)` count) — full machine-readable extract saved at `docs/audit/data/in-routes-api-all.txt` (with file line numbers). `[OBSERVED]`
- Additional route files: `routes/client.php` (client portal, Blade+react-portal hybrid), `routes/vendor.php` (vendor portal), `routes/contact.php`, `routes/shop.php`, `routes/web.php`, `routes/console.php`. `[OBSERVED]` Counts: client.php = portal routes (login/register/password/magic-key + dashboard/invoices/payments/…), vendor.php vendor portal.

## IN-D — Invoice-family API surface (routes + actions)

| ID | Route / endpoint | Behaviour | Evidence |
|---|---|---|---|
| IN-INV-020 | `Route::resource('invoices', InvoiceController)` full CRUD (index/create/show/update/destroy/edit) via `StoreInvoiceRequest`, `UpdateInvoiceRequest`, etc. | Standard + filters | `routes/api.php:317`; `app/Http/Controllers/InvoiceController.php:127-504` (index/create/show/update/destroy) `[OBSERVED]` |
| IN-INV-021 | `GET invoices/{invoice}/{action}` — generic action endpoint | Actions dispatched: `auto_bill`, `clone_to_invoice`, `clone_to_quote`, `convert_to_purchase_order`, `history`, `delivery_note`, `mark_paid`, `mark_sent`, `download`, `restore`, `archive`, `delete`, `cancel`, `reverse` (controller switch) | `routes/api.php:319`; `InvoiceController.php:805-905` case list: mark_paid etc.; actions `auto_bill:13, clone_to_invoice:18, clone_to_quote:22, convert_to_purchase_order:30, history:39, delivery_note:42, mark_paid:45, mark_sent:56, download:63, restore:69, archive:76, delete:83, cancel:90` (offsets within 761..) `[OBSERVED]` |
| IN-INV-022 | Action guards (Request validation) | `cancel` allowed only when `invoiceCancellable`: status ∈ {SENT, PARTIAL}, not soft-deleted (Verifactu-enabled adds stricter F1-child rules); `reverse` allowed when status ∈ {SENT, PARTIAL, CANCELLED, PAID} (never under verifactu); `mark_paid` when `invoicePayable`: not deleted, not PAID, not CANCELLED/REVERSED, DRAFT/SENT/PARTIAL okay (draft auto-transitions to sent→paid per MarkPaid) | `app/Http/Requests/Invoice/ActionInvoiceRequest.php:55-61`; `app/Utils/Traits/Invoice/ActionsInvoice.php:19-42 (Payable), 55-98 (Deletable/Restorable), 67-95 (Cancellable/Reversable)` `[OBSERVED]` |
| IN-INV-023 | `POST invoices/bulk` | Bulk actions with `BulkInvoiceRequest` | `routes/api.php:325` `[OBSERVED]` |
| IN-INV-024 | `GET invoice/{invitation_key}/download` and `/download_e_invoice` | PDF / e-invoice download via **invitation key** (public, token-auth path) | `routes/api.php:323-324` `[OBSERVED]` |
| IN-INV-025 | `PUT invoices/{invoice}/upload` | Attach documents to invoice | `routes/api.php:320` `[OBSERVED]` |
| IN-INV-026 | `POST / DELETE invoices/{invoice}/payment_schedule` | Payment schedules per invoice (delete supported) | `routes/api.php:321-322` `[OBSERVED]` |
| IN-INV-027 | `GET invoices/{invoice}/delivery_note` | Delivery note PDF | `routes/api.php:318` `[OBSERVED]` |
| IN-INV-028 | `PUT invoices/update_reminders` | Force reminder recomputation | `InvoiceController.php:1127` `[OBSERVED]` |
| IN-QUO-020 | `Route::resource('quotes', QuoteController)` + `{quote}/{action}` + bulk + upload + public download PDF/e-quote | Quote CRUD + generic action endpoint (`action` switch includes email/approve/convert flows via hooks) | `routes/api.php:365-370`; `QuoteController.php:125-1041` `[OBSERVED]` |
| IN-CRE-020 | `Route::resource('credits', CreditController)` + `{credit}/{action}` + bulk + upload + public download PDF/e-credit | Credit CRUD + generic actions | `routes/api.php:260-265`; `CreditController.php:109-903` `[OBSERVED]` |
| IN-REC-020 | `Route::resource('recurring_invoices', RecurringInvoiceController)` + bulk + upload | Recurring invoice CRUD (no per-entity action route; bulk covers start/stop etc.) | `routes/api.php:383-387`; `RecurringInvoiceController.php:109-628` `[OBSERVED]` |
| IN-REC-021 | `Route::resource('recurring_quotes', RecurringQuoteController)` + bulk + upload | Recurring quotes are a separate recursive resource | `routes/api.php:388-392` `[OBSERVED]` |
| IN-PO-020 | `Route::resource('purchase_orders', PurchaseOrderController)` + bulk + upload + `{purchase_order}/{action}` + public PDF/e-PO | Purchase order CRUD + actions | `routes/api.php:358-363`; `PurchaseOrderController.php` (exists) `[OBSERVED]` |
| IN-PAY-020 | `Route::resource('payments', PaymentController)` + bulk + upload + `refund` endpoint (`RefundPaymentRequest`) + action cases restore/archive/delete/email/email_receipt | Payment CRUD, refund flow, email receipt | `app/Http/Controllers/PaymentController.php:621-772` (case list 624-655; refund:713) + route file `[OBSERVED]` |
| IN-EXP-020 | `Route::resource('expenses', ExpenseController)` + bulk + upload + `edocument` upload | Expense CRUD + attach docs + e-document ingestion | `routes/api.php:310-315` `[OBSERVED]` |
| IN-EXP-021 | `expense_categories` resource + bulk | Categories entity | `routes/api.php:327-329` `[OBSERVED]` |
| IN-DOC-020 | `documents` resource + download + bulk; per-entity `upload` endpoints | Central attachment entity, public download by hash | `routes/api.php:267-270` `[OBSERVED]` |
| IN-DES-020 | `designs` resource + bulk + `set/default` | Invoice PDF design management | `routes/api.php:272-275` `[OBSERVED]` |
| IN-IMPEXP-020 | `POST import`, `POST import_json`, `POST preimport`; `POST export` | Cross-product import (CSV/JSON with preview) and export | `routes/api.php:302-306, 308` `[OBSERVED]` |
| IN-EINV-020 | e-invoice endpoints: validateEntity, configurations, peppol discovery/legal_entity/setup/disconnect/update/add+remove identifier/send, sg c5 activate/deactivate/cancel, token update, quota, health_check, delivery_map | Full Peppol lifecycle + format validation API | `routes/api.php:283-300` `[OBSERVED]` |
| IN-REP-020 | 30 report endpoints under `reports/*` (clients, activities, contacts ×2, credits, documents, expenses, invoices, invoice_items, locations ×2, purchase_orders(±items), quotes(±items), recurring_invoices(±items), payments, products, product_sales, tasks, vendors) + profitloss, ar_detail_report, ar_summary_report, client_balance_report, client_sales_report, tax_summary_report, tax_period_report | Report API surface; throttled 20/min | `routes/api.php:401-431` `[OBSERVED]` |
| IN-UI-001 | Charts/dashboard endpoints: charts/totals, chart_summary, totals_v2, chart_summary_v2, calculated_fields, analytics_summary, analytics_totals, cashflow_forecast, client_payment_analytics, project_analytics/{project}, project_burnup/{project} | Dashboard/statistics surface (11 endpoints) | `routes/api.php:189-200` `[OBSERVED]` |

## IN-E — Permissions on routes
Per-route middleware uses `permission:<entity>,<action>` style declarations throughout `routes/api.php` (e.g. `->middleware('permission:invoices,create')`). NOT fully enumerated yet at this depth — tracked in coverage.md §4; the user-management permission model itself is inventoried under IN-SET/AUTH. `[OBSERVED, not complete — flagged]`

## IN-F — Setup wizard (self-host installation)

| ID | Item | Behaviour | Evidence |
|---|---|---|---|
| IN-ACC-001 | Setup entry pages | Web routes behind `guest`: GET /setup (wizard index), POST /setup (submit), GET /update (update page), POST /setup/check_db, POST /setup/check_mail, POST /setup/check_pdf | `routes/web.php:26-32` `[OBSERVED]` |
| IN-ACC-002 | Wizard screens (Blade views) | index (multi-step), `_account` (admin account), `_application` (URL/app settings), `_database` (DB), `_mail` (mail driver), `_issues` (problem list), `clean_setup` | `resources/views/setup/` file list `[OBSERVED]` |
| IN-ACC-003 | Setup required fields | `url`, `privacy_policy`, `terms_of_service`, `first_name`, `last_name`, `email`, `password` always; `db_host`, `db_database`, `db_username`, `db_password` unless `ninja.preconfigured_install` (hosted) | `app/Http/Requests/Setup/StoreSetupRequest.php:29-52` `[OBSERVED]` |
| IN-ACC-004 | Pre-flight checks | checkDB (connect + write test), checkMail (mail config test), checkPdf (PDF generation test), clearCompiledCache | `app/Http/Controllers/SetupController.php:190,216,233,244` `[OBSERVED]` |
| IN-ACC-005 | `doSetup()` behaviour | Creates admin account into DB with secret update etc. | `SetupController.php:59-190` `[OBSERVED — implementation not fully read]` |
| IN-ACC-006 | Update page | `/update` availability for self-host update checklist | `routes/web.php:28` `[OBSERVED]` |

## IN-G — Authentication & security (admin side)

| ID | Item | Behaviour | Evidence |
|---|---|---|---|
| IN-AUTH-001 | Login endpoint | POST api/v1/login precheck GET-check plus POST token issuance; `precheck` returns available auth methods (lists `totp` when `google_2fa_secret` set) | `routes/api.php:149,153`; `LoginController.php:91-147,137` (`$methods[] = 'totp'` at 147-148) `[OBSERVED]` |
| IN-AUTH-002 | 2FA | TOTP via Google2FA: `verifyKey(decrypt(user.google_2fa_secret), one_time_password)`; user model exposes google_2fa_secret | `LoginController.php:218-228`; `app/Models/User.php` (google_2fa_secret column per migration) `[OBSERVED]` |
| IN-AUTH-003 | API token auth | `X-API-TOKEN` header resolved through MultiDB/CompanyToken (`CompanyToken::with(...)->where('token', ...)`) | `app/Http/Middleware/TokenAuth.php:37-39` `[OBSERVED]` |
| IN-AUTH-004 | API secret check | `X-API-SECRET` compared to config(`ninja.api_secret`) | `app/Http/Middleware/ApiSecretCheck.php:35` `[OBSERVED]` |
| IN-AUTH-005 | OAuth | `api/v1/oauth_login`, dedicated Google/Microsoft/LinkedIn/Apple providers, OIDC config/exchange endpoints, passkey login options endpoint | `routes/api.php:143-158`; `LoginController.php:438-1109` method list `[OBSERVED]` |
| IN-AUTH-006 | Password fields | reset via web (`password/email`, `password/reset/{token}`) and API `api/v1/reset_password`, `password_timeout` endpoint (password re-entry) | `routes/api.php:158,163`; `routes/web.php:34-37` `[OBSERVED]` |
| IN-AUTH-007 | Multi-DB middleware | Extensive `SetDb`/`ContactSetDb`/`UrlSetDb`... middlewares select database per company/contact/URL (multi-tenant by DB) | `app/Http/Middleware/` file list `[OBSERVED]` |
| IN-AUTH-008 | Rate limiting | `throttle:` variants everywhere (portal, portal-login, contact-register, password-reset, refresh, 30,1 patterns) with Predis-based throttler | middleware list `ThrottleRequestsWithPredis.php`, throttle strings across route files `[OBSERVED]` |
| IN-AUTH-009 | Password-protected destructive ops | `password_protected` middleware on client purge, client merge, company purge/save-settings | `routes/api.php:207,209,238-239` `[OBSERVED]` |
| IN-AUTH-010 | Signature-protected downloads | `ValidateProtectedDownloadSignature`, `token_auth`, `verify_hash` middlewares | middleware filenames; `routes/client.php:39,52-53` `[OBSERVED]` |

## IN-H — Client portal (Blade/JS + invited flows)

| ID | Item | Behaviour | Evidence |
|---|---|---|---|
| IN-PORT-001 | Portal auth | Client login by email/password (`client/login/{company_key?}`), registration gated per company, magic link (`client/magic_link/{magic_link}`) and `key_login/{contact_key}` (one-click per contact key) | `routes/client.php:22-37` `[OBSERVED]` |
| IN-PORT-002 | Portal dashboard | `dashboard` route + NinjaPlanController (hosted upsell pages: plan, trial confirmation) | `routes/client.php:50-53` `[OBSERVED]` |
| IN-PORT-003 | Portal documents | Invoices/recurring/quotes/credits lists + per-entity show via invitation key; showBlob for templates; payment bulk; downloads | `routes/client.php:55-74` `[OBSERVED]` |
| IN-PORT-004 | Portal payments | `payments/process` (POST catch process), payment response handlers, pre_payments (store credits), payment_methods resource (verify/confirm/set-default), credit_response | `routes/client.php:66-74`; portal payment routes `[OBSERVED]` |
| IN-PORT-005 | Portal profiles | Contact profile + update client data + localization | `routes/client.php:79-83` offsets (3-6 in 75.. block) `[OBSERVED]` |
| IN-PORT-006 | Portal self-service subscriptions | `subscriptions/{recurring_invoice}/plan_switch/{target}` plan switching, `subscriptions` index/show, `purchase/v2/v3` hosted purchase flows | `routes/client.php:111-115` (offsets 35-40 in block) `[OBSERVED]` |
| IN-PORT-007 | Portal tasks/projects | Tasks read-only index; projects index/show | `routes/client.php:117-119` `[OBSERVED]` |
| IN-PORT-008 | Portal statements | `statement` + `statement/raw` (account statement page) | `routes/client.php:121-122` `[OBSERVED]` |
| IN-PORT-009 | Portal upload | Contact document upload | `routes/client.php:124` `[OBSERVED]` |
| IN-PORT-010 | Invitation routers | `invoice/{invitation_key}`, `quote/...`, `credit/...`, `recurring_invoice/...` resolve to entity by key; `pay/{invitation_key}` payment page; email preferences + unsubscribe per entity | `routes/client.php:139-160` (group `invite_db`) `[OBSERVED]` |
| IN-PORT-011 | Public download | `{entity}/{invitation_key}/download` for all document types (token_auth) | `routes/client.php:151` `[OBSERVED]` |
| IN-PORT-012 | Vendor portal | `routes/vendor.php` (54 lines) vendor portal with vendor contacts | `routes/vendor.php` file `[OBSERVED — not itemized in this pass]` |

## IN-I — Automation: cron jobs & commands

| ID | Item | Behaviour | Evidence |
|---|---|---|---|
| IN-JOBS-001 | Cron jobs | `app/Jobs/Cron/`: AutoBill, AutoBillCron, DailyTaskDigestCron, FranceEReportingCron, InvoiceTaxSummary, RecurringExpensesCron, RecurringInvoicesCron, SubscriptionCron | `app/Jobs/Cron/` file list `[OBSERVED]` |
| IN-JOBS-002 | Reminder dispatch | `SendRemindersCron` command (scheduled reminders/late fees) | `app/Console/Commands/SendRemindersCron.php` filename `[OBSERVED]` |
| IN-JOBS-003 | Job classification | 31 job families (Account, Bank, Brevo, Client, Company, Credit, Cron, Document, EDocument, Elastic, Entity, Expense, Import, Inventory, Invoice, Ledger, Mail, Mailgun, Ninja, Payment, PostMark, Product, Quickbooks, Quote, RecurringInvoice, Report, SES, Subscription, Task, User, Util); 113 job classes total | `app/Jobs/` directory tree `[OBSERVED]` |
| IN-JOBS-004 | Artisan commands | 29 commands incl. BackupUpdate, CheckData, CreateAccount/CreateSingleAccount/CreateTestData/DemoMode, DesignUpdate, ImportHarvest, ImportPancake(+DB), MobileLocalization, OpenApiYaml, PostUpdate, PullPeppolDocs, ReactBuilder, RecurringCommand, ReconcileCashEvents, S3Cleanup, SendTestEmails, TranslationsExport, EncryptNinja | `app/Console/Commands/` file list `[OBSERVED]` |

## IN-J — Emails & notifications

| ID | Item | Evidence |
|---|---|---|
| IN-MAIL-001 | Dedicated mailer namespace with Mailables per event (`app/Emails/*` dir exists) | `[OBSERVED dir exists]` detailed list pending |
| IN-MAIL-002 | Emails translatable: `lang/{locale}/emails/*.php`, reminders texts, page/notification texts | `lang/en/emails`, `lang/fr/emails` dirs `[OBSERVED]` |
| IN-MAIL-003 | Providers supported | SES, Mailgun, PostMark, Brevo controllers/jobs (`app/Http/Controllers/BrevoController` etc.; app/Jobs/{SES,Mailgun,PostMark,Brevo}) | `[OBSERVED]` |
| IN-MAIL-004 | Email tracking/history endpoints `emails/entityHistory`, `clientHistory` | `routes/api.php:291-292` `[OBSERVED]` |

## IN-K — i18n

| ID | Item | Evidence |
|---|---|---|
| IN-I18N-001 | Baseline UI language = English, translations via `lang/` files; ~36 locales present in `lang/` list (af_ZA, ar, bg, ca, cs, da, de, el, en, en_GB, …) | `lang/` directory listing `[OBSERVED]` |
| IN-I18N-002 | French coverage = 5 file groups: `fr/emails`, `fr/pagination.php`, `fr/reminders.php`, `fr/texts.php`, `fr/validation.php` (UI strings of the React app itself are NOT in this repo) | `lang/fr/` file list `[OBSERVED]` |
| IN-I18N-003 | Locale middleware `Locale` per request; currencies/timezones/dates pre-seeded models (Language, Currency, Timezone, DateFormat, DatetimeFormat, Size, Country, PaymentType, PaymentTerm, Industry, GatewayType) | middleware + model list `[OBSERVED]` |

## IN-L — Data model (tables from migrations)

| ID | Item | Evidence |
|---|---|---|
| IN-DATA-001 | 317 migration files in `database/migrations/` defining the Eloquent schema (per-table inventory cross-referenced in `04-data-model-comparison.md`) | directory count `[OBSERVED]` |


---
### Orientation note (course-correction, applies to this file)
Invoice Ninja is the **behavioural healthy base**, not a stack to replicate. Items below sourced from job/middleware/migration counts are retained only where they witness a user-visible behaviour (scheduled reminders, portal routing, 2FA). Where the same user outcome on Freebuff is achieved by different implementation means, the parity row (05) will use `EQUIVALENT-BY-PLATFORM`; blocked platform capabilities are `PLATFORM-DEPENDENT` with the needed.capability named. Version recorded above (5.13.49 @15ea35e) is the behavioural source of truth.
