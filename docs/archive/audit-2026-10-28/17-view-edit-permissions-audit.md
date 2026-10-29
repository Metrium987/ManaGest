# 17 — "View" presence + permission-model audit (2026-10-28, R-B & R-C)

## R-B — read-only "Voir" affordance per element
Server detail/read endpoints exist broadly (GET /:id per family in `13-route-matrix.md`). The UI audit (page-by-page):

| Screen | Detail view exists? | "Voir" affordance | Gap |
|---|---|---|---|
| Clients | ClientDetailPage | detail page exists; row access unclear | row-level "Voir" button to add |
| Factures / Devis / Avoirs | Invoice/Quote detail pages | yes (rows open detail) | add explicit "Voir" on credits & recurring |
| Paiements | none (PaymentsPage only) | — | **MISSING** — payment detail view |
| Dépenses | none | — | **MISSING** |
| Fournisseurs / Bons de commande | none in UI | — | **MISSING** |
| Produits | none | — | **MISSING** |
| Projets / Tâches | none | — | **MISSING** |
| Banque | BankPage list | — | **MISSING** |
| Paramètres (setting entries, tax rates, numbering) | SettingsPage tabs | tabs visible to all readers | view-only readouts lack read-only detail |
| Utilisateurs | UsersPage | no per-user detail screen | **MISSING** |
| Journal d'activité | ActivityPage | list-only | acceptable (no entity) |

Verdict: 3 detail views exist (clients, invoices, quotes); ~9 areas lack a dedicated read-only view/`Voir` button. All to add in R3 (R-B), read-only detail first, then buttons.

## R-C — server-enforced permission model (current state + gaps)
**Current state (good baseline):** every non-auth route family is wrapped in `requirePermission(...)` server-side (`13-route-matrix.md`: 96 handler checks across clients, products, invoices, payments, quotes, credits, recurring, operations, bank, dashboard, settings, users, activity — counts ≥ handler counts; `auth` and the 2 `setup` endpoints are the only public routes, by design). Permissions are enumerated in `shared/domain.ts:19-99` (module×action style) mapped to roles `owner/admin/accountant/sales/viewer` via `ROLE_PERMISSIONS`; routes use `permissions` from the session, not client input. Every mutation logs to the hash-chained activity journal. Server-side protection is therefore real, not UI-only.

**Gaps against the owner's R-C model:**
1. Role set is fixed in code (owner/admin/accountant/sales/viewer) — R-C requires **admin-creatable/extendable roles** (custom roles with a chosen permission set). Current `ROLE_PERMISSIONS` is a constant (`shared/domain.ts:92`).
2. No role-editing screen beyond role assignment in UsersPage; permission matrix is not user-visible.
3. Per-row visibility of buttons without permission is partially implemented (quick-add gating exists, `AppShell.tsx:203`), needs full pass so buttons become disabled-with-message rather than hidden (R-C UI rule).
4. Permission changes are logged when users are edited, but a role CRUD change (future) must also journal — currently no roles table at all.

**Proposed default role matrix for owner validation (OQ-021):**
| Module × action | Administrateur | Gestionnaire | Personnel | Lecture seule |
|---|---|---|---|---|
| view all lists/details | ✔ | ✔ | ✔ | ✔ (only view) |
| create documents | ✔ | ✔ | ✔ | ✖ |
| edit | ✔ | ✔ | limited (own drafts) | ✖ |
| delete | ✔ | small deletes only | ✖ | ✖ |
| cancel/reopen invoice | ✔ | ✔ | ✖ | ✖ |
| payments record | ✔ | ✔ | ✔ | ✖ |
| expense create | ✔ | ✔ | ✔ | ✖ |
| export/import | ✔ | ✔ | export only | ✖ |
| settings (numbering, taxes, templates) | ✔ | view | view | ✖ |
| users/roles | ✔ | ✖ | ✖ | ✖ |
Every edit/deletion/permission change journal-logged.
Extension (R2/R3): roles table + per-role permission set, role CRUD server-enforced, UI gating helper reused.
