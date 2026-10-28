# InvoiceNinja v5.13.50 — Settings & Company Configuration FRD

> **Sources:** `app/Models/Company.php`, `app/Models/GroupSetting.php`, `app/Http/Controllers/CompanyController.php`, `app/Http/Controllers/GroupSettingController.php`, `app/Services/Company/CompanyService.php`, `config/forge.php` (app config)

> Note: `Workflow.php` was not found at the path noted in the summary; the workflow logic lives in `app/Services/Invoice/InvoiceService.php` method `workFlow()` (lines 657-684).

## 1. System Overview & Boundaries

### Scope
- Company-level settings: defaults, branding, tax, payment
- Group settings: user grouping with shared settings
- Customization: invoice/quote designs, number sequences, custom fields
- Localization: timezones, currencies, language, date formats
- Email configuration: SMTP, templates, sender identity
- Payment gateway configuration
- Notification settings: email/SMS triggers
- Security settings: password policies, 2FA enforcement, session timeout

### Out-of-scope
- User-level permissions (covered in Authentication FRD)
- Module-specific entity CRUD (covered in respective module FRDs)

### Actors
| Actor | Role |
|---|---|
| **Account Owner** | Company creation, billing, plan selection |
| **Administrator** | Settings configuration within company |
| **Standard User** | Affected by settings; no configuration access |

## 2. Settings Hierarchy

```
Settings resolution at runtime (last value wins):
1. System defaults (config/app.php, config/forge.php)
2. Company settings
3. GroupSetting settings
4. Client settings (runtime)
5. Individual entity overrides
```

> **Source:** `app/Services/Client/MapSettings.php` merges company → group → client → contact

---

## 3. Company Settings Reference

> **Source:** `app/Models/Company.php`

### 3.1 Company Entity Fields
| Field | Type | Description |
|---|---|---|
| `account_id` | int | Parent account |
| `name` | string | Company name |
| `name_vector` | string\|null | Alternative name |
| `ident` | string\|null | Identifier |
| `email` | string\|null | Company contact email |
| `phone` | string\|null | Phone |
| `address1/2` | string\|null | Address |
| `city` | string\|null | City |
| `state` | string\|null | State |
| `zip` | string\|null | ZIP |
| `country_id` | int\|null | Country |
| `enabled` | bool | Active status |
| `is_disabled` | bool | Soft-disabled |
| `is_approved` | bool | Email verified |
| `settings` | object | Full settings object |

### 3.2 Settings Object Structure
The `settings` field is a serialized JSON object with nested keys grouped by category.

### 3.3 Key Settings Categories

#### 3.3.1 Number Settings
| Key | Default | Description |
|---|---|---|
| `counter_number_applied` | `'when_saved'` | When to apply invoice numbers (on save or send) |
| `invoice_number_pattern` | `null` | Custom invoice number format |
| `quote_number_pattern` | `null` | Custom quote number format |
| `client_number_pattern` | `null` | Client numbering pattern |
| `vendor_number_pattern` | `null` | Vendor numbering pattern |
| `purchase_order_number_pattern` | `null` | PO numbering pattern |
| `payment_number_pattern` | `null` | Payment numbering pattern |
| `client_number_counter` | 0 | Client number sequence counter |
| `invoice_number_counter` | 0 | Invoice number sequence counter |

#### 3.3.2 Tax Settings
| Key | Default | Description |
|---|---|---|
| `tax_niin_number` | `null` | Tax ID / VAT number |
| `tax_state_nr` | `null` | State tax number |
| `tax_currency` | `null` | Currency for tax reporting |
| `tax_rate` | `null` | Default tax rate |
| `tax_name` | `null` | Default tax name |
| `inclusive_tax` | `false` | Tax-inclusive pricing |
| `show_tax_calculation` | `true` | Show tax breakdown on documents |
| `tax_collection_grouping` | `'day'` | How taxes are grouped in reports |

#### 3.3.3 Currency Settings
| Key | Default | Description |
|---|---|---|
| `currency_id` | 1 (USD) | Base currency |
| `currency_converter_api` | `'config'` | Exchange rate source |
| `exchange_percent` | 0.0 | Adjustment percentage |
| `sync_product_currency` | `true` | Sync product prices on currency change |

