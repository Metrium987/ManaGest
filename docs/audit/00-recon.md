# 00 — Reconnaissance

Audit: Invoice Ninja (behavioural baseline) vs ManaGest (implementation under test).

- Audit root: `docs/audit/`
- ManaGest root directory: **`/workspace/chats/1dc810481d9e3dba36eb9bbf`** (this workspace root contains the `server/`, `src/`, `shared/` source trees; the 17 owner FRD documents, `README.md`, `deploy.json` etc. sit at the root).
- Invoice Ninja reference directory: **`reference/invoiceninja/`** (git repo, branch `v5-stable`, commit `15ea35e`). Recorded version: `VERSION.txt` = **5.13.49**.

Everything in this file carries the `[OBSERVED]` tag: the facts below were read directly in the two repositories. Rebuild/run instructions were executed where stated with `[EXECUTED]`.

---

## 1. Invoice Ninja — reference baseline

### 1.1 Identification
| Item | Value | Evidence |
|---|---|---|
| Version | 5.13.49 | `reference/invoiceninja/VERSION.txt:1` `[OBSERVED]` |
| Git commit | 15ea35e "Merge pull request #13363 from turbo124/v5-stable" | `git log -1` in `reference/invoiceninja` (no bare-repo git command run inside the audit folder; commit still resolves) `[OBSERVED]` |
| License | Elastic License. `composer.json` declares `"license": "Elastic License"` (`reference/invoiceninja/composer.json:~7`) and a `LICENSE` file exists. The terms are summarised in `00-executive-summary.md` (information only). `[OBSERVED]` |
| Language / framework | PHP 8.3 (see `composer.json` `"php": ">=8.3"`), Laravel | `reference/invoiceninja/composer.json` `[OBSERVED]` |

### 1.2 Architecture style
- Classical **Laravel monolith**: `app/Http/Controllers` (229 PHP files, counted), `app/Http/Livewire` (setup/registration live-components), `app/Models/*.php` (75 models), `app/Repositories`, `app/Services` (per-module service classes such as `InvoiceService`, `PaymentService`), `app/Request` (FormRequest validators), `app/Jobs` (113 jobs counted), `app/Console/Commands` (29 artisan commands counted), `app/Emails` (mailables), `app/DataMapper`, `app/Helpers`.
- Route files: `routes/api.php` (319 `Route::` declarations counted), `routes/client.php` (client-portal routes), `routes/contact.php`, `routes/vendor.php`, `routes/web.php`, `routes/console.php`, `routes/channels.php`, `routes/shop.php` — all read directly. `[OBSERVED]`
- Persistence: MySQL/PostgreSQL-compatible Eloquent; `database/migrations/` contains **317 migration files** (counted). `[OBSERVED]`
- Frontend: the admin application UI is a **separately bundled React application**; `resources/views/react/index.blade.php` hosts it and its comment says "Source: https://github.com/invoiceninja/invoiceninja — Version: {{ config('ninja.app_version') }}". A local build path exists (`vite.config.ts.react`, `npm run build` → bundle JS), but **the admin React UI source is not present in this repository** — `resources/js` contains only `clients/` (61 vanilla-JS files for the Blade client portal and payment pages) and `setup/`. `[OBSERVED]`
  - Consequence for the audit: the admin UI behaviour inventoried in `02-invoiceninja-inventory.md` comes from: (a) the **44 Playwright e2e specs** in `tests/e2e/*.spec.ts` (they assert actual buttons, labels, workflows of the shipped UI), (b) the API surface, (c) Blade/portal code, (d) official documentation (section 7 web research). Each inventory entry states which of these is its evidence.
- Client-facing also exists as a **Blade client portal** (`resources/views/portal/`, `resources/views/billing-portal/`, `resources/views/vendor/`) plus `resources/js/clients/*` JavaScript. `[OBSERVED]`
- Tests: `tests/` with PHPUnit suites (`phpunit.xml`), feature tests under `tests/Feature`, unit tests under `tests/Unit`, and Playwright e2e specs under `tests/e2e` (`playwright.config.ts`, `package.json` script `test:e2e`). `[OBSERVED]`
- Scheduled jobs/cron: `app/Console/Kernel.php` + commands + queue workers (`phpunit.xml`, `routes/console.php`, `app/Jobs`). `[OBSERVED]`

