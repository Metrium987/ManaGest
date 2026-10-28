# InvoiceNinja v5.13.50 — Setup, Updates, Login & Import/Export FRD

> **Sources:** `app/Http/Controllers/SetupController.php`, `app/Http/Controllers/SelfUpdateController.php`, `app/Http/Controllers/Auth/LoginController.php`, `app/Http/Controllers/ImportController.php`, `app/Http/Controllers/ImportJsonController.php`, `app/Http/Controllers/ExportController.php`, `app/Jobs/Import/CSVIngest.php`, `app/Jobs/Company/CompanyExport.php`, `resources/views/setup/*.blade.php`

## 1. Setup Wizard

### 1.1 Overview
The setup wizard runs on first access when no account exists (`Account::count() == 0`). It is gated by `guest` middleware and `Ninja::isHosted()` check.

> **Routes:** `routes/web.php` lines 26–32
```
GET /setup         → SetupController::index()       (guest middleware)
POST /setup        → SetupController::doSetup()     (guest + throttle:10,1)
POST /setup/check_db   → SetupController::checkDB()  (guest + throttle:10,1)
POST /setup/check_mail → SetupController::checkMail() (guest + throttle:10,1)
POST /setup/check_pdf  → SetupController::checkPdf()  (guest + throttle:10,1)
GET /update        → SetupController::update()      (guest + throttle:10,1)
```

### 1.2 Setup Flow

#### 1.2.1 Index — Health Check
`SetupController::index()`:
1. Calls `SystemHealth::check(false, false)` — checks PHP version, required extensions, storage writability, database connectivity
2. IF system health OK AND `accounts` table exists AND first account exists → redirect `/` (already configured)
3. IF `Ninja::isHosted()` → redirect `/`
4. Returns `setup.index` view with:
   - `_database` partial (DB connection form)
   - `_account` partial (company/account creation form)
   - `_issues` partial (system health warnings, if any)

#### 1.2.2 Database Check
`SetupController::checkDB()`:
1. Receives `CheckDatabaseRequest` (db_host, db_port, db_database, db_username, db_password)
2. Calls `SystemHealth::dbCheck($request)` — attempts PDO connection
3. Returns 200 if connection succeeds, 400 with error message if it fails

#### 1.2.3 Mail Check
`SetupController::checkMail()`:
1. Receives `CheckMailRequest` (mail_host, mail_port, mail_username, mail_password, mail_encryption)
2. Calls `SystemHealth::testMailServer($request)` — attempts SMTP connection
3. Returns 200 if SMTP connects, 400 with error if not

### 1.3 Setup Wizard View Structure

> **Source:** `resources/views/setup/index.blade.php` + partials

The setup form (`/setup` POST) captures:

| Section | Fields |
|---|---|
| **Database** (`_database.blade.php`) | `db_host`, `db_port`, `db_database`, `db_username`, `db_password` |
| **Account** (`_account.blade.php`) | `url` (APP_URL), `https` (REQUIRE_HTTPS), `first_name`, `last_name`, `email`, `password`, `company_name`, `company_timezone_id`, `company_country_id` |
| **Mail** (`_mail.blade.php`) | `mail_driver` (smtp/mailgun/smtp), `mail_host`, `mail_port`, `mail_username`, `mail_password`, `mail_encryption` |
| **Application** (`_application.blade.php`) | (empty — placeholder) |
| **Issues** (`_issues.blade.php`) | System health failures displayed as warnings |

### 1.4 doSetup — Environment Write & Migrate

`SetupController::doSetup()`:
1. If hosted → redirect `/`
2. SystemHealth check — redirect `/` if already configured
3. Check system health false → return error
4. **Write `.env`:** Uses `AppSetup` trait's `updateEnvironmentProperty()` to write each value:
   - APP_URL, REQUIRE_HTTPS, APP_DEBUG=false, DB credentials, MAIL config, NINJA_ENVIRONMENT=selfhost, DB_CONNECTION=mysql
   - IF `ninja.preconfigured_install` → skip DB fields (already in env)
   - ELSE → update DB connection config at runtime + `DB::purge('mysql')`