#### 3.3.4 Payment Settings
| Key | Default | Description |
|---|---|---|
| `payment_terms` | 30 | Default payment terms (days) |
| `payment_terms_currency` | 0 | Currency-specific terms |
| `payment_type_id` | 1 | Default payment type |
| `auto_advance_credit` | `true` | Auto-apply credits to new invoices |
| `auto_convert_quote` | `false` | Auto-convert approved quotes |
| `auto_archive_invoice` | `true` | Auto-archive paid invoices |
| `auto_archive_invoice_cancelled` | `true` | Auto-archive cancelled invoices |
| `auto_archive_quote` | `false` | Auto-archive unused quotes |
| `auto_bill_enabled` | `false` | Enable auto-billing |
| `auto_bill` | `'off'` | `'on'`, `'off'`, `'yes'` |

#### 3.3.5 Email Settings
| Key | Default | Description |
|---|---|---|
| `email_sending_enabled` | `true` | Enable email sending |
| `email_setting` | `null` | Email provider config |
| `email_address` | `null` | From address |
| `email_protocol` | `'smtp'` | SMTP/TLS/PHP mail |
| `email_smtp_server` | `null` | SMTP host |
| `email_smtp_port` | `null` | SMTP port |
| `email_smtp_user` | `null` | SMTP username |
| `email_smtp_password` | `null` | SMTP password (encrypted) |
| `email_smtp_encryption` | `'tls'` | Encryption method |

#### 3.3.6 PDF & Design Settings
| Key | Default | Description |
|---|---|---|
| `pdf_engine` | `'snappy'` | PDF rendering engine |
| `pdf_size` | `'A4'` | Page size |
| `pdf_background` | `null` | Background PDF for documents |
| `all_effects` | `false` | Enable advanced PDF effects |
| `use_commissify` | `false` | Use Commissify (third-party PDF) |
| `invoice_design_id` | 1 | Default invoice design |
| `quote_design_id` | 1 | Default quote design |

### 3.4 Invoice-Specific Settings
| Key | Default | Description |
|---|---|---|
| `invoice_labels` | `null` | Custom field labels |
| `invoice_custom_fields` | `null` | Custom fields config |
| `custom_value1/2/3/4` | `null` | Default custom field values |
| `custom_surcharge1-4` | `null` | Surcharge amounts |
| `include_tax_invoices` | `false` | Include tax on invoices |
| `mark_sent_invoices` | `true` | Mark as sent automatically |
| `mark_paid_invoices` | `true` | Mark paid automatically |
| `partial_due_date_days` | 30 | Partial payment due days |
| `payment_options` | `'on_invoice'` | Show payment options |

### 3.5 Recurring Settings
| Key | Default | Description |
|---|---|---|
| `stop_on_unpaid_recurring` | `false` | Pause unpaid recurring invoicing |
| `reminders` | `null` | Reminder schedule (days) |
| `send_new_invoice` | `true` | Email on new invoice |
| `send_reminders` | `true` | Email reminders |
| `send_bulk_email_receipt` | `false` | Bulk email receipts |

### 3.6 Client/Portal Settings
| Key | Default | Description |
|---|---|---|
| `client_portal_enabled` | `true` | Enable client portal |
| `client_portal_titles` | `null` | Custom portal titles |
| `enable_client_login` | `true` | Client login via email |
| `client_pass` | `null` | Shared client password |
| `show_email` | `false` | Show email addresses in portal |
| `enable_client_registration` | `false` | Allow client self-registration |
| `require_invoice_email` | `false` | Require email on invoice creation |

### 3.7 Security Settings
| Key | Default | Description |
|---|---|---|
| `password_required` | `null` | Password complexity rules |
| `require_2fa` | `false` | Enforce two-factor auth |
| `force_sorting` | `false` | Enforce data sorting |
| `google_analytics_secret` | `null` | GA tracking secret |
| `google_analytics_tag` | `null` | GA tracking tag |

