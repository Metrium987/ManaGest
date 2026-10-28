# InvoiceNinja v5.13.50 — E-Invoicing & Regulatory Compliance FRD

> **Sources:** `app/Services/EInvoice/`, `app/Services/ThirdParty/`, `app/Models/EInvoice.php`, `app/Models/Integration.php`, `app/Http/Controllers/EInvoiceController.php`

## 1. System Overview & Boundaries

### Scope
- Peppol BIS e-invoicing (Australia, EU, NZ, SG)
- Verifactu Spain e-invoicing (AEAT)
- France reporting (DGCCRF / DGFiP)
- A-NZ GST reporting
- E-invoice submission (UBL 2.1, PEPPOL BIS)
- E-invoice status tracking
- Integration management (QuickBooks, Xero, Zapier, etc.)
- Webhook event delivery
- Import/sync connectors

### Out-of-scope
- Native payment gateway processing (covered in Payments FRD)
- Third-party API implementation details (external)

### Compliance Notes by Jurisdiction
| Country | Feature | Service |
|---|---|---|
| Spain | Verifactu | VerifactuService, `verifactu_enabled` flag |
| France | Reporting | FrancePaymentApplicationRecorder, `france_reporting_enabled` |
| Australia/NZ | GST reporting | A-NZ services |
| EU | VAT OSS reporting | Tax rates + Taxer |
| Global | Peppol BIS | PeppolService |

## 2. Peppol E-Invoicing

> **Sources:** `app/Services/EInvoice/PeppolService.php`, `app/Services/EInvoice/EDocumentService.php`, `app/Models/EInvoice.php`

### 2.1 EInvoice Entity
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `client_id` | int | Client being invoiced |
| `invoice_id` | int | Source invoice |
| `vendor_id` | int\|null | For PEPPOL self-billing |
| `document_type` | string | 'peppol', 'verifactu', 'custom' |
| `status_id` | int | 0=DRAFT, 1=PENDING, 2=SENT, 3=ACCEPTED, 4=REJECTED, 5=ERROR |
| `response_url` | string\|null | Webhook response URL |
| `guid` | string\|null | PEPPOL GUID |
| `ubl` | string\|null | Generated UBL XML |
| `message` | string\|null | Submission message |
| `is_e_invoice` | bool | True if e-invoice |

### 2.2 Peppol Submission Workflow
```
EInvoiceService.submit(invoice):
1. IF client.e_invoice_type == 'PEPPOL':
   - IF client not found on Peppol → attempt discovery via PeppolService
   - Generate UBL 2.1 from InvoiceSum data
   - Create EInvoice record (PENDING)
   - Call PeppolService::send(ubl, recipient_endpoint)
   - IF success → EInvoice.status = SENT, guid stored
   - IF webhook configured → send to response_url on delivery status change
2. IF client.e_invoice_type == 'VERIFACTU':
   - Call VerifactuService::submit()
```

### 2.3 Status Enum
| Status | ID | Description |
|---|---|---|
| DRAFT | 0 | Created but not submitted |
| PENDING | 1 | Queued for submission |
| SENT | 2 | Sent to network |
| ACCEPTED | 3 | Accepted by recipient |
| REJECTED | 4 | Rejected with error |
| ERROR | 5 | Submission failure |

### 2.4 Peppol Discovery
> **Source:** `PeppolService::discover()`

1. Query Peppol SMP directory with client's PEPPOL ID or email domain
2. Returns endpoint URL + supported document types
3. Cached for 30 days (`peppol_discovery_cache_ttl`)
4. If not found → client's e-invoice set to manual

## 3. Verifactu (Spain) Compliance

> **Sources:** `app/Services/EInvoice/VerifactuService.php`, `app/Services/EInvoice/Verifactu/VerifactuSchemaGenerator.php`

### 3.1 Activation
1. Company sets `verifactu_enabled = true` in settings
2. Company configures AEAT `numero_de_registro` (registration number)
3. All invoices created after activation are flagged `verifactu_submitted` field pending

### 3.2 Submission
When invoice is sent:
1. `VerifactuService::submit(invoice)` builds `FacturaEvidente` XML schema
2. Includes: NIF, Obligado, NumeroDeRegistro, TipoDeFactura, ClaveDeProductos, etc.
3. Signed with company's X.509 certificate
4. Submitted to AEAT REST API (`https://www2.agenciatributaria.gob.es/...`)

### 3.3 Key Fields in Verifactu Schema
| Field | Source |
|---|---|
| `NIF` | Company tax ID |
| `NumeroFactura` | Invoice number |
| `FechaExpedicionFactura` | Invoice date |
| `TipoEjercicio` | Invoice type |
| `ClaveDeProductos` | Product codes |
| `TipoDeFactura` | `factura` or `abono` |
| `BaseImponible` | Net amount |
| `BaseImpuestos` | Tax base |
| `TipoImpuesto` | VAT type code |
| `CuotaImpuesto` | Tax rate (%) |
| `ImporteImpuesto` | Tax amount |
| `CuotaDevengada` | Tax owed |
| `ImporteTotal` | Total invoice |

## 4. France Regulatory Reporting

> **Sources:** `app/Services/Locale/FrancePaymentApplicationRecorder.php`, `app/Models/Payment.php`

### 4.1 Payment Application Tracking
When a payment is applied to an invoice for a French client:
1. Payment `payment_date` and `invoice_id` are recorded
2. `FrancePaymentApplicationRecorder` creates a `FrancePaymentApplication` record:
   - `invoice_id` → linked invoice
   - `payment_date` → when payment applied
   - `application_date` → when payment was matched to invoice
   - `movement_type` → 'application' or 'refund'
