# InvoiceNinja v5.13.50 — Implementation Primer Appendix

> **Purpose:** Key architectural patterns, conventions, and implementation guidance referenced across all FRDs. Read this before coding any module.

---

## 1. Architectural Patterns

### 1.1 Service-Repository-Model Pattern
Every entity follows a 3-layer structure:

```
Model          →  app/Models/Entity.php        (data layer: DB mapping, accessors, mutators)
Service        →  app/Services/EntityService.php (business logic, state transitions, side effects)
Repository     →  app/Repositories/EntityRepository.php (persistence logic, mapping from request)
Controller     →  app/Http/Controllers/EntityController.php (HTTP routing, request validation, response)
Request        →  app/Http/Requests/Entity/[Action]Request.php (input validation)
```

**Rule:** Business logic lives ONLY in Services. Controllers delegate to Services. Repositories handle persistence only.

### 1.2 Event-Driven Architecture
Events fire on state changes; listeners handle side effects:
```
InvoiceWasMarkedPaid      → PaymentService, NotificationService
InvoiceWasCreated         → ActivityService, WebhookService
RecurringInvoiceWasGenerated → AutoBillInvoice job
ClientWasCreated          → MapSettings, ActivityService
PaymentWasCreated         → InvoiceService (apply to balance)
CreditWasCreated          → ClientService (recalculate balance)
```

### 1.3 Command Bus for Actions
Entity actions follow the `Entity\Action` pattern:
- `MarkPaid`, `MarkSent`, `CancelInvoice`, `RefundPayment`, `ConvertQuote`, `ApproveQuote`
- Each action is a service class with a `run()` method
- Invoked via `entity.service()->action()` or `EntityAction::handle()`
- Actions are composable and chainable

### 1.4 Queue Jobs
Heavy or async operations dispatched to queue:
- `SendRecurring` — generate invoices from templates
- `EmailEntity` — send notification emails
- `AdjustProductInventory` — inventory changes
- `CreateEDocument` — e-invoice/Peppol generation
- `UpdateRecurring` — bulk price updates
- `ImportCsv` — data imports

---

## 2. Calculation Engine: InvoiceSum

> **Source:** `app/Helpers/Invoice/InvoiceSum.php`

**ALL monetary calculations** for invoices, quotes, credits, and recurring invoices flow through `InvoiceSum`:

```
InvoiceSum::build(invoice, reload = false):
  ├─ line_items → calculate per-line: cost × quantity
  ├─ discounts → apply before or after tax (per setting)
  ├─ taxes → apply per line (tax_name1/2/3, tax_rate1/2/3)
  │   └─ Uses Discounter::calculate() for complex scenarios
  ├─ total_discount → sum of all discounts
  │   └─ FOR AMOUNT DISCOUNTS: taxes recomputed per-line via calcTaxesWithAmountDiscount()
  ├─ total_taxes → sum of all tax amounts
  ├─ total_cost → net subtotal (before tax, after discount)
  │   └─ Uses calculateInclusive() if uses_inclusive_taxes
  ├─ total → total cost + total taxes + surcharges
  └─ balance → total - paid_to_date
```

**Critical flags:**
- `uses_inclusive_taxes` → taxes embedded in product prices
- `is_amount_discount` → fixed value vs percentage
- `custom_surcharge1-4` + `custom_surcharge_tax1-4` → additional charges with tax

**Must call `InvoiceSum::build(invoice, true)` after any modification that affects amounts.**

---

## 3. State Transition Rules

### 3.1 Invoice Status Transitions (Canonical)
> **Source:** `app/Models/Invoice.php` + `app/Services/Invoice/InvoiceService.php`

```
Valid transitions (invoice_status_history table tracks each):
DRAFT (1)  → SENT (2):    markSent()  (atomic UPDATE WHERE status=DRAFT)
SENT (2)   → PAID (4):     markPaid()  (requires balance=0)
SENT (2)   → PARTIAL (3):  markPaid() with partial payment
PARTIAL (3)→ PAID (4):     markPaid()  (remaining balance=0)
SENT (2)   → CANCELLED (5):  cancel() (balance must be 0)
PARTIAL (3)→ CANCELLED (5):  cancel() (balance must be 0)
PAID/PARTIAL/CANCELLED → DRAFT (restore): restore()
```

**Guard rules:**
- Cannot cancel an invoice with balance > 0
- Cannot mark paid unless full payment is applied
- Cancellations create a reversal credit for balance adjustment
- Restoration resets balances and reverses payment application

