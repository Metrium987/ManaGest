# 03 — Business rules (GIVEN / WHEN / THEN), both products

Rules are statements of behaviour a user experiences. IDs: `BR-<MODULE>-<NNN>` with `IN` or `MG` prefix documented per rule. Evidence: file + lines (read) or `[EXECUTED]` (ManaGest black-box audit). This file grows per pass; `coverage.md` tracks which modules are complete.

## 1. Money, tax and rounding

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-TAX-001 | IN | GIVEN a line amount `A` with rate `R%`, WHEN the tax is computed, THEN tax = round(BcMath::mul(A, R/100), 2, HALF_UP); rate 0/absent ⇒ 0. Evidence `app/Helpers/Invoice/Taxer.php:21-30` |
| BR-TAX-002 | IN | GIVEN tax-inclusive mode, WHEN a single rate applies, THEN tax = amount − amount/(1+R/100) via `InclusiveTax::backout` (2 decimals). Evidence `Taxer.php:41-49` |
| BR-TAX-003 | IN | GIVEN entity (invoice/quote/credit/PO/recurring), WHEN totals build, THEN one shared pipeline computes subtotal → discount → custom values → taxes → balance → partial → totals. Evidence `app/Helpers/Invoice/InvoiceSum.php:79-260` |
| BR-TAX-010 | MG | GIVEN quantities/prices as integers (minor units), WHEN a line total is computed, THEN round(unit_price × qty) half-away-from-zero. Evidence `shared/tax.ts:computeTotals` line via `lineTotal`; `[EXECUTED]` totals in audit |
| BR-TAX-011 | MG | GIVEN a document-level discount (percent or amount), WHEN totals build, THEN the discount is spread line-by-line proportionally, remainder adjusted on the last line, then tax computed per bucket (rate kept exact, base reduced). Evidence `shared/tax.ts` comments + `[EXECUTED]` `invoice totals apply each line rate` (2×10 000@16% + 1×5 000@5% ⇒ 3 200 + 250) |
| BR-TAX-012 | MG | GIVEN `tax_exempt` client or document, WHEN totals build, THEN every bucket's tax = 0 and the exempt flag persists to the PDF path. Evidence `shared/tax.ts`, `server/services/pdf.ts:61` |
| BR-TAX-013 | MG | GIVEN currency XPF (or JPY), WHEN amounts render, THEN zero decimals (`currencyDecimals`=0); internal math uses minor integers with half-away rounding. Evidence `shared/money.ts:3-46`; `[OBSERVED]` |
| BR-TAX-020 | MG | GIVEN a validated tax rate list (per-company CRUD), WHEN TVA report runs, THEN rows aggregate from the `invoice_tax_lines` mirror with summary = Σ rows (rebuildable). Evidence `server/routes/dashboard.ts` report branch + `settings.ts:184` + `[EXECUTED] tax report summary equals the sum of its rows` |

## 2. Numbering

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-NUM-001 | IN | GIVEN entity + settings, WHEN a document is created, THEN number uses the per-entity counter and pattern; `client_number_pattern/counter`, `invoice_number_pattern`, per-credit/quote pattern keys exist in company settings. Evidence `app/DataMapper/CompanySettings.php` cast keys (extract `docs/audit/data/in-company-settings-keys.txt` rows) |
| BR-NUM-010 | MG | GIVEN entity+period, WHEN a document is created, THEN an atomic `UPSERT ... RETURNING` increments `(entity, year)` counter — no reuse on concurrency; pattern tokens `{prefix}{YYYY}{YY}{MM}{#####..##}`. Evidence `server/lib/numbering.ts:1-47` |
| BR-NUM-011 | MG | GIVEN one deletion, WHEN the counter moves forward, THEN the number is never re-issued; the gap is not recorded (see 07 DEF-001 recommendation). Evidence `numbering.ts` (no gap registry) |

