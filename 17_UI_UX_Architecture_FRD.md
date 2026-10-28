# InvoiceNinja v5.13.50 — UI/UX Architecture FRD

> **Source base:** `E:\invoiceninja-5.13.50`
> **Sources:** `resources/views/index/index.blade.php`, `resources/views/portal/ninja2020/layout/app.blade.php`, `resources/views/portal/ninja2020/components/general/sidebar/*.blade.php`, `app/Http/ViewComposers/PortalComposer.php`, `app/Http/Controllers/Auth/LoginController.php`, `app/Http/Controllers/SetupController.php`, `resources/views/setup/*.blade.php`, `app/Http/Controllers/SelfUpdateController.php`, `resources/views/auth/login.blade.php`, `resources/views/portal/ninja2020/auth/login.blade.php`, `app/Http/Controllers/ImportController.php`, `app/Http/Controllers/ExportController.php`, `resources/views/portal/ninja2020/components/livewire/*.blade.php`, `resources/views/portal/ninja2020/invoices/show.blade.php`, `resources/views/portal/ninja2020/quotes/includes/actions.blade.php`, `routes/web.php`, `routes/client.php`

---

## 1. System Overview & UI Architecture

### 1.1 Three-Tier Interface Architecture

InvoiceNinja v5.13.50 employs **three distinct UI surfaces**, each with a different technology stack:

| Surface | Technology Stack | URL Route | Primary User | Entry File |
|---|---|---|---|---|
| **Admin Panel** | Flutter SPA + Service Worker | `/` (`flutterRoute`) | Authenticated users (admin/staff) | `resources/views/index/index.blade.php` |
| **Client Portal** | Laravel Blade + Livewire + Alpine.js (ninja2020 theme) | `/client/*` | Clients, vendors, contacts | `resources/views/portal/ninja2020/layout/app.blade.php` |
| **Setup Wizard** | Laravel Blade + Vite JS | `/setup` | First-time installer | `resources/views/setup/index.blade.php` |

**Key architectural note:** The admin panel's Flutter source code is NOT included in this repository — only the compiled JavaScript bundle is served via Blade. The Flutter app loads asynchronously; a CSS spinner (`<div class="loader">`) displays during initialization, then hides on `DOMContentLoaded`. The client portal and setup wizard are fully server-rendered with selective Livewire/Alpine reactivity.

### 1.2 Global UI Conventions

| Aspect | Pattern |
|---|---|
| **CSS Framework** | TailwindCSS (admin panel), custom Bootstrap-style classes (client portal) |
| **Icons** | Inline SVG for structural icons (hamburger, chevrons, close); SVG image files for sidebar navigation icons (`images/svg/` and `images/svg/dark/`) |
| **Color Theme** | Primary color via `bg-primary` class; active sidebar items use `bg-primary text-white hover:brightness-90` |
| **Responsive** | `md:` breakpoint at 768px; mobile hides sidebar and shows hamburger button |
| **White-label** | `data-white_label` attribute controls branding visibility; `data-company` and `data-user` attributes expose context to JS |
| **Cookie Consent** | Cookie consent banner via `cookieconsent` library on all surfaces |

---

## 2. Admin Panel UI (Flutter SPA)

### 2.1 Loading & Initialization

**Source:** `resources/views/index/index.blade.php` (lines 1–199)

```
Flow:
1. Browser loads index/index.blade.php
   ├─ Injects Flutter build JS: <script src="{{ $path }}?v={{ app_version }}"></script>
   ├─ Sets up PDF.js worker: pdfjsLib.GlobalWorkerOptions.workerSrc
   ├─ Configures Flutter canvasKit (self-hosted only): canvasKitBaseUrl
   └─ Registers service worker: flutter_service_worker.js
2. CSS spinner (3 bouncing dots) displayed at center:
   <center id="loader"><div class="loader"></div></center>
3. On DOMContentLoaded → loader.style.display = "none"
4. Flutter app initializes inside empty <body>
   └─ If existing service worker → controllerchange → auto-reload
```

### 2.2 Update Notification Pattern

**Source:** `resources/views/index/index.blade.php` (lines 125–189)

```javascript
// Service Worker update detection
registration.addEventListener('updatefound', () => {
    if (registration.installing) {
        registration.installing.addEventListener('statechange', () => {
            if (registration.waiting) {
                if (navigator.serviceWorker.controller) {
                    invokeServiceWorkerUpdateFlow();
                }
            }
        });
    }
});

function invokeServiceWorkerUpdateFlow() {
    // Shows native browser alert() — NOT a custom modal
    const confirmed = alert('New version of the app is available. Refresh now');
    if (confirmed) {
        window.location.reload();
    }
}
```

**UX characteristics:**
- Update is detected silently via service worker `updatefound` event
- Notification uses native browser `alert()` — non-stylable, blocks interaction
- User must click "OK" to dismiss; clicking "Cancel" means update waits for next page reload
- Auto-refresh via `controllerchange` event if user doesn't act (page reloads without prompt)
- **No update history, changelog, or version display** in the UI

### 2.3 Admin Panel Layout Structure (Flutter)

**Sources:** `github.com/invoiceninja/admin-portal` (separate Flutter repository), `github.com/invoiceninja/flutter` (web deployment); `docs/sidebar-and-shell.md`, `docs/detail-screen-layout.md`

The admin panel is a Flutter application built from a **separate repository** (`invoiceninja/admin-portal` or `invoiceninja/flutter`). Only the compiled JavaScript bundle is present in this Laravel repository (`resources/views/index/index.blade.php`). The layout follows a **three-part pane structure**:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Sidebar Navigation (left)      List/Table (center)   Preview (right)│
│  ┌──────────────────────────┐    ┌──────────────────┐   ┌─────────────┐│
│  │ [company logo]           │    │  Search/Filter   │   │  Entity     ││
│  │                          │    │  ┌────────────┐  │   │  Details  ││
│  │ Dashboard         📊      │    │  │ Item 1     │  │   │  ┌──────┐  ││
│  │ Clients           👥      │    │  │ Item 2 ... │  │   │  │ Tab  │  ││
│  │ Products         📦      │    │  └────────────┘  │   │  │      │  ││
│  │ Invoices         📄      │    │                  │   │  └──────┘  ││
│  │ …                       │    │  Pagination      │   │           ││
│  │ Settings         ⚙️      │    │                  │   │           ││
│  └──────────────────────────┘    └──────────────────┘   └─────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

**Key features:**
- Layout is customizable via `Settings → Device Settings`
- **Sidebar modes:** "Collapse" (pinned, expands on hover) or "Float" (hidden, slides out via hamburger)
- **Responsive:** Sidebar collapses to icons-only on narrow screens
- **Preview sidebar:** Can be toggled on/off; when enabled, shows detailed entity information alongside the list
- Uses `NavigationRail` (≥600px) or `NavigationBar` (<600px) via `go_router` `StatefulShellRoute.indexedStack`

### 2.4 Sidebar Navigation — Menu Structure

**Source:** `lib/ui/app/menu_drawer.dart` (from admin-portal repo)

The sidebar (`MenuDrawer`) contains `DrawerTile` components for each entity type. Each tile is **permission-gated** — `userCompany.canViewCreateOrEdit(entityType)` hides tiles the user lacks permission for.

**Navigation order (from `menu_drawer.dart`):**

| Order | Entity Type | Icon | Long-Press Action |
|---|---|---|---|
| 1 | **Dashboard** | 📊 | Create dashboard filter |
| 2 | **Clients** | 👥 | Create new client |
| 3 | **Products** | 📦 | Create new product |
| 4 | **Invoices** | 📄 | Create new invoice |
| 5 | **Recurring Invoices** | 🔁 | Create recurring invoice |
| 6 | **Credits** | 💳 | Create credit |
| 7 | **Quotes** | 📝 | Create new quote |
| 8 | **Purchase Orders** | 🛒 | Create purchase order |
| 9 | **Expenses** | 💰 | Create expense |
| 10 | **Recurring Expenses** | 🔁💰 | Create recurring expense |
| 11 | **Vendors** | 🏢 | Create vendor |
| 12 | **Projects** | 📁 | Create project |
| 13 | **Tasks** | ⏱ | Create task |
| 14 | **Tax Rates** | 📊 | Create tax rate |
| 15 | **Bank Accounts** | 🏦 | Add bank account |
| 16 | **Bank Transactions** | 📥 | — |
| 17 | **Transaction Rules** | ⚙️ | Create rule |
| 18 | **Documents** | 📎 | — |
| 19 | **Templates** | 📄 | Create template |
| 20 | **Reports** | 📈 | — |
| — | **Settings** | ⚙️ | — |

**DrawerTile interaction patterns:**
- **Single tap**: `onTap` → dispatches `viewEntitiesByType(entityType)` (navigates to list)
- **Long press** (tooltip shown on hover): `onLongPress` → dispatches entity-specific create action (creates new entity)
- **Permission check**: returns empty `Container()` if `!userCompany.canViewCreateOrEdit(entityType)`
- **Dark mode support**: `enableDarkMode` preference affects tile colors
- **Custom colors**: `activeCustomColors[PrefState.THEME_SIDEBAR_INACTIVE_BACKGROUND_COLOR]` for theme customization
- **Company selector**: PopupMenuButton at top of sidebar for switching between companies (`state.companies`)

### 2.5 Entity List Views

**Source:** `lib/ui/app/entities/entity_list_tile.dart`, `lib/ui/app/list_scaffold.dart`

Each entity list page uses the following pattern:

```
┌─────────────────────────────────────────────────────────┐
│  Search bar                   [Filter ▼] [Sort ▼]       │
├─────────────────────────────────────────────────────────┤
│  [✓] Item 1          (subtitle)          →            │
│      — status badge, icon                             │
│  [ ] Item 2          (subtitle)          →            │
│  [ ] Item 3          (subtitle)          →            │
│  ─────────────────────────────────                    │
│  Rows: 1-10 of 42  [1] [2] [3] [4] ... [Next]         │
└─────────────────────────────────────────────────────────┘
```

**EntityListTile structure (per row):**
- **Leading:** entity icon (`getEntityIcon(entityType)`)
- **Title:** `entity.listDisplayName` — primary display name
- **Subtitle:** `entity.matchesFilterValue()` result, or `localization.lookup(entityType)`
- **Trailing:** `Icons.navigate_next` (chevron)
- **onTap:** `viewEntity(entity: entity)` — navigates to detail view
- **Multi-select:** Long-press on edit button → enters multi-select mode; checkboxes appear on all rows

**List header actions (above table):**
- Search bar (live filtering)
- Filter dropdown (status, date range, etc.)
- Sort options
- Multi-select checkboxes (when in selection mode)
- Bulk action buttons: Delete, Archive, Convert, Email (context-dependent)

### 2.6 Entity Detail Views

**Source:** `lib/ui/app/view_scaffold.dart`, `docs/detail-screen-layout.md`

Detail views use the **`ViewScaffold`** pattern with a consistent tab structure:

#### Tab Structure (Entity Detail)

| Tab | Content | Components Used |
|---|---|---|
| **Overview** | Key fields, status, totals | `EntityHeader`, `FieldGrid` |
| **Activity** | Audit trail / history | `ActivityListTile` |
| **History** | Payment/application history | `ActivityListTile` variants |
| **Custom** (entity-specific) | e.g., Payment Schedule for invoices, Tasks for projects | Entity-specific components |

**Detail screen layout (from `docs/detail-screen-layout.md`):**

```
┌─────────────────────────────────────────────────┐
│  AppBar: Entity Name  [Status Badge]  [Actions] │
│  ─────────────────────────────────────────────── │
│  Tab 1  Tab 2  Tab 3  Tab 4                    │  ← TabController
│  ─────────────────────────────────────────────── │
│  [Overview content with FieldGrid + quick      │
│   action tiles]                                  │
│  ─────────────────────────────────────────────── │
│  [BottomButtons] ← state/permission dependent  │
└─────────────────────────────────────────────────┘
```

#### BottomButtons Component

**Source:** `lib/ui/app/buttons/bottom_buttons.dart` (component name per DeepWiki)

The `BottomButtons` component renders action buttons at the bottom of entity detail screens. Buttons are **dynamically generated** based on:
- Entity type (invoice, quote, client, etc.)
- Entity status (draft, sent, paid, etc.)
- User permissions (can view, edit, delete)

Common bottom button actions:
| Entity | Draft | Sent | Paid | Other Conditions |
|---|---|---|---|---|
| Invoice | Edit, Delete, Send | Edit, Send, Cancel | Edit, View PDF | Mark Paid, Clone |
| Quote | Edit, Delete, Send | Edit, Send, Convert | — | Approve, Reject |
| Client | Edit, Delete | Edit | — | Statement, Emails |

#### Quick-Action Tiles

On the overview tab, a row of quick-action tiles provides one-tap access to common operations:
- Invoice: Create Credit, Create Payment, Send, Clone, Convert to Recurring
- Quote: Approve, Convert to Invoice, Email
- Client: New Invoice, New Quote, Statement, Payment

### 2.7 Interaction Patterns

**Source:** `docs/sidebar-and-shell.md`, Getting Started documentation