5. **Run Artisan commands:**
   - `config:clear`
   - `key:generate --force` (app key generation)
   - `migrate --force` (database migrations)
   - `db:seed --force` (seeders: PaymentLibrariesSeeder, etc.)
   - `config:clear`, `cache:clear`
6. **Create first account:** `(new CreateAccount($request->all(), $ip))->handle()`
   - Creates Account + first company + first user (role: owner)
   - Sets default company on account
   - Generates company key
   - Creates default payment terms, groups, tokens
7. **Version check:** `(new VersionCheck())->handle()` — checks for updates
8. Redirects `/` (to login)

---

## 2. Self-Update Module

> **Source:** `app/Http/Controllers/SelfUpdateController.php` (218 lines)

### 2.1 Update Route
```
GET|POST /update?secret={key}
```
- Password protected via `config('ninja.update_secret')` — if secret doesn't match, redirect `/`
- Only runs on self-hosted (not SaaS — `Ninja::isHosted()` → 403)
- Only runs if an account exists (database already configured)

### 2.2 Update Workflow
`SelfUpdateController::update()`:

```
1. Test filesystem writability:
   - Checks every file in base_path() (excluding .git, vendor/)
   - Throws FilePermissionsFailure if any non-writable

2. Clear bootstrap cache:
   - Deletes: bootstrap/cache/compiled.php, config.php, packages.php, services.php, routes-v7.php, livewire-components.php

3. Fetch version:
   - checkVersion() → reads config('ninja.version_url') (or returns "5.10.SaaS" for hosted)
   - Download URL: https://github.com/invoiceninja/invoiceninja/releases/download/v{version}/invoiceninja.tar

4. Download release tarball:
   - copy() from GitHub release URL to storage_path('app/invoiceninja.tar')

5. Extract:
   - new PharData(file)->extractTo(base_path(), null, true) — true = overwrite existing

6. Purge cache files (list defined inline):
   - Same bootstrap/cache files from step 2

7. If resources/lang exists → deleteDirectory (force re-download of language packs)

8. Run Artisan sequence:
   - clear-compiled
   - route:clear
   - view:clear
   - migrate --force
   - config:clear
   - cache:clear
   - ninja:design-update

9. If config('ninja.pdf_generator') == 'snappdf':
   - Download snappdf binary: ./vendor/bin/snappdf download (300s timeout)

10. Return: { message: "Update completed" }
```

### 2.3 Version Check
```
checkVersion():
├─ IF Ninja::isHosted() → return "5.10.SaaS"
└─ ELSE → file_get_contents(config('ninja.version_url'))
```

### 2.4 Update Failure Modes
| Condition | Behavior |
|---|---|
| Filesystem not writable | `FilePermissionsFailure` exception thrown; 500 response |
| Update server unreachable | Returns 410 with "problem reaching the update server" |
| Release not yet available (404/302) | Returns 410 with "download not yet available" |
| Download copy fails | Returns 500 with "problem downloading to local filesystem" |
| Migration fails | Exception; user must manually run `php artisan migrate` |

---

## 3. Login Portal

> **Source:** `app/Http/Controllers/Auth/LoginController.php`

### 3.1 Login Methods Supported
| Method | Flow |
|---|---|
| **Password** | `POST /api/v1/login` — username + password |
| **Passkey (WebAuthn)** | `POST /api/v1/login` with `passkey_authentication` payload |
| **Google OAuth** | `GET /auth/google` → Socialite redirect → `POST /oauth/callback` |
| **Microsoft OAuth** | `GET /auth/microsoft` → Microsoft Graph API → `POST /oauth/callback` |
| **Apple Sign-In** | `POST /api/v1/oauth/login?provider=apple` — JWT token |
| **OIDC** | `GET /auth/oidc` → Generic OIDC provider (config-based) |

