# InvoiceNinja v5.13.50 — Banking, Operations & Integrations FRD

> **Sources:** `app/Models/BankTransaction.php`, `app/Models/BankTransactionRule.php`, `app/Models/BankIntegration.php`, `app/Services/Bank/BankTransactionService.php`, `app/Services/Bank/ImportBankTransaction.php`, `app/Models/Tag.php`, `app/Models/Document.php`, `app/Models/Activity.php`, `app/Models/Token.php`, `app/Http/Controllers/BankTransactionController.php`, `app/Http/Controllers/BankIntegrationController.php`, `app/Http/Controllers/TagController.php`, `app/Http/Controllers/DocumentController.php`, `app/Http/Controllers/WebhookController.php`, `app/Http/Controllers/TokenController.php`

## 1. System Overview

### Scope
- Bank transaction import and categorization
- Bank integration configuration (Nordigen, Yodlee)
- Transaction matching to payments/invoices
- Bank transaction rules for auto-categorization
- Tagging system for entity organization
- Document storage and management (attachments)
- Activity/audit logging
- API token management
- Webhook registration and delivery
- Data import/export

---

## 2. Bank Transactions

> **Source:** `app/Models/BankTransaction.php`, `app/Http/Controllers/BankTransactionController.php`

### 2.1 Entity Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `bank_integration_id` | int\|null | Source integration |
| `amount` | float | Transaction amount |
| `date` | string | Transaction date |
| `description` | string\|null | Merchant/description |
| `category_id` | int\|null | Expense/Payment category |
| `bank_account_id` | int\|null | Account identifier |
| `is_deleted` | bool | Soft-delete |
| `bank_transaction_rules_id` | int\|null | Auto-rule applied |

### 2.2 Transaction Matching
```
matchTransaction(transaction_data):
1. Parse transaction fields (date, amount, description)
2. Check BankTransactionRules for matching patterns (regex on description, amount comparison)
3. IF rule applies → set category_id, client_id, vendor_id
4. ELSE → mark as unmatched
5. User can manually match via POST /api/v1/bank_transactions/match
6. When matched to a Payment or Expense → bank_transaction_id set on target
```

### 2.3 Bank Transaction Rules
> **Source:** `app/Models/BankTransactionRule.php`

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creator |
| `name` | string | Rule name |
| `rules` | object | Conditions: field, operator, value |
| `apply_to` | string | 'payment', 'expense', 'both' |
| `action` | string | 'categorize', 'match', 'link' |
| `category_id` | int\|null | Target category |
| `client_id` | int\|null | Target client |
| `vendor_id` | int\|null | Target vendor |
| `payment_type_id` | int\|null | Target payment type |
| `is_deleted` | bool | Soft-delete |

**Rule conditions** (AND/OR):
- `description` contains/equals a regex pattern
- `amount` equals/greater_than/less_than
- `date` within range

---

## 3. Bank Integrations

> **Source:** `app/Models/BankIntegration.php`, `app/Http/Controllers/BankIntegrationController.php`

### 3.1 Integration Types
| Provider | Gateway Type | Notes |
|---|---|---|
| Nordigen | Open Banking EU | OAuth 2.0, PSD2-compliant |
| Plaid | US/Canada | Direct API connection |
| Salt Edge | Global | Multi-region PSD2 |
| Yodlee | Global | Enterprise banking API |
| MX | US/Canada | Financial data aggregator |
| TrueLayer | EU | Open Banking API |
| GoCardless | EU | PSD2 bank initiation |

### 3.2 Integration Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `type_id` | int | Integration provider |
| `name` | string | Account name |
| `access_token` | string | Encrypted token |
| `refresh_token` | string | For OAuth rotation |
| `bank_account_id` | string | Provider institution ID |
| `is_active` | bool | Enabled |
| `last_sync` | datetime\|null | Last successful sync |
| `last_error` | string\|null | Last error message |

### 3.3 Sync Flow
```
BankIntegration::refresh(refresh_accounts):
FOR each active integration:
1. IF OAuth: refresh access_token if expired
2. Call provider API: list accounts
3. FOR each account: call transactions endpoint
4. Parse transactions → BankTransaction records
5. Apply BankTransactionRules
6. Update last_sync timestamp
7. Store any errors in last_error
```

