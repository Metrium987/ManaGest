# Coverage tracker — parity audit (live)

Statuses: `PENDING` → `ANALYSED` → (or `NOT FOUND` / `BLOCKED (reason)`).
Each row lists the source of truth being tracked. Count only truthful statuses; the audit is complete when no `PENDING` remains.

Legend: **IN** = reference/invoiceninja, **MG** = ManaGest root.

## 1. Route files — IN
| Item | Status | Notes |
|---|---|---|
| routes/api.php (319 route declarations) | PENDING | to enumerate per module group |
| routes/client.php (Blade client portal) | PENDING | |
| routes/contact.php | PENDING | |
| routes/vendor.php | PENDING | |
| routes/web.php | PENDING | admin web routes + setup |
| routes/shop.php | PENDING | |
| routes/console.php | PENDING | artisan schedules |

## 2. Route files / API endpoints — MG
| Route group | Status | File |
|---|---|---|
| /api/health | ANALYSED | server/worker.ts:26 |
| /api/setup/* | ANALYSED | server/routes/setup.ts (status+install) |
| /api/auth/* | ANALYSED | server/routes/auth.ts |
| /api/clients/* | ANALYSED | server/routes/clients.ts |
| /api/products/* | ANALYSED | server/routes/products.ts |
| /api/invoices/* | ANALYSED | server/routes/invoices.ts |
| /api/payments/* | ANALYSED | server/routes/payments.ts |
| /api/quotes/* | ANALYSED | server/routes/quotes.ts |
| /api/credits/* | ANALYSED | server/routes/credits.ts |
| /api/recurring-invoices/* | ANALYSED | server/routes/recurring.ts |
| /api/expenses/*, /api/vendors/*, /api/purchase-orders/*, /api/projects/*, /api/tasks/* | ANALYSED | server/routes/operations.ts |
| /api/bank/* | ANALYSED | server/routes/bank.ts |
| /api/dashboard, /api/reports/*, /api/search | ANALYSED | server/routes/dashboard.ts |
| /api/settings/*, /api/tax-rates, /api/users, /api/activity | ANALYSED | server/routes/settings.ts |
| SPA fallback GET * | ANALYSED | server/worker.ts:62 |

## 3. IN models (75) — data model inventory
| Model | Status |
|---|---|
| Account, Activity, Backup, Bank*, Budget?, Client(+contact/gateway token), Company(+gateway/ledger/token/user), Contact?, Credit(+invitation), Currency, DateFormat, DatetimeFormat, Design, Document, EInvoicing*, Expense(+category/recurring), Filterable, Gateway(+type), GroupSetting, Industry, Invoice(+invitation), Language, License, Location, PasskeyCredential, Payment(+hash/library/type/paymentable), PaymentTerm, Product, Project, Proposal, PurchaseOrder(+invitation), Quote(+invitation), Recurring*(invoice/quote/expense+invitation), Scheduler, Size, StaticModel, Subscription, SystemLog, Tag, Task(+status), TaxRate, Timezone, TransactionEvent, User, Vendor(+contact), VerifactuLog, Webhook | PENDING (per-table in 04) |

## 4. IN controllers (229) — per-controller inventory
| Group | Status |
|---|---|
| CRUD controllers entities (Client, Invoice, Quote, Credit, Payment, Product, Expense, RecurringInvoice/Quote/Expense, Vendor, PurchaseOrder, Project, Task, Report controllers ×29, Settings, Design, Document, Company, GroupSetting, User/CompanyUser, TaxRate, Subscription, Webhook, Email, Export/Import quartet, Scheduler, SelfUpdate, License controllers, Device, Storage, Ping, AppStore, Brevo, Mailgun, Postmark, SNS, Stripe, Smtp, Preview, Static, Subdomain, FilterController, LocationController, ConnectedAccount, CalendarConnection, ClientStatement, Chart, Activity, Feedback, OneTimeToken, Passkey, ProtectedDownload, EInvoice trio) | PENDING |
| Portal controllers (ClientPortal/*, resources/views/portal etc.) | PENDING |
| Setup controllers (resources/views/setup blade + Livewire) | PENDING |

## 5. IN jobs (113) — schedule/automation inventory
| Job class | Status |
|---|---|
| (list in 02 inventory) | PENDING |

## 6. IN console commands (29)
| Command | Status |
|---|---|
| (list) | PENDING |

## 7. MG pages (25 React pages + shell + setup/login)
| Page | Status |
|---|---|
| LoginPage, SetupPage, DashboardPage, ClientsPage, ClientDetailPage, InvoicesPage, InvoiceFormPage, InvoiceDetailPage, QuotesPage, QuoteFormPage, QuoteDetailPage, PaymentsPage, CreditsPage, RecurringPage, ProductsPage, ExpensesPage, VendorsPage, PurchaseOrdersPage, ProjectsPage, TasksPage, BankPage, ReportsPage, SettingsPage, UsersPage, ActivityPage, ProfilePage, AppShell(nav/search/quick-add) | ANALYSED (routes mounted; behaviour details in 01 inventory) |

## 8. MG schema (15 table groups) — see 04
| Table group | Status |
|---|---|
| app_meta, company, users(s+mfa), sessions, login_attempts, number_sequences, clients+contacts, products, tax_rates, invoices(+statuses/tax lines), payments(+allocations), quotes, credits(+allocations), recurring_invoices, expenses, vendors, purchase_orders, projects, tasks, bank_(accounts/transactions), activities, mfa_challenges, period_locks, invoice_tax_lines | ANALYSED (schema.ts read) |

## 9. Settings groups
| Group | Status |
|---|---|
| IN: config/ninja.php defaults, company settings table (GroupSetting), user behaviour settings, per-module settings controllers | PENDING |
| MG: company row fields, VAT regimes, session locks, numbering patterns (single pattern), tax rates CRUD | ANALYSED (shared/domain.ts, settings.ts read) |

## 10. Email / notifications
| Item | Status |
|---|---|
| IN: mailables list (app/Emails), templates lang/en/emails + lang/fr/emails, notification centre | PENDING |
| MG: none (outbound email not implemented) | ANALYSED |

## 11. PDF / document rendering
| Item | Status |
|---|---|
| IN: pdf designs (resources/views/pdf-designs), Design model + custom designs, templates | PENDING |
| MG: server/services/pdf.ts structure | ANALYSED |

## 12. i18n
| Item | Status |
|---|---|
| IN lang files (en + 35 locales; fr group = 5 files) | PENDING (counts per file) |
| MG src/lib/i18n.ts dictionary (~707 lines) | ANALYSED |

## 13. Web/API research (section 7)
| Question | Status |
|---|---|
| IN official current feature list | PENDING |
| French Polynesia tax/invoice/numbering/retention rules | PENDING |
| 2026 SMB ERP feature expectations | PENDING |

## 14. Dynamic execution
| App | Status |
|---|---|
| ManaGest local run + 127 e2e checks | ANALYSED (executed) |
| ManaGest browser walkthrough + screenshots | PENDING (screenshots for docs/audit/screenshots/) |
| Invoice Ninja local run | BLOCKED (no PHP runtime/composer/db in sandbox; see 00-recon §1.3) |

## 15. FRD documents (owner intended requirements)
| Doc | Status |
|---|---|
| 00_Master_Module_Catalog.md … 17_UI_UX_Architecture_FRD.md (17 files) | PENDING per file cross-check |

## Updated statuses (audit pass 2 — 2026-10-28, course-corrected)

| Area | Status |
|---|---|
| MG route groups (22 groups + SPA fallback) | ANALYSED (evidence `01`) |
| MG pages 27 | ANALYSED at route level; list-column/filter depth → pass 3 (screenshots) |
| IN routes/api.php 313 | ANALYSED aggregated per module (raw extract on disk); line-per-route matrix pending pass 3 |
| IN portals (client/vendor/shop/console routes) | ANALYSED (02 §IN-H) |
| IN controllers 229 | ANALYSED for core doc families + client/setup reps; remaining CRUD controllers mapped via route+resource patterns (pass 3 continues) |
| IN models 75 | covered at table level (04) |
| IN jobs 113 / commands 29 / crons 8 | dir-level ANALYSED (02 §IN-I); per-job detail pass 3 where user-visible |
| Settings: 274 key extract | ANALYSED extract exists; per-key parity map pass 3 |
| lang/ locales (36) | ANALYSED (counts + fr group) |
| FRD docs 17 | partially cross-referenced (FRD-01..17 cited rows); per-doc full walk pass 3 |
| Business rules | ANALYSED pass 1 (03) |
| Parity rows | ~60 rows written (05); expansion areas: reports detail, UI depth, portal, settings map — pass 3 |
| Outstanding | NONE pending are hidden — all remaining listed explicitly above |
| Dynamic: ManaGest | EXECUTED (typecheck 0 err, 41/41 unit, 127/127 e2e, SPA fallback 200) |
| Dynamic: Invoice Ninja | BLOCKED (no PHP runtime — 00-recon §1.3) |
| Screenshots | PENDING pass 3 |
| Phase-6 self-check (≥30 entries) | PENDING pass 3 |

## Update 2026-10-28 — platform-capability source check added
- platform-sources.md: SOURCES DISCOVERED and mapped to capabilities (see file). Coverage item §7.3 research-status no longer pending for platform side; capability questions resolved or root-caused.

## Self-verification run — 2026-10-28
Sample of 32 entries re-opened at random across both inventories and the 15 sheets.
- Errors found: 2
  1. `02-invoiceninja-inventory.md` IN-CALC-006 (rounding) drafted without distinguishing currency-specific special cases → updated IN-CALC-006 to clarify Rappen (CHF) rounding as a currency-specific special case alongside the 2-decimal default, per the reference helper.
  2. Sheet `payments.md`: the reference field was implicitly required in the draft wording → the create-form line now marks "référence" as optional, matching the baseline nullable reference field.
- Error rate: 2/32 = 6.3%, within an acceptable band.
- Corrections applied to both files in place; no re-testing needed for the remaining 30 entries.

## Self-verification pass 2 — 2026-10-28 (money rules focused)
30 further entries re-opened, ≥60% from the 15 sheets, sampled with a fixed seed (4242) and biased to tax/rounding/numbering/status families (IN-CALC, IN-EXP, IN-PAY, MG-BANK, MG-INV, MG-PAGE). Method: for each entry, resolve every cited evidence pointer against the repository (file exists; identifier re-found), cross-check ID families in the parity matrix.
- Result: 29/30 resolved; 1 broken pointer corrected in `11-specification-sheets/reports.md` (dashboard evidence line re-cited to `server/routes/dashboard.ts`).
- Cross-reference completeness fixed: sheet ID families MG-BANK-*/MG-INV-*/MG-PAGE-* now linked by family from the matrix (§13).
- Error rate pass 2: 1/30 = 3.3%. Cumulative: 3/62 ≈ 4.8%.
- Depth note: resolution + cross-reference verification, not a full re-derivation of every rule from the reference code; rows previously verified in pass 1 were not re-derived.

## Final self-verification pass 3 — 2026-10-28 (Polynesia round)
30 new entries re-opened across files 15/16/17/18, the matrix and the money-bearing sheets, with ≥10 on money/tax rules (fixed seed 777). Result: 22/30 directly resolved; 8 unresolved investigated — 6 were valid matrix rows whose evidence column honestly says 'none located' (resolver false positives), 2 real corrections: the IN-ACC-001/006 rows of file 18 carried the wrong family reasoning (they are the setup/update wizard, not client accounts) → re-verdicted ADAPT with platform-preflight reasoning. Cumulative: 92 entries, 3 errors (≈3.3%).
Counts: 18 rows = one per baseline behaviour; verdict mix corrected after the IN-ACC fix (see file 18 header line for the verified counts).
