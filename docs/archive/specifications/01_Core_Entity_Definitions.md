# InvoiceNinja v5.13.50 — Core Business Entity Definitions

> **Source base:** `E:\invoiceninja-5.13.50`
> **Sources:** All entity models, their fillable/casts arrays, status constants, and relationship methods.

---

## 1. Invoice Entity

### 1.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Invoice.php` |
| **Primary Statuses** | `STATUS_DRAFT=1`, `STATUS_SENT=2`, `STATUS_PARTIAL=3`, `STATUS_PAID=4`, `STATUS_CANCELLED=5` |
| **Special Status** | `STATUS_UNPAID=6` (proforma — never transitions in normal flow) |
| **Relationships** | `client`, `company`, `user`, `assigned_user`, `invitations`, `payments` (M:N via Paymentable), `documents`, `activities`, `history`, `credits`, `subscription`, `project`, `location`, `tax_data` |

### 1.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `client_id` | int | Owning client (customer) |
| `user_id` | int | Creating user |
| `assigned_user_id` | int\|null | Assigned user for follow-up |
| `company_id` | int | Tenant/organization |
| `status_id` | int | Current lifecycle state (see §1.3) |
| `number` | string\|null | Invoice number (auto-generated when marked sent) |
| `po_number` | string\|null | Customer's purchase order reference |
| `date` | string\|null | Issue date (format: YYYY-MM-DD) |
| `due_date` | string\|null | Due date (auto-calculated from payment terms if blank) |
| `partial` | float\|null | Deposit/partial payment amount |
| `partial_due_date` | string\|null | Due date for partial payment |
| `amount` | float | Total invoice amount (subtotal + taxes - discounts + surcharges) |
| `balance` | float | Outstanding balance (amount - paid_to_date) |
| `paid_to_date` | float | Total amount paid so far |
| `discount` | float | Discount amount |
| `is_amount_discount` | bool | If true, discount is a fixed amount; if false, it is a percentage |
| `tax_name1/2/3` | string\|null | Invoice-level tax names |
| `tax_rate1/2/3` | float | Invoice-level tax rates (percent) |
| `total_taxes` | float | Sum of all tax amounts |
| `line_items` | object/array | Array of line item objects (see §4.1) |
| `terms` | string\|null | Payment terms text |
| `footer` | string\|null | Footer text |
| `public_notes` | string\|null | Notes visible to client |
| `private_notes` | string\|null | Internal notes (not visible to client) |
| `custom_value1/2/3/4` | string\|null | Custom monetary surcharges |
| `custom_surcharge1/2/3/4` | float\|null | Additional surcharge amounts |
| `custom_surcharge_tax1/2/3/4` | int | Tax flags for surcharges |
| `exchange_rate` | float | Currency exchange rate (1.0 = same currency) |
| `is_deleted` | bool | Soft-delete flag |
| `is_proforma` | bool | Proforma flag — does not affect client balance |
| `auto_bill_enabled` | bool | Auto-bill via payment gateway |
| `design_id` | int\|null | Design/theme for PDF rendering |
| `location_id` | int\|null | Geographic location (settings override) |
| `reminder1_sent` | string\|null | Timestamp of first reminder |
| `reminder2_sent` | string\|null | Timestamp of second reminder |
| `reminder3_sent` | string\|null | Timestamp of third reminder |
| `reminder_last_sent` | string\|null | Timestamp of last reminder |
| `last_sent_date` | string\|null | Date the invoice was last sent |
| `last_viewed` | string\|null | When the invoice was last viewed by client |
| `next_send_date` | string\|null | Next scheduled send date (auto-reminders) |
| `recurring_id` | int\|null | Links to a RecurringInvoice template |
| `subscription_id` | int\|null | Links to a Subscription |
| `e_invoice` | object\|null | E-invoice metadata (Verifactu, Peppol) |
| `uses_inclusive_taxes` | bool | Tax-inclusive pricing mode |

### 1.3 Status Transition Rules

> **Source:** `app/Models/Invoice.php` (status constants), `app/Services/Invoice/MarkSent.php` (draft→sent), `app/Services/Invoice/MarkPaid.php` (sent→paid, draft→sent→paid), `app/Services/Invoice/HandleCancellation.php` (→cancelled), `app/Services/Invoice/InvoiceService.php` (`setCalculatedStatus`, `updateStatus`)

