# InvoiceNinja v5.13.50 — Client Management Module FRD

> **Source base:** `E:\invoiceninja-5.13.50`
> **Sources:** `app/Models/Client.php`, `app/Services/Client/ClientService.php`, `app/Http/Controllers/ClientController.php`, `app/Models/ClientContact.php`, `app/Services/Client/MapSettings.php`, `app/Services/Client/Statement.php`, `app/Http/Requests/Client/StoreClientRequest.php`

---

## 1. System Overview & Boundaries

### Scope
**In-scope:**
- Client entity lifecycle: creation, update, merging, archiving (soft-delete), purging
- Client contact management (multi-contact per client)
- Client settings: settings hierarchy, currency, tax exemption, payment terms, notifications
- Client financial state: balance, paid_to_date, credit_balance, payment_balance
- Client statements (PDF generation, email delivery)
- Client portal access: contact keys, invitation-based access
- Client merging and deduplication
- VAT number validation (EU)
- Peppol discovery for e-invoicing

**Out-of-scope:**
- Invoice/Payment creation for clients (covered in Invoice/Payment FRDs)
- Client portal authentication (covered in Authentication FRD)

### Actors
| Actor | Role |
|---|---|
| **Authenticated User** | Creates/edits clients, merges duplicates, adjusts settings |
| **Client Contact (Portal)** | Portal login, views invoices/payments, pays, receives statements |
| **System** | VAT validation, Peppol discovery, statement generation cron |

### Triggers
| Trigger | Type | Source |
|---|---|---|
| `POST /api/v1/clients` | User action | API/UI |
| `PUT /api/v1/clients/{id}` | User action | Client edit |
| `POST /clients/{id}/{mergeable}/merge` | User action | Merge duplicates |
| `POST /clients/{id}/purge` | User action | Permanent delete (password protected) |
| `POST /client_statement` | User action | Generate statement |
| `POST /clients/{id}/check_vat` | System/User | VAT validation |
| `POST /clients/{id}/peppol_discovery` | System/User | Peppol network discovery |

---

## 2. Functional Input/Output Matrix

| Trigger / Action | Input Data | Validation Rules | Expected Output / Side Effects |
|---|---|---|---|
| **Store Client** (`POST /api/v1/clients`) | `name`, `email`, `phone`, `address1`, `address2`, `city`, `state`, `zip`, `country_id`, `currency_id`, `number`, `custom_value1-4`, `settings` (object), `is_tax_exempt` | Name is required; email format valid if provided; country_id must exist; currency_id must exist; number must be unique per company | Client created with auto-generated `number` if not provided; `balance = 0`, `paid_to_date = 0`, `credit_balance = 0`; settings merged from company defaults |
| **Update Client** (`PUT /api/v1/clients/{id}`) | All store fields, plus `assigned_user_id` | Must not be deleted; user has edit permission; email unique if provided | Client fields updated; settings merged; if currency changed → exchange rates recalculated for pending invoices |
| **Merge Clients** (`POST /clients/{id}/{mergeable}/merge`) | Two client hashes | Password protected (admin only); both clients belong to same company | Primary client keeps all data; secondary client's invoices/payments/quotes re-assigned to primary; secondary client soft-deleted; contacts merged |
| **Purge Client** (`POST /clients/{id}/purge`) | Client hash | Password protected; client must be soft-deleted first | All client data permanently deleted; invoices, payments, credits, quotes, expenses, tasks all purged; cannot be undone |
| **Generate Statement** (`POST /client_statement`) | `client_id`, `start_date`, `end_date`, `send_email` (bool), `only_clients_with_invoices` (bool), `country_id`, `payment_state` | Client must be valid; dates valid | PDF statement generated showing all invoices/payments within period; if `send_email` → email dispatched to client contact |
| **Check VAT** (`POST /clients/{id}/check_vat`) | `tax_data.vat_number` | VAT number format valid | VAT number validated against EU VIES service; `client.tax_data` updated with validation results |
| **Peppol Discovery** (`POST /clients/{id}/peppol_discovery`) | `address` details | Valid address for lookup | Peppol network queried; returns whether client is reachable on Peppol; discovery result stored |
| **Show Settings** (`POST /clients/{id}/show_settings`) | Client hash | — | Returns merged settings object: Company → GroupSetting → Client → ClientContact |