### 1.3 Main run/build instructions (from repo files; local execution status: BLOCKED)
- Runtime requirements per `composer.json`: PHP >= 8.3, Laravel 11/12 framework packages, plus the database of choice.
- The repo's own Playwright specs assume a pre-installed environment (see `tests/e2e/README.md` and `playwright.config.ts` for the expected base URL and seeded accounts).
- **Execution status in this audit sandbox: `BLOCKED`** — the sandbox provides Node 24 (`node -v` → 24.21.0) but no PHP runtime (`php: command not found`), no Composer, and no database server. Installing a full PHP 8.3 + Laravel + DB stack was judged out of proportion for this disposable runner; every Invoice Ninja fact in this audit is therefore sourced from `[OBSERVED]` repository evidence or documented web sources, never from a live session. This limitation is restated in `coverage.md` and `09-open-questions.md`.
- ManaGest, by contrast, was executed (its stack is Node/Wrangler); every workflow executed against it carries `[EXECUTED]`.

### 1.4 Directory highlights (evidence anchors used later)
| Path | Used for |
|---|---|
| `routes/api.php`, `routes/client.php`, `routes/vendor.php`, `routes/contact.php`, `routes/web.php` | API and portal route inventory |
| `app/Http/Controllers/*.php` | one controller per entity incl. 29 `app/Http/Controllers/Reports/*ReportController.php` report controllers |
| `app/Services/*Service.php` | business rules per module |
| `app/Models/*.php` | entities |
| `database/migrations/*` | data model and constraints |
| `config/update/*.yml`, `config/ninja.php` | defaults and settings lists |
| `lang/en/*.php`, `lang/fr/*.php` | translation files (`texts.php`, `emails/`, `validation.php`, `pagination.php`, `reminders.php`, help texts); `lang/en/help.php` front-line docs |
| `app/Http/Livewire/*` | setup wizard and registration wizards |
| `resources/views/setup/*.blade.php` | setup wizard screens: `_account`, `_application`, `_database`, `_mail`, `_issues`, `clean_setup`, `index` `[OBSERVED ls]` |
| `tests/e2e/*.spec.ts` (44 files) | admin UI + client portal behavioural evidence |
| `app/DataMapper`, `app/Import`, `app/Export` | import/export subsystems |

---

## 2. ManaGest — implementation under test

### 2.1 Stack `[OBSERVED]`
| Item | Value | Evidence |
|---|---|---|
| Name | ManaGest — "ERP de gestion pour la Polynésie française" | `package.json` description |
| Runtime | Node >= 20.19 (`package.json` → engines), bundle built for Cloudflare Workers (esbuild, `platform=browser`, `--external:node:*` matches: `server/worker.ts` imports) | `package.json`, build executed `[EXECUTED]` |
| Server | TypeScript + Hono router on Cloudflare Workers; D1 (SQLite) database; static SPA assets served by the Worker | `server/worker.ts` `[OBSERVED]` |
| Client | React 19 + React Router 7 + TanStack React Query 5, Tailwind 4, lucide-react icons; Vite 8 build | `package.json`, `src/main.tsx`, `vite.config.ts` `[OBSERVED]` |
| Validation | zod 4 on the server (`server/lib/validation.ts`, `routes/*.ts` all call `parseInput(schema, body)`) | `[OBSERVED]` |
| Tests | Vitest — `tests/domain.test.ts` (31 tests) + `tests/tax.test.ts` (10 tests) = 41 passing; plus the black-box end-to-end script `.tmp/audit-api.mjs` with 127 checks (all passing) driving the local Worker | `npm test` executed, `node .tmp/audit-api.mjs` executed `[EXECUTED]` |
| PDF | pdf-lib | `package.json`, `server/services/pdf.ts` `[OBSERVED]` |
| Ops files | `wrangler.jsonc` (local dev: D1 binding `DB`, assets dir `dist/client`, SPA fallback), `deploy.json` (production manifest: `entrypoint: worker.js`, `assetsDirectory: ./dist/client`, `spa: true`) | both read `[OBSERVED]` |