### 3.2 Login Rate Limiting
- Laravel's `LoginThrottling` trait: `maxAttempts = 5`, `decayMinutes = 1`
- `hasTooManyLoginAttempts()` check at start of `apiLogin()`
- Failed attempts increment via `incrementLoginAttempts()`

### 3.3 Precheck Endpoint
> **Source:** `LoginController::precheck()` (lines 137-157)

```
POST /api/v1/precheck
{ "email": "user@company.com" }

→ Returns: { methods: ["password"], secret_required: false }
→ IF user has google_2fa_secret → methods: ["password", "totp"]
```

**Purpose:** Reveals available auth methods before password submission.
**Anti-enumeration:** Response time equalized to 250ms floor (`PRECHECK_TIME_FLOOR_MS = 250`).

### 3.4 Two-Factor Authentication (TOTP)
1. User with `google_2fa_secret` set → after password verification, `verifyTwoFactor()` called
2. Requires `one_time_password` field from request
3. Uses `PragmaRX\Google2FA\Google2FA` to verify TOTP code
4. On failure → 422 response "invalid one_time_password"
5. On success → login proceeds to `finalizeLogin()`

### 3.5 Session Finalization
`finalizeLogin()`:
1. Ensures account has `default_company` set (if missing → assigns from user's first company)
2. Hydrates all `CompanyUser` records for the user
3. Hosted tier check: non-owners denied on non-Enterprise plans
4. Fires `UserLoggedIn` event (for analytics, activity log)
5. Creates `CompanyToken` (system token) for each company user if missing (`CreateCompanyToken` job)
6. Rotates due tokens (`CompanyTokenRotator::rotateDueTokensForUser()`)
7. Returns `timeConstrainedResponse` with company users + tokens

### 3.6 OIDC Secure Token Exchange (Self-Hosted Only)
> **Source:** `LoginController::handleOidcProviderCallback()` (lines 991-1076) and `oidcExchange()` (lines 1090-1107)

```
OIDC callback flow:
1. User authenticates via OIDC provider (Google/Microsoft/Socialite)
2. OIDC user resolved via `MultiDB::hasUser(['oauth_user_id' => sub, 'oauth_provider_id' => 'oidc'])`
3. IF no existing OIDC-linked account:
   - Fall back to email match (only if email_verified=true AND no conflicting OAuth provider)
   - Link account to OIDC identity
4. Login proceeds → `finalizeLogin()` → gets CompanyToken
5. Token is NOT placed in redirect URL (security risk)
   - Instead: generate random 64-char exchange code, cache with 60s TTL
   - Redirect to `{react_url}/oauth-callback?code={exchange_code}`
6. SPA calls `POST /api/v1/oidc/exchange` with code
   - `Cache::pull('oidc.exchange.{code}')` → one-time use, 60s TTL
   - Returns `{ token: company_token }`
7. If no user found → 400 "No Invoice Ninja account is linked"
   - OIDC does NOT support self-service signup on self-hosted instance
```

### 3.7 Hosted Plan Restrictions
For hosted (SaaS) instances:
- Non-owner users on free/basic plans → login denied: "Pro / Free accounts only the owner can log in. Please upgrade."
- Only Enterprise accounts allow non-owner logins
- Enforced at: `finalizeLogin()`, `handleMicrosoftCallback`, `handleOidcCallback`

---

## 4. Data Import

> **Source:** `app/Http/Controllers/ImportController.php` (538 lines), `app/Jobs/Import/CSVIngest.php`

### 4.1 Import Routes

```
POST /api/v1/preimport     → ImportController::preimport()
POST /api/v1/import         → ImportController::import()
POST /api/v1/import_json    → ImportJsonController::import()
POST /company_gateways/{id}/import_customers → bulk customer import
```

### 4.2 Importable Entity Types

The import system supports these entity types (each has a provider class in `app/Import/Providers/`):

| Entity Type | Provider Class | Status |
|---|---|---|
| `client` | `App\Import\Providers\Csv\ClientProvider` | ✓ |
| `payment` | `PaymentProvider` | ✓ |
| `invoice` | `InvoiceProvider` | ✓ |
| `quote` | `QuoteProvider` | ✓ |
| `product` | `ProductProvider` | ✓ |
| `task` | `TaskProvider` | ✓ |
| `expense` | `ExpenseProvider` | ✓ |
| `vendor` | `VendorProvider` | ✓ |
| `purchase_order` | `PurchaseOrderProvider` | ✓ |
| `bank_transaction` | `BankTransactionProvider` | ✓ |
| `recurring_invoice` | `RecurringInvoiceProvider` | ✓ |

### 4.3 Pre-Import Flow (Auto-Hint Mapping)

> **Source:** `ImportController::preimport()` + `setImportHints()`, `getImportHintScore()`

1. Generate 32-char random hash as file reference
2. Cache base64-encoded file content under `hash-{entityType}` key (20min TTL)
3. Parse CSV using `League\Csv\Reader`
4. Read headers from first rows
5. Call `setImportHints()` — intelligent column-to-field mapping:
   - Gets `importable()` fields from the provider class
   - Splits by dot notation (e.g., `client_number` → `client.number`)
   - For each CSV header, computes fuzzy match score against available fields
   - Uses `getImportHintScore()` — similarity based on Levenshtein distance + keyword matching
   - Returns proposals: `{candidate_field_key, score}`
6. Returns:
```json
{
  "hash": "random_hash",
  "mappings": {
    "invoice": {
      "available": ["number", "client_id", "date", "due_date", ...],
      "headers": [["Column A", "Column B", ...], ...],
      "hints": {"0": {"candidate": 3, "score": 92}, "1": {...}, ...}
    }
  }
}
```

### 4.4 Import Execution Flow

`ImportController::import()`:
1. Receives `ImportRequest` with `hash` and `mappings` (column → field assignments)
2. Validates the hash exists in cache (file was preimported)
3. Reconstructs CSV from cached content
4. Dispatches `CSVIngest` job with:
   - Company
   - Hash
   - Import type (entity type)
   - Mappings
   - Skip header flag
5. Returns 202 Accepted — job runs async

`CSVIngest::handle()`:
```
1. Read all CSV rows as LazyCollection (memory-efficient)
2. For each row:
   a. Apply column mappings to create entity data array
   b. Convert foreign key references (client_number → client_id, etc.)
   c. Call the provider's create() method
   d. Track success/failure per row, store error messages
3. Log import summary (rows, errors, skipped) to activities table
4. Dispatch notification email to user with results
5. Clean up cache entries
```

### 4.5 Third-Party Import Providers

Beyond CSV, the system supports importing from:
- **Wave** — `App\Import\Providers\Wave`
- **Zoho** — `App\Import\Providers\Zoho`
- **QuickBooks Backup** — `App\Import\Providers\QBBackup`
- **Invoicely** — `App\Import\Providers\Invoicely`
- **Freshbooks** — `App\Import\Providers\Freshbooks`
- **Invoice2Go** — `App\Import\Providers\Invoice2Go`

These providers map third-party data formats to InvoiceNinja's entity structure.

---

## 5. Data Export

> **Source:** `app/Http/Controllers/ExportController.php`, `app/Jobs/Company/CompanyExport.php`

### 5.1 Export Route
```
POST /api/v1/export
```

### 5.2 Export Flow

`ExportController::index()`:
1. Receives `StoreExportRequest` — specifies entities to export
2. Generates UUID as hash
3. Calculates total activity count for expiry:
   - >10,000 activities → 5-hour expiry
   - ≤10,000 → 1-hour expiry
4. Generates download URL (signed route `protected_download`)
5. Caches hash → URL mapping
6. Dispatches `CompanyExport` job with:
   - Company
   - User
   - Hash
   - Entities to export
7. Returns: `{ message: "Processing", url: "https://.../export/{hash}" }`

`CompanyExport::handle()`:
```
1. For each requested entity type:
   a. Query all entities for company
   b. Serialize to JSON (with related data: client, user, project, etc.)
   c. Write to storage disk as {entity_type}.json
2. Create ZIP archive of all JSON files
3. Upload to export disk
4. Cache download URL under hash key
5. Mark as ready for download
```

### 5.3 Exportable Entities
All entities are exportable: clients, invoices, payments, quotes, credits, products, expenses, vendors, projects, tasks, bank_transactions, purchase_orders, recurring_invoices, users, tax_rates, and all activities.

---

## 6. Implementation Notes for Coding Agent

### 6.1 Setup Wizard Integration
- The setup wizard is web (not API) — uses Blade templates with Vite JS
- Environment file writes use the `AppSetup` trait's `updateEnvironmentProperty()` which preserves formatting
- After setup, the user is at the login page — no auto-login
- The `_account` section creates an Account (top-level billing entity) containing one Company

### 6.2 Update Module Constraints
- Updates download a `.tar` (not `.zip`) from GitHub releases
- The tar file is extracted directly into `base_path()` — files overwrite in place
- PHP Phar extension is required for extraction
- After update, `ninja:design-update` artisan command must run to update PDF templates
- If `pdf_generator = 'snappdf'`, the update process also downloads a fresh PhantomJS binary

### 6.3 Login Security Features
- OIDC does NOT support signup — only login for existing accounts (self-hosted safety measure)
- Passkey authentication uses `PasskeyService::authenticate()` — WebAuthn protocol
- IP resolution checks Cloudflare, X-Forwarded-For, and direct IP
- OAuth tokens (oauth_user_token) are stored on the user model for API operations (e.g., sending email via Gmail for Google OAuth users)
- 2FA verification is enforced for ALL login methods (password AND passkey)

### 6.4 Import Best Practices
- Use LazyCollection for memory efficiency on large files
- Import is async — UI polls `/api/v1/reports/preview/{hash}` or similar endpoint
- Import hints use fuzzy string matching — test with real-world header names
- CSV files with Windows-1252 encoding are auto-detected and converted to UTF-8
- BOM stripping handles UTF-8, UTF-16, UTF-32 BOMs

### 6.5 Export Considerations
- Export runs as a queue job — return a URL immediately, content processes async
- Large datasets (>10k records) get longer cache TTL (5 hours vs 1 hour)
- Export download uses signed URLs for security
- Export includes all related entities' data (nested serialization)

## Source Files
| File |
|---|
| `app/Http/Controllers/SetupController.php` |
| `app/Http/Controllers/SelfUpdateController.php` |
| `app/Http/Controllers/Auth/LoginController.php` |
| `app/Http/Controllers/ImportController.php` |
| `app/Http/Controllers/ImportJsonController.php` |
| `app/Http/Controllers/ExportController.php` |
| `app/Http/Controllers/Contact/LoginController.php` |
| `app/Jobs/Import/CSVIngest.php` |
| `app/Jobs/Company/CompanyExport.php` |
| `app/Jobs/Account/CreateAccount.php` |
| `app/Jobs/Util/VersionCheck.php` |
| `app/Jobs/Util/SchedulerCheck.php` |
| `app/Jobs/Company/CreateCompanyToken.php` |
| `app/Services/Auth/Passkeys/PasskeyService.php` |
| `app/Services/Company/CompanyTokenRotator.php` |
| `app/Utils/Traits/AppSetup.php` |
| `app/Utils/SystemHealth.php` |
| `app/Utils/Ninja.php` |
| `app/Import/Providers/Csv/ClientProvider.php` |
| `routes/web.php` |
| `routes/api.php` |
| `resources/views/setup/index.blade.php` |
| `resources/views/setup/clean_setup.blade.php` |
| `resources/views/setup/_database.blade.php` |
| `resources/views/setup/_account.blade.php` |
| `resources/views/setup/_mail.blade.php` |
| `resources/views/setup/_issues.blade.php` |
| `resources/views/setup/_application.blade.php` |
