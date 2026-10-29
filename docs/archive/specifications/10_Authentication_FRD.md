# InvoiceNinja v5.13.50 — Authentication & Access Control FRD

> **Sources:** `app/Models/User.php`, `app/Models/Company.php`, `app/Http/Controllers/AuthController.php`, `app/Http/Middleware/`, `app/Services/User/UserService.php`, `app/Models/UserSession.php`, `app/Models/Account.php`, `app/Models/Invitation.php`

## 1. System Overview & Boundaries

### Scope
- User authentication (email/password, OAuth, SSO)
- Account-level vs company-level roles
- Permission system (granular per-entity, per-company permissions)
- User session management (JWT, sessions, password reset)
- Two-factor authentication (2FA)
- Contact portal authentication (contact_key-based)
- API token generation and scoping
- Invitation system for new users

### Actors
| Actor | Role |
|---|---|
| **New User** | Registers; accepts invitation; authenticates |
| **Authenticated User** | Accesses features per role permissions |
| **Account Owner** | Full admin; creates companies; manages billing |
| **Administrator** | Full company admin within company scope |
| **Client Contact** | Portal access via contact_key |
| **System** | Validates tokens; handles password reset |

## 2. Authentication Flows

### 2.1 User Registration
> **Source:** `app/Http/Controllers/AuthController.php` (lines 137-224)

1. `POST /api/v1/register` with email, password, first_name, last_name
2. `StoreUserRequest` validates fields
3. `AccountService::save()` creates Account (owner)
4. Account Owner created with full permissions
5. Welcome email sent with company link

### 2.2 Login
> **Source:** `AuthController::login()` (lines 54-130)

1. `POST /api/v1/login` with email + password
2. `Auth::attempt()` validates credentials
3. Rate limited (max_attempts middleware: 5 attempts per minute)
4. `UserSession` record created
5. JWT token generated with `expires_in` and `refresh_token`
6. `last_login` and `last_login_public` updated on user

### 2.3 Password Reset
1. `POST /api/v1 forgotten_password` — generates reset token
2. `POST /api/v1/reset_password` — validates token + sets new password
3. Reset token expires in 60 minutes (`config/jermsipassword_reset.expire`)

### 2.4 API Token Authentication
> **Source:** `app/Models/Token.php`

1. `POST /api/v1/tokens` — create scoped token
2. Token has `scopes` array (read/write entity permissions)
3. Header: `Authorization: Bearer <token>`
4. Tokens expire per `expired` timestamp
5. Each token tracks `last_used_at`

### 2.5 Two-Factor Authentication (2FA)
> **Source:** `app/Models/User.php` (`enable_two_factor`, `two_factor_confirmed`)

1. `PUT /api/v1/users/{id}` with `two_factor_enabled = true`
2. User receives TOTP secret via email
3. User enters 6-digit code from authenticator app
4. `two_factor_confirmed = true` persisted
5. On subsequent logins → redirect to 2FA verification step

### 2.6 Contact Portal Authentication
> **Source:** `app/Models/ClientContact.php`, `app/Http/Middleware/ClientShared`/`ContactToken`

1. Contact receives email with secure link containing `contact_key`
2. `contact_key` is a 64-char encrypted string (not a password)
3. `ContactToken` middleware validates key; loads contact
4. Contact accesses invoices, payments, quotes via `/client/{contact_key}/...`
5. No password required; links expire based on token age (default: 60 days for signed documents, 30 days for regular)

## 3. Authorization Model

### 3.1 Account vs Company Roles
> **Source:** `app/Models/Account.php`, `app/Models/Company.php`, `app/Models/User.php`

| Level | Entity | Description |
|---|---|---|
| **Account** | `Account` model | Top-level billing entity; owns all companies |
| **Company** | `Company` model | Isolated tenant; contains all business data |
| **User** | `User` model | Individual; can belong to multiple companies |

An Account Owner can:
- Create/manage companies
- Manage account billing
- Set subscription plan
- Transfer account ownership

A Company Administrator can:
- Full CRUD within their company
- Manage company users and permissions
- Configure company settings

### 3.2 Permission System

> **Source:** `config/permissions.php`, `app/Http/Middleware/HandlePermissions.php`

**Permission Format:** `{entity}_{action}`
- Entities: `invoice`, `payment`, `client`, `product`, `expense`, `vendor`, `user`, `report`, `setting`, `subscription`, `purchase_order`, `tax_rate`, `credit`, `quote`, `project`, `task`
- Actions: `view`, `create`, `edit`, `delete`, `download`, `archive`, `bulk`