### 2.2 Architecture `[OBSERVED]`
- **Single-Worker monolith**: `server/worker.ts` builds one Hono app with `app.route('...')` per module; 19 API route groups + `/api/health` + catch-all 404 for unmatched `/api/*`, then static-assets fallback for the SPA.
- Server layers: `server/routes/*` (HTTP handlers) → `server/services/*` (documents, pdf, seed, session, status) → `server/lib/*` (audit, crypto, dates, errors, locks, money, numbering, passwords, permissions, tax, totp, validation) → `server/db/*` (schema + idempotent provisioner `ensureSchema`).
- Domain constants and permission matrix shared between client and server in `shared/domain.ts` (roles, permissions, statuses, TVA rates, currencies, cookie names, default timezone/currency/locale).
- Frontend layers: `src/features/<module>/*Page.tsx` (25 page components), `src/components/layout/AppShell.tsx` (navigation + global search + quick-add), `src/components/ui/*` (design-system primitives), `src/lib/i18n.ts` (single French dictionary, 700+ keys, `t(key)` lookup), `src/lib/api.ts` (fetch wrapper adding CSRF + JSON error codes → `src/lib/errors.ts`).
- Build scripts in `package.json`: `dev` (vite), `dev:api` (wrangler dev), `build` (= typecheck → vite build → esbuild worker), `test`, `db:migrate:local`, `preview`.
- Sizing: 79 TypeScript source files (find output above), the schema file alone declares **15 tables** (see `04-data-model-comparison.md`).

### 2.3 Execution status: PASSED `[EXECUTED]`
- `npm run typecheck` → clean (both tsconfig projects).
- `npm test` → 41/41 pass.
- `npm run build` → clean (bundle built to `dist/client` + `dist/worker/index.js`).
- Local Worker started via `wrangler dev --port 8787 --local` with D1 + ASSETS bindings confirmed in the banner; API audit (`node .tmp/audit-api.mjs`) → **127/127 checks pass**, covering: clients, products, invoices (create/send/PDF/paid-life cycle), quotes (create/send/approve/convert), credits (create/send/apply), payments, recurring (create/run), expenses, vendors, purchase orders, projects, tasks, bank accounts/transactions/import/match, settings, users per role, activity chain verification, tax report reconciliation, period close/reopen, MFA_totp enable/verify/recovery codes/challenge replay/danger-disable, CSRF, foreign-origin, unauthenticated 401, role-permission matrix for owner/sales/accountant/viewer.
- SPA fallback: `GET /connexion` → 200 HTML; `GET /` → 200 HTML (`curl`-verified). `[EXECUTED]`

---

## 3. Cross-cutting observations

1. **UI-of-record difference.** The reference UI is a separate React app; only its Playwright specs + hosted SaaS docs witness it here. ManaGest's UI is fully in-repo. Parity verdicts therefore distinguish "UI panel" (grey-labelled: behavioural, from specs) vs "API" (from Laravel code) in `02-invoiceninja-inventory.md`.
2. **Db position.** Invoice Ninja = Eloquent migrations (317 files; every table in DDL form). ManaGest = a single idempotent schema script (`server/db/schema.ts`, 15 `CREATE TABLE` groups). Comparison is structural — table by table — in `04-data-model-comparison.md`.
3. **Assessment of applicability.** Many Invoice Ninja modules (client portal, subscriptions checklist, gated payments, bank auto-matching) are SaaS-scale features whose absence from an ERP-for-a-small-country is expected; they are disclosed as `NOT-APPLICABLE`/`DEVIATION-INTENTIONAL` (or flagged for the owner in `09-open-questions.md`) rather than counted as failures, unless ManaGest's own FRDs demand them.
4. **Owner requirements located.** The 17 FRD files at the ManaGest root (00–17: Master Module Catalogue, Core Entity Definitions, per-module FRDs, Authentication FRD, Settings FRD, bank module, UI/UX architecture FRD, setup/update FRD, implementation primer) are numbered the "Intended Requirements" column throughout the audit. They are read as statements of intent, cross-checked against code. Inventory entries cite them as `FRD-<number>`.
5. **Translation gap (seed observation).** Invoice Ninja ships `lang/fr/` translation files (5 file groups: emails, pagination, reminders, texts, validation). ManaGest's UI dictionary is entirely in-file in French (`src/lib/i18n.ts`) while Invoice Ninja keeps source strings in English and translates `fr` from files. This is a structural deviation made explicit in sections 6H and 05.

## 4. What happens next

The audit proceeds: Phase 1 static analyses of both trees → Phase 3 rules → Phase 4 normalisation → Phase 5 parity + backlog → Phase 6 self-verification, each delivered in its own `docs/audit/NN-*.md` file in the order of `INDEX.md`.