### 2.1 Client Settings Hierarchy

> **Source:** `app/Services/Client/MapSettings.php`

```
getMergedSettings() — runtime merge order (last wins):
1. Company.settings     (base defaults)
2. GroupSetting.settings  (group-level overrides, if client assigned to group)
3. Client.settings      (client-specific overrides)
4. ClientContact.settings (per-contact overrides, if applicable)
```

**Key settings mapped at client level:**
- `currency_id` → determines invoice currency
- `payment_terms` → days added to invoice date for due_date
- `payment_terms_currency` → currency-specific terms
- `date_format_id` → client's preferred date format
- `timezone` → timezone for all client dates
- `locale` → language/locale
- `is_tax_exempt` → skip all tax calculation
- `invoice_footer` → default invoice footer
- `invoice_terms` → default payment terms
- `quote_footer` / `quote_terms` → defaults for quotes
- `payment_type_id` → preferred payment method
- `custom_value1_label`–`custom_value4_label` → labels for custom fields
- `enable_rappen_rounding` → Swiss 5-cent rounding
- `auto_archive_invoice` → soft-delete paid invoices
- `auto_archive_invoice_cancelled` → soft-delete cancelled invoices
- `auto_archive_quote` → archive quotes after conversion
- `auto_convert_quote` → auto-convert approved quotes to invoices
- `stop_on_unpaid_recurring` → reset overdue recurring invoice dates
- `france_reporting_enabled` → enable France regulatory tracking
- `verifactu_enabled` → enable Spain AEAT e-invoicing
- `peppol_sending_enabled` → enable Peppol e-invoicing
- `e_invoice_type` → 'PEPPOL' or other
- `client_manual_payment_notification` → send email receipt for manual payments
- `send_email_on_mark_paid` → send payment confirmation email
- `unlock_invoice_documents_after_payment` → make attachment public after payment
- `invoice_design_id`, `quote_design_id` → default document designs
- `include_tax_invoices` → show tax breakdown on invoices

---

## 3. State Transition Matrix

| Current State | Event / Trigger | Condition | New State | Actions Triggered |
|---|---|---|---|---|
| Active | Soft Delete | User has permission; not already deleted | Soft-deleted (`is_deleted = true`) | `ClientRepository::delete()`; client removed from active lists; portal access disabled |
| Soft-deleted | Restore | User has permission | Active | `is_deleted = false`; portal access re-enabled; client reappears in active lists |
| Active | Merge (primary) | Secondary client provided | Active (primary preserved) | Invoices/payments/quotes reassigned; secondary soft-deleted; contacts merged |
| Active | Merge (secondary) | Merged into primary | Soft-deleted | All associations transferred; client soft-deleted |
| Active | Purge | Password protected; already soft-deleted | Permanently Deleted | All entities deleted (invoices, payments, quotes, credits, expenses, tasks) |

---

## 4. Client Financial State Management

### 4.1 Balance Calculation

> **Source:** `app/Services/Client/ClientService.php`, `calculateBalance()` (lines 46-70)

```
calculateBalance():
├─ balance = SUM(invoices.balance) 
│   WHERE client_id = this.client.id
│   AND status_id IN (SENT, PARTIAL)
│   AND is_deleted = false
│   AND is_proforma = false (implicit via status filter)
├─ transaction:
│   └─ client.balance = SUM(balance)
│   └─ client.saveQuietly()
└─ Used for: full balance recalculation on restore, cancellation
```

**Key rule:** Only `SENT` and `PARTIAL` invoices contribute to client balance. `PAID` and `CANCELLED` invoices have `balance = 0` and thus contribute nothing. `DRAFT` invoices are not yet sent so they don't count.

### 4.2 Paid To Date Calculation

> **Source:** `app/Services/Client/ClientService.php`, `calculatePaidToDate()` (lines 72-95)

```
calculatePaidToDate():
├─ paid_to_date = SUM(invoices.paid_to_date)
│   WHERE client_id = this.client.id
│   AND status_id IN (PARTIAL, PAID)
│   AND is_proforma = false
│   AND is_deleted = false
├─ transaction:
│   └─ client.paid_to_date = SUM(paid_to_date)
│   └─ client.saveQuietly()
└─ Used for: full recalculation on restore
```

### 4.3 Payment Balance (Unapplied Payments)

> **Source:** `app/Services/Client/ClientService.php`, `updatePaymentBalance()` (lines 139-157)

```
updatePaymentBalance():
├─ amount = SUM(payments.amount - payments.applied)
│   WHERE client_id = this.client.id
│   AND is_deleted = 0
│   AND status_id IN (COMPLETED, PENDING, PARTIALLY_REFUNDED, REFUNDED)
├─ transaction:
│   └─ client.payment_balance = amount
│   └─ client.saveQuietly()
└─ Represents: payments received but not yet applied to invoices
```

### 4.4 Credit Balance

> **Source:** `app/Services/Client/ClientService.php`, `getCreditBalance()` (lines 195-206), `getCredits()` (lines 208-218)

```
getCreditBalance():
├─ credits = Credit::where('client_id', this.id)
│   WHERE is_deleted = false
│   AND (due_date >= today OR due_date IS NULL)
│   ORDER BY created_at ASC
├─ Sum all credit.balance values
└─ Round to currency precision

getCredits():
├─ Same scope as credit balance
├─ WHERE balance > 0 (only non-fully-applied credits)
└─ Ordered by created_at ASC (oldest first for application)
```

---

## 5. Client Portal Access

### 5.1 Contact Key Authentication

> **Source:** `app/Models/ClientContact.php`

Each client can have multiple contacts. Each contact has:
- `contact_key` — encrypted key for secure portal access (used in URLs)
- `email` — contact email
- `send_email` — flag for whether to send emails to this contact
- `is_primary` — primary contact flag

Portal URLs use the pattern: `/client/{contact_key}/...`

### 5.2 Statement Generation

> **Source:** `app/Services/Client/Statement.php`, `app/Services/Client/ClientService.php` (`statement()`, `buildStatementMailableData()`, `emailStatement()`)

```
statement(options, send_email):
├─ filters = {client_id, payment_state, country_id, start_date, end_date}
├─ pdf = StatementService::run()
│   ├─ Fetches invoices within date range
│   ├─ Fetches payments within date range
│   ├─ Calculates opening balance
│   ├─ Calculates activity (invoices, payments, credits)
│   └─ Calculates closing balance
├─ IF send_email AND only_clients_with_invoices:
│   └─ Skip if no invoices in range
├─ IF send_email:
│   └─ emailStatement(pdf, options)
│       ├─ email_object.to = [primary contact email]
│       ├─ cc = other contacts with send_email = true
│       ├─ attachment = PDF
│       ├─ template = 'email_template_statement'
│       └─ variables: $client, $start_date, $end_date
└─ return pdf
```

---

## 6. Step-by-Step Functional Workflows

### 6.1 Create and Configure Client (Happy Path)

1. **Pre-conditions:**
   - Authenticated user with `create` permission on Client
   - Company context established

2. **Execution Steps:**
   - Step 1: `POST /api/v1/clients` → `ClientController::store()`
   - Step 2: `StoreClientRequest` validates: name required, email format, country exists
   - Step 3: `ClientRepository::save()` processes data
   - Step 4: `applyNumber()` generates client number from sequence
   - Step 5: `MapSettings` merges company-level settings into client settings
   - Step 6: Client saved with `balance = 0`, `paid_to_date = 0`, `credit_balance = 0`
   - Step 7: `ClientWasCreated` event fired
   - Step 8: `number_updated` setting triggers counter increment

3. **Post-conditions:**
   - Client created with auto-number
   - Client settings initialized from company defaults
   - Portal access available (after invitation sent)

### 6.2 Client Merge

1. **Pre-conditions:**
   - Administrator with password confirmation
   - Two clients in the same company

2. **Execution Steps:**
   - Step 1: `POST /api/v1/clients/{primary}/merge/{secondary}` → `ClientController::merge()`
   - Step 2: `Merge` service processes:
     - Reassigns all invoices, payments, quotes, credits from secondary to primary
     - Reassigns contacts (merging duplicates by email)
     - Updates `company_ledger` entries for both clients
     - Updates `payment_balance` on primary
     - Soft-deletes the secondary client
   - Step 3: `ClientWasMerged` event fired
   - Step 4: Admin audit log entry created

3. **Post-conditions:**
   - Primary client owns all financial entities
   - Secondary client soft-deleted
   - All references updated to primary client

### 6.3 Generate and Email Client Statement

1. **Pre-conditions:**
   - Client has invoices/payments in the specified date range
   - Client has valid email on primary contact

2. **Execution Steps:**
   - Step 1: `POST /api/v1/client_statement` with `client_id`, `start_date`, `end_date`, `send_email=true`
   - Step 2: `ClientStatementController::statement()` calls `ClientService::statement()`
   - Step 3: `Statement` service fetches all invoices and payments for the client in the date range
   - Step 4: Calculates opening balance (from prior activity), activity (current period), closing balance
   - Step 5: PDF generated with formatted statement
   - Step 6: If `send_email`: `buildStatementMailableData()` constructs email with PDF attachment
   - Step 7: Email dispatched to primary contact email, CC'd to other contacts with `send_email = true`
   - Step 8: `StatementWasEmailed` event fired

3. **Post-conditions:**
   - Statement PDF generated and optionally emailed
   - Activity logged

---

## 7. Edge Cases & Error Behaviors

| Case ID | Description | Expected Handling |
|---|---|---|
| **CL-001** | Client merge where secondary has payments not applied to primary's invoices | Payments are re-associated to primary client; paymentables remain intact; `payment_balance` recalculated |
| **CL-002** | Client purge when still has active invoices | Purge is blocked; client must have all invoices paid and archived first (password_protected middleware requires confirmation) |
| **CL-003** | VAT validation for non-EU countries | VIES service not called; `tax_data` left unchanged; no validation error |
| **CL-004** | Client with no `payment_terms` setting | `setDueDate()` returns `due_date = null`; invoices have no due date until manually set |
| **CL-005** | Client has `is_tax_exempt = true` | All tax calculations return 0; tax fields zeroed on all documents |
| **CL-006** | Statement for client with no activity in date range | Statement still generated, showing zero activity; `only_clients_with_invoices` flag can skip emailing |
| **CL-007** | Client currency change when invoices exist | Exchange rate recalculated via `CurrencyApi`; `exchange_rate` updated on un-paid invoices |
| **CL-008** | Client merge where both have same email for contacts | Contacts merged; one retained with `is_primary = true`; duplicate removed |
| **CL-009** | Peppol discovery failure (network error) | Returns `['message' => false]`; discovery result not stored; retry possible |
| **CL-010** | Client restore after purge | Not possible — purge is permanent; all data deleted |
| **CL-011** | Client with `france_reporting_enabled` | Payment application date changes tracked via `PaymentApplicationDateChanged` event; `FrancePaymentApplicationRecorder` logs movements |
| **CL-012** | Client portal access when multiple contacts exist | Each contact has unique `contact_key`; invitations are per-contact for each invoice sent |

---

## 8. Client Entity Fields

> **Source:** `app/Models/Client.php`