| From | To | Trigger | Condition |
|---|---|---|---|
| DRAFT | SENT | `markSent()` / `InvoiceController::action('mark_sent')` | User action or auto-transition during payment |
| DRAFT | PARTIAL | `markPaid()` | Invoice is in DRAFT; auto-marks SENT first, applies partial payment |
| DRAFT | PAID | `markPaid()` | Invoice is in DRAFT; auto-marks SENT first, then applies full payment |
| SENT | PARTIAL | `applyPayment()` | Payment amount < balance |
| SENT | PAID | `applyPayment()` / `markPaid()` / `updateBalance()` | Payment amount ≥ balance OR balance rounds to 0 |
| SENT | CANCELLED | `handleCancellation()` | Must be cancellable (see §7.3) |
| SENT | DRAFT | `handleRestore()` | Only via restore of a soft-deleted invoice |
| PARTIAL | PAID | `applyPayment()` | Payment covers remaining balance |
| PARTIAL | CANCELLED | `handleCancellation()` | Same cancellable check |
| PAID | CANCELLED | `handleCancellation()` | Only if cancellable (rare) |
| PAID | CANCELLED | Auto-archive | When `auto_archive_invoice` setting is enabled |
| CANCELLED | DRAFT | `handleRestore()` | Soft-deleted invoice restored |

**Key business rule:** Balances are compared with `round($balance, 2) == 0` to handle floating-point precision. Currency precision is configurable per client currency (`client->currency()->precision`).

### 1.4 Number Generation

> **Source:** `app/Services/Invoice/ApplyNumber.php`

Invoice numbers are generated based on company settings:
- `counter_number_applied`: `'when_saved'` or other triggers
- Numbers respect the company's `invoice_number_prefix`, `invoice_number_suffix`, and padding settings
- Numbers are sequential within the company's counter scheme

---

## 2. Payment Entity

### 2.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Payment.php` |
| **Statuses** | `STATUS_PENDING=1`, `STATUS_CANCELLED=2` (voided), `STATUS_FAILED=3`, `STATUS_COMPLETED=4`, `STATUS_PARTIALLY_REFUNDED=5`, `STATUS_REFUNDED=6` |
| **Payment Types** | 54 types (see Master Catalog §4) via `type_id` field referencing `PaymentType` |
| **Relationships** | `client`, `company`, `user`, `assigned_user`, `contact`, `type`, `currency`, `exchange_currency`, `company_gateway`, `gateway_type`, `transaction`, `invoices` (M:N via Paymentable), `credits` (M:N via Paymentable), `vendor`, `project`, `documents`, `activities`, `tags`, `paymentables` |

### 2.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `client_id` | int | Receiving client |
| `company_id` | int | Tenant |
| `type_id` | int\|null | Payment type (reference to PaymentType) |
| `status_id` | int | Current lifecycle state (see §2.3) |
| `amount` | float | Total payment amount |
| `refunded` | float | Total amount refunded |
| `applied` | float | Total amount applied to invoices/credits |
| `date` | string\|null | Payment date |
| `transaction_reference` | string\|null | Reference/memo (e.g., check number, manual entry) |
| `number` | string\|null | Payment number (auto-generated) |
| `currency_id` | int | Currency of the payment |
| `exchange_rate` | float | Exchange rate to company currency |
| `exchange_currency_id` | int\|null | Company's base currency |
| `is_manual` | bool | True if manually entered (not via gateway) |
| `is_deleted` | bool | Soft-delete flag |
| `private_notes` | string\|null | Internal notes |
| `idempotency_key` | string\|null | For preventing duplicate gateway charges |
| `category_id` | int | Payment category |
| `custom_value1/2/3/4` | string\|null | Custom fields |
| `meta` | object\|null | Gateway-specific metadata |
| `refund_meta` | array\|null | History of refund operations |

### 2.3 Payment Status Transitions

| From | To | Trigger | Condition |
|---|---|---|---|
| PENDING | COMPLETED | Gateway webhook / manual | Payment processed successfully |
| PENDING | FAILED | Gateway webhook | Payment declined/failed |
| PENDING | CANCELLED | Timeout / user | Payment cancelled/voided |
| COMPLETED | PARTIALLY_REFUNDED | `refund()` | Partial refund processed |
| COMPLETED | REFUNDED | `refund()` | Full refund processed |
| COMPLETED | CANCELLED | `markVoided()` | Payment voided (amount set to refunded) |
| REFUNDED | — | Terminal | Cannot be voided if already refunded |
| PARTIALLY_REFUNDED | REFUNDED | `recordRefund()` | Remaining amount refunded |

**Key business rules:**
- A payment already **voided** (`STATUS_CANCELLED`) cannot be voided again
- A payment already **refunded** or **partially refunded** cannot be voided (`isVoided()` check in `markVoided()`)
- `getCompletedAmount()` = `amount - refunded` — this is the effective applied amount
- When a payment is voided: `refunded = amount`, `status_id = STATUS_CANCELLED`

---

## 3. Quote Entity

### 3.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Quote.php` |
| **Statuses** | `STATUS_DRAFT=1`, `STATUS_SENT=2`, `STATUS_APPROVED=3`, `STATUS_PURCHASED=4`, `STATUS_REJECTED=5`, `STATUS_CONVERTED=6`, `STATUS_EXPIRED=7` |
| **Relationships** | `client`, `company`, `user`, `assigned_user`, `invitations`, `documents`, `activities`, `history`, `project`, `tax_data` |

### 3.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `client_id` | int | Client receiving the quote |
| `status_id` | int | Current lifecycle state (see §3.3) |
| `number` | string\|null | Quote number |
| `due_date` | string\|null | Expiration date |
| `discount` | float | Discount amount |
| `is_amount_discount` | bool | Fixed amount vs percentage |
| `amount` | float | Total quote amount |
| `balance` | float | Outstanding balance |
| `paid_to_date` | float | Amount paid (for converted quotes) |
| `partial` | float\|null | Partial payment amount |
| `partial_due_date` | string\|null | Due date for partial |
| `line_items` | object/array | Line items |
| `tax_name1/2/3` | string\|null | Tax names |
| `tax_rate1/2/3` | float | Tax rates |
| `total_taxes` | float | Sum of taxes |
| `uses_inclusive_taxes` | bool | Inclusive tax mode |
| `exchange_rate` | float | Exchange rate |
| `is_deleted` | bool | Soft-delete |
| `auto_bill_enabled` | bool | Auto-bill flag (for converted invoices) |

### 3.3 Quote Status Transitions

| From | To | Trigger | Condition |
|---|---|---|---|
| DRAFT | SENT | `markSent()` | First send to client |
| SENT | APPROVED | `approve()` | Client accepts quote |
| SENT | REJECTED | `reject()` | Client declines quote |
| SENT | CONVERTED | `convertToInvoice()` | Quote accepted and converted to invoice |
| APPROVED | CONVERTED | `convertToInvoice()` | Auto-conversion (`auto_convert_quote` enabled) |
| APPROVED | — | Terminal | Cannot reject once approved |
| REJECTED | — | Terminal | Cannot act further |
| CONVERTED | — | Terminal | Cannot re-convert |

**Key business rules:**
- `approve()` requires status to be `STATUS_SENT`
- `reject()` requires status to be `STATUS_SENT`; sets notes on rejection
- `isConvertable()` returns false if: quote already converted (`invoice_id` set), status is `EXPIRED` or `CANCELLED`
- When `auto_convert_quote` is enabled on the client, approving a quote automatically converts it to an invoice and marks it sent
- Approval fires `QuoteWasApproved` event; rejection fires `QuoteWasRejected` event

---

## 4. Credit Entity

### 4.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Credit.php` |
| **Statuses** | `STATUS_DRAFT=1`, `STATUS_SENT=2`, `STATUS_PARTIAL=3`, `STATUS_APPLIED=4` |
| **Relationships** | `client`, `company`, `user`, `assigned_user`, `invitations`, `invoices` (M:N via Paymentable), `payments` (M:N via Paymentable), `documents`, `project`, `vendor` |

### 4.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `client_id` | int | Owning client |
| `status_id` | int | Lifecycle state (see §4.3) |
| `number` | string\|null | Credit number |
| `invoice_id` | int\|null | Parent invoice (if credit was generated from an invoice) |
| `amount` | float | Total credit amount |
| `balance` | float | Unapplied credit balance |
| `paid_to_date` | float | Amount applied so far |
| `discount` | float | Discount amount |
| `is_amount_discount` | bool | Fixed vs percentage |
| `line_items` | object/array | Line items (negative quantities for credit notes) |
| `tax_name1/2/3` | string\|null | Tax names |
| `tax_rate1/2/3` | float | Tax rates |
| `total_taxes` | float | Tax sum |
| `partial` | float\|null | Partial application amount |
| `partial_due_date` | string\|null | Due date for partial |

### 4.3 Credit Status Transitions

| From | To | Trigger | Condition |
|---|---|---|---|
| DRAFT | SENT | `markSent()` | First send to client |
| SENT | PARTIAL | `applyPayment()` | Credit applied to invoice, partial remaining |
| SENT | APPLIED | `updateBalance()` | `balance == 0` after application |
| DRAFT | APPLIED | Direct application | Balance reduced to 0 on first entry |

**Key business rules:**
- When `balance` reaches `0`, status auto-transitions to `STATUS_APPLIED` (in `updateBalance()` method, line 419-423)
- Credits are applied via the `Paymentable` pivot table linking `Payment → Credit` or directly to invoices
- Credits can be used to offset invoice balances before payment is recorded

---

## 5. Recurring Invoice Entity

### 5.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/RecurringInvoice.php` |
| **Statuses** | `STATUS_DRAFT=1`, `STATUS_ACTIVE=2`, `STATUS_PAUSED=3`, `STATUS_COMPLETED=4`, `STATUS_PENDING=-1` (dynamic — active but next_send_date is future) |
| **Relationships** | `client`, `company`, `user`, `assigned_user`, `invoices` (generated instances), `invitations`, `subscription` |

### 5.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `client_id` | int | Owning client |
| `status_id` | int | Template status |
| `frequency_id` | int | Recurrence frequency (see Frequency Reference) |
| `remaining_cycles` | int\|null | Cycles remaining (-1 = infinite) |
| `next_send_date` | string\|null | Next scheduled send date (server-side, UTC) |
| `next_send_date_client` | string\|null | Next scheduled send date (client timezone) |
| `auto_bill` | string | Auto-bill configuration |
| `auto_bill_enabled` | bool | Whether auto-billing is active |
| `number` | string\|null | Template number |
| `due_date_days` | string\|null | "terms", "on_receipt", or numeric days |
| `is_proforma` | bool | Proforma flag |

### 5.3 Recurring Invoice Status Transitions

| From | To | Trigger | Condition |
|---|---|---|---|
| DRAFT | PENDING | `start()` | First activation; becomes ACTIVE if next_send_date is past |
| DRAFT | ACTIVE | `start()` | Activation when next_send_date is due |
| DRAFT | PAUSED | Manual | User pauses before activation |
| ACTIVE | PAUSED | `stop()` | User pauses |
| PAUSED | ACTIVE | `start()` | User resumes |
| ACTIVE | COMPLETED | Auto | `remaining_cycles == 0` |
| ACTIVE | PENDING | Auto | `next_send_date` is in the future |
| COMPLETED | ACTIVE | `remaining_cycles` changed from 0 to non-zero | User resets cycles |

**Key business rules:**
- `getStatusAttribute()` dynamically returns `STATUS_PENDING` when the template is `STATUS_ACTIVE` but `next_send_date` is in the future
- `calculateStatus()` determines final status based on `remaining_cycles`
- `remainingCycles()` returns `0` if no cycles left, `-1` if infinite, `remaining_cycles - 1` otherwise
- When `stop_on_unpaid_recurring` is enabled, overdue recurring invoices have their `next_send_date` reset to today to prevent back-scheduling
- `setCompleted()` sets status to `STATUS_COMPLETED`, clears `next_send_date`, sets `remaining_cycles = 0`

---

## 6. Recurring Quote Entity

### 6.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/RecurringQuote.php` |
| **Statuses** | `STATUS_DRAFT=1`, `STATUS_ACTIVE=2`, `STATUS_PAUSED=3`, `STATUS_COMPLETED=4`, `STATUS_PENDING=-1` |
| **Relationships** | `client`, `company`, `user`, `assigned_user`, `quotes` (generated instances), `invitations` |

### 6.2 Key Fields

Same field structure as RecurringInvoice, including:
- `frequency_id`, `remaining_cycles`, `next_send_date`, `next_send_date_client`, `due_date_days`
- `auto_bill`, `auto_bill_enabled`, `is_proforma`
- Shared `HasRecurrence` trait for date calculation

### 6.3 Recurring Quote Status Transitions

Identical transition logic to Recurring Invoice (see §5.3).

---

## 7. Purchase Order Entity

### 7.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/PurchaseOrder.php` |
| **Statuses** | `STATUS_DRAFT=1`, `STATUS_SENT=2`, `STATUS_APPROVED=3`, `STATUS_PURCHASED=4`, `STATUS_DELETED=5` |
| **Relationships** | `client` (as vendor), `vendor`, `company`, `user`, `assigned_user`, `invitations`, `documents`, `activities`, `history`, `project` |

### 7.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `client_id` | int | Company (yourself) |
| `vendor_id` | int | Supplier/vendor |
| `status_id` | int | Lifecycle state (see §7.3) |
| `number` | string\|null | PO number |
| `date` | string\|null | PO date |
| `due_date` | string\|null | Expected delivery date |
| `partial` | float\|null | Partial payment/receipt amount |
| `partial_due_date` | string\|null | Due date for partial |
| `amount` | float | Total PO amount |
| `balance` | float | Outstanding balance |
| `discount` | float | Discount amount |
| `is_amount_discount` | bool | Fixed vs percentage |
| `tax_name1/2/3` | string\|null | Tax names |
| `tax_rate1/2/3` | float | Tax rates |
| `total_taxes` | float | Tax sum |
| `line_items` | object/array | Line items (same format as invoices) |
| `custom_value1/2/3/4` | string\|null | Custom surcharges |
| `exchange_rate` | float | Exchange rate |
| `e_invoice` | object\|null | E-invoice metadata |

### 7.3 Purchase Order Status Transitions

| From | To | Trigger | Condition |
|---|---|---|---|
| DRAFT | SENT | `send()` | First send to vendor |
| SENT | APPROVED | `approve()` | Vendor accepts / internal approval |
| APPROVED | PURCHASED | `markPurchased()` | Goods received / payment processed |
| SENT | DELETED | `handleCancellation()` | Cancelled before approval |
| APPROVED | DELETED | `handleCancellation()` | Cancelled after approval |

**Key business rules:**
- `invoiceCancellable()` check determines whether a PO can be cancelled
- POs use the same `InvoiceSum` calculation engine as invoices
- E-invoice generation supported (Verifactu compliance)

---

## 8. Subscription Entity

### 8.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Subscription.php` |
| **Relationships** | `company`, `user`, `assigned_user`, `client` (via `client_subscriptions`), `recurring_invoice` (if linked), `payment` |

### 8.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Owning company |
| `name` | string | Subscription/plan name |
| `description` | string\|null | Description |
| `is_active` | bool | Whether the subscription is active |
| `amount` | float | Subscription price |
| `interval` | string | Billing interval (day/week/month/year) |
| `interval_count` | int | Number of intervals per billing cycle |
| `trial_period` | int | Trial period in days |
| `trial_interval` | string | Trial interval unit |
| `invoice_id` | int\|null | Linked recurring invoice |
| `is_free` | bool | Free plan flag |
| `is_trial` | bool | Trial plan flag |
| `custom_value1/2/3/4` | string\|null | Custom fields |

### 8.3 Subscription Lifecycle

| State | Transition | Trigger |
|---|---|---|
| New | → Active | Client subscribes; recurring invoice generated |
| Active | → Canceled | Client cancels / admin cancels |
| Active | → Unpaid | Payment fails |
| Active | → Past Due | Payment overdue |
| Canceled | → Active | Client re-subscribes |

---

## 9. Client Entity

### 9.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Client.php` |
| **Relationships** | `company`, `contacts` (ClientContact), `invoices`, `payments`, `quotes`, `credits`, `expenses`, `recurring_invoices`, `subscriptions`, `tasks`, `projects`, `activities`, `country`, `tax_data` |

### 9.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `number` | string\|null | Client number (auto-assigned) |
| `display_name` | string | Full display name |
| `first_name` | string\|null | First name |
| `last_name` | string\|null | Last name |
| `email` | string\|null | Primary email |
| `phone` | string\|null | Phone number |
| `address1` | string\|null | Address line 1 |
| `address2` | string\|null | Address line 2 |
| `city` | string\|null | City |
| `state` | string\|null | State/Province |
| `zip` | string\|null | Postal code |
| `country_id` | int\|null | Country reference |
| `balance` | float | Current outstanding balance (sum of sent+partial invoice balances) |
| `paid_to_date` | float | Total paid across all invoices |
| `payment_balance` | float | Unapplied payments |
| `credit_balance` | float | Available credit balance |
| `is_tax_exempt` | bool | Tax exemption flag |
| `is_deleted` | bool | Soft-delete |
| `contact_key` | string | Encrypted key for portal access |
| `settings` | object | Client-specific settings (overrides company/group defaults) |
| `public_notes` | string\|null | Public notes |

### 9.3 Client Balance Calculations

> **Source:** `app/Services/Client/ClientService.php` (lines 46-95)

| Calculation | Method | Logic |
|---|---|---|
| **Balance** | `calculateBalance()` | `SUM(balance) FROM invoices WHERE status_id IN (SENT, PARTIAL) AND is_deleted = false` |
| **Paid To Date** | `calculatePaidToDate()` | `SUM(paid_to_date) FROM invoices WHERE status_id IN (PARTIAL, PAID) AND is_proforma = false AND is_deleted = false` |
| **Payment Balance** | `updatePaymentBalance()` | `SUM(amount - applied) FROM payments WHERE status_id IN (COMPLETED, PENDING, PARTIALLY_REFUNDED, REFUNDED) AND is_deleted = 0` |
| **Credit Balance** | `getCreditBalance()` | `SUM(balance) FROM credits WHERE is_deleted = false AND (due_date >= today OR due_date IS NULL)` |
| **Available Credits** | `getCredits()` | Same scope as credit balance; ordered by `created_at ASC` |

### 9.4 Client Settings Hierarchy

Settings cascade from Company → GroupSetting → Client. `getMergedSettings()` merges all levels with client settings taking priority.

Key settings include: `currency_id`, `payment_terms` (days), `payment_type_id`, `date_format_id`, `timezone`, `locale`, `is_tax_exempt`, `auto_convert_quote`, `auto_archive_quote`, `auto_archive_invoice`, `auto_archive_invoice_cancelled`, `stop_on_unpaid_recurring`, `send_email_on_mark_paid`, `client_manual_payment_notification`, `france_reporting_enabled`, `verifactu_enabled`, `peppol_sending_enabled`, `e_invoice_type` (PEPPOL), `custom_value1_label`–`custom_value4_label`.

---

## 10. Product Entity

### 10.1 Identity & Relationships

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/Product.php` |
| **Relationships** | `company`, `user`, `assigned_user`, `tax_rate` (3 tax rates), `categories` (ExpenseCategory), `activities`, `documents` |

### 10.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `product_key` | string | SKU / product code |
| `name` | string | Product name |
| `description` | string\|null | Description |
| `unit_price` | float | Unit price |
| `cost` | float | Cost price |
| `quantity` | float | Quantity on hand |
| `notes` | string\|null | Internal notes |
| `tax_rate1/2/3` | float | Tax rate fields |
| `tax_name1/2/3` | string\|null | Tax name fields |
| `custom_value1/2/3/4` | float | Custom fields |
| `custom_surcharge1/2/3/4` | float | Surcharges |
| `is_deleted` | bool | Soft-delete |
| `track_quantity` | bool | Whether to track stock |
| `is_cost_known` | bool | Whether cost is known |
| `in_stock_quantity_threshold` | int | Reorder threshold |

### 10.3 Inventory Behavior

> **Source:** `app/Jobs/Inventory/AdjustProductInventory.php`, referenced in `app/Services/Invoice/InvoiceService.php::adjustInventory()`

- Inventory tracking is enabled at the company level (`company->track_inventory`)
- When an invoice is created/saved with product line items, inventory is decremented
- When an invoice is deleted or refunded, inventory is incremented back
- `adjustInventory()` is called during invoice save; `handleRestoredInvoice()` restores inventory on restore
- The `AdjustProductInventory` job handles: initial adjustment, invoice deletion adjustment, and restoration

---

## 11. TaxRate Entity

### 11.1 Identity & Fields

| Aspect | Detail |
|---|---|
| **Model** | `app/Models/TaxRate.php` |
| **Relationships** | `company`, `country`, `activities` |

### 11.2 Key Fields

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `country_id` | int\|null | Linked country |
| `tax_name` | string | Tax name (e.g., "VAT", "GST") |
| `tax_rate` | float | Tax rate percentage |
| `is_deleted` | bool | Soft-delete |
| `type_id` | int\|null | Tax type classification |
| `custom_value1/2/3/4` | string\|null | Custom fields |

---

## 12. Vendor Entity

### 12.1 Identity & Fields

> **Source:** `app/Models/Vendor.php`

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `assigned_user_id` | int\|null | Assigned user |
| `number` | string\|null | Vendor number |
| `name` | string | Vendor name |
| `address1/2` | string\|null | Address |
| `city` | string\|null | City |
| `state` | string\|null | State |
| `zip` | string\|null | Postal code |
| `country_id` | int\|null | Country |
| `email` | string\|null | Email |
| `phone` | string\|null | Phone |
| `contact_name` | string\|null | Contact person |
| `contact_phone` | string\|null | Contact phone |
| `contact_email` | string\|null | Contact email |
| `balance` | float | Outstanding balance from purchase orders |
| `paid_to_date` | float | Total paid |
| `custom_value1/2/3/4` | string\|null | Custom fields |
| `is_deleted` | bool | Soft-delete |
| `settings` | object | Vendor-specific settings |

---

## 13. Expense Entity

### 13.1 Identity & Fields

> **Source:** `app/Models/Expense.php`

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `client_id` | int\|null | Associated client (billable expense) |
| `vendor_id` | int\|null | Vendor/supplier |
| `payment_type_id` | int\|null | How it was paid |
| `project_id` | int\|null | Associated project |
| `invoice_id` | int\|null | If added to an invoice |
| `transaction_id` | int\|null | Bank transaction |
| `amount` | float | Expense amount |
| `tax_amount` | float | Tax portion |
| `custom_value1/2/3/4` | string\|null | Custom fields |
| `public_notes` | string\|null | Public notes |
| `private_notes` | string\|null | Internal notes |
| `date` | string\|null | Expense date |
| `payment_date` | string\|null | Payment date |
| `due_date` | string\|null | If bill |
| `is_bill` | bool | True if this is a bill (accounts payable) |
| `is_deleted` | bool | Soft-delete |
| `is_recurring` | bool | Part of recurring expense |
| `recurring_id` | int\|null | Link to recurring expense template |

---

## 14. InvoiceItem Data Mapper

> **Source:** `app/DataMapper/InvoiceItem.php`

Each line item in `line_items` array has the following structure:

| Field | Type | Description |
|---|---|---|
| `product_key` | string | SKU / product code |
| `notes` | string\|null | Line item description |
| `cost` | float | Unit cost |
| `quantity` | float | Quantity |
| `unit_value` | float | Unit price (for time-based items, seconds) |
| `unit_name` | string | Unit name (e.g., "hour", "service", custom) |
| `line_total` | float | Total for this line (cost × quantity) |
| `discount` | float | Line-level discount |
| `is_amount_discount` | bool | Fixed amount vs percentage |
| `tax_name1/2/3` | string\|null | Tax names at line level |
| `tax_rate1/2/3` | float | Tax rates at line level |
| `tax1/2/3` | float | Calculated tax amounts |
| `sort_order` | int | Display order |
| `type_id` | int | Line item type (1=standard product/service, 3=gateway fee, 4=confirmed gateway fee) |
| `product_id` | int\|null | Linked product |
| `task_id` | int\|null | Linked task |
| `expense_id` | int\|null | Linked expense |
| `custom_value1/2/3/4` | string\|null | Custom fields |

### 14.1 Line Item Type Classification

| Type ID | Meaning |
|---|---|
| 1 | Standard product/service line |
| 2 | Comment/description only |
| 3 | Gateway fee (pre-confirmation, deprecated) |
| 4 | Confirmed gateway fee (post-confirmation) |

---

## 15. FeesAndLimits Data Mapper

> **Source:** `app/DataMapper/FeesAndLimits.php`

Used for payment gateway fee calculation and limits:

| Field | Type | Description |
|---|---|---|
| `min_limit` | float | Minimum payment amount (-1 = unlimited) |
| `max_limit` | float | Maximum payment amount (-1 = unlimited) |
| `fee_amount` | float | Flat fee per transaction |
| `fee_percent` | float | Percentage fee |
| `fee_tax_name1/2/3` | string | Tax names for fees |
| `fee_tax_rate1/2/3` | float | Tax rates for fees |
| `fee_cap` | float | Cap on fee percentage |
| `adjust_fee_percent` | bool | Whether to adjust fee percent |
| `is_enabled` | bool | Whether fees are active |
| `gateway_type_id` | int | Gateway type classification |

---

## 16. Paymentable Pivot Entity

> **Source:** `app/Models/Paymentable.php`

Links payments to invoices or credits. Tracks applied amounts.

| Field | Type | Description |
|---|---|---|
| `payment_id` | int | Payment reference |
| `paymentable_id` | int | Invoice or Credit ID |
| `paymentable_type` | string | `'invoices'` or `Credit::class` |
| `amount` | float | Amount applied |
| `refunded` | float | Amount refunded from this application |
| `created_at` | timestamp | Application timestamp (business date) |
| `deleted_at` | timestamp\|null | Soft-delete for reversal |

**Key business rule:** The `Paymentable` pivot allows tracking of partial payments, refunds, and reversals at a granular level. When a payment is deleted/restored, paymentables are soft-deleted/restored to maintain audit trail.

---

## 17. InvoiceBackup Data Mapper

> **Source:** `app/DataMapper/InvoiceBackup.php` (referenced in Invoice and Credit models)

Contains regulatory and backup metadata:

| Field | Type | Description |
|---|---|---|
| `guid` | string\|null | Verifactu registration GUID |
| `document_type` | string | F1 (new), R1 (partial rectification), R2 (full cancellation) |
| `adjustable_amount` | float | Amount available for adjustment |
| `parent_invoice_id` | string\|null | Hashed ID of parent invoice |
| `parent_invoice_number` | string | Parent invoice number |
| `child_invoice_ids` | array | Linked child invoices |
| `cancellation` | object | Cancellation details (adjustment, status_id) |
| `notes` | string\|null | Cancellation notes |
| `redirect` | string\|null | Client portal redirect URL |
| `e_invoice` | object\|null | E-invoice metadata |

---

## 18. PaymentSync Data Mapper

> **Source:** `app/DataMapper/PaymentSync.php` (cast on Payment model)

Synchronization metadata for gateway-linked payments:

| Field | Type | Description |
|---|---|---|
| Various | mixed | Sync state for external gateway reconciliation |

---

## Cross-Reference: Entity-to-FRD Mapping

| Entity | Detailed in FRD Document |
|---|---|
| Invoice | `01_Invoice_Management_FRD.md` |
| Payment | `02_Payment_Management_FRD.md` |
| Quote | `03_Quote_Management_FRD.md` |
| Credit | `03_Quote_Management_FRD.md` |
| RecurringInvoice/RecurringQuote | `04_Recurring_Engine_FRD.md` |
| PurchaseOrder | `05_Purchase_Order_Vendor_FRD.md` |
| Subscription | `06_Subscription_Billing_FRD.md` |
| Client | `07_Client_Management_FRD.md` |
| Product | `08_Product_Inventory_FRD.md` |
| Expense | `05_Purchase_Order_Vendor_FRD.md` |
| TaxRate | `09_Tax_Configuration_FRD.md` |
| Reports | `10_Reports_FRD.md` |
| E-Invoicing/Verifactu | `11_EInvoicing_Compliance_FRD.md` |
| Webhooks | `12_Integrations_FRD.md` |
