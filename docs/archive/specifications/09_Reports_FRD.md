# InvoiceNinja v5.13.50 — Reports Module FRD

> **Sources:** `app/Services/Report/ReportService.php`, `app/Services/Report/InvoiceReport.php`, `app/Services/Report/PaymentReport.php`, `app/Services/Report/ProfitAndLossReport.php`, `app/Services/Report/TaxSummaryReport.php`, `app/Services/Report/CustomerBalanceReport.php`, `app/Services/Report/EmployeeReport.php`, `app/Models/Report/Report.php`, `app/Http/Controllers/ReportController.php`

## 1. System Overview & Boundaries

### Scope (In-scope)
- Financial reporting (P&L, Balance Summary, A/R Aging, A/P Aging)
- Transactional reports (Invoices, Payments, Expenses, Credits, Quotes, Tasks)
- Tax reports (Tax Summary, Tax Period)
- Client/Vendor reports (Customer Balance, Vendor Balance)
- User/Employee reports
- Report scheduling and export (CSV, Excel, PDF)
- Report grouping and filtering

### Scope (Out-of-scope)
- Real-time dashboards (covered separately in UI)
- Audit logs (covered in separate logging module)
- Custom report builder (beyond preset templates)

### Actors
| Actor | Role |
|---|---|
| **Authenticated User** | Runs, filters, exports, schedules reports |
| **Admin** | Schedules reports, configures email delivery |
| **System** | Cron-triggered scheduled report delivery |

### Triggers
| Trigger | Type | Source |
|---|---|---|
| `POST /api/v1/reports/{report}` | User action | API/UI |
| Scheduled report delivery | Cron | `ReportService::sendScheduledReport()` |

---

## 2. Available Reports

### 2.1 Financial Reports

#### 2.1.1 Profit & Loss Report
> **Source:** `app/Services/Report/ProfitAndLossReport.php`

**Data Source:** Invoices, Expenses, Credits, Payments (income/expense items)
**Key Metrics:**
- Total income (paid invoices only)
- Total expenses
- Net profit
- Margin percentage
- Income by category
- Expenses by category

**Filters:**
- Date range (start_date, end_date)
- Payment status (paid, unpaid, all)
- Client (specific or all)
- Project (specific or all)

**Output Columns:**
| Date | Type | Category | Amount | Balance |

#### 2.1.2 Client Balance Report (A/R Aging)
> **Source:** `app/Services/Report/CustomerBalanceReport.php`

**Data Source:** Clients with outstanding balances
**Key Metrics:**
- Current balance per client
- Total outstanding
- Aging buckets: 0-30 days, 31-60 days, 61-90 days, 90+ days

**Filters:**
- Client status (active, inactive)
- Country
- Payment terms
- Client group

**Output Columns:**
| Client | Balance | Paid To Date | Balance Due |

### 2.2 Transactional Reports

#### 2.2.1 Invoice Report
> **Source:** `app/Services/Report/InvoiceReport.php`

**Data Source:** All invoices (status, date, amounts, client)
**Groups By:** Date, Client, User, Project, Status

**Output Columns:**
| Date | Invoice # | Client | User | Status | Amount | Balance |

#### 2.2.2 Payment Report
> **Source:** `app/Services/Report/PaymentReport.php`

**Data Source:** All payments
**Output Columns:**
| Date | Payment # | Client | Invoice # | Amount | Payment Method |

#### 2.2.3 Quote Report
> **Source:** `app/Services/Report/QuoteReport.php`

**Data Source:** All quotes (status: sent, approved, converted, expired)
**Output Columns:**
| Date | Quote # | Client | Status | Amount |

#### 2.2.4 Expense Report
> **Source:** `app/Services/Report/ExpenseReport.php`

**Data Source:** All expenses (date, amount, vendor, category, billable status)
**Output Columns:**
| Date | Expense # | Vendor | Category | Amount | Public |

### 2.3 Tax Reports

#### 2.3.1 Tax Summary Report
> **Source:** `app/Services/Report/TaxSummaryReport.php`

**Data Source:** Invoices with tax data
**Output Columns:**
| Tax Name | Tax Rate | Tax Amount |

### 2.4 User/Employee Reports