| Gesture | Behavior | Scope |
|---|---|---|
| **Single tap** on entity in list | Navigate to detail view | All entity lists |
| **Long press** on sidebar tile | Create new entity | All sidebar items (e.g., long-press "Clients" → create new client) |
| **Long press** on dashboard entity | Navigate directly to edit screen | Dashboard entities |
| **Long press** on table edit button | Enter multi-select mode + select that row | All entity tables |
| **Back button** (←) | Navigate to URL-parent (up navigation) | All screens |
| **Android back / Cmd+Backspace** | History-based back | All screens |
| **Hover** on sidebar tile | Show long-press tooltip (e.g., "New Client") | Desktop only |

**Shorthand input support:**
- Date fields: typing `404` → April 4th of current year
- Time fields: typing `1.5` → 1:30 (1.5 hours → one and a half hours in duration fields)
- Number fields: live preview of formatted values

### 2.8 App Bar Structure

**Source:** `view_scaffold.dart` (from DeepWiki)

The AppBar appears at the top of the `ViewScaffold`:
```
┌─ [←] Entity Name            [Status Badge]  [Action Icons] ─┐
│                                                             │
│  ← = up navigation (URL parent)                            │
│  Entity Name = entity display name                          │
│  Status Badge = colored status indicator                  │
│  Action Icons = Save, Edit, Delete, More (⋮)             │
│                 (permission and state dependent)           │
└─────────────────────────────────────────────────────────────┘
```

Action icons (right side of AppBar):
- **Save** (✓) — on edit forms, saves changes
- **Edit** (✎) — on view forms, navigates to edit screen
- **Delete** (🗑) — navigates to delete confirmation
- **More** (⋮) — dropdown with: Clone, Convert, Email, Archive, Print/PDF, etc.
- **History** (⏱) — navigation history drawer

### 2.9 Plan Gating (Feature Availability)

**Source:** `dashboard_screen.dart` (from GitHub)

Advanced features use a **"show-but-allow-with-banner"** pattern rather than hiding:
```
Plan gating logic:
├─ IF state.isProPlan == false AND feature requires Pro:
│   └─ Feature IS visible (not hidden)
│   └─ Upgrade banner displayed: "Upgrade to Pro" button
│   └─ Action blocked until upgrade
└─ IF state.isProPlan == true:
    └─ Feature fully functional
```

**`isProPlan`** computed from `account.plan` returned by server. Banners appear on:
- Advanced settings screens
- Certain report types
- E-invoicing features (Peppol, Verifactu)
- Template customization beyond basic themes
- Custom domain for client portal

### 2.10 Device Settings (Layout Customization)

**Source:** Getting Started documentation

Available under `Settings → Device Settings`:

| Setting | Options | Default |
|---|---|---|
| Sidebar | Collapse / Float | Collapse |
| Preview Sidebar | Enabled / Disabled | Enabled |
| Dark Mode | On / Off / Auto | Auto |
| Table Density | Compact / Normal / Spacious | Normal |
| History Visible | On / Off | On |
| Enable Tooltips | On / Off | On |

---

## 3. Client Portal UI (ninja2020 Theme)

### 3.1 Overall Layout Structure

**Source:** `resources/views/portal/ninja2020/layout/app.blade.php`

```
┌─────────────────────────────────────────────────────────┐
│ Header (h-16, fixed, bg-white, shadow)                   │
│ ┌─ Hamburger (mobile) ─┼─ Page Title ─┼─ Contact       │
│    Switcher ─┼─ Profile Dropdown ─┐                     │
├─────────────────────────────────────────────────────────┤
│ ┌ Sidebar (desktop) ───┐  ┌ Main Content ────────────┐ │
│ │  [logo]              │  │  Page header alert         │ │
│ │  Dashboard           │  │  (errors)                  │ │
│ │  Invoices            │  │  Entity content            │ │
│ │  …                   │  │  (PDF viewer, tables,      │ │
│ │  (social links       │  │   forms, payment flow)      │ │
│ │   on unpaid)         │  │                            │ │
│ │                      │  │                            │ │
│ │                      │  │  Footer                    │ │
│ └──────────────────────┘  └───────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Wrapper:** `sidebar/main.blade.php` uses:
- `x-data="{ sidebarOpen: false }"` (Alpine.js) for mobile sidebar state
- `@keydown.window.escape="sidebarOpen = false"` to close on ESC
- `data-portal-target="shell"` attribute for targeting
- Background: `bg-gray-100` (light gray)
- Main container: `flex flex-col w-0 flex-1 overflow-hidden`

### 3.2 Sidebar Navigation — Category Organization

**Source:** `app/Http/ViewComposers/PortalComposer.php` (lines 104–152)

The entire navigation structure is built dynamically by `PortalComposer::sidebarMenu()`. The method reads `$enabled_modules` (a **bitmask** integer stored on the Company model) and conditionally adds menu items:

```php
// Module bitmask constants (PortalComposer.php lines 25-53)
const MODULE_RECURRING_INVOICES = 1;
const MODULE_CREDITS            = 2;
const MODULE_QUOTES             = 4;
const MODULE_TASKS              = 8;
const MODULE_EXPENSES           = 16;
const MODULE_PROJECTS            = 32;
const MODULE_VENDORS             = 64;
const MODULE_TICKETS            = 128;
const MODULE_PROPOSALS          = 256;
const MODULE_RECURRING_EXPENSES = 512;
const MODULE_RECURRING_TASKS    = 1024;
const MODULE_RECURRING_QUOTES   = 2048;
const MODULE_INVOICES           = 4096;
const MODULE_PROFORMAL_INVOICES = 8192;
const MODULE_PURCHASE_ORDERS    = 16384;
```

#### 3.2.1 Navigation Category Structure (in order)

| Order | Module Constant | Condition | Route | Icon | Menu Title |
|---|---|---|---|---|---|
| 1 | — | `enable_client_portal_dashboard` | `client.dashboard` | `activity` | Dashboard |
| 2 | `MODULE_INVOICES (4096)` | Bitmask & enabled | `client.invoices.index` | `file-text` | Invoices |
| 3 | `MODULE_RECURRING_INVOICES (1)` | Bitmask & enabled | `client.recurring_invoices.index` | `file` | Recurring Invoices |
| 4 | — (always) | — | `client.payments.index` | `credit-card` | Payments |
| 5 | `MODULE_QUOTES (4)` | Bitmask & enabled | `client.quotes.index` | `align-left` | Quotes |
| 6 | `MODULE_CREDITS (2)` | Bitmask & enabled | `client.credits.index` | `credit-card` | Credits |
| 7 | — (always) | — | `client.payment_methods.index` | `shield` | Payment Methods |
| 8 | — (always) | — | `client.documents.index` | `download` | Documents |
| 9 | `MODULE_TASKS (8)` | Bitmask & enabled + `enable_client_portal_tasks` | `client.tasks.index` | `clock` | Tasks |
| 10 | `MODULE_PROJECTS (32)` | Bitmask & enabled + `enable_client_portal_tasks` | `client.projects.index` | `briefcase` | Projects |
| 11 | — (always) | — | `client.statement` | `activity` | Statement |
| 12 | `MODULE_INVOICES (4098)` | If hosted + default company: Plan; else: Subscriptions | `client.plan` or `client.subscriptions.index` | `credit-card` / `calendar` | Plan / Subscriptions |
| 13 | — | `client_initiated_payments` setting | `client.pre_payments.index` | `dollar-sign` | Pre-Payment |

#### 3.2.2 Sidebar Rendering (Desktop)

**Source:** `resources/views/portal/ninja2020/components/general/sidebar/desktop.blade.php`

```blade
@if($settings && $settings->enable_client_portal)
    @include('portal.ninja2020.components.general.sidebar.desktop')
@endunless
```

Desktop sidebar is a **fixed left sidebar** that can be hidden via query parameter:
```blade
@unless(request()->query('sidebar') === 'hidden')
    @include('...sidebar.desktop')
@endunless
```

Each menu item renders:
```blade
<a href="{{ route($row['url']) }}" id="{{ $row['id'] }}"
   class="{{ isActive($row['url'], true) ? 'bg-primary text-white hover:brightness-90' : 'text-gray-900 hover:bg-gray-100' }}">
    <img src="{{ asset('images/svg/' . $row['icon'] . '.svg') }}" class="w-5 h-5 fill-current mr-3" />  {{-- active --}}
    <span>{{ $row['title'] }}</span>
</a>
```

**Active state detection:** `isActive($row['url'], true)` — checks current route against the menu item's route name. Active items use the primary color scheme (`bg-primary`); inactive use `bg-gray-100` hover.

#### 3.2.3 Sidebar Rendering (Mobile)

**Source:** `resources/views/portal/ninja2020/components/general/sidebar/mobile.blade.php`

Mobile sidebar is a **slide-out drawer** triggered by a hamburger button:

```blade
{{-- Hamburger trigger in header --}}
<button @click.stop="sidebarOpen = true" class="px-4 border-r ...">
    <svg><!-- hamburger icon: M4 6h16M4 12h16M4 18h7 --></svg>
</button>

{{-- Drawer (off-canvas) --}}
<div class="fixed inset-y-0 left-0 ... -translate-x-full"
     :class="{'translate-x-0': sidebarOpen, '-translate-x-full': !sidebarOpen}">
    {{-- Close button --}}
    <button @click="sidebarOpen = false" class="...focus:bg-gray-600">
        <svg><!-- X icon: M6 18L18 6M6 6l12 12 --></svg>
    </button>
</div>
```

**Drawer behavior:**
- `x-cloak` equivalent: `opacity-0 pointer-events-none` when closed → `opacity-75 pointer-events-auto` when open
- Transition: `duration-300 ease-in-out`
- Width: `max-w-xs w-[calc(100%-3.5rem)]` (full height minus 56px header)
- **Footer on unpaid accounts:** Social media icons (Facebook, Twitter, GitHub, Contact, YouTube) displayed at bottom of drawer — only when `!$contact->user->account->isPaid()`

---

### 3.3 Header Bar

**Source:** `resources/views/portal/ninja2020/components/general/sidebar/header.blade.php`

```
Header Layout (h-16, bg-white, shadow):
┌────────────────────────────────────────────────────────┐
│ [☰]  Page Title              [Company] ▼  [Avatar]  │
│       (mobile)              (contact       (profile) │
│                            switcher)                  │
└────────────────────────────────────────────────────────┘
```

#### 3.3.1 Hamburger Menu Button (Mobile Only)
- Visible only on `md:hidden` (mobile)
- `@click.stop="sidebarOpen = true"` — opens mobile drawer, stops propagation
- Contains SVG hamburger icon (3 horizontal lines)
- **CSS classes:** `px-4 border-r border-gray-200 text-gray-500 hover:bg-gray-100`

#### 3.3.2 Page Title
- Rendered via `@yield('meta_title')` from child view
- Uses `data-ref="meta-title"` attribute
- Text: `text-base sm:text-xl text-gray-900 break-words leading-tight`

#### 3.3.3 Contact Switcher (Multiple Contacts)
- Appears only when `$multiple_contacts->count() > 1`
- Alpine.js dropdown: `x-data="{ open: false }"`
- Trigger: company name + chevron-down SVG
- Dropdown content: list of contacts with `route('client.switch_company', $contact->hashed_id)`
- Current contact shows green checkmark SVG
- **Classes:** `bg-white ring-1 ring-black ring-opacity-5`, `max-h-80 overflow-y-auto`

#### 3.3.4 User Profile Dropdown
- Trigger: circular avatar image + contact name
- Alpine.js dropdown: `x-data="{ open: false }"`
- Transition: `x-transition:enter="transition ease-out duration-100"` / `x-transition:leave="transition ease-in duration-75"`
- Dropdown items:
  - **Profile** (if `$client->getSetting('enable_client_profile_update')`): `route('client.profile.edit', ['client_contact' => ...])`
  - **Logout**: `route('client.logout')`
- **Dropdown classes:** `origin-top-right absolute right-0 w-48 rounded-md shadow-lg`, `py-1 rounded-md bg-white ring-1 ring-black ring-opacity-5`

---

### 3.4 Dashboard View

**Source:** `resources/views/portal/ninja2020/dashboard/index.blade.php`

#### 3.4.1 Dashboard Summary Cards

| Card | Data Source | Display Format |
|---|---|---|
| **Total Invoices** | `invoices()->count()` | Integer count |
| **Paid To Date** | `getPaidToDate()` | Currency formatted |
| **Open Balance** | `getBalance()` | Currency formatted |

**Card layout:** 3-column grid (`sm:grid sm:grid-cols-3`), white cards with shadow. Currency amounts use `App\Utils\Number::formatMoney()`.

#### 3.4.2 Client Information Card
- Shows: client name, phone, email, address
- Positioned below summary cards
- Uses `bg-white shadow sm:rounded-lg` card pattern

#### 3.4.3 Company Information Card
- Shows: company logo (`company->present()->logo()`), company name, address, VAT number, phone, email
- Positioned in right column (dashboard uses `lg:grid lg:grid-cols-3` on larger screens)

---

### 3.5 Entity List Views (Invoices, Quotes, Credits, Payments, etc.)

**Source:** `resources/views/portal/ninja2020/components/livewire/invoices-table.blade.php` (representative)

All entity list views follow the same pattern via Livewire data tables.

#### 3.5.1 Bulk Action Toolbar (Top of Table)

```
Position: Left-aligned, above table
┌──────────────────────────────────────────┐
│ [☐] Download   [☐] Pay Now              │
│ (buttons disabled when no rows selected) │
└──────────────────────────────────────────┘
```

**Button placement rules:**
- **Download**: Always visible (form POST to `client.invoices.bulk` with `action=download`)
- **Pay Now**: Only appears if `$gateway_available` is true
- Both buttons use `name="action" value="..."` pattern — the form determines the action
- Selection state: `wire:change="toggleSelected('hash_id')"` on individual checkboxes, `wire:change="toggleSelectAll"` on header checkbox
- Button disabled: `@disabled(count($selected) === 0)` — Livewire reactive

#### 3.5.2 Filter & Pagination Toolbar (Top of Table)

```
Position: Right-aligned, above table
┌────────────────────────────────────┐
│ Per Page: [10 ▼]  [paid] [unpaid] [overdue] │
└────────────────────────────────────┘
```

- **Per-page selector:** `<select wire:model.live="per_page">` with options 5/10/15/20 (default: 10)
- **Status filters:** Checkboxes with `wire:change="toggleStatus('...')"'`:
  - `paid` (checkbox + label "Paid")
  - `unpaid` (checkbox + label "Unpaid")
  - `overdue` (checkbox + label "Past Due")