### 3.8 Time & Locale Settings
| Key | Default | Description |
|---|---|---|
| `timezone` | `'UTC'` | System timezone |
| `date_format` | `'Y-m-d'` | Default date format |
| `first_day_of_week` | 0 (Sunday) | Calendar first day |
| `week_numbers` | `false` | Show week numbers |
| `financial_start_months` | 1 (January) | Fiscal year start month |
| `financial_start_days` | 1 | Fiscal year start day |
| `financial_start_timezone` | `'UTC'` | Fiscal timezone |

---

## 4. Group Settings

> **Source:** `app/Models/GroupSetting.php`

Groups allow applying shared settings to subsets of clients/users.

### 4.1 Key Fields
| Field | Type | Description |
|---|---|---|
| `name` | string | Group name |
| `settings` | object | Overrides applied to group members |
| `company_id` | int | Tenant |
| `user_id` | int | Owner |
| `is_deleted` | bool | Soft-delete |

### 4.2 Group Settings Overrides
Groups can override:
- `currency_id`
- `payment_terms`
- `date_format`
- `timezone`
- `tax_name1-3` / `tax_rate1-2/3`
- `invoice_design_id`
- `discount` / `is_amount_discount`
- `enable_custom_invoice_labels` / `invoice_labels`
- Custom value fields and labels

### 4.3 Group Assignment
- Clients assigned via `group_id` field
- Users assigned via `group_setting_id` pivot on `User` model
- Settings merged at runtime: Company → Group → Client → Contact

---

## 5. Configuration Workflows

### 5.1 Company Setup (New Company)
1. **Trigger:** Account Owner creates company from dashboard
2. **Steps:**
   - `POST /api/v1/companies` with name, base currency, timezone, country
   - `CompanyService::save()` sets defaults:
     - `invoice_number_counter = 1`
     - `client_number_counter = 1`
     - Default tax rates from country
     - Payment terms = 30
     - Currency = selected base
     - Date format = locale-appropriate
   - Company created in `enabled = true` state
   - Admin user assigned to company with `ROLE_ADMIN`
3. **Result:** Company is ready for use with defaults; user redirected to settings wizard

### 5.2 Payment Gateway Configuration
1. `GET /api/v1/settings/gateways` → list supported gateways
2. `POST /api/v1/settings/payment_gateways` with `gateway_key`, credentials
3. Gateway stored as `PaymentBankTransfer` or `ClientPayment` depending on setup
4. Token validation: service makes test call to verify credentials
5. If valid → gateway enabled; `payment_type_id` updated

### 5.3 Email Configuration Validation
1. User enters SMTP settings in UI
2. `POST /api/v1/settings/email` stores config
3. `POST /api/v1/settings/test_email` sends test email
4. System attempts SMTP connection:
   - If success → settings saved permanently
   - If failure → error returned; settings not persisted

---

## 6. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `GET /api/v1/companies` | GET | List companies for account |
| `POST /api/v1/companies` | POST | Create company |
| `GET /api/v1/companies/{id}` | GET | Show company settings |
| `PUT /api/v1/companies/{id}` | PUT | Update company settings |
| `POST /api/v1/group_settings` | POST | Create group setting |
| `PUT /api/v1/group_settings/{id}` | PUT | Update group |
| `GET /api/v1/settings/gateways` | GET | Available payment gateways |
| `POST /api/v1/settings/payment_gateways` | POST | Configure gateway |
| `POST /api/v1/settings/test_email` | POST | Send test email |
| `GET /api/v1/settings/currencies` | GET | Currency list |
| `GET /api/v1/settings/date_formats` | GET | Date format options |
| `POST /api/v1/import` | POST | Data import endpoint |

---

## Source Files
| File |
|---|
| `app/Models/Company.php` |
| `app/Models/GroupSetting.php` |
| `app/Services/Company/CompanyService.php` |
| `app/Services/Client/MapSettings.php` |
| `app/Http/Controllers/CompanyController.php` |
| `app/Http/Controllers/GroupSettingController.php` |
| `app/Http/Controllers/Settings/EmailSettingsController.php` |
| `app/Http/Controllers/Settings/PaymentGatewayController.php` |
| `app/Repositories/GroupSettingRepository.php` |
| `app/Jobs/Import/ImportCsv.php` |
| `config/forge.php` |
| `routes/api.php` |
