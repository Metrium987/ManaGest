# InvoiceNinja v5.13.50 — Purchase Order & Vendor Management FRD

> **Sources:** `app/Models/PurchaseOrder.php`, `app/Models/Vendor.php`, `app/Http/Controllers/PurchaseOrderController.php`, `app/Http/Controllers/VendorController.php`

## 1. System Overview & Boundaries

### Scope (In-scope)
- Purchase order creation, approval, and conversion tracking
- Vendor management: create, merge, balance tracking
- PO-to-expense conversion (marking purchased)
- PO lifecycle: DRAFT → SENT → APPROVED → PURCHASED
- E-invoice generation for POs

### Scope (Out-of-scope)
- PO payment processing (see Payment FRD)
- Vendor portal (vendors receive POs via email, not portal)
- Inventory procurement beyond matching

### Actors
| Actor | Role |
|---|---|
| **Authenticated User** | Creates POs, sends to vendors, approves, marks purchased |
| **Vendor** | Receives PO via email, fulfills goods/services |
| **System** | Handles expiration, e-invoice submission |

## 2. Purchase Order Entity

### Status Constants
> **Source:** `app/Models/PurchaseOrder.php`

| Constant | Value | Description |
|---|---|---|
| `STATUS_DRAFT` | 1 | Not yet sent |
| `STATUS_SENT` | 2 | Sent to vendor |
| `STATUS_APPROVED` | 3 | Vendor accepted / internally approved |
| `STATUS_PURCHASED` | 4 | Goods received / paid |
| `STATUS_DELETED` | 5 | Cancelled/archived |

### Key Fields
| Field | Type | Description |
|---|---|---|
| `client_id` | int | Your company (as buyer) |
| `vendor_id` | int\|null | Supplier |
| `status_id` | int | Lifecycle state |
| `number` | string\|null | PO number |
| `date` | string\|null | PO date |
| `due_date` | string\|null | Expected delivery |
| `amount` | float | Total PO amount |
| `balance` | float | Outstanding |
| `discount` | float | Discount amount |
| `is_amount_discount` | bool | Fixed vs percentage |
| `line_items` | object | Line items (same format as invoices) |
| `tax_name1/2/3` | string\|null | Tax names |
| `tax_rate1/2/3` | float | Tax rates |
| `total_taxes` | float | Tax sum |
| `custom_surcharge1-4` | float\|null | Surcharges |
| `exchange_rate` | float | Currency rate |
| `is_deleted` | bool | Soft-delete |
| `uses_inclusive_taxes` | bool | Tax-inclusive mode |

## 3. Purchase Order State Transition Matrix

| Current State | Event | Condition | New State | Actions |
|---|---|---|---|---|
| DRAFT | Send | Valid vendor; SMTP configured | SENT | Apply number; create invitations; email vendor; ledger entry |
| DRAFT | Delete | User permission | DELETED (soft) | Soft-delete; archive |
| SENT | Approve | Vendor accepted | APPROVED | Create approval record; update ledger |
| SENT | Cancel | Must be cancellable | DELETED | Set balance=0; ledger entry |
| APPROVED | Mark Purchased | Goods received | PURCHASED | Create expense; link to vendor; ledger entries |
| APPROVED | Cancel | Must be cancellable | DELETED | Set balance=0; ledger entry |
| PURCHASED | — | Terminal | — | Cannot be cancelled directly |
| DELETED | Restore | Must be soft-deleted | Previous status | Reverse deletion; restore balances |

## 4. Vendor Entity

### Key Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `number` | string\|null | Vendor number |
| `name` | string | Supplier name |
| `address1/2` | string\|null | Address |
| `city` | string\|null | City |
| `state` | string\|null | State |
| `zip` | string\|null | Postal code |
| `country_id` | int\|null | Country |
| `email` | string\|null | Email |
| `phone` | string\|null | Phone |
| `contact_name` | string\|null | Contact person |
| `contact_email` | string\|null | Contact email |
| `contact_phone` | string\|null | Contact phone |
| `balance` | float | Outstanding PO balance |
| `paid_to_date` | float | Total paid |
| `is_tax_exempt` | bool | Tax exempt flag |
| `is_deleted` | bool | Soft-delete |
| `settings` | object | Vendor-specific settings |
| `custom_value1-4` | string\|null | Custom fields |

## 5. PO Workflows

### 5.1 Create and Send PO
1. `POST /api/v1/purchase_orders` with vendor_id, line_items
2. PO saved in DRAFT
3. `GET /api/v1/purchase_orders/{id}/send_email` → mark sent, email vendor
4. Vendor receives PDF via email

### 5.2 Mark Purchased
1. Vendor confirms delivery
2. `GET /api/v1/purchase_orders/{id}/convert` or `mark_purchased`
3. Creates expense record linked to vendor
4. Status → PURCHASED
5. Client (you) balance unaffected (vendor balance updated)

### 5.3 Vendor Merge
1. `POST /api/v1/vendors/{id}/{mergeable}/merge` (password protected)
2. All POs and expenses re-assigned to primary vendor
3. Secondary vendor soft-deleted

## 6. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `purchase_orders` | GET/POST | List/create |
| `purchase_orders/{id}` | GET/PUT/DELETE | Show/update/delete |
| `purchase_orders/{id}/{action}` | GET | approve, convert, cancel, mark_purchased |
| `purchase_orders/{key}/download` | GET | Download PDF |
| `purchase_orders/{key}/download_e_purchase_order` | GET | Download e-document |
| `purchase_orders/bulk` | POST | Bulk actions |
| `vendors` | GET/POST | List/create vendors |
| `vendors/{id}` | GET/PUT/DELETE | Manage vendor |
| `vendors/{id}/{mergeable}/merge` | POST | Merge vendors |
| `vendors/bulk` | POST | Bulk vendor actions |
| `recurring_expenses` | GET/POST | Recurring expense templates |

## 7. Edge Cases

| Case | Handling |
|---|---|
| PO sent to vendor with no email | Email field empty → send fails; PO remains DRAFT |
| Mark purchased without expense | PO marks PURCHASED but no expense created; balance adjustment only |
| Vendor merge with same contact email | Contacts merged; primary retained |
| PO cancellation when already purchased | Not allowed — `invoiceCancellable()` check fails |
| Expense already created from PO | Conversion blocked; PO marked as converted |

## Source Files
| File |
|---|
| `app/Models/PurchaseOrder.php` |
| `app/Models/Vendor.php` |
| `app/Http/Controllers/PurchaseOrderController.php` |
| `app/Http/Controllers/VendorController.php` |
| `app/Repositories/PurchaseOrderRepository.php` |
| `app/Repositories/VendorRepository.php` |
| `routes/api.php` |