- These use Tailwind `form-checkbox` and `form-select` classes

#### 3.5.3 Table Column Headers

| Column | Header | Sortable? | Notes |
|---|---|---|---|
| Checkbox | (no text, aria-label "Select All") | No | `wire:change="toggleSelectAll"` |
| Number | "Invoice Number" | Yes | `wire:click="sortBy('number')"` |
| PO Number | "PO Number" | Yes | `wire:click="sortBy('number')"` (same field) |
| Date | "Invoice Date" | Yes | `wire:click="sortBy('date')"` |
| Amount | "Amount" | Yes | `wire:click="sortBy('amount')"` |
| Balance | "Balance" | Yes | `wire:click="sortBy('balance')"` |
| Due Date | "Due Date" | Yes | `wire:click="sortBy('due_date')"` |
| Status | "Status" | Yes | `wire:click="sortBy('status_id')"` |
| Actions | (empty) | No | Right-aligned |

**Header styling:** `px-6 py-3 text-xs font-medium text-white uppercase bg-primary border-b border-gray-200`

#### 3.5.4 Row-Level Actions (Rightmost Column)

**Source:** `invoices-table.blade.php` (lines 116–130)

```
Row Actions (right-aligned, in last `<td>`):
┌─────────────────────────────────┐
│ [Pay Now] [View]                │
│ (conditionally rendered)        │
└─────────────────────────────────┘
```

**Action button placement rules per entity type:**

| Entity | Row Action 1 (Primary) | Row Action 2 | Conditions |
|---|---|---|---|
| **Invoice** | Pay Now button | View link | Pay Now: `isPayable() && balance > 0 && gateway_available` |
| **Quote** | — | View link | No action button (approval handled on detail page) |
| **Credit** | — | View link | No action button |
| **Payment** | — | View link | No action button |
| **Recurring Invoice** | — | View link | No action button |
| **Purchase Order** | — | View link | No action button |
| **Subscription** | — | View link | No action button |

**Pay Now button** (in table rows):
- Class: `px-2 py-1 mr-3 text-xs uppercase button button-primary bg-primary`
- `dusk="pay-now"` attribute for testing
- Inline onclick: `setTimeout(() => this.disabled = true, 0)` — disables immediately

**View link** (in table rows):
- Class: `button-link text-primary`
- Always visible, points to entity detail page

#### 3.5.5 Status Badges

| Entity | Badge Method | Colors |
|---|---|---|
| Invoice | `Invoice::badgeForStatus($invoice->status)` | Paid=green, Sent=blue, Overdue=red, Draft=gray, Cancelled=gray |
| Quote | `Quote::badgeForStatus()` | Approved=green, Sent=blue, Expired=yellow, Draft=gray |
| Credit | `Credit::badgeForStatus()` | Applied=green, Sent=blue, Partial=yellow |

**Implementation:** Badges are HTML `<span>` elements with inline color styles generated by PHP methods.

---

### 3.6 Entity Detail Views

#### 3.6.1 Invoice Detail Page

**Source:** `resources/views/portal/ninja2020/invoices/show.blade.php` (119 lines)

```
┌─────────────────────────────────────────────────────────┐
│ [Status Banner / Pay Now Form]                          │
│  ├─ "Invoice #123 - Unpaid" (heading)                   │
│  ├─ If payable: payment form with hidden inputs          │
│  │  └─ Pay Now button OR pay-now-dropdown component      │
│  └─ If not payable: status display + view payment link   │
├─────────────────────────────────────────────────────────┤
│ [PDF Viewer]                                             │
│  └─ @livewire('pdf-slot', entity_type: 'invoice')        │
├─────────────────────────────────────────────────────────┤
│ [Attachments]                                            │
│  └─ @include('entity-documents')                         │
├─────────────────────────────────────────────────────────┤
│ [Footer: Required Fields / Signature / Terms]           │
│  ├─ @include('required-fields')                          │
│  ├─ @include('signature')                                │
│  └─ @include('terms')                                    │
└─────────────────────────────────────────────────────────┘
```

#### 3.6.2 Pay Now Button Placement on Detail Pages

**Source:** `invoices/show.blade.php` (lines 60–74) + `pay-now-dropdown.blade.php`

Two scenarios:

**Scenario A: Under/over payment allowed** (`client_portal_allow_under_payment` or `client_portal_allow_over_payment` = true)
```
Position: Top-right of the status banner card
Button: [ Pay Now ] (single submit button, class: "button button-primary bg-primary")
Form action: route('client.invoices.bulk') with action=payment
```

**Scenario B: Standard payment** (default)
```
Position: Top-right of the status banner card
Component: @livewire('pay-now-dropdown', ['total' => invoice->getPayableAmount(), ...])
→ Renders a dropdown with gateway selection
```

#### 3.6.3 Pay Now Dropdown (Gateway Selection)

**Source:** `resources/views/portal/ninja2020/components/livewire/pay-now-dropdown.blade.php` (56 lines)

```
Pay Now Dropdown Structure:
┌────────────────────────────────────┐
│ [ Pay Now ▼ ]                      │  ← Trigger button
│ (bg-primary, button button-primary) │
└────────────┬───────────────────────┘
             ↓ click → open dropdown
┌────────────────────────────────────┐
│ Gateway 1                        │  ← data-company-gateway-id, etc.
│ Gateway 2                        │
│ Custom Gateway (from config)     │
│ ...                              │
└────────────────────────────────────┘
```

**Button trigger:**
- Class: `button button-primary bg-primary inline-flex items-center`
- Text: `ctrans('texts.pay_now')` + chevron-down SVG
- `dusk="pay-now-dropdown"` for testing
- Hidden inputs set gateway ID when a gateway is selected

**Dropdown menu:**
- Positioned: `absolute z-20 right-0 w-56 max-w-[calc(100vw-2rem)] max-h-[60dvh] overflow-y-auto`
- Background: `bg-white rounded-md ring-1 ring-black ring-opacity-5`
- Each item: `block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100`
- Custom gateway: renders `CompanyGateway::getConfigField('name')`
- Mobile payment type: shows Payware badge image
- **No icons in dropdown items** — just text labels

**Conditional rendering:** Entire dropdown is wrapped in `@unless(count($methods) == 0)` — if no payment methods, nothing renders.

#### 3.6.4 Quote Approval Actions (Approve/Reject Buttons)

**Source:** `resources/views/portal/ninja2020/quotes/includes/actions.blade.php` (44 lines)

```
Quote Actions Card Layout:
┌─────────────────────────────────────────────────────────────────────┐
│ Approve / Reject                                                  │  ← heading
├─────────────────────────────────────────────────────────────────────┤
│                                                [ Approve ] [Reject]│
│                                                (buttons, right-justified)│
└─────────────────────────────────────────────────────────────────────┘
```

**Button placement:**
- Container: `sm:flex sm:items-start sm:justify-between`
- Heading: `<h3>` in left column
- Buttons: right column with `sm:flex-shrink-0 flex flex-col sm:flex-row gap-3`
- **Approve button:** `button button-primary bg-primary` — green/primary
- **Reject button:** `button button-danger` — red/danger
- Both: `min-h-11` height, full-width on mobile (`w-full sm:w-auto`)

**Behind-the-scenes:** Hidden forms submit to `route('client.quotes.bulk')` with `action=approve` / `action=reject`. The buttons are `<button type="button">` and JavaScript triggers form submission (`@click` or event listener).

**Additional elements:**
- `@yield('quote-not-approved-right-side')` — slot for additional content in the button area
- Hidden form fields: `signature`, `user_input` — populated via modal dialogs before submission

#### 3.6.5 Document Attachments Section

**Source:** `resources/views/portal/ninja2020/components/entity-documents.blade.php`

- Shows entity-level documents and company-level documents (where `is_public = 1`)
- For invoices: also shows expense documents and task documents
- Each attachment: download link (`button-link text-primary`) + download icon SVG
- Document names truncated to 40 characters via `Str::limit()`
- Icons are inline SVG download symbols (external link icon):
  ```xml
  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
  <polyline points="M15 3 21 3 21 9"></polyline>
  <line x1="10" y1="14" x2="21" y2="3"></line>
  ```

#### 3.6.6 Footer Sections (Detail Pages)

Three include partials at the bottom of entity detail views:

| Section | Source File | Content |
|---|---|---|
| **Required Fields** | `invoices/includes/required-fields.blade.php` | Custom field inputs required before payment |
| **Signature** | `invoices/includes/signature.blade.php` | Canvas-based signature pad (if `require_invoice_signature`) |
| **Terms** | `invoices/includes/terms.blade.php` | Accept/decline terms checkbox |
| **Terms** | `quotes/includes/signature.blade.php` | (quote-specific variant) |
| **Terms** | `quotes/includes/actions.blade.php` | (renders approve/reject if quote) |

---

### 3.7 PDF Viewer Component

**Source:** `resources/views/portal/ninja2020/components/livewire/pdf-slot.blade.php`

The PDF viewer is a Livewire component that renders PDF documents inline:
- Loads PDF from server endpoint
- Uses PDF.js library (same as admin panel)
- Entity-specific: `entity_type` parameter ('invoice', 'credit', 'quote', etc.)
- Access-controlled via `invitation_key` for guest access

---

## 4. Setup Wizard UI

### 4.1 Setup Wizard Flow

**Source:** `resources/views/setup/index.blade.php`, `resources/js/setup/setup.js`

```
Flow:
┌─────────────────────────────────────────────────────────┐
│ 1. System Health Check (always visible first)            │
│    ├─ PHP version check (✔ or version display)          │
│    ├─ Required extensions (✔ or ❌ per extension)        │
│    └─ Env file writable check (✔ or ❌)                   │
├─────────────────────────────────────────────────────────┤
│ 2. Application Settings (always visible)                 │
│    ├─ URL field (APP_URL)                                 │
│    ├─ HTTPS toggle (REQUIRE_HTTPS)                        │
│    └─ Send logs toggle (analytics)                        │
├─────────────────────────────────────────────────────────┤
│ 3. Database Connection (always visible)                  │
│    ├─ Host (default: localhost)                          │
│    ├─ Port (default: 3306)                               │
│    ├─ Database name (default: db-ninja-01)                │
│    ├─ Username (default: ninja)                           │
│    ├─ Password (default: ninja)                           │
│    └─ [ Test Connection ] button                         │
│       ↓ (Axios POST to meta[setup-db-check])             │
│       Success → reveals Account section + Submit wrapper │
│       Failure → shows error in response area             │
├─────────────────────────────────────────────────────────┤
│ 4. Account Creation (hidden until DB test passes)        │
│    ├─ First Name                                          │
│    ├─ Last Name                                           │
│    ├─ Email                                               │
│    └─ Password                                            │
├─────────────────────────────────────────────────────────┤
│ 5. Terms & Submit (revealed after DB test passes)        │
│    ├─ [ ] I agree to Terms of Service                    │
│    ├─ [ ] I agree to Privacy Policy                      │
│    └─ [ Submit ] button                                   │
└─────────────────────────────────────────────────────────┘
```

### 4.2 Setup Wizard — Visual Layout

**Source:** `resources/views/setup/index.blade.php` (lines 5–89), `resources/views/setup/clean_setup.blade.php`

- **Form container:** `div class="container mx-auto mb-10 mt-4"`
- **Form:** `<form action="{{ url('/setup') }}" method="post">`
- **Layout:** `grid grid-cols-12 px-6` — content spans columns 4–9 (`md:col-start-4 md:col-span-6`)
- **Heading:** `<h1 class="text-center text-2xl font-semibold">Invoice Ninja Setup</h1>`
- **Help link:** "Need help?" link to https://forum.invoiceninja.com
- **Error display:** `alert alert-failure` with `<ul><li>` list of validation errors
- **Setup error:** `alert alert-failure` with `<pre>` showing full error trace

### 4.3 Setup Wizard — JavaScript Behavior

**Source:** `resources/js/setup/setup.js` (lines 13–78)