### 3.2 Payment Status Transitions
```
PENDING (1) → COMPLETED (2):   Payment received
PENDING (1) → FAILED (3):      Gateway rejection
COMPLETED (2) → PARTIALLY_REFUNDED (3): Partial refund
COMPLETED (2) → REFUNDED (4):   Full refund
```

**Key rule:** Payment status reflects the **gateway transaction state**, not the invoice-application state. A COMPLETED payment can have some funds on invoice and some on credit (paymentable.amount vs refunded).

### 3.3 Recurring Invoice Status (See Recurring Engine FRD §3)
- `STATUS_PENDING = -1` is a **dynamic/virtual status** computed at display time, never persisted
- `STATUS_COMPLETED` is set when `remaining_cycles == 0`
- Templates can only be started (DRAFT → ACTIVE) when `remaining_cycles ≠ 0`

---

## 4. Number Sequences

### 4.1 Number Pattern
Each entity type has a number pattern:
```
Default invoice:  YYYY-MM-####
Default quote:    YYYY-####
Default client:   ####
Default vendor:   VENDOR-####
```

**Pattern tokens:** `YYYY` = 4-digit year, `MM` = 2-digit month, `####` = sequential counter

### 4.2 Counter Management
- Counter stored on Company: `invoice_number_counter`, `quote_number_counter`, etc.
- `counter_number_applied` setting controls WHEN the number is assigned:
  - `when_saved` → assigned at creation (default)
  - `when_sent` → assigned when transitioning DRAFT → SENT

**Important:** If `when_sent`, the number is assigned atomically during the `MarkSent` transaction. The `UPDATE ... WHERE status = DRAFT` lock prevents number collisions.

---

## 5. Tax Calculation Deep Dive

### 5.1 Tax Application Order
> **Source:** `app/Helpers/Invoice/Discounter.php`, `app/Helpers/Invoice/Taxer.php`

```
Total = (net_amount - discounts + surcharges) + taxes
```

1. **Line items** calculated: `cost × quantity` → line subtotal
2. **Discounts** applied:
   - Percentage discount: multiplied across each line's subtotal proportionally
   - Amount discount: split proportionally across lines, then **taxes recomputed per-line**
     via `InvoiceItemSum::calcTaxesWithAmountDiscount()`
3. **Taxes** computed per line: `net_line_amount × (tax_rate / 100)`
4. **Surcharges** added: `custom_surcharge1-4` (before or after tax per setting)
5. **Total** = sum of all lines + taxes + surcharges

### 5.2 Tax Exemption
If `client.is_tax_exempt = true`:
- All tax rates zeroed
- `total_taxes = 0`
- Tax fields on invoice set to empty/null

### 5.3 Inclusive Taxes
If `invoice.uses_inclusive_taxes = true`:
- Tax embedded in line item prices
- `calculateInclusive()` method extracts tax from gross amount:
  ```
  tax_amount = gross × (rate / (100 + rate))
  net = gross - tax_amount
  ```

---

## 6. Client Settings Hierarchy

> **Source:** `app/Services/Client/MapSettings.php`

```php
// Runtime resolution: Company → GroupSetting → Client → ClientContact
$client->getMergedSettings():
1. Start with company->settings (base defaults)
2. IF client.group_setting_id: merge group->settings
3. IF client->settings: merge client-level overrides
4. IF contact->settings: merge contact-level overrides
5. Return merged Settings object
```

**Example cascade:**
- Company: `payment_terms = 30`, `currency = USD`
- GroupSetting: `payment_terms = 15`
- Client: `currency = EUR`
- Result: `payment_terms = 15` (from group), `currency = EUR` (from client)

---

## 7. Currency & Exchange Handling

### 7.1 Exchange Rate Sources
| Source | Setting | Notes |
|---|---|---|
| `config` (manual) | `currency_converter_api = 'config'` | Company sets rates manually in UI |
| Yahoo Finance | `currency_converter_api = 'yahoo'` | Free API, 24h refresh |
| European Central Bank | `currency_converter_api = 'ecb'` | Daily rates |
| OpenExchangeRates | `currency_converter_api = 'openexchangerates'` | Requires API key |
| Custom API | `currency_converter_api = 'api'` | Custom endpoint URL |

### 7.2 Exchange Rate Refresh
- Cron job: `UpdateExchangeRates` runs daily
- Stores rates as `currency_id → {rate, updated_at}` in `currencies` table
- Exchange percent markup: `settings.exchange_percent` added on top (for payment processing fees)

### 7.3 Invoice Currency Conversion
When invoice currency differs from company base currency:
```
invoice.exchange_rate → set at creation time from currencies table
amounts stored in invoice currency; converted to base for reporting
report_currency conversion: amount_base = amount × exchange_rate
```

---

## 8. Email & Communication

### 8.1 Email Templates
> **Source:** `app/Models/EmailTemplate.php`

Templates are stored per-company with merge variables:
```php
// Available variables in templates:
$client->name, $client->email, $client->phone
$invoice->number, $invoice->total, $invoice->balance, $invoice->due_date
$payment->amount, $payment->date, $payment->payment_date
$user->name, $user->email
$company->name, $company->logo
```

**Built-in templates:**
- `email_template_invoice` — invoice sent
- `email_template_payment` — payment receipt
- `email_template_quote` — quote sent
- `email_template_statement` — client statement
- `email_template_upcoming_recurring_invoice` — reminder
- `email_template_recurring_invoice` — recurring generation
- `email_template_invoice_history` — payment history
- `email_template_reminder1/2/3` — dunning reminders

### 8.2 Email Delivery Status
- Templates store `{ }__{entity_id}` tracking token in email body
- `POSTMARK_WEBHOOK`, `MAILGUN_WEBHOOK`, `BREVO_WEBHOOK` routes receive delivery events
- Delivery status tracked via `Activity` records:
  - `EMAIL_SENT` (type 30)
  - `EMAIL_OPENED` (type 31)
  - `EMAIL_FAILED` (type 32)

---

## 9. Bulk Operations Pattern

> **Source:** `app/Http/Controllers/EntityController.php` (`bulk()`)

All entities support bulk actions via:
```
POST /api/v1/{entity}/bulk
{
  "action": "mark_paid | mark_sent | cancel | archive | delete | stop | start | send_now",
  "ids": ["hashed_id_1", "hashed_id_2", ...]
}
```

**Bulk action resolution:**
```php
EntityRepository::performAction(ids, action):
├─ Look up action in static $bulk_actions map
├─ Validate user has permission for each entity
├─ Iterate: apply action via EntityService
├─ Each action fires its own events
├─ Return: {success: true, count_processed, count_skipped}
```

**Rules:**
- All-or-nothing transactions per entity (not the batch as a whole)
- Skipped entities (already paid, already started) counted but not failed
- Admin permissions bypass per-entity checks

---

## 10. Data Integrity & Soft-Delete Convention

### 10.1 Soft-Delete Pattern
All entities use `is_deleted` boolean (NOT Laravel's `SoftDeletes` trait):
- `is_deleted = true` → entity hidden from all queries
- Queries use `where('is_deleted', false)` via scopes or repository filters
- Deleted entities can be restored via `PUT` with `is_deleted = false`
- Purge endpoint (`password_protected` middleware) performs hard delete

### 10.2 Number Preservation
- Soft-deleted entity numbers are NOT reused
- Counter only increments; never resets (unless manually reset via settings)
- This ensures audit trail integrity

### 10.3 Balance Cascade
When an invoice is voided/cancelled:
1. Invoice balance → set to 0
2. Client balance decremented by invoice balance
3. Client `paid_to_date` adjusted
4. Paymentable records for that invoice marked cancelled
5. If the invoice had auto-applied credits, they are returned to client credit balance

---

## 11. Queue & Job Conventions

### 11.1 Job Naming Convention
All jobs prefixed with `App\Jobs\`:
- `SendRecurring` — recurring invoice generation (cron)
- `EmailEntity` — email sending (async)
- `AdjustProductInventory` — inventory sync
- `CreateEDocument` — e-invoice generation
- `SendToAeat` — Verifactu submission
- `UpdateRecurring` — bulk recurring price update
- `ApplyCreditPayment` — credit application
- `ImportCsv` — data import processing

### 11.2 Retry Logic
Jobs use Laravel's built-in retry:
- `tries = 3` (default for most jobs)
- `backoff()` method returns `[30, 60, 120]` (exponential backoff)
- Payment-related jobs use `tries = 1` (no auto-retry for charge attempts)
- E-invoice submissions use `tries = 1` (idempotent at AEAT level)

### 11.3 Queue Connection
- Default: `redis` (in production) or `sync` (testing)
- Jobs tagged with queue name for prioritization:
  - `high` — SendRecurring, EmailEntity
  - `medium` — CreateEDocument, SendToAeat
  - `low` — ImportCsv, UpdateRecurring