**Permissions resolved via `PermissionChecker` middleware:**

```
hasPermission(entity, action, company_id):
├─ IF user is account_owner at company level → true
├─ IF user is administrator at company level → true
├─ Check user.permissions array for key = "{entity}_{action}"
└─ Return boolean
```

### 3.3 Role Definitions

| Role Constant | Title | Scope | Permissions |
|---|---|---|---|
| `ROLE_OWNER` (0) | Account Owner | Company-wide | All permissions |
| `ROLE_ADMIN` (1) | Administrator | Company-wide | All permissions |
| `ROLE_USER` (2) | Standard User | Company-wide | View all + create/edit own invoices, payments, clients, products, expenses, vendors |
| `ROLE_REGISTER_EVERYONE` | All Registered Users | Company-wide (default) | View own clients only; limited view access |

### 3.4 Permission Resolution Chain
```
User permissions check:
1. Is user authenticated? (auth:sanctum / auth:web)
2. Does user belong to this company? (company_user pivot)
3. Is user deleted? (soft-deleted users blocked)
4. Is user active? (is_locked flag blocks access)
5. Does user have required permission? → HandlePermissions middleware
6. For entity-level scoping → check entity belongs to user.company
```

## 4. Middleware Chain

> **Source:** `app/Http/Middleware/`, `app/Http/Kernel.php`

| Middleware | Purpose |
|---|---|
| `HandlePermissions` | Checks granular permission for route entity + action |
| `HandleCompanyErrors` | Returns 403 if user doesn't belong to requested company |
| `CheckCompanyExists` | Ensures company context is valid |
| `ContactToken` | Validates contact_key for portal routes |
| `PasswordProtected` | Checks for password-protected company setting |
| `Subscribed` | Verifies subscription is active (billing gates) |
| `HandleEcho` | WebSocket broadcasting authorization |
| `TwoFactorEnabled` | Redirects to 2FA when enabled but not confirmed |
| `VerifyEmail` | Ensures user email is verified |

## 5. Session & Token Management

### 5.1 JWT Token
> **Source:** `app/Services/User/UserService.php`

| Claim | Description |
|---|---|
| `exp` | Token expiry (current + `session_length` minutes) |
| `iat` | Issued at |
| `user_id` | User identifier |
| `company_id` | Current company context |
| `token_ability` | Scope (default: `*`) |
| `session_id` | `UserSession` record ID |

### 5.2 Session Length
- Configurable via `settings › session` (default: 120 minutes)
- "Remember me" extends session to 525,600 minutes (1 year)

### 5.3 Rate Limiting
> **Source:** `app/Http/Middleware/RateLimiters.php`

| Route | Limit |
|---|---|
| `login` | 5 requests/minute |
| `register` | 2 requests/minute |
| `api` | Configurable; default per-route throttling |
| `forgotten_password` | 1 request/minute |

## 6. Invitation System

> **Source:** `app/Models/Account.php` (`inviteKey` generation)

1. Admin invites user: `POST /api/v1/users` creates user with `invitation_sent = false`
2. Invite email sent with secure token link
3. User clicks → sets password and activates account
4. Invitation expires in 14 days
5. Resend invitation: `POST /api/v1/users/{id}/resend_invitation`

## 7. API Endpoints

| Endpoint | Verb | Description |
|---|---|---|
| `POST /api/v1/login` | POST | User login |
| `POST /api/v1/register` | POST | New account creation |
| `POST /api/v1/logout` | POST | Invalidate session/token |
| `POST /api/v1/forgotten_password` | POST | Send reset email |
| `POST /api/v1/reset_password` | POST | Reset with token |
| `POST /api/v1/refresh_token` | POST | Get new JWT |
| `GET /api/v1/users` | GET | List company users |
| `POST /api/v1/users` | POST | Create/invite user |
| `GET /api/v1/tokens` | GET | List API tokens |
| `POST /api/v1/tokens` | POST | Create scoped token |

## Source Files
| File |
|---|
| `app/Models/User.php` |
| `app/Models/Account.php` |
| `app/Models/UserSession.php` |
| `app/Models/Token.php` |
| `app/Models/ClientContact.php` |
| `app/Models/Invitation.php` |
| `app/Services/User/UserService.php` |
| `app/Http/Controllers/AuthController.php` |
| `app/Http/Controllers/UserController.php` |
| `app/Http/Controllers/ContactController.php` |
| `app/Http/Middleware/HandlePermissions.php` |
| `app/Http/Middleware/HandleCompanyErrors.php` |
| `config/permissions.php` |
| `routes/api.php` |