```javascript
class Setup {
    constructor() {
        this.checkDbButton = document.getElementById('test-db-connection');
        this.checkDbAlert = document.getElementById('database-response');
    }

    handleDatabaseCheck() {
        // Collects: db_host, db_port, db_database, db_username, db_password
        // POSTs via Axios to meta[setup-db-check] URL
        this.checkDbButton.disabled = true;

        Axios.post(url, data)
            .then((response) => {
                this.handleSuccess(this.checkDbAlert, 'account-wrapper');
                this.handleSuccess(this.checkDbAlert, 'submit-wrapper');
            })
            .catch((e) => this.handleFailure(this.checkDbAlert, e.response.data.message))
            .finally(() => this.checkDbButton.disabled = false);
    }

    handleSuccess(element, nextStep = null) {
        element.classList.remove('alert-failure');
        element.innerText = 'Success!';
        element.classList.add('alert-success');
        if (nextStep) {
            document.getElementById(nextStep).classList.remove('hidden');  // Reveal next section
            document.getElementById(nextStep).scrollIntoView({behavior: 'smooth', block: 'center'});
        }
    }
}
```

**Progressive reveal logic:**
1. `account-wrapper` div starts with `hidden` class (display: none)
2. `submit-wrapper` div also starts with `hidden` class (display: none)
3. When DB test succeeds → both `hidden` classes removed → smooth scroll to account section
4. All form fields submitted together via single POST to `/setup`

### 4.4 Setup Wizard — Button Placement

| Element | Position | CSS Classes | Behavior |
|---|---|---|---|
| "Test Connection" button | Top-left of DB section | `button button-primary bg-blue-600 py-2 px-3 text-xs` | Axios POST; reveals account+submit sections on success |
| "Submit" button | Bottom-center, in submit-wrapper (initially hidden) | `button button-primary bg-blue-600 w-1/2 my-4` | Submits entire form to `/setup` |
| Terms checkboxes | Above Submit button | `form-checkbox mr-2` + `button-link` | Required for Submit to work |
| DB connection response | Below Test button | `alert py-2 bg-white` | JS-updates with "Success!" or error message |

### 4.5 Setup Wizard — System Health Display

**Source:** `resources/views/setup/_issues.blade.php` (66 lines)

System health check rendered as definition list (`<dl>`) with key/value pairs:

| Check | Display Pattern |
|---|---|
| Required PHP extensions | `<span class="alert {{ ok ? 'alert-success' : 'alert-failure' }}">ExtensionName ✔/❌</span>` |
| PHP version | Success alert (✔) or failure with minimum version shown |
| `.env` writable | Success alert (✔) or failure alert (❌) |

If system health fails (`$check['system_health'] === false`), the database and account forms are NOT shown — only the issues section displays.

---

## 5. Login Portal UI

### 5.1 Admin User Login

**Source:** `resources/views/auth/login.blade.php` (76 lines)

```
┌─────────────────────────────────────────────┐
│              Login                          │  ← card-header
├─────────────────────────────────────────────┤
│ [Session error message]                      │  ← alert alert-danger (if Session::has('error'))
│                                             │
│ E-Mail Address: [___________________]       │  ← form-group, col-md-8
│ Password:       [___________________]       │
│ [ ] Remember Me                              │  ← checkbox
│                                             │
│ [Login]  (Forgot Your Password?)             │  ← btn btn-primary + btn btn-link
└─────────────────────────────────────────────┘
```

**Form structure:**
- Method: POST to `route('client.login.submit')`
- CSRF token included
- Form row pattern: Bootstrap 4 `form-group row` with `col-md-4` label + `col-md-6` input
- Input error styling: `$errors->has('field') ? ' is-invalid' : ''`
- Validation error: `<span class="invalid-feedback"><strong>Error message</strong></span>`

**Button placement:**
- Login button: `col-md-8 offset-md-4` — offset to align with input fields
- Forgot password: `btn btn-link` — inline with Login button

### 5.2 Client Portal Login

**Source:** `resources/views/portal/ninja2020/auth/login.blade.php`

The client portal login uses the same `ninja2020` theme layout:
- Same sidebar/header structure as the rest of the client portal
- Login form rendered within the `ninja2020` layout wrapper
- Fields: email, password
- Additional option: passwordless login (magic link)
- SSO buttons: Google, Microsoft, Apple (if configured)

### 5.3 Login Authentication Methods

**Source:** `app/Http/Controllers/Auth/LoginController.php`, `resources/views/auth/login.blade.php`

| Method | UI Pattern | Entry Point |
|---|---|---|
| **Password** | Email + password form | `POST /api/v1/login` |
| **Passkey (WebAuthn)** | Button labeled "Use Passkey" | `POST /api/v1/login` with `passkey_authentication` payload |
| **Google OAuth** | "Sign in with Google" button | `GET /auth/google` → callback |
| **Microsoft OAuth** | "Sign in with Microsoft" button | `GET /auth/microsoft` → callback |
| **Apple Sign-In** | "Sign in with Apple" button | `POST /api/v1/oauth/login?provider=apple` |
| **OIDC** | "Sign in with [Provider Name]" | `GET /auth/oidc` → callback |
| **Passwordless** | "Send me a magic link" on client portal | Email-based token |

### 5.4 Two-Factor Authentication (TOTP) Entry

**Source:** `app/Http/Controllers/Auth/LoginController.php`

After password verification, if the user has `google_2fa_secret`:
1. Login is paused — no session created yet
2. User is presented with a second form field: `one_time_password`
3. TOTP code verified via `PragmaRX\Google2FA\Google2FA`
4. On success → `finalizeLogin()` executes
5. On failure → 422 error "invalid one_time_password"

**UI pattern:** The TOTP field appears in the same login form (not a separate page). The login button must be clicked again with the 2FA code present.

---

## 6. Update Module UI

### 6.1 Client-Side Update (Flutter Service Worker)

**Source:** `resources/views/index/index.blade.php` (lines 136–189)

```javascript
// Register service worker on page load
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('flutter_service_worker.js?v={{ version }}');
}

// Detect update
registration.addEventListener('updatefound', () => {
    if (registration.installing) {
        registration.installing.addEventListener('statechange', () => {
            if (registration.waiting) {
                if (navigator.serviceWorker.controller) {
                    invokeServiceWorkerUpdateFlow();
                }
            }
        });
    }
});

// Auto-reload on controller change
navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!refreshing) {
        window.location.reload();
        refreshing = true;
    }
});

// Native alert — NOT a custom modal
function invokeServiceWorkerUpdateFlow() {
    const confirmed = alert('New version of the app is available. Refresh now');
    if (confirmed == true) {
        window.location.reload();
    }
}
```

**Update notification UX:**
- Uses **native browser `alert()`** — cannot be styled, blocks all interaction
- Message: "New version of the app is available. Refresh now"
- If user clicks "OK": `window.location.reload()` — hard refresh
- If user clicks "Cancel": update is cached; next page visit triggers auto-reload via `controllerchange` event
- No changelog, no version number shown to user

### 6.2 Server-Side Update (Self-Hosted)

**Source:** `resources/views/vendor/self-update/self-update.blade.php` (empty), `app/Http/Controllers/SelfUpdateController.php`

- Route: `GET|POST /update?secret={key}`
- Access: password-protected via `config('ninja.update_secret')`
- Only for self-hosted (SaaS returns 403)
- View: The blade file is **empty (0 bytes)** — update runs entirely server-side with no HTML UI
- Progress feedback: none (the controller returns JSON `{"message": "Update completed"}`)

---

## 7. Data Import/Export UI

### 7.1 Import Flow

**Source:** `app/Http/Controllers/ImportController.php`, `routes/api.php`

Import is performed via API endpoints from the admin panel (Flutter app):

```
Flow:
1. User selects entity type to import (client, invoice, payment, quote, product, task, expense, vendor, purchase_order, bank_transaction, recurring_invoice)
2. User uploads CSV file
3. POST /api/v1/preimport
   ├─ File cached (32-char random hash key, 20min TTL)
   ├─ CSV parsed (League\Csv\Reader)
   ├─ Headers extracted from first 2 rows
   ├─ setImportHints() — fuzzy field mapping (Levenshtein + keyword matching)
   └─ Returns: { hash, mappings: { entityType: { available, headers, hints } } }
4. UI displays field mapping interface
   ├─ Available fields list (from provider's importable() method)
   ├─ CSV headers detected
   └─ Auto-suggested mappings with confidence scores
5. User confirms/adjusts mappings
6. POST /api/v1/import
   ├─ Validates hash exists in cache
   ├─ Dispatches CSVIngest job (async)
   └─ Returns 202 Accepted
7. UI shows progress / waits for completion
8. Results notification via email + activity log
```

**Import UI patterns (admin panel):**
- File upload with drag-and-drop zone
- Entity type selector dropdown
- Column-to-field mapping grid with:
  - CSV headers in left column
  - Available fields dropdown in right column (pre-populated with auto-hints)
  - Skip/import toggle per column
- Progress indicator for async job
- Results summary: rows imported, rows skipped, errors with inline messages

### 7.2 Import Hint Scoring

**Source:** `ImportController.php` — `setImportHints()` and `getImportHintScore()`

The fuzzy matching system:
1. Gets all `importable()` fields from the entity's provider class
2. Splits dot-notation fields (e.g., `client.number` → nested)
3. For each CSV header column, computes match score against all available fields
4. Returns proposals sorted by score: `{ candidate_field_key, score }`
5. Thresholds: scores above 80 are auto-selected, 50–79 are suggested, below 50 are unmapped

### 7.3 Export Flow

**Source:** `app/Http/Controllers/ExportController.php`, `app/Jobs/Company/CompanyExport.php`

```
Flow:
1. User selects entities to export:
   [x] Clients  [x] Invoices  [ ] Payments  [x] Quotes
   [x] Credits  [ ] Products  [x] Expenses  [x] Vendors
   [x] Purchase Orders  [x] Bank Transactions  [x] Tasks
   [ ] Projects  [x] Users  [x] Tax Rates  [x] Activities
2. POST /api/v1/export
   ├─ Generates UUID hash
   ├─ Calculates TTL (5 hours for >10k activities, 1 hour otherwise)
   ├─ Caches download URL under hash key
   ├─ Dispatches CompanyExport job (async)
   └─ Returns: { message: "Processing", url: "signed_download_url" }
3. UI polls for completion or waits for email notification
4. When ready: user clicks download link
   ├─ Signed URL: GET /export/{hash}
   ├─ CompanyExport job writes JSON files per entity type
   ├─ ZIP archive of all JSON files
   ├─ Stored on export disk
```

**Export UI patterns (admin panel):**
- Entity type checkboxes in a grid or list
- "Export" button → triggers async job
- Status indicator: "Processing..." → "Ready" (with download link)
- Download link uses signed URL with expiring TTL
- Email notification when export is ready

---

## 8. Cross-Application UX Patterns

### 8.1 Button Styling Taxonomy

Across all interfaces, buttons follow a consistent class taxonomy:

| Class | Appearance | Usage |
|---|---|---|
| `button button-primary bg-primary` | White text, primary color background | Primary actions (Pay Now, Submit, Approve) |
| `button button-danger` | White text, red background | Destructive actions (Reject, Cancel, Delete) |
| `button button-primary bg-blue-600` | Blue background (setup wizard) | Form submission |
| `button-link text-primary` | Text-only, primary color | Secondary actions (View, links) |
| `button-link underline` | Underlined text | External/help links |

**Button sizing:**
- Default: `px-4 py-2` (standard)
- Small: `px-2 py-1 text-xs` (table row actions)
- Full-width mobile: `w-full sm:w-auto`

### 8.2 Card Component Pattern

Used universally across setup wizard, entity detail pages, dashboard, and portal views:

```html
<div class="bg-white shadow sm:rounded-lg">
    <div class="px-4 py-5 sm:p-6">
        <div class="sm:flex sm:items-start sm:justify-between">
            <div>[content]</div>
            <div class="mt-5 sm:mt-0 sm:ml-6 sm:flex-shrink-0 [actions]"></div>
        </div>
    </div>
</div>
```

**Key structural elements:**
- Container: `bg-white shadow sm:rounded-lg` (white, drop shadow, rounded corners on desktop)
- Padding: `px-4 py-5 sm:p-6` (responsive — 16px on mobile, 24px on desktop)
- Content layout: `sm:flex sm:items-start sm:justify-between` (flexbox on desktop, stacked on mobile)
- Action area: `mt-5 sm:mt-0 sm:ml-6 sm:flex-shrink-0` (margin-top on mobile, margin-left on desktop)

### 8.3 Status Badge Pattern

Used in table views for entity status display:

```php
// Generated server-side
Invoice::badgeForStatus($status)
└─ Returns: <span class="bg-{color}-100 text-{color}-800 ...">StatusLabel</span>
```

| Status | Color |
|---|---|
| Paid | green (success) |
| Sent | blue (primary) |
| Partial | yellow (warning) |
| Overdue | red (danger) |
| Draft | gray (secondary) |
| Cancelled | gray (secondary) |

### 8.4 Form Field Pattern

Used in setup wizard, login, profile editing:

```html
<div class="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
    <dt class="text-sm leading-5 font-medium text-gray-500">Label*</dt>
    <dd class="mt-1 text-sm leading-5 text-gray-900 sm:mt-0 sm:col-span-2">
        <input type="text" class="input w-full" name="field_name" required>
    </dd>
</div>
```