## 3. Invoice lifecycle

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-INV-001 | IN | GIVEN invoice DRAFT, WHEN mark_paid, THEN transitions DRAFT→SENT→PAID with payment auto-created. Evidence `app/Services/Invoice/MarkPaid.php:39-64` + `[OBSERVED]` |
| BR-INV-002 | IN | GIVEN invoice SENT/PARTIAL and not deleted, WHEN cancel, THEN allowed; PAID/CANCELLED/REVERSED or deleted ⇒ refused. Evidence `app/Utils/Traits/Invoice/ActionsInvoice.php:67-95` |
| BR-INV-003 | IN | GIVEN SENT/PARTIAL/CANCELLED/PAID non-deleted, WHEN reverse, THEN reversal applies (never under Verifactu). Evidence `ActionsInvoice.php:88-98` |
| BR-INV-010 | MG | GIVEN DRAFT invoice, WHEN POST /send, THEN status→SENT, sent_at stamped; second send ⇒ 409. Evidence `server/routes/invoices.ts:252-281` + `[EXECUTED]` |
| BR-INV-011 | MG | GIVEN any invoice not PAID/CANCELLED, WHEN mark-paid, THEN allocation + payment created, balance→0, status→PAID; second call ⇒ 409. Evidence `invoices.ts:359-410` + `[EXECUTED] cannot pay a paid invoice` |
| BR-INV-012 | MG | GIVEN any invoiced allocation sum > invoice total, WHEN allocations apply, THEN status→PARTIAL and balance reduced accordingly. Evidence status service + `[EXECUTED] partial/paid transitions` (bank match, credits) |
| BR-INV-013 | MG | GIVEN duplicate action, WHEN invoked, THEN new DRAFT document with next number. Evidence `invoices.ts:313-358` |
| BR-INV-014 | MG | GIVEN closed period (period_locks row), WHEN create/patch any document dated inside, THEN 409 `PERIOD_LOCKED` (both stored date and re-dated dates guarded; reopen is owner/admin with audit entry). Evidence `server/lib/locks.ts:26-49`, `settings.ts:111-183` + `[EXECUTED] all four document types blocked` |
| BR-INV-015 | MG | GIVEN invoiced with `invoices.delete` permission, WHEN DELETE, THEN soft delete only. Evidence `invoices.ts:461-488` |

## 4. Quotes / credits / recurring

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-QUO-001 | IN | GIVEN DRAFT quote, WHEN emit/approve, THEN SENT→APPROVED; CONVERTED once invoice created. Evidence models + controllers (`QuoteController` actions) `[OBSERVED]` |
| BR-QUO-010 | MG | GIVEN DRAFT quote, WHEN send/approve/reject/convert, THEN legal transitions enforced; convert requires invoices.write and spawns DRAFT invoice that can be edited/sent. Evidence `server/routes/quotes.ts:150-255` + `[EXECUTED]` |
| BR-CRE-010 | MG | GIVEN credit with available balance, WHEN apply to invoice, THEN credit balance and invoice paid/balance update atomically; apply only within available amount. Evidence `server/routes/credits.ts:126-171` + `[EXECUTED]` |
| BR-REC-010 | MG | GIVEN recurring ACTIVE, WHEN /run, THEN child invoice generated via totals engine, next_run_date advanced by frequency, remaining_cycles decremented when set. Evidence `server/routes/recurring.ts:143-214` + `[EXECUTED] run recurring invoice` |

## 5. Payments & bank

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-PAY-001 | IN | GIVEN payment, WHEN refund(partial/full), THEN status PARTIALLY_REFUNDED/REFUNDED and re-allocation of credit. Evidence `PaymentController.php:713` (refund endpoint + statuses `app/Models/Payment.php:111-121`) |
| BR-PAY-010 | MG | GIVEN payment w/ allocations, WHEN created, THEN invoice balances/status updated in the same transaction; allocation sum is capped at the invoice balance (over-allocation refused). Evidence `server/routes/payments.ts:95-168` + `[EXECUTED]` |
| BR-BANK-010 | MG | GIVEN imported bank transaction, WHEN matched to invoice, THEN a payment allocation is created with the matched amount and invoice status recomputed. Evidence `server/routes/bank.ts:89-132` + `[EXECUTED] bank match reduces invoice balance` |