#### 2.4.1 Employee Report
> **Source:** `app/Services/Report/EmployeeReport.php`

**Data Source:** Users, assigned clients, commissions
**Filters:** User, Date range
**Output Columns:**
| User | Clients | Sales |

### 2.5 Vendor Reports

#### 2.5.1 Vendor Balance Report (A/P Aging)
> **Source:** `app/Services/Report/VendorBalanceReport.php`

**Data Source:** Vendors with outstanding balances
**Data Source:** Expenses linked to vendors
**Output Columns:**
| Vendor | Balance | Paid To Date |

---

## 3. Report Engine

### 3.1 Report Generation Pipeline
> **Source:** `app/Services/Report/ReportService.php`

```
ReportService.run(report, input):
├─ company = Auth::user()->company
├─ repo = company.reports()
├─ IF input.client_id → filter by client_id
├─ IF input.user_id → filter by user_id
├─ IF input.start_date / end_date → filter by date range
├─ report_class = resolve(report_string)
├─ report_class(input, repo, client, user)
├─ return report->run(input, company, repo, user, client)

Each report subclass:
├─ run(input, company, repo, user, client):
│   ├─ query = base Eloquent query for data source
│   ├─ apply input filters (client_id, user_id, date range)
│   ├─ if report has preset reports → apply preset filters
│   ├─ if input.csv_enable → return CSV export
│   └─ return array of rows [column1, column2, ...]
```

### 3.2 Preset Reports
Some reports support presets that pre-configure filters:
- `InvoicesByStatus` — groups by status
- `PaymentsByMethod` — groups by payment method
- `ExpensesByCategory` — groups by category
- `CustomersBalance` — only shows clients with balance > 0
- `VendorsBalance` — only shows vendors with balance > 0

### 3.3 Report Scheduling & Email Delivery
> **Source:** `app/Models/Report/Report.php`, `ReportService::sendScheduledReport()`

Scheduled reports stored as Report model entities:
| Field | Type | Description |
|---|---|---|
| `company_id` | int | Tenant |
| `user_id` | int | Owner |
| `report_id` | string | Report type identifier |
| `name` | string | Schedule name |
| `settings` | object | Filters, recipients, frequency |
| `is_active` | bool | Enabled |

**Email Delivery:**
- Frequency: daily, weekly, monthly
- Recipients: user IDs or email addresses
- Attachments: CSV, Excel, or PDF based on configuration
- Template: `email_template_report`

### 3.4 Export Formats
| Format | Generation | Notes |
|---|---|---|
| CSV | Direct from report rows | Fast; no formatting |
| Excel (XLSX) | PhpSpreadsheet | Formatted; supports styling |
| PDF | Browser print / dompdf | Styled report table |

## 4. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `POST /api/v1/reports/{report}` | POST | Run report with filters |
| `GET /api/v1/reports/templates` | GET | Available report templates |
| `GET /api/v1/reports/scheduled` | GET | List scheduled reports |
| `POST /api/v1/reports/scheduled` | POST | Create scheduled report |
| `GET /api/v1/reports/scheduled/{id}` | GET | Show scheduled report config |

### 4.1 Report Request Format
```
POST /api/v1/reports/invoices
Content-Type: application/json

{
  "report_data": {
    "start_date": "2024-01-01",
    "end_date": "2024-01-31",
    "client_id": "hashed_client_id",
    "user_id": "hashed_user_id",
    "payment_state": "paid",
    "status": 4,
    "group_id": 1,
    "csv_enable": false
  }
}
```

## Source Files
| File |
|---|
| `app/Services/Report/ReportService.php` |
| `app/Services/Report/ProfitAndLossReport.php` |
| `app/Services/Report/InvoiceReport.php` |
| `app/Services/Report/PaymentReport.php` |
| `app/Services/Report/CustomerBalanceReport.php` |
| `app/Services/Report/VendorBalanceReport.php` |
| `app/Services/Report/EmployeeReport.php` |
| `app/Services/Report/TaxSummaryReport.php` |
| `app/Services/Report/ExpenseReport.php` |
| `app/Services/Report/QuoteReport.php` |
| `app/Models/Report/Report.php` |
| `app/Http/Controllers/ReportController.php` |
| `routes/api.php` |