**Pattern details:**
- Definition list (`<dl>`) with `<dt>` (label) + `<dd>` (input)
- Grid: `sm:grid-cols-3 sm:gap-4` — label in first column, input in remaining two
- Alternating row colors: `bg-gray-50` and `bg-white`
- Required fields marked with `*`
- Input class: `input w-full` (custom CSS, not Tailwind)

---

## 9. Client Portal Routes & Access Patterns

### 9.1 Route Structure

**Source:** `routes/client.php`

```php
Route::group(['prefix' => 'client', 'as' => 'client.', 'middleware' => ['auth:contact', 'locale']], function () {
    Route::get('/dashboard', ...);
    Route::get('/invoices', ...);
    Route::get('/invoices/{invoice}', ...);
    Route::get('/invoices/{invoice}/payment', ...);
    Route::post('/invoices/payment', ...);
    Route::get('/invoices/{invoice}/download', ...);
    Route::post('/invoices/bulk', ...);
    Route::get('/quotes', ...);
    Route::get('/quotes/{quote}', ...);
    Route::post('/quotes/bulk', ...);
    Route::get('/credits', ...);
    Route::get('/payments', ...);
    Route::get('/payment_methods', ...);
    Route::get('/recurring_invoices', ...);
    Route::get('/documents', ...);
    Route::get('/tasks', ...);
    Route::get('/projects', ...);
    Route::get('/statement', ...);
    Route::get('/subscriptions', ...);
    Route::get('/profile', ...);
    Route::post('/logout', ...);
});
```

### 9.2 Guest Access Patterns

Invoices, quotes, and credits can be viewed without login via invitation keys:
- `GET /view/{type}/{key}/{invitation_key}` — public view
- Token-based access via `InvoiceInvitation`, `QuoteInvitation`, `CreditInvitation` models
- Full UI renders (same Blade templates) but with different action availability

---

## 10. Responsive Behavior Matrix

| Screen Size | Sidebar | Header | Table Columns | Action Buttons |
|---|---|---|---|---|
| **Mobile (< 768px)** | Hamburger → slide-out drawer | Hamburger + title + profile | Reduced (hides some columns) | Full-width buttons |
| **Tablet (768–1024px)** | Desktop sidebar visible | Full header | Standard columns | Inline buttons |
| **Desktop (> 1024px)** | Desktop sidebar visible | Full header | All columns | Inline buttons |

---

## 11. Component Interaction Summary

### 11.1 Livewire Components

| Component | Location | Purpose |
|---|---|---|
| `invoices-table` | `app/Livewire/InvoicesTable.php` | Client invoice list with sorting, filtering, pagination |
| `pay-now-dropdown` | `app/Livewire/PayNowDropdown.php` | Gateway selection dropdown for payments |
| `pdf-slot` | `app/Livewire/PdfSlot.php` | PDF document viewer with download |
| `credits-table` | `app/Livewire/CreditsTable.php` | Client credit list |
| `quotes-table` | `app/Livewire/QuotesTable.php` | Client quote list with approval status |
| `payments-table` | `app/Livewire/PaymentsTable.php` | Payment history list |
| `payment-methods-table` | `app/Livewire/PaymentMethodsTable.php` | Saved payment methods management |
| `recurring-invoices-table` | `app/Livewire/RecurringInvoicesTable.php` | Recurring invoice templates list |
| `subscriptions-table` | `app/Livewire/SubscriptionsTable.php` | Subscription management |
| `tasks-table` | `app/Livewire/TasksTable.php` | Time-tracking tasks list |
| `projects-table` | `app/Livewire/ProjectsTable.php` | Projects list |
| `documents-table` | `app/Livewire/DocumentsTable.php` | Document attachments list |
| `purchase-orders-table` | `app/Livewire/PurchaseOrdersTable.php` | Purchase orders list |

### 11.2 Alpine.js Components

| Scope | Component | Behavior |
|---|---|---|
| Dropdown menus | `x-data="{ open: false }"` | `@click="open = !open"`, `@click.outside="open = false"`, `@keydown.window.escape="open = false"` |
| Mobile sidebar | `x-data="{ sidebarOpen: false }"` | Slide-in drawer with transform transitions |
| Pay Now dropdown | `x-data="{ open: false }"` | Absolute-positioned gateway list |
| Profile dropdown | `x-data="{ open: false }"` | Transitioned dropdown with fade/scale |
| Contact switcher | `x-data="{ open: false }"` | Scrollable contact list |

### 11.3 Shared Blade Components

| Component | Path | Used On |
|---|---|---|
| Layout wrapper | `portal/ninja2020/layout/app.blade.php` | All client portal pages |
| Sidebar main | `portal/ninja2020/components/general/sidebar/main.blade.php` | Wraps desktop + mobile |
| Sidebar desktop | `portal/ninja2020/components/general/sidebar/desktop.blade.php` | Client portal (desktop) |
| Sidebar mobile | `portal/ninja2020/components/general/sidebar/mobile.blade.php` | Client portal (mobile) |
| Header bar | `portal/ninja2020/components/general/sidebar/header.blade.php` | All client portal pages |
| Footer | `portal/ninja2020/components/general/footer.blade.php` | All client portal pages |
| Success message | `portal/ninja2020/components/general/messages/success.blade.php` | Flash messages |
| Pop-up dialog | `portal/ninja2020/components/general/pop-up.blade.php` | Modal dialogs |
| Processing | `portal/ninja2020/components/processing.blade.php` | Loading state |

---

## 12. UI State Management

### 12.1 Client Portal State

| State | Persistence | Source |
|---|---|---|
| Sidebar open/closed (mobile) | Alpine.js in-memory | `x-data="{ sidebarOpen: false }"` |
| Dropdown open/closed | Alpine.js in-memory | `x-data="{ open: false }"` |
| Selected table rows | Livewire component state | `$selected` array in component |
| Active filters | Livewire URL params | `wire:model.live` on per_page, status checkboxes |
| Sort column | Livewire URL params | `sortBy()` method |
| Current page | Livewire URL params | `pagination` |
| Multiple contacts context | Session | `session()->get('multiple_contacts')` |

### 12.2 Admin Panel State

| State | Persistence | Source |
|---|---|---|
| Service worker registration | Browser storage | `navigator.serviceWorker.register()` |
| Update available | Service worker | `registration.waiting` |
| User session | HTTP-only cookie | Laravel session |
| Company context | App state | `data-company`, `data-user` attributes |
| White-label mode | App state | `data-white_label` attribute |

---

## 13. Internationalization (i18n) Patterns

**Source:** Throughout Blade templates via `ctrans()` function

- All UI text uses `ctrans('texts.key_name')` for translation
- Fallback to English if translation key missing
- Language files in `lang/` directory
- RTL support: HTML `dir` attribute set based on locale
- Date/time formatting: `translateDate()` method uses client's `date_format()` and `locale()`
- Currency formatting: `Number::formatMoney()` with client's currency settings

---

## 14. Client Portal Customization

### 14.1 CSS Customization via Data Attributes

**Source:** Client Portal documentation, `resources/views/portal/ninja2020/components/`

The ninja2020 theme exposes `data-portal-target` attributes for CSS targeting. Administrators can inject custom CSS via **Settings → Client Portal → Customize → Custom CSS**.

| Target | Selector | Purpose |
|---|---|---|
| Signed-in layout | `[data-portal-target="shell"]` | Full portal container |
| Header | `[data-portal-target="header"]` | Top bar |
| Sidebar | `[data-portal-target="sidebar"]` | Navigation sidebar |
| Sidebar variant | `[data-portal-variant="desktop"]` or `[data-portal-variant="mobile"]` | Target specific sidebar variant |
| Navigation menu | `[data-portal-target="navigation"]` | Nav links container |
| Navigation links | `[data-portal-target="navigation-link"]` | Individual nav items |
| Active nav link | `[data-portal-target="navigation-link"][aria-current="page"]` | Currently selected page |
| Company logo | `[data-portal-target="logo"]` | Logo in sidebar |
| Main content | `[data-portal-target="content"]` | Page content area |
| Page heading | `[data-portal-target="page-header"]` | Page title area |
| Footer | `[data-portal-target="footer"]` | Portal footer |
| Entity tables | `[data-portal-target="table"]` | Data tables |
| Table variant | `[data-portal-table="invoices"]`, `[data-portal-table="quotes"]`, `[data-portal-table="payments"]`, `[data-portal-table="credits"]`, `[data-portal-table="recurring-invoices"]`, `[data-portal-table="payment-methods"]`, `[data-portal-table="documents"]`, `[data-portal-table="projects"]`, `[data-portal-table="tasks"]`, `[data-portal-table="subscriptions"]`, `[data-portal-table="purchase-orders"]` | Type-specific table styling |
| Pagination | `[data-portal-target="pagination"]` | Page navigation |

### 14.2 Custom CSS Theme Variables

**Source:** Client Portal documentation

The portal supports 13 CSS color variables for theming. Available as copy-and-paste themes:

| Variable | Purpose |
|---|---|
| `--portal-primary` | Primary color (buttons, active nav) |
| `--portal-secondary` | Secondary color |
| `--portal-background` | Page background |
| `--portal-card-bg` | Card backgrounds |
| `--portal-text` | Primary text color |
| `--portal-text-secondary` | Secondary text |
| `--portal-border` | Border color |
| `--portal-input-bg` | Form input background |
| `--portal-input-border` | Form input border |
| `--portal-table-header` | Table header background |
| `--portal-table-row` | Table row background |
| `--portal-table-row-hover` | Table row hover |
| `--portal-footer-bg` | Footer background |

**10 pre-built themes** available as copy-paste CSS blocks:
1. Default (Invoice Ninja blue)
2. Dark
3. Minimal
4. Corporate
5. Warm
6. Cool
7. Branded
8. High contrast
9. Soft
10. Classic

### 14.3 Client Portal Login Options

**Source:** `resources/views/portal/ninja2020/auth/login.blade.php`, client portal docs

| Login Method | Description |
|---|---|
| **Password** | Email + password form |
| **Magic Link** | Passwordless — "Send me a magic link" email |
| **Google OAuth** | "Sign in with Google" |
| **Microsoft OAuth** | "Sign in with Microsoft" |
| **Apple Sign-In** | "Sign in with Apple" |
| **SSO/OIDC** | Generic OIDC provider |

**Magic link flow:**
1. User enters email
2. System sends email with secure link
3. User clicks link → authenticated in portal
4. No password stored or required

### 14.4 Client Portal Registration

- Self-registration can be enabled: `Settings → Client Portal → Registration`
- When enabled, clients can create their own accounts
- Uses same `ninja2020` layout with sidebar/header structure
- Registration form captures: first name, last name, email, company name, address

### 14.5 Client Portal Profile & Settings Editing

**Source:** `resources/views/portal/ninja2020/profile/settings/general.blade.php`

Authenticated clients can edit their profile via **Profile → Settings** in the sidebar. The settings UI uses a **two-column form layout** pattern:

```
┌─────────────────────────────────────────────────────┐
│  Contact Details                                    │  ← Section heading (left column)
│  ┌───────────┐ ┌─────────────────────────────────┐  │
│  │  Section  │ │  [First Name] [Last Name]       │  │
│  │  Label    │ │  [Email Address]                │  │
│  │  (Left)   │ │  [Phone]                        │  │
│  │  col-span-1│ │  [Password] [Confirm Password]  │  │
│  └───────────┘ │  ┌──────────────────────────┐   │  │
│                │  │  [Save]                    │   │  │
│                │  └──────────────────────────┘   │  │
│                └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Available settings pages (sidebar navigation):**

| Page | Source File | Fields |
|---|---|---|
| General | `profile/settings/general.blade.php` | First/last name, email, phone, password, password confirmation |
| Name & Website | `profile/settings/name-website-logo.blade.php` | Company name, website, logo upload |
| Personal Address | `profile/settings/personal-address.blade.php` | Address line 1, line 2, city, state, zip, country |
| Shipping Address | `profile/settings/shipping-address.blade.php` | Same address fields for shipping |
| Custom Fields | `profile/settings/custom-fields.blade.php` | Dynamically rendered custom fields |

**Form pattern details:**
- Layout: `md:grid md:grid-cols-3` — 1 column label, 2 columns form
- Form: `wire:submit="submit"` + `@method('PUT')` — Livewire reactive update
- Validation: `@error('field')` → `<div class="validation validation-fail">` with message
- Required field highlighting: `session('missing_required_fields')` → `border border-red-400`
- Submit button: `button button-primary bg-primary` in `px-4 py-3 bg-gray-50` footer bar

### 14.6 Billing Portal v3 Cart Flow

---

## 15. Document Templates UI

### 15.1 Template System

**Source:** Client Portal documentation, `resources/views/pdf/`, `resources/views/templates/`

The template system uses **HTML/CSS + Twig** with `<ninja>` tags for Twig code:

```
Template creation flow:
┌─────────────────────────────────────────────────┐
│  Settings > Invoice Design > Custom Designs      │
├─────────────────────────────────────────────────┤
│  1. Enter template name                          │
│  2. Select type: [✓] Regular Design [ ] Template │
│     (Template = enables Twig syntax)            │
│  3. Select associated data types:               │
│     [✓] Invoice  [✓] Quote  [ ] Credit           │
│     [ ] Purchase Order  [ ] Client              │
│  4. Write HTML/CSS + Twig in editor              │
└─────────────────────────────────────────────────┘
```

### 15.2 Template Association (Menu Placement)

When creating a template, you select which entity types it applies to via checkboxes:
- This determines **where the template appears** in the UI:
  - Invoice templates → "Download" dropdown on invoice views
  - Statement templates → "Generate Statement" on client views
  - Payment receipt templates → "Email Receipt" on payment views
  - Delivery note templates → "Delivery Note" on invoice views

### 15.3 Prebuilt Templates

**Source:** `resources/views/pdf/design1.blade.php`, `resources/views/pdf/design2.blade.php`

| Template | Type | Description |
|---|---|---|
| **Design 1** | Invoice/Quote | Standard clean layout |
| **Design 2** | Invoice/Quote | Vertical layout with colored sections |
| **Stub** | PDF | Minimal stub for testing |

### 15.4 Statement Templates

| Template Code | Name | Preview |
|---|---|---|
| TS1 | Plain Statement | Download |
| TS2 | Color Statement | Download |
| TS3 | Vertical Statement | Download |
| TS4 | Logo Statement | Download |

**Source:** `resources/views/templates/entity/td15.html` and other template files

Templates use CSS variables for primary/secondary colors and page margins. They include:
- Company/client details sections
- Itemized product/table sections
- Totals section with tax breakdown
- Footer with payment terms
- Markdown support within Twig `<ninja>` blocks

---

## 16. Billing Portal vs. Client Portal vs. Guest Views

**Source:** `resources/views/billing-portal/`, `resources/views/portal/ninja2020/`, `resources/views/themes/ninja2020/view_entity/`

| Portal | URL Prefix | Theme | Authentication | Primary Users |
|---|---|---|---|---|
| **Admin Panel** | `/` | Flutter (compiled) | User login | Admin, staff |
| **Client Portal** | `/client/` | ninja2020 (Blade+Livewire) | Contact login | Clients, vendors |
| **Billing Portal v3** | `/billing-portal/v3/` | Custom (Blade) | No (guest checkout) | Anonymous customers |
| **Guest View** | `/view/{type}/{key}/{invitation}` | ninja2020 `view_entity` theme | Token-based | Anyone with link |
| **Legacy Theme** | `/themes/ninja2020/` | Blade (original) | Token-based | Legacy document view |

### 16.1 Guest Invoice View

**Source:** `resources/views/themes/ninja2020/view_entity/password.blade.php`

- Unauthenticated invoice/quote/credit view via secure token
- May be password-protected if company enables it
- Shows: entity details, PDF, payment form (if payable)
- Same UI components (pay-now-dropdown, pdf-slot) but without sidebar/header

### 16.2 Invoice Email Actions

When invoices are emailed, the email template includes action buttons:

| Button | URL Pattern |
|---|---|
| **View Invoice** | `client/invoice/{hashed_id}/{invitation_key}` |
| **Pay Now** | `client/invoice/payment/{hashed_id}/{invitation_key}` |
| **Download PDF** | `client/invoice/{key}/download` |
| **View Quote** | `client/quote/{hashed_id}/{invitation_key}` |
| **Approve Quote** | `client/quote/{key}/approve/{invitation_key}` |
| **Reject Quote** | `client/quote/{key}/reject/{invitation_key}` |

**Source:** `resources/views/email/components/button.blade.php`

---

## 17. Notification & Feedback Patterns

### 17.1 Success Notifications

**Source:** `resources/views/portal/ninja2020/components/general/messages/success.blade.php`

```blade
@if(session()->has('success'))
    <div class="alert alert-success">
        {{ session('success') }}
    </div>
@endif
```

- Green alert banner at top of main content area
- Appears after successful form submissions (payment, approval, etc.)
- Auto-dismissable (via session flash)

### 17.2 Error Notifications

```blade
@if($errors->any())
    <div class="alert alert-failure">
        <ul>
            @foreach($errors->all() as $error)
                <li>{{ $error }}</li>
            @endforeach
        </ul>
    </div>
@endif
```

- Red alert banner with bulleted error list
- Appears at top of form/page content

### 17.3 Processing/Loading States

**Source:** `resources/views/portal/ninja2020/components/processing.blade.php`

- Spinner overlay for Livewire async operations
- Shown during: payment processing, form submission, data loading
- Uses `wire:loading` directive for Livewire components
- Disables underlying buttons: `wire:loading.attr="disabled"`

### 17.4 Payment Processing States (Flow2)

**Source:** `resources/views/portal/ninja2020/flow2/` directory (7 files)

The Flow2 payment flow uses a **two-column layout**:

```
┌───────────────────────────────────────────────────────┐
│  Invoice Summary (left)     Payment Step (right)     │
│  ┌──────────────────────┐    ┌─────────────────────┐   │
│  │  Line items table    │    │  Step component     │   │
│  │  Subtotal / Tax /    │    │  (dynamically        │   │
│  │  Total / Balance     │    │   rendered)         │   │
│  └──────────────────────┘    │                     │   │
│                              │  [Continue/Navigate]│   │
│                              └─────────────────────┘   │
└───────────────────────────────────────────────────────┘
```

**Flow2 component files and their roles:**

| File | Component | Render Mode | Purpose |
|---|---|---|---|
| `invoice-pay.blade.php` | Layout wrapper | Two-column or full-width | Switches layout based on `$this->component` |
| `invoices-summary.blade.php` | `flow2.invoice-summary` | Left column (always) | Invoice line items, subtotal, tax, total |
| `payment-method.blade.php` | `flow2.payment-method` | Right column | Gateway selection |
| `required-fields.blade.php` | `flow2.required-fields` | Right column | Name, address, custom fields |
| `under-over-payments.blade.php` | `flow2.under-over-payments` | Right column | Payment amount adjustment |
| `docu-ninja.blade.php` | `flow2.docu-ninja` | Full-width | Signature capture (DocuSign or canvas pad) |
| `docu-ninja-loader.blade.php` | `flow2.docu-ninja-loader` | Full-width | Loader for DocuSign redirect |

**Conditional rendering logic** (from `invoice-pay.blade.php`):
- If component is `DocuNinja` or `DocuNinjaLoader` → **full-width** (single column, no summary on left)
- All other components → **two-column** (summary left, form component right)

**Step navigation:**
- Component is conditionally set via `$this->component` property on the Livewire parent
- Each step renders inside `<div wire:key="step-{{ ... }}">` for Livewire reactivity
- Right column receives focus automatically: `tabindex="-1"` + `$el.focus()` on `x-init`
- Mobile: scrolls into view with `scrollIntoView({ block: 'nearest' })`

**Error handling:**
- `@if($errors->any())` → renders `alert alert-error` with bulleted list above the component
- `session()->forget('errors')` called after display to prevent duplicates on Livewire re-render

**Billing Portal v3 cart structure** (from `cart.blade.php`):

| Cart Section | Livewire Component | Purpose |
|---|---|---|
| One-time products | `billing-portal.cart.one-time-products` | Add-ons with one-time charge |
| Recurring products | `billing-portal.cart.recurring-products` | Subscription line items |
| Optional recurring | `billing-portal.cart.optional-recurring-products` | Optional subscription add-ons |
| Optional one-time | `billing-portal.cart.optional-one-time-products` | Optional one-time add-ons |
| Coupon | `billing-portal.cart.coupon` | Discount code entry |

**Billing Portal v3 Authentication Views:**
- `authentication/login.blade.php` — Login form
- `authentication/register.blade.php` — Registration page
- `authentication/register-form.blade.php` — Registration form fields
- `authentication/register-or-login.blade.php` — Choice screen (guest checkout)

**Billing Portal v3 Payments:**
- `payments/methods.blade.php` — Payment method management (saved cards, etc.)

**Source:** `resources/views/billing-portal/v3/` directory

---

## 18. Vendor Portal UI

**Source:** `resources/views/portal/ninja2020/components/general/sidebar/vendor_main.blade.php`, `resources/views/portal/ninja2020/components/general/sidebar/vendor_desktop.blade.php`, `app/Http/Controllers/VendorPortal/`

The vendor portal shares the **same ninja2020 Blade theme** as the client portal but uses:
- Authentication guard: `auth()->guard('vendor')`
- Separate route files in `routes/vendor.php`
- Vendor-specific sidebar/header/footer components

### 18.1 Vendor Portal Navigation

Vendor sidebar menu (from `PurchaseOrderController::sidebarMenu()`):

| Menu Item | Route | Icon | Condition |
|---|---|---|---|
| **Purchase Orders** | `vendor.purchase_orders.index` | `file-text` | `MODULE_PURCHASE_ORDERS & $enabled_modules` |

The vendor portal currently only exposes **Purchase Orders** in the sidebar — all other modules (invoices, quotes, payments, etc.) are hidden. This is by design — vendors only interact with purchase orders.

### 18.2 Vendor Portal Authentication

- Login: `resources/views/portal/ninja2020/auth/vendor_login.blade.php`
- Guard: `vendor` (separate from `web` and `contact` guards)
- Password + magic link options (same as client portal)
- No self-registration (vendors are invited by the company)

### 18.3 Vendor Portal Purchase Order Flow

```
Vendor Portal → Purchase Orders List → Purchase Order Detail
```

Purchase Order Detail screen includes:
- PO header with status, vendor info, company info
- Line items table
- Signature capture (conditional on `require_purchase_order_signature`)
- DocuSign integration (`docuninja_active`)
- Accept / Reject bulk actions
- Download PDF / Download ZIP (multiple)

### 18.4 Purchase Order Acceptance Flow

**Source:** `resources/views/portal/ninja2020/purchase_orders/includes/actions.blade.php`

The PO acceptance uses a form-based pattern:

```html
<form action="vendor.purchase_orders.bulk" method="post" id="accept-form">
    <input type="hidden" name="action" value="accept">
    <input type="hidden" name="process" value="true">
    <input type="hidden" name="purchase_orders[]" value="hashed_id">
    <div class="bg-white shadow sm:rounded-lg">
        <button type="button" class="button button-primary bg-primary"
                id="accept-button">Accept</button>
    </div>