## 6. Access, sessions, audit

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-AUTH-001 | IN | GIVEN stored google_2fa_secret, WHEN required, THEN TOTP with `one_time_password` accepted only on verifyKey; precheck advertises 'totp'. Evidence `LoginController.php:147,218-228` |
| BR-AUTH-010 | MG | GIVEN account with login, WHEN credentials fail 8× in 15 min, THEN 429 (attempts table); dummy-hash equalises timing on unknown email. Evidence `server/routes/auth.ts:29-90` + `[EXECUTED]` (throttle unit test optional — not exercised; logic observed) |
| BR-AUTH-011 | MG | GIVEN an authenticated session, WHEN any unsafe (POST/PUT/PATCH/DELETE) call arrives, THEN CSRF double-token + Origin check applies; missing/foreign ⇒ 403. Evidence `server/middleware.ts` + `[EXECUTED]` |
| BR-AUTH-012 | MG | GIVEN MFA-enabled account, WHEN login begins, THEN a 5-min single-use challenge token is issued; /mfa/verify accepts TOTP or a recovery code (single-consumption, hashed storage). Evidence `server/routes/auth.ts:141-243,260-292` + `[EXECUTED] full MFA flow` |
| BR-AUD-001 | MG | GIVEN any state-changing action, WHEN it succeeds, THEN an activity row records actor/IP/action/before-after with `prev_hash` chained to prior row; integrity endpoint recomputes the chain; legacy rows that predate hashing are skipped by the verifier without breaking the verdict. Evidence `server/lib/audit.ts` + `[EXECUTED] chain intact across every pass` |
| BR-PRM-001 | MG | GIVEN role ∈ {owner,admin,accountant,sales,viewer}, WHEN a permission-guarded route is called, THEN requirePermission validates `(role → permission)` matrix — accountant: finance writes + period control; sales: client income documents only; viewer: operational reads, no directory/journal access. Evidence `shared/domain.ts` ROLE_PERMISSIONS + `server/lib/permissions.ts` + `[EXECUTED] 21 role probes` |

## 7. Automation (behaviour, not mechanism)

| ID | Product | GIVEN / WHEN / THEN |
|---|---|---|
| BR-AUT-001 | IN | GIVEN scheduled time, WHEN cron runs, THEN reminders/late fees execute per invoice settings; auto-bill charges stored tokens; recurring invoices generate + optionally auto-send; recurring expenses replicate; subscriptions settle. Evidence `app/Jobs/Cron/*` filenames + `SendRemindersCron` + settings keys (`auto_bill`, `late_fee_*`, `reminder_*`, `enable_reminder*`; extract file rows) |
| BR-AUT-010 | MG | GIVEN recurring models with due dates in the past, WHEN nobody calls /run, THEN nothing generates (no scheduled trigger in current runtime). Evidence outbound `recurring.ts` run-only + absent cron config (finding feeds `PLATFORM-DEPENDENT` row PAR-REC-001) |

## Re-derived money rules from scratch (2026-10-28) — code first, compared against the sheets
Method: each rule re-read in the code, then compared with `11-specification-sheets/` and existing BR rows. Results per rule family.

**MG-RULE-1 — Tax computation and rounding** (`shared/tax.ts` `computeTotals`, `shared/money.ts`)
- Line amount = `roundMinor(unit_price × quantity)`; amounts are integer minor units; `roundMinor` = half away from zero; XPF/JPY and other currencies in `EXTRA_DECIMALS` have 0 decimals, others 2. `[OBSERVED]`
- Rate percentages are stored ×100 (basis points: 1600 = 16%); rate clamped 0–100; tax rate 0 or taxExempt flag zeroes every bucket. `[OBSERVED]`
- Document discount (percent or fixed) spread **pro-rata on line bases before tax**, remainder of the spread assigned to the last line so the buckets always add up exactly; discount capped at subtotal. `[OBSERVED]`
- Comparison with sheets: `BR-TAX-013` (XPF 0 decimals, half-away) and the invoices sheet ("identical arithmetic to server `computeTotals`") are confirmed **without difference**. New precision not formerly stated in the sheets: pro-rata discount spread with remainder-to-last-line (documented here; Minor documentation gap in the invoices sheet).

**MG-RULE-2 — Document numbering** (`server/lib/numbering.ts`)
- Financial documents: `number_sequences(entity, period = year)` upserted with `+1` and `RETURNING` — atomic increment inside the insert statement, so no read-modify-write race. `[OBSERVED]`
- Pattern placeholders: `{prefix} {YYYY} {YY} {MM} {#####}/{####}/{###}/{##}`; prefix per entity (FAC, DEV, AV, REG); clients/vendors use a separate `nextSimpleNumber` with period `'all'` (no year — observed CLI-0013, CLI-0014). `[OBSERVED]`
- Comparison with sheets: matches the numbering sheet/construction. Nuance not in the sheets: the counter is stored per (entity, year) independently of the pattern, so changing the pattern mid-year keeps the sequence continuous (documentation-only note).

**MG-RULE-3 — Partial payment allocation** (`server/routes/payments.ts:95-155`)
- Candidate invoices: same client, status `sent|partial`, balance > 0. Auto-apply walks them **oldest first** (`ORDER BY date ASC, created_at ASC`) and caps each at the invoice balance and the remaining amount. `[OBSERVED]`
- Invariants: Σ allocations ≤ payment amount (`exceeds_amount`); each allocation ≤ invoice balance (`AMOUNT_EXCEEDS_BALANCE`); allocations optional (payment may be unallocated); `allocated` returned. `[OBSERVED]`
- Payment inserted with status `completed` inside one batch with its allocations, then `recalcInvoice` per invoice (paid_total = min(total, payments+credits), balance ≥ 0). `[OBSERVED]`
- Comparison with sheets: payments sheet states exactly this (oldest-first capped, both error codes) — **no difference**. Nuance not in the sheets: no "pending" payment state (a payment is completed at creation).

**MG-RULE-4 — Credit-note application** (`server/routes/credits.ts:126-165`)
- Preconditions: amount required (positive int) — the DEF-SESSION-01 lesson; amount ≤ credit.remaining; invoice same client, status `sent|partial`, amount ≤ invoice.balance. `[OBSERVED]`
- Effects: `credit_allocations` row inserted, credit and invoice recalculated in sequence; credit status → `applied` at zero remainder, `partial` when partly applied; deleting an applied credit is refused (`CREDIT_ALREADY_APPLIED`). `[OBSERVED]`
- Comparison with sheets: quotes-credits sheet matches; the double-application guard is exercised by design (409 on second apply).

**MG-RULE-5 — Status transitions** (`server/routes/invoices.ts:252-300`, `server/services/status.ts`)
- Send: from `draft` only (else 409 `INVALID_TRANSITION`), guarded by open-period assertion. Cancel: refused when already cancelled or paid_total > 0 (then a credit note is the route); sets balance 0 and marks `cancelled_at`. `[OBSERVED]`
- Derived status (recalc): `cancelled` terminal; balance ≤ 0 → `paid`; paidTotal > 0 → `partial`; payment date set at full payment, cleared otherwise. `[OBSERVED]`
- Comparison with sheets: matches the invoice sheet's status buttons/behaviour; no difference found. Precision not in the sheets: `paid_at` is cleared by any recalc — relevant to keep statement history coherent (documentation note only).

**Summary**: five rules re-derived; **no functional difference between code and the specification sheets**; three documentation-only nuances recorded here (pro-rata discount spread, per-year counter independent of pattern, completed-at-creation payment state).