### 8.1 Core Identity Fields

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `assigned_user_id` | int\|null | Assigned sales rep |
| `number` | string\|null | Client number (auto-generated) |
| `display_name` | string | Full name for display |
| `first_name` | string\|null | First name |
| `last_name` | string\|null | Last name |
| `email` | string\|null | Primary email |
| `phone` | string\|null | Phone |
| `address1` | string\|null | Billing address line 1 |
| `address2` | string\|null | Billing address line 2 |
| `city` | string\|null | City |
| `state` | string\|null | State/Province |
| `zip` | string\|null | Postal/ZIP code |
| `country_id` | int\|null | Country reference |
| `shipping_address1/2` | string\|null | Shipping address |
| `shipping_city` | string\|null | Shipping city |
| `shipping_state` | string\|null | Shipping state |
| `shipping_zip` | string\|null | Shipping ZIP |
| `shipping_country_id` | int\|null | Shipping country |

### 8.2 Financial Fields

| Field | Type | Description |
|---|---|---|
| `balance` | float | Current outstanding (SENT + PARTIAL invoice balances) |
| `paid_to_date` | float | Total paid across all invoices |
| `credit_balance` | float | Available credit (from credit notes) |
| `payment_balance` | float | Unapplied payment amounts |
| `custom_value1/2/3/4` | string\|null | Custom monetary fields |

### 8.3 Configuration Fields

| Field | Type | Description |
|---|---|---|
| `is_tax_exempt` | bool | Skip all tax calculation |
| `is_deleted` | bool | Soft-delete flag |
| `is_active` | bool | Active/inactive client |
| `contact_key` | string | Portal access key (primary) |
| `settings` | object | Full settings object (merged at runtime) |
| `tax_data` | object\|null | VAT validation data |
| `public_notes` | string\|null | Public-facing notes |
| `currency_id` | int | Preferred currency (from settings) |

---

## 9. Sequence Diagram — Client Statement Generation

```mermaid
sequenceDiagram
    participant User
    participant ClientStatementController
    participant ClientService
    participant Statement
    participant ClientContact
    participant EmailService
    participant EventService

    User->>ClientStatementController: POST /clients/client_statement
    Note over User,ClientStatementController: client_id, start_date, end_date, send_email
    
    ClientStatementController->>ClientService: statement(options, send_email)
    ClientService->>Statement: new Statement(client, options)
    Statement->>Statement: run()
    Statement->>Statement: Fetch invoices (date range)
    Statement->>Statement: Fetch payments (date range)
    Statement->>Statement: Calculate opening balance
    Statement->>Statement: Calculate activity
    Statement->>Statement: Calculate closing balance
    
    alt send_email = true AND only_clients_with_invoices
        Statement->>Statement: Check invoice count
        alt No invoices
            Statement-->>ClientService: Skip email (return false)
            ClientStatementController-->>User: 200 OK (no email sent)
            return
        end
    end
    
    alt send_email = true
        ClientService->>ClientContact: Get contacts with send_email = true
        ClientService->>ClientService: buildStatementMailableData(pdf)
        Note over ClientService: to = primary contact email<br/>cc = other contacts with send_email
        ClientService->>EmailService: Email::dispatch(email_object)
        EmailService->>EventService: StatementWasEmailed event
    end
    
    ClientService-->>ClientStatementController: PDF blob
    ClientStatementController-->>User: PDF download / 200 OK
```

---

## Source Files Referenced

| Source | File |
|---|---|
| Client model | `app/Models/Client.php` |
| ClientContact model | `app/Models/ClientContact.php` |
| ClientService | `app/Services/Client/ClientService.php` |
| MapSettings | `app/Services/Client/MapSettings.php` |
| Statement service | `app/Services/Client/Statement.php` |
| ClientController | `app/Http/Controllers/ClientController.php` |
| StoreClientRequest | `app/Http/Requests/Client/StoreClientRequest.php` |
| ClientRepository | `app/Repositories/ClientRepository.php` |
| ClientStatementController | `app/Http/Controllers/ClientStatementController.php` |
| Merge service | `app/Services/Client/Merge.php` |
| API routes | `routes/api.php` |