3. This satisfies France's requirement to track payment application dates separately from payment dates

### 4.2 Reporting Output
- Available in `reports › france_payment_applications`
- CSV export includes: invoice number, client, payment date, application date, amount, type
- Required for French DGFIP audits

## 5. E-Invoicing Triggers & Events

| Trigger | Condition | Result |
|---|---|---|
| Invoice marked SENT | `client.e_invoice_type = PEPPOL` | EInvoice generated; PeppolService::send() |
| Invoice marked SENT | `client.e_invoice_type = VERIFACTU` AND `company.verifactu_enabled` | VerifactuService::submit() |
| Invoice sent | `client.is_e_invoice_required = false` | Standard email PDF |
| E-invoice accepted | Webhook/Poll | `EInvoice.status = ACCEPTED` |
| E-invoice rejected | Webhook/Poll | `EInvoice.status = REJECTED`; notification to user |

## 6. Integrations

### 6.1 Integration Model
> **Source:** `app/Models/Integration.php`, `app/Http/Controllers/IntegrationController.php`

| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `key` | string | Integration type (`quickbooks`, `xero`, `wave`, `freeagent`, `snyk`, `zoho`) |
| `is_sync` | bool | Sync enabled |
| `sync_type` | string | `pull` or `push` |
| `settings` | object | API keys, token state, last sync |

### 6.2 Integration Flow
```
runIntegrationSync(integration):
1. GET settings from Integration.settings
2. Initialize ThirdParty service (e.g., QuickBooksService)
3. IF sync_type == 'pull':
   - Fetch entities from external
   - Map to InvoiceNinja entities
   - Create/update in local DB
4. IF sync_type == 'push':
   - Queue local changes
   - Push to external service
5. Update last_sync_at, last_sync_status
6. Log any conflicts for user resolution
```

### 6.3 Available Third-Party Connectors
> **Source:** `app/Services/ThirdParty/`

| Connector | Type | Sync Direction | Notes |
|---|---|---|---|
| QuickBooksService | Accounting | Bidirectional | OAuth 2.0 |
| XeroService | Accounting | Bidirectional | OAuth 2.0 |
| WaveService | Accounting | Pull | OAuth 2.0 |
| ZohoBooksService | Accounting | Bidirectional | OAuth 2.0 |
| FreeAgentService | Accounting | Pull | OAuth 1.0a |
| ZapierService | Automation | Push | Webhook-based |
| StripeImportService | Payments | Pull | API key |
| PayPalImportService | Payments | Pull | OAuth 2.0 |
| DwollaImportService | Payments | Pull | OAuth 2.0 |
| SquareImportService | Payments | Pull | OAuth 2.0 |

### 6.4 Webhook Event Delivery
> **Source:** `app/Services/Webhook/WebhookService.php`, `app/Models/Webhook.php`

When configured events fire:
1. Webhook payload generated from event model:
```
{
  "event": "invoice.paid",
  "data": { serialized entity },
  "timestamp": "2024-...",
  "signature": "HMAC-SHA256 signature"
}
```
2. POST to configured URL with retry logic (exponential backoff)
3. If 3 consecutive failures → webhook marked inactive
4. Responses stored for audit: status code, response body, timestamp

### 6.5 Supported Webhook Events
| Event Key | Trigger |
|---|---|
| `invoice.created` | New invoice created |
| `invoice.updated` | Invoice updated |
| `invoice.deleted` | Invoice deleted |
| `invoice.paid` | Invoice marked as fully paid |
| `payment.created` | New payment |
| `payment.refunded` | Payment refunded |
| `client.created` | New client |
| `client.updated` | Client updated |
| `quote.created` | New quote |
| `quote.approved` | Quote approved |
| `quote.expired` | Quote expired |
| `recurring_invoice.created` | Recurring invoice template created |
| `recurring_invoice.paid` | Recurring invoice fully paid |
| `expense.created` | New expense |
| `task.started` | Task timer started |
| `task.completed` | Task marked complete |

## 7. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `POST /api/v1/e_invoices` | POST | Generate/submit e-invoice |
| `GET /api/v1/e_invoices` | GET | List e-invoices |
| `GET /api/v1/e_invoices/{id}` | GET | Show e-invoice details |
| `POST /api/v1/e_invoices/{id}/resend` | POST | Resend rejected e-invoice |
| `POST /api/v1/integrations` | POST | Create integration |
| `PUT /api/v1/integrations/{id}/sync` | PUT | Trigger sync |
| `POST /api/v1/webhooks` | POST | Register webhook |
| `GET /api/v1/integrations/types` | GET | Available integration types |

## Source Files
| File |
|---|
| `app/Services/EInvoice/PeppolService.php` |
| `app/Services/EInvoice/VerifactuService.php` |
| `app/Services/EInvoice/Verifactu/VerifactuSchemaGenerator.php` |
| `app/Services/Locale/FrancePaymentApplicationRecorder.php` |
| `app/Models/EInvoice.php` |
| `app/Models/Integration.php` |
| `app/Models/Webhook.php` |
| `app/Http/Controllers/EInvoiceController.php` |
| `app/Services/ThirdParty/QuickBooksService.php` |
| `app/Services/ThirdParty/XeroService.php` |
| `app/Services/Webhook/WebhookService.php` |
| `routes/api.php` |