---

## 4. Tags

> **Source:** `app/Models/Tag.php`, `app/Http/Controllers/TagController.php`

### 4.1 Entity Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `name` | string | Tag label |
| `color` | string | Hex color code |
| `icon` | string\|null | Icon name (FontAwesome) |
| `is_deleted` | bool | Soft-delete |
| `custom_value1/2/3/4` | string\|null | Custom fields |

### 4.2 Tag Assignment
Tags are polymorphic (many-to-many):
- Can be assigned to: Invoices, Clients, Quotes, Projects, Tasks, Expenses
- Via `taggables` pivot table: `tag_id`, `taggable_id`, `taggable_type`
- No limit on tags per entity

---

## 5. Documents

> **Source:** `app/Models/Document.php`, `app/Http/Controllers/DocumentController.php`

### 5.1 Entity Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Uploader |
| `documentable_id` | int | Related entity ID |
| `documentable_type` | string | Related entity class |
| `name` | string | Display name |
| `disk` | string | Storage disk (local/S3) |
| `path` | string | File path |
| `type` | string\|null | File type (e.g., 'invoice_pdf') |
| `size` | int | File size in bytes |
| `is_public` | bool | Publicly accessible |

### 5.2 Storage
- Files stored encrypted on disk (AES-256 via `Illuminate\Filesystem`)
- Public documents get a time-limited signed URL (`expires_in` setting, default 60 min)
- Private documents served via authenticated download endpoint
- Upload endpoint supports chunked/multi-part uploads for large files
- Max upload size: configurable via `MAX_UPLOAD_SIZE` (default: 25MB)

### 5.3 Document Download
- `GET /documents/{document}/download` — authenticated download
- Generates time-limited URL with `expires_in` from settings
- Downloads tracked in activity log

---

## 6. Activity Log

> **Source:** `app/Models/Activity.php`, `app/Services/Activity/ActivityService.php`

### 6.1 Activity Types
| Type | Description |
|---|---|
| 1 | User created |
| 2 | User updated |
| 3 | Payment received |
| 4 | Invoice sent |
| 5 | Client created |
| 6 | Quote sent |
| 7 | Quote approved |
| 8 | Invoice paid |
| 9 | Payment refunded |
| 10 | Client statement |
| ... | 40+ activity types |

### 6.2 Activity Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int\|null | Acting user |
| `client_id` | int\|null | Related client |
| `activity_type_id` | int | Type of activity |
| `note` | string\|null | Description |
| `data` | object\|null | Additional JSON data |
| `ip` | string\|null | IP address |
| `user_agent` | string\|null | User agent |

---

## 7. Webhooks

> **Source:** `app/Models/Webhook.php`, `app/Services/Webhook/WebhookService.php`

### 7.1 Entity Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Owner |
| `url` | string | Endpoint URL |
| `status` | string | 'active', 'disabled' |
| `events` | array | Subscribed event keys |
| `secret` | string | HMAC signing secret |
| `is_enabled` | bool | Active |
| `last_notification` | datetime\|null | Last delivery |
| `failure_count` | int | Consecutive failures |

### 7.2 Event Payload
```json
{
  "event": "invoice.paid",
  "data": { ...serialized entity... },
  "company": { "id": 1, "name": "..." },
  "timestamp": "2024-...",
  "signature": "sha256_hmac_of_payload"
}
```

### 7.3 Delivery & Retry
- Initial delivery attempt: immediate
- Retry schedule: 5min → 15min → 1hr → 24hr (exponential backoff)
- On 3 consecutive failures → webhook disabled
- `X-NINJA-Signature` header = HMAC-SHA256(payload, secret)
- Responses logged; status code 200-299 = success

---

## 8. API Tokens

> **Source:** `app/Models/Token.php`, `app/Http/Controllers/TokenController.php`

### 8.1 Entity Fields
| Field | Type | Description |
|---|---|---|
| `user_id` | int | Associated user |
| `company_id` | int | Tenant |
| `name` | string | Token label |
| `token` | string | Hashed token value |
| `abilities` | array | Scopes: `['create', 'read', 'update', 'delete']` |
| `last_used_at` | datetime\|null | Last usage |
| `expires_at` | datetime\|null | Expiration (null = never) |
| `is_deleted` | bool | Revoked |