</form>
```

- Same card pattern as quote approval: `bg-white shadow sm:rounded-lg` + `px-4 py-5 sm:p-6`
- Button has `onclick="setTimeout(() => this.disabled = true, 0); return true;"` — immediate disable to prevent double-submit
- Form uses `@csrf` for security
- Action determined by hidden `action` field: `accept` or (implicitly) `reject`

### 18.5 Purchase Order Statuses

| Status | Color | Actions Enabled |
|---|---|---|
| Draft | Gray | Accept (disabled) |
| Sent | Blue | Accept, Reject, Download |
| Accepted | Green | Download, View PDF |
| Cancelled | Gray | None |

**Source:** `app/Models/PurchaseOrder.php`

### 18.6 Vendor Portal Additional Views

| View | Source File | Purpose |
|---|---|---|
| Vendor Profile Edit | `vendor_profile/edit.blade.php` | Edit vendor contact information |
| Purchase Orders List | `vendor/purchase_orders/index.blade.php` | Table of POs with status badges |
| Purchase Order Detail | `vendor/purchase_orders/show.blade.php` | Full PO view with line items |
| Purchase Order Fullscreen | `vendor/purchase_orders/show-fullscreen.blade.php` | Print-friendly PO view |
| Pagination | `vendor/pagination.blade.php` | Vendor-specific pagination |
| Upload | `purchase_orders/includes/upload.blade.php` | Document upload form |

---

## 19. Flutter Admin Portal Entity Viewing

**Source:** `github.com/invoiceninja/admin-portal` (DeepWiki analysis), `docs/detail-screen-layout.md`

The Flutter admin portal uses a `ViewScaffold` pattern for all entity detail screens, distinct from the Blade-rendered client/vendor portals.

### 19.1 ViewScaffold Architecture

Every entity view follows this scaffold structure:

```
ViewScaffold
├── AppBar (title, back/close button, edit button)
├── AppBarBottom (TabBar with dynamic tabs)
├── TabBarView Body
│   ├── Overview tab
│   ├── Details tab
│   ├── Documents tab (conditional on module)
│   ├── Activity tab
│   └── Entity-specific tabs
└── BottomButtons (Primary/Secondary actions)
```

The `ViewScaffold` accepts:
- `entity`: The entity being displayed
- `body`: Main content widget
- `appBarBottom`: Optional TabBar
- `isFilter`: Whether in filter mode
- `isEditable`: Controls edit button visibility

### 19.2 Entity-Specific Tab Configurations

| Entity Type | Tabs (in order) |
|---|---|
| **Invoice** | Overview, Details, Documents, History/Schedule (if recurring), Activity |
| **Client** | Overview, Details, Documents, Locations, Ledger, Activity, System Logs |
| **Expense** | Overview, Documents, Schedule (if recurring) |
| **Task** | Overview, Documents, Schedule (if recurring) |
| **Product** | Overview, Documents |
| **Project** | Overview, Documents |
| **Vendor** | Overview, Documents |
| **Payment** | Overview, Documents, Activity |

**Conditional tabs** are shown based on:
- Module enablement: `company.isModuleEnabled(EntityType.document)` → Documents tab
- Recurring state: entity has schedule → Schedule/History tab
- Entity status: certain actions only appear in BottomButtons based on status

### 19.3 Bottom Buttons Pattern

The `BottomButtons` component renders primary and secondary actions based on entity state and user permissions:

| Entity | Primary Action | Secondary Actions |
|---|---|---|
| Invoice (sent) | New Payment | View PDF, Send Email, Archive |
| Invoice (paid) | View PDF | Send Email, Credit |
| Task (running) | Start/Stop | Resume, Mark as Viewed |
| Client | View Statement | Send Email, Archive |
| Purchase Order (sent) | Accept/Reject | Download PDF, Mark as Viewed |

### 19.4 State Management for Views

- Tab index persisted per entity type: `invoiceUIState.tabIndex`, `clientUIState.tabIndex`, etc.
- Tab changes dispatch Redux actions (`UpdateTabAction`)
- Pull-to-refresh wrapped in `RefreshIndicator` on all tab content
- Entity loading via `LoadEntityAction` dispatched on view init

### 19.5 Key Flutter UI Components

| Component | File Path | Purpose |
|---|---|---|
| `ViewScaffold` | `lib/ui/app/view_scaffold.dart` | Base entity view layout |
| `ListScaffold` | `lib/ui/app/list_scaffold.dart` | Entity list layout |
| `EntityHeader` | `lib/ui/invoice/view/invoice_view_overview.dart` | Status, title, value display |
| `FieldGrid` | `lib/ui/app/FieldGrid.dart` | Two-column field display |
| `EntityListTile` | `lib/ui/app/entities/entity_list_tile.dart` | Related entity list items |
| `BottomButtons` | `lib/ui/app/BottomButtons.dart` | Bottom action bar |
| `HistoryDrawer` | `lib/ui/app/history_drawer.dart` | Sidebar drawer for entity history |

---

## 20. Reports & Analytics UI (Flutter Admin Portal)

**Source:** `github.com/invoiceninja/admin-portal` — `lib/ui/reports/`, DeepWiki analysis

The Reports system provides business intelligence across all entity types with filtering, grouping, charting, and CSV export.

### 20.1 Report Types

| Report Type | Enum | Source File | Key Fields |
|---|---|---|---|
| **Client** | `kReportClient` | `lib/ui/reports/client_report.dart` | Client name, email, balance, total, number |
| **Invoice** | `kReportInvoice` | `lib/ui/reports/invoice_report.dart` | Invoice number, date, due date, amount, balance, status |
| **Payment** | `kReportPayment` | `lib/ui/reports/payment_report.dart` | Payment date, amount, method, invoice number |
| **Expense** | `kReportExpense` | `lib/ui/reports/expense_report.dart` | Date, amount, category, vendor, project |
| **Task** | `kReportTask` | `lib/ui/reports/task_report.dart` | Date, duration, description, project |
| **Quote** | `kReportQuote` | `lib/ui/reports/quote_report.dart` | Number, date, amount, status, expiration |
| **Credit** | `kReportCredit` | `lib/ui/reports/credit_report.dart` | Number, date, amount, remaining |
| **Profit & Loss** | `kReportProfitAndLoss` | `lib/ui/reports/profit_loss_report.dart` | Revenue, expenses, net income |

Additional reports (from file listing): Product, Document, Purchase Order, Recurring Invoice, Recurring Expense, Tax, User, Subscription

### 20.2 ReportsScreen Component

**Source:** `lib/ui/reports/reports_screen.dart` (741 lines)

Key functionality:
- Report type selection via `AppDropdownButton`
- Date range filtering with custom date picker support
- Grouping and subgrouping options (e.g., group by client, then by month)
- Chart visualization toggle (bar/column charts from report data)
- Column customization through `multiselectDialog` (select which columns to show)
- CSV export via `reports_screen_vm.dart` (lines 472–558)

**Report data filtering:**
- String matching: case-insensitive contains
- Numeric range filtering (e.g., amount between X and Y)
- Boolean value matching
- Date range filtering with custom date support
- Age group filtering for invoice aging buckets

### 20.3 Dashboard Module

**Source:** `lib/ui/dashboard/dashboard_panels.dart`, `lib/ui/dashboard/dashboard_chart.dart`

Dashboard is organized into **configurable sections** based on enabled modules. Each section shows:
- Current period totals and counts
- Average values
- Percentage changes (vs. previous period)
- Interactive chart selection (drill-down from chart to entity list)

Chart data processing includes:
- Currency conversion for multi-currency companies
- Date grouping (day, month, year)
- Status-based categorization (active, outstanding, paid, etc.)
- Entity mapping for drill-down (click chart → navigate to filtered list)

### 20.4 Settings Navigation Structure

**Source:** `lib/ui/settings/settings_list.dart` (327 lines), DeepWiki analysis

Settings organized into categorized sections with tab-based navigation:

| Category | Screen Component | Key Configuration Areas |
|---|---|---|
| **Company Details** | `CompanyDetails` | Name, VAT number, address, logo, default terms |
| **Payment Settings** | `PaymentSettings` | Gateway configuration, auto-billing, payment terms |
| **Tax Settings** | `TaxSettings` | Tax rates, inclusive taxes, tax calculation rules |
| **Workflow Settings** | `WorkflowSettings` | Auto-email, invoice locking, quote conversion rules |
| **Invoice Design** | `InvoiceDesignSettings` | Template selection, colors, fonts, PDF settings (1267 lines) |
| **Client Portal** | `ClientPortalSettings` | Portal theme, login options, custom CSS, registration |
| **Custom Fields** | `CustomFieldsSettings` | Entity custom field configuration |
| **Device Settings** | `DeviceSettings` | Sidebar mode, dark mode, table density, tooltips |
| **Email Settings** | `EmailSettings` | SMTP config, email templates, sending options |
| **Localization** | `LocalizationSettings` | Language, timezone, date/time formats |
| **Generated Numbers** | `GeneratedNumbersSettings` | Invoice/quote/PO number patterns, prefixes |
| **Task Settings** | `TaskSettings` | Task billing rates, rounding, time formats |
| **Account Management** | `AccountManagement` | Plan, billing, subscription, users |

**Settings Inheritance Flow:** Company defaults → Group overrides → Client overrides → User preferences (per-device)

**Settings Persistence:** Business settings stored server-side via `SaveSettings` action; device preferences cached locally via `SharedPreferences`. Debounced saves prevent excessive API calls.

**Settings Search:** Maps over 200 configuration fields across all setting sections; searchable in user's preferred language via `lib/utils/i18n.dart` (6328 lines of translations).

---

## 21. Flow2 Payment Livewire Components

**Source:** `app/Livewire/Flow2/` directory (9 components)

The Flow2 payment processing system is composed of modular Livewire components, each handling a discrete step:

| Component | Class File | Blade View | Step in Flow | Conditional Trigger |
|---|---|---|---|---|
| **Invoice Summary** | `Flow2/InvoiceSummary.php` | `flow2/invoices-summary.blade.php` | Left column (always visible) | No — always shown |
| **Pay Now** | `Flow2/InvoicePay.php` | `flow2/invoice-pay.blade.php` | Layout wrapper | Wraps all steps below |
| **Payment Method** | `Flow2/PaymentMethod.php` | `flow2/payment-method.blade.php` | 1st step | Always (unless direct gateway link) |
| **Required Fields** | `Flow2/RequiredFields.php` | `flow2/required-fields.blade.php` | 2nd step | `$company->getSetting('require_billing_address')` |
| **Under/Over Payment** | `Flow2/UnderOverPayment.php` | `flow2/under-over-payments.blade.php` | 3rd step | `client_portal_allow_under_payment` or `client_portal_allow_over_payment` |
| **Signature** | `Flow2/Signature.php` | `flow2/docu-ninja.blade.php` | 4th step | `$company->getSetting('require_invoice_signature')` |
| **DocuSign Loader** | `Flow2/DocuNinjaLoader.php` | `flow2/docu-ninja-loader.blade.php` | 4th step (alt) | DocuSign active + signature required |
| **Terms Acceptance** | `Flow2/Terms.php` | `flow2/terms.blade.php` | 5th step | `$company->getSetting('show_accept_invoice_terms')` |
| **Process Payment** | `Flow2/ProcessPayment.php` | (no blade — redirects to gateway) | Final step | Triggers on form submit |

**Component communication:**
- Parent `InvoicePay` component dynamically swaps child components based on `$this->component` property
- Each child component receives `_key` (invitation key) and `invitation_id` as parameters
- Livewire events (`purchase.submit`, `purchase.next`) coordinate navigation between steps
- Left column (`InvoiceSummary`) uses `wire:poll` for real-time total updates

---

## 22. Areas Still Requiring Research

| # | Area | Why It Matters for ManaGest | Next Steps |
|---|---|---|---|
| 1 | **Mobile App UI (iOS/Android)** | Flutter compiles to mobile; mobile-specific layouts differ from web (`lib/ui/app/layout/`) | Load Flutter repo, inspect `AppBar` `center` property and `Scaffold` mobile adaptations |
| 2 | **Notification Center** | Real-time in-app notifications for invoice views, payment confirmations | Inspect `lib/ui/notification_center/` in Flutter repo |
| 3 | **Calendar/Scheduler UI** | Task scheduling, recurring invoice schedule visualization | Inspect `lib/ui/scheduler/` in Flutter repo |
| 4 | **Email Template Editor** | WYSIWYG editor for customizing invoice/quote email templates | Inspect `lib/ui/settings/email_template/` in Flutter repo |
| 5 | **User/Roles Management UI** | Multi-user permission system, role-based access control | Inspect `lib/ui/user/` in Flutter repo + `app/Http/Controllers/Auth/` in Laravel |
| 6 | **Bulk Action UI (Admin)** | Multi-select with action toolbar in Flutter admin panel | Inspect `lib/ui/app/entities/entity_action_bar.dart` in Flutter repo |
| 7 | **Custom Field Builder UI** | Dynamic form field configuration for entities | Inspect `lib/ui/app/custom_field/` in Flutter repo |
| 8 | **Webhooks/Integration UI** | Third-party integration configuration and webhook management | Inspect `lib/ui/integration/` in Flutter repo |

**Component communication:**
- Parent `InvoicePay` component dynamically swaps child components based on `$this->component` property
- Each child component receives `_key` (invitation key) and `invitation_id` as parameters
- Livewire events (`purchase.submit`, `purchase.next`) coordinate navigation between steps
- Left column (`InvoiceSummary`) uses `wire:poll` for real-time total updates

---

## 23. Entity Detail View Patterns

**Source:** All `resources/views/portal/ninja2020/*/show.blade.php` and `vendor/` equivalents

### 24.1 Consistent Detail Page Structure

Every entity detail page (invoice, quote, credit, payment, subscription, project, purchase order) follows the same Blade layout:

```blade
@extends('portal.ninja2020.layout.app')
@section('meta_title', ctrans('texts.entity_type'))
@section('body')
    {{-- Optional header section --}}
    @section('header')
        @if($errors->any()) <div class="alert alert-failure">...</div> @endif
    @endsection

    {{-- Main content: cards with bg-white shadow sm:rounded-lg --}}
    <div class="container mx-auto">
        {{-- Entity header card (always first) --}}
        <div class="bg-white shadow sm:rounded-lg mb-4">
            <div class="px-4 py-5 sm:p-6">
                <h3 class="text-lg font-medium text-gray-900">
                    {{ entity name or number }}
                </h3>
            </div>
        </div>

        {{-- Definition list card (field-value pairs) --}}
        <div class="bg-white shadow sm:rounded-lg">
            <div class="px-4 py-5 border-b border-gray-200 sm:px-6">
                <h3>Section Title</h3>
            </div>
            <dl>
                <div class="bg-white sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt class="text-sm font-medium text-gray-500">Field Label</dt>
                    <dd class="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">Field Value</dd>
                </div>
                {{-- Alternating bg-gray-50 / bg-white rows --}}
            </dl>
        </div>

        {{-- Conditional sections --}}
        @include('portal.ninja2020.components.entity-documents', ['entity' => $entity])
        @livewire('pdf-slot', [...])
    </div>
@endsection
```

### 24.2 Entity-Specific Detail Patterns

| Entity | Header Display | Key Sections | Conditional Components |
|---|---|---|---|
| **Invoice** | Status badge + "Invoice #X - Unpaid" | Pay Now form or status display, PDF viewer, attachments, footer (required fields, signature, terms) | Payment form, signature pad, terms acceptance |
| **Payment** | Status badge | Payment details (date, number, method, amount, refunded, remaining) | Linked invoices list, bank transfer details |
| **Credit** | "Credit #X" heading | PDF viewer, entity documents | — |
| **Subscription** | Subscription name | Start date, next send date, frequency, cycles remaining, amount | Auto-bill toggle, plan switching, cancellation request |
| **Project** | Project name | Summary cards (due date, budgeted hours, total hours, invoiced hours), notes, tasks table | Time log expansion, note collapse/expand |
| **Purchase Order** (vendor) | PO number | Header with status, line items table, documents | Accept/Reject form, signature, DocuSign |

### 24.3 Modal Pattern (Alpine.js)

**Source:** `resources/views/portal/ninja2020/recurring_invoices/includes/modals/cancellation.blade.php`

All modals use a consistent Alpine.js pattern:

```javascript
// Trigger: x-data="{ open: false }" on parent
// Modal visibility: x-show="open" with x-transition
// Backdrop: fixed inset-0 bg-gray-500 opacity-75
// Content: fixed bg-white rounded-lg shadow-xl, sm:max-w-lg
// Close: @click="open = false" or ESC key

Alpine modal structure:
┌──────────────────────────────────────────┐
│  Backdrop (fixed, opacity-75, z-40)      │
│  Modal (fixed, bg-white, rounded-lg,     │
│    shadow-xl, max-w-lg, z-50)            │
│  ┌─────────────────────────────────────┐ │
│  │  Icon (red warning circle)          │ │
│  │  Title + Description                │ │
│  │  [Primary Action]  [Cancel]         │ │
│  └─────────────────────────────────────┘ │
└──────────────────────────────────────────┘
```

**Key attributes:**
- `x-show="open"` — controls visibility
- `x-transition:enter="ease-out duration-300"` / `x-transition:leave="ease-in duration-200"`
- `style="display:none;"` on backdrop (fallback for no-JS)
- `x-cloak` on content to prevent FOUC
- Modal appears bottom-fixed on mobile, centered on desktop
- `flex-shrink-0` on icon container: `h-12 w-12 rounded-full bg-red-100`

### 24.4 Summary Card Pattern (Project View)

**Source:** `resources/views/portal/ninja2020/projects/show.blade.php`

Used for quick metric display at the top of entity views:

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
    <div class="bg-white rounded-lg shadow p-6">
        <div class="text-sm text-gray-600 mb-2">Label</div>
        <div class="text-2xl font-bold text-gray-900">Value</div>
        <div class="text-xs text-gray-500 mt-1">Subtext/percentage</div>
    </div>
    <!-- Repeat for each metric -->
</div>
```

### 24.5 Inline Expandable Text Pattern

**Source:** Multiple detail views (`projects/show.blade.php`, `invoices/show.blade.php`)

Used for notes and descriptions that may be long:

```html
<div x-data="{ expanded: false }">
    <span x-show="!expanded">
        {{ Str::limit($text, 150, '') }}
        <button @click="expanded = true" class="text-primary hover:underline">More...</button>
    </span>
    <span x-show="expanded" x-cloak>
        {{ $text }}
        <button @click="expanded = false" class="text-primary hover:underline">Less</button>
    </span>
</div>
```

---

## 24. BillingPortal Livewire Components

**Source:** `app/Livewire/BillingPortal/` directory

The v3 billing portal uses Livewire for its cart and checkout flow:

| Component | Class File | Blade View | Purpose |
|---|---|---|---|
| **Cart One-Time Products** | `BillingPortal/Cart/OneTimeProducts.php` | `billing-portal/v3/cart/one-time-products.blade.php` | One-time add-on items |
| **Cart Recurring Products** | `BillingPortal/Cart/RecurringProducts.php` | `billing-portal/v3/cart/recurring-products.blade.php` | Subscription line items |
| **Cart Optional Recurring** | `BillingPortal/Cart/OptionalRecurringProducts.php` | `billing-portal/v3/cart/optional-recurring-products.blade.php` | Optional subscription add-ons |
| **Cart Optional One-Time** | `BillingPortal/Cart/OptionalOneTimeProducts.php` | `billing-portal/v3/cart/optional-one-time-products.blade.php` | Optional one-time add-ons |
| **Cart Coupon** | `BillingPortal/Cart/Coupon.php` | `billing-portal/v3/cart/coupon.blade.php` | Discount code entry |
| **Authentication Login** | `BillingPortal/Authentication/Login.php` | `billing-portal/v3/authentication/login.blade.php` | Guest/registered login |
| **Authentication Register** | `BillingPortal/Authentication/Register.php` | `billing-portal/v3/authentication/register.blade.php` | New user registration |
| **Authentication RegisterOrLogin** | `BillingPortal/Authentication/RegisterOrLogin.php` | `billing-portal/v3/authentication/register-or-login.blade.php` | Choice screen (register or login) |
| **Payments Methods** | `BillingPortal/Payments/Methods.php` | `billing-portal/v3/payments/methods.blade.php` | Saved payment method management |
| **Payments BlockonomicsPrice** | `BillingPortal/Payments/BlockonomicsPriceDisplay.php` | (no blade — inline) | Crypto payment price display |
| **Payments BlockonomicsQr** | `BillingPortal/Payments/BlockonomicsQrCode.php` | (no blade — inline) | Crypto QR code display |
| **Purchase** | `BillingPortal/Purchase.php` | `billing-portal/v3/purchase.blade.php` | Checkout flow orchestrator |
| **Setup** | `BillingPortal/Setup.php` | `billing-portal/v3/setup.blade.php` | Initial configuration |
| **Submit** | `BillingPortal/Submit.php` | (internal) | Order submission |
| **Summary** | `BillingPortal/Summary.php` | `billing-portal/v3/summary.blade.php` | Order summary before payment |
| **RFF** | `BillingPortal/RFF.php` | `billing-portal/v3/rff.blade.php` | Required fields (billing address) |
| **RFF Basic** | (no Livewire — plain blade) | `billing-portal/v3/rff-basic.blade.php` | Simplified required fields form |

---

## Source Files Referenced

| File | Usage |
|---|---|
| `resources/views/index/index.blade.php` | Admin panel HTML shell, service worker, Flutter loader |
| `resources/views/layouts/ninja.blade.php` | Fallback layout with Vite CSS/JS |
| `resources/views/portal/ninja2020/layout/app.blade.php` | Client portal main layout |
| `resources/views/portal/ninja2020/components/general/sidebar/main.blade.php` | Sidebar wrapper (desktop + mobile) |
| `resources/views/portal/ninja2020/components/general/sidebar/desktop.blade.php` | Desktop sidebar navigation |
| `resources/views/portal/ninja2020/components/general/sidebar/mobile.blade.php` | Mobile slide-out drawer |
| `resources/views/portal/ninja2020/components/general/sidebar/header.blade.php` | Header bar with profile/contact switcher |
| `resources/views/portal/ninja2020/components/general/sidebar/footer.blade.php` | Portal footer |
| `app/Http/ViewComposers/PortalComposer.php` | Builds sidebar menu dynamically (module bitmask) |
| `resources/views/portal/ninja2020/dashboard/index.blade.php` | Dashboard view with summary cards |
| `resources/views/portal/ninja2020/invoices/index.blade.php` | Invoice list view (Livewire container) |
| `resources/views/portal/ninja2020/invoices/show.blade.php` | Invoice detail + payment flow |
| `resources/views/portal/ninja2020/quotes/includes/actions.blade.php` | Approve/Reject buttons on quote detail |
| `resources/views/portal/ninja2020/components/livewire/pay-now-dropdown.blade.php` | Payment gateway selection dropdown |
| `resources/views/portal/ninja2020/components/livewire/invoices-table.blade.php` | Invoice data table with columns, sorting, actions |
| `resources/views/portal/ninja2020/components/livewire/pdf-slot.blade.php` | PDF viewer component |
| `resources/views/portal/ninja2020/components/entity-documents.blade.php` | Document attachments section |
| `resources/views/portal/ninja2020/components/dockuninja.blade.php` | DocuSign integration widget |
| `resources/views/portal/ninja2020/auth/login.blade.php` | Client portal login |
| `resources/views/auth/login.blade.php` | Admin login form |
| `resources/views/auth/contact_login.blade.php` | Legacy contact login |
| `resources/views/setup/index.blade.php` | Setup wizard form |
| `resources/views/setup/clean_setup.blade.php` | Setup wizard HTML document shell |
| `resources/views/setup/_database.blade.php` | Database connection form |
| `resources/views/setup/_account.blade.php` | Account creation form |
| `resources/views/setup/_issues.blade.php` | System health check display |
| `resources/views/setup/_application.blade.php` | Application settings form |
| `resources/views/setup/_mail.blade.php` | Mail server settings form |
| `resources/js/setup/setup.js` | Setup wizard JavaScript (DB test, progressive reveal) |
| `app/Http/Controllers/Auth/LoginController.php` | Login authentication logic |
| `app/Http/Controllers/SetupController.php` | Setup wizard controller |
| `app/Http/Controllers/SelfUpdateController.php` | Self-update controller |
| `app/Http/Controllers/ImportController.php` | CSV/JSON import controller |
| `app/Http/Controllers/ExportController.php` | Data export controller |
| `app/Http/Controllers/Contact/LoginController.php` | Client portal login controller |
| `app/Http/Controllers/VendorPortal/PurchaseOrderController.php` | Vendor portal PO controller (sidebar menu, accept/reject logic) |
| `app/Models/PurchaseOrder.php` | PurchaseOrder model (statuses: draft, sent, accepted, cancelled) |
| `resources/views/portal/ninja2020/components/general/sidebar/vendor_main.blade.php` | Vendor portal layout shell |
| `resources/views/portal/ninja2020/components/general/sidebar/vendor_desktop.blade.php` | Vendor sidebar navigation |
| `resources/views/portal/ninja2020/components/general/sidebar/vendor_header.blade.php` | Vendor header bar |
| `resources/views/portal/ninja2020/profile/settings/general.blade.php` | Client profile settings form (two-col grid pattern) |
| `resources/views/portal/ninja2020/profile/settings/name-website-logo.blade.php` | Company name, website, logo settings |
| `resources/views/portal/ninja2020/profile/settings/personal-address.blade.php` | Personal address settings form |
| `resources/views/portal/ninja2020/profile/settings/shipping-address.blade.php` | Shipping address settings form |
| `resources/views/portal/ninja2020/profile/settings/custom-fields.blade.php` | Custom fields settings form |
| `resources/views/billing-portal/v3/index.blade.php` | Billing portal v3 entry (cart flow) |
| `resources/views/billing-portal/v3/cart/cart.blade.php` | Billing portal v3 cart (one-time + recurring products + coupon) |
| `resources/views/billing-portal/v3/authentication/login.blade.php` | Billing portal v3 login |
| `resources/views/billing-portal/v3/payments/methods.blade.php` | Billing portal v3 payment method management |
| `resources/views/portal/ninja2020/purchase_orders/includes/actions.blade.php` | Vendor PO accept/reject form |
| `resources/views/portal/ninja2020/payments/show.blade.php` | Client payment detail (definition list pattern) |
| `resources/views/portal/ninja2020/credits/show.blade.php` | Client credit detail (PDF slot + documents) |
| `resources/views/portal/ninja2020/subscriptions/show.blade.php` | Subscription detail (auto-bill, plan switching, cancellation) |
| `resources/views/portal/ninja2020/projects/show.blade.php` | Project detail (summary cards, tasks table, expandable notes) |
| `resources/views/portal/ninja2020/purchase_orders/show.blade.php` | Vendor PO detail view |
| `resources/views/portal/ninja2020/purchase_orders/show-fullscreen.blade.php` | Vendor PO print-friendly view |
| `resources/views/portal/ninja2020/recurring_invoices/includes/modals/cancellation.blade.php` | Cancellation modal (Alpine.js pattern) |
| `resources/views/portal/ninja2020/upload/index.blade.php` | File upload component (documents view) |
| `resources/views/portal/ninja2020/gateways/stripe/bank_transfer/bank_details.blade.php` | Bank transfer details display |
| `routes/vendor.php` | Vendor portal routes |
| `github.com/invoiceninja/admin-portal` (repo) | Flutter admin portal source |
| `docs/detail-screen-layout.md` (admin-portal) | Entity detail screen layout documentation |
| `docs/sidebar-and-shell.md` (admin-portal) | Sidebar and page shell documentation |
| `app/Jobs/Import/CSVIngest.php` | Async CSV processing job |
| `app/Jobs/Company/CompanyExport.php` | Async export job |
| `app/Livewire/InvoicesTable.php` | Invoice Livewire table component |
| `app/Livewire/PayNowDropdown.php` | Pay Now dropdown Livewire component |
| `app/Livewire/PdfSlot.php` | PDF viewer Livewire component |
| `app/Livewire/Flow2/InvoicePay.php` | Payment flow layout wrapper |
| `app/Livewire/Flow2/InvoiceSummary.php` | Invoice summary (left column) |
| `app/Livewire/Flow2/PaymentMethod.php` | Payment gateway selection |
| `app/Livewire/Flow2/RequiredFields.php` | Billing address/custom fields |
| `app/Livewire/Flow2/UnderOverPayment.php` | Payment amount adjustment |
| `app/Livewire/Flow2/Signature.php` | Signature capture (canvas/DocuSign) |
| `app/Livewire/Flow2/Terms.php` | Terms acceptance checkbox |
| `app/Livewire/Flow2/ProcessPayment.php` | Final payment gateway redirect |
| `app/Livewire/BillingPortal/Purchase.php` | Billing portal checkout flow |
| `app/Livewire/BillingPortal/Cart/Cart.php` | Billing portal cart manager |
| `app/Livewire/BillingPortal/Authentication/RegisterOrLogin.php` | Guest auth choice screen |
| `resources/views/portal/ninja2020/flow2/*.blade.php` | Flow2 payment flow views (7 files) |
| `resources/views/billing-portal/v3/*.blade.php` | Billing portal v3 views (19 files) |
| `routes/web.php` | Admin panel route (flutterRoute) |
| `routes/client.php` | Client portal routes |
| `routes/api.php` | API routes (import/export endpoints) |