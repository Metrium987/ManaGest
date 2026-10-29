# InvoiceNinja v5.13.50 — Expense & Tax Management FRD

> **Sources:** `app/Models/Expense.php`, `app/Models/TaxRate.php`, `app/Http/Controllers/ExpenseController.php`, `app/Http/Controllers/TaxRateController.php`, `app/Http/Controllers/ExpenseCategoryController.php`

## 1. Expense Module

### 1.1 Scope
- Creation of business expenses (billable and non-billable)
- Categorization via expense categories
- Linking to clients (billable), vendors, projects, invoices
- Recurring expense templates
- Bank transaction matching
- E-document generation

### 1.2 Actors
| Actor | Role |
|---|---|
| **Authenticated User** | Creates/edits expenses; assigns categories; links to bills |
| **Vendor** | Supplier on expense invoice |
| **Client** | If billable, expense appears on client invoice |
| **System** | Bank transaction matching; recurring expense generation |

### 1.3 Expense Entity Fields
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Creating user |
| `client_id` | int\|null | Billable client |
| `vendor_id` | int\|null | Supplier |
| `payment_type_id` | int\|null | Payment method |
| `project_id` | int\|null | Project assignment |
| `invoice_id` | int\|null | Linked invoice |
| `transaction_id` | int\|null | Bank transaction |
| `amount` | float | Expense amount |
| `tax_amount` | float | Tax portion |
| `date` | string\|null | Expense date |
| `payment_date` | string\|null | Payment date |
| `due_date` | string\|null | Bill due date |
| `is_bill` | bool | True = accounts payable |
| `is_recurring` | bool | Part of recurring expense |
| `recurring_id` | int\|null | Link to template |
| `custom_value1-4` | string\|null | Custom fields |
| `public_notes` | string\|null | Public notes |
| `private_notes` | string\|null | Internal notes |
| `is_deleted` | bool | Soft-delete |

### 1.4 Expense State Transitions
| From | To | Trigger |
|---|---|---|
| Active | DELETED (soft) | `DELETE /api/v1/expenses/{id}` |
| DELETED | Active | `PUT /api/v1/expenses/{id}` (undelete) |
| Active | Attached to Invoice | `POST /api/v1/invoices` with expense line items |
| Bill → Paid | Paid | Payment applied to vendor bill |

### 1.5 Expense Workflows

#### 1.5.1 Create Expense
1. `POST /api/v1/expenses` with client_id, vendor_id, amount, category, date
2. `StoreExpenseRequest` validates
3. `ExpenseRepository::save()` persists
4. If linked to invoice → invoice recalculated
5. If `is_bill = true` → appears in vendor balance

#### 1.5.2 Recurring Expense Generation
1. Cron evaluates RecurringExpense templates where `next_send_date ≤ now`
2. Expense cloned from template with current date
3. `remaining_cycles` decremented
4. `next_send_date` advanced by frequency

### 1.6 API Endpoints
| Endpoint | Verb | Description |
|---|---|---|
| `expenses` | GET/POST | List/create expenses |
| `expenses/{id}` | GET/PUT/DELETE | Manage expense |
| `expenses/{id}/upload` | PUT | Upload receipt |
| `expenses/bulk` | POST | Bulk actions |
| `expenses/edocument` | PUT | Generate e-document |
| `expense_categories` | GET/POST | Manage categories |
| `recurring_expenses` | GET/POST | Manage templates |

## 2. Tax Module

### 2.1 Scope
- Tax rate definition and management
- Tax-inclusive vs tax-exclusive calculation modes
- Tax exemption handling per client
- Multi-tax support (up to 3 tax rates per document)
- Tax reporting (summary and period reports)

### 2.2 TaxRate Entity
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `country_id` | int\|null | Linked country |
| `tax_name` | string | Tax label (e.g., "VAT", "GST") |
| `tax_rate` | float | Rate percentage |
| `type_id` | int\|null | Tax type classification |
| `is_deleted` | bool | Soft-delete |
| `custom_value1-4` | string\|null | Custom fields |

### 2.3 Tax Calculation Logic
> **Source:** `app/Helpers/Invoice/Taxer.php` (1,571 chars), `app/Helpers/Invoice/InvoiceSum.php` (lines 129-186, 419-437)

```
taxer(net_amount, tax_rate):
├─ IF client.is_tax_exempt → return 0
└─ return round(net_amount × (tax_rate / 100), precision)
```

**Invoice-level taxes:** Applied to post-discount total (net of line items + discount). Up to 3 tax rates supported (`tax_name1/2/3`, `tax_rate1/2/3`).

**Line-level taxes:** Each line item can carry its own tax_name/rate. For amount-based discounts, taxes are recomputed per-line via `InvoiceItemSum::calcTaxesWithAmountDiscount()`.

**Surcharge taxes:** `custom_surcharge1-4` fields can have associated tax flags (`custom_surcharge_tax1-4`). When `e_invoice_type = PEPPOL`, surcharges always receive tax calculation.

### 2.4 Tax Exemption
> **Source:** `app/Helpers/Invoice/InvoiceSum.php`, lines 131-140

If `client.is_tax_exempt = true`:
- All invoice tax fields zeroed (`tax_name1/2/3 = ''`, `tax_rate1/2/3 = 0`)
- `total_taxes = 0`
- `total_tax_map = []` (empty)

### 2.5 Tax Reports
| Report | Data Source | Purpose |
|---|---|---|
| Tax Summary | Invoices (tax_name1/2/3, tax_rate1/2/3, total_taxes) | Aggregate tax collected by rate |
| Tax Period | Invoices (date range, tax breakdown) | Periodic tax filing support |

### 2.6 API Endpoints
| Endpoint | Verb | Description |
|---|---|---|
| `tax_rates` | GET/POST | Manage tax rates |
| `tax_rates/bulk` | POST | Bulk operations |
| `reports/tax_summary_report` | POST | Tax summary |
| `reports/tax_period_report` | POST | Period tax report |

## Source Files
| File |
|---|
| `app/Models/Expense.php` |
| `app/Models/TaxRate.php` |
| `app/Models/RecurringExpense.php` |
| `app/Http/Controllers/ExpenseController.php` |
| `app/Http/Controllers/TaxRateController.php` |
| `app/Http/Controllers/ExpenseCategoryController.php` |
| `app/Http/Controllers/RecurringExpenseController.php` |
| `app/Helpers/Invoice/InvoiceSum.php` |
| `app/Helpers/Invoice/Taxer.php` |
| `routes/api.php` |