### 8.2 Token Lifecycle
1. Token created: `POST /tokens` with name, abilities, expiry
2. Returns plaintext token once at creation (`$token->plainTextToken`)
3. Client stores token securely (never shown again)
4. Used via `Authorization: Bearer <token>` header
5. `last_used_at` updated on each request
6. Revoked via `DELETE /tokens/{id}`

---

## 9. Import/Export

> **Source:** `app/Imports/`, `app/Exports/`, `app/Http/Controllers/ImportController.php`

### 9.1 Supported Import Types
| Entity | Format | Notes |
|---|---|---|
| Clients | CSV, Excel, JSON | Email dedup; number auto-generation |
| Invoices | CSV, Excel, JSON | Line items supported as JSON or CSV |
| Payments | CSV, Excel, JSON | Paymentable linking to invoices |
| Quotes | CSV, Excel, JSON | Status: DRAFT, SENT |
| Credits | CSV, Excel, JSON | |
| Products | CSV, Excel, JSON | Stock quantity, cost, pricing |
| Expenses | CSV, Excel, JSON | |
| Vendors | CSV, Excel, JSON | |
| Users | CSV, Excel, JSON | |
| Bank Transactions | CSV | Custom format mapping |

### 9.2 Import Pipeline
```
ImportController::import(input):
1. Validate: file uploaded, valid type, within size limits
2. Parse: Maatwebsite Excel or CSV reader
3. Map: columns → entity fields (via import_map or auto-detect)
4. Validate each row: required fields, format, existence of related entities
5. Process: batch insert in chunks of 1000
6. Log: import_log table for errors, warnings, row numbers
7. Notify: completion email to importing user with summary
```

### 9.3 Pre-import Validation
- `POST /import/preimport` — validates file structure, returns column mapping suggestions
- Checks for required fields per entity type
- Reports duplicate detection (email for clients, number for invoices)
- Returns estimated row count

### 9.4 Export
- Reports engine handles export generation (see Reports FRD)
- `GET /reports/{report}?format=csv|excel|pdf`
- `exports/preview/{hash}` — async export with polling

---

## 10. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `bank_transactions` | GET/POST | List/create |
| `bank_transactions/match` | POST | Match transaction |
| `bank_transactions/bulk` | POST | Bulk actions |
| `bank_integrations` | GET/POST | Manage integrations |
| `bank_integrations/refresh_accounts` | POST | Refresh account list |
| `bank_transaction_rules` | GET/POST | Manage rules |
| `tags` | GET/POST | Manage tags |
| `documents` | GET/POST | Manage uploads |
| `documents/{document}/download` | GET | Download file |
| `documents/bulk` | POST | Bulk document actions |
| `webhooks` | GET/POST | Manage webhooks |
| `webhooks/{id}/retry` | POST | Retry failed delivery |
| `tokens` | GET/POST | Manage API tokens |
| `import` | POST | Start import |
| `preimport` | POST | Validate before import |
| `import_json` | POST | JSON-structured import |
| `system_logs` | GET | System event log |
| `scheduler` | GET | Scheduled tasks dashboard |
| `search` | POST | Global entity search |

---

## Source Files
| File |
|---|
| `app/Models/BankTransaction.php` |
| `app/Models/BankTransactionRule.php` |
| `app/Models/BankIntegration.php` |
| `app/Services/Bank/BankTransactionService.php` |
| `app/Http/Controllers/BankTransactionController.php` |
| `app/Http/Controllers/BankIntegrationController.php` |
| `app/Http/Controllers/BankTransactionRuleController.php` |
| `app/Models/Tag.php` |
| `app/Http/Controllers/TagController.php` |
| `app/Models/Document.php` |
| `app/Http/Controllers/DocumentController.php` |
| `app/Models/Activity.php` |
| `app/Http/Controllers/ActivityController.php` |
| `app/Models/Webhook.php` |
| `app/Http/Controllers/WebhookController.php` |
| `app/Models/Token.php` |
| `app/Http/Controllers/TokenController.php` |
| `app/Http/Controllers/ImportController.php` |
| `routes/api.php` |
