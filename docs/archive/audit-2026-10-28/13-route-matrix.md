# 13 — Route matrix: user action ↔ route ↔ handler file ↔ screen (2026-10-28)

Build method: full grep of every `Routes.(get|post|put|patch|delete)` registration across `server/routes/*.ts` (111 route handlers), mounted in `server/worker.ts:22-43`. Screens are the navigation entries of `src/components/layout/AppShell.tsx:33-70`.

## Correction of the §10 note in `05-parity-matrix.md`
The §10 of `05-parity-matrix.md` recorded one orphan route, `POST /api/settings/reset-demo`. A full grep of `server/`, `src/` for `reset-demo` returns **zero matches** — that entry was an analysis error introduced in an earlier pass, not an observed route. After this complete build of the table there is **no orphan in either direction to date**: every route is reachable from a nav screen or a detail-screen action, and every nav entry has a serving route. Correction appended to the matrix and the changelog.

## Table
| Route (mounted under worker) | Handler file | Screen reaching it |
|---|---|---|
| `POST /login` | `auth.ts` | Login / Profil / Sécurité |
| `POST /mfa/verify` | `auth.ts` | Login / Profil / Sécurité |
| `POST /mfa/setup` | `auth.ts` | Login / Profil / Sécurité |
| `POST /mfa/enable` | `auth.ts` | Login / Profil / Sécurité |
| `POST /mfa/disable` | `auth.ts` | Login / Profil / Sécurité |
| `POST /logout` | `auth.ts` | Login / Profil / Sécurité |
| `GET /me` | `auth.ts` | Login / Profil / Sécurité |
| `PATCH /profile` | `auth.ts` | Login / Profil / Sécurité |
| `POST /change-password` | `auth.ts` | Login / Profil / Sécurité |
| `GET /sessions` | `auth.ts` | Login / Profil / Sécurité |
| `DELETE /sessions/:id` | `auth.ts` | Login / Profil / Sécurité |
| `DELETE /sessions` | `auth.ts` | Login / Profil / Sécurité |
| `GET /status` | `setup.ts` | Assistant d'installation |
| `POST /install` | `setup.ts` | Assistant d'installation |
| `GET /` | `clients.ts` | Clients |
| `GET /:id` | `clients.ts` | Clients |
| `POST /` | `clients.ts` | Clients |
| `PATCH /:id` | `clients.ts` | Clients |
| `DELETE /:id` | `clients.ts` | Clients |
| `GET /:id/statement` | `clients.ts` | Clients |
| `POST /:id/contacts` | `clients.ts` | Clients |
| `GET /` | `products.ts` | Produits |
| `POST /` | `products.ts` | Produits |
| `PATCH /:id` | `products.ts` | Produits |
| `DELETE /:id` | `products.ts` | Produits |
| `POST /:id/adjust-stock` | `products.ts` | Produits |
| `GET /` | `invoices.ts` | Factures |
| `GET /:id` | `invoices.ts` | Factures |
| `POST /` | `invoices.ts` | Factures |
| `PATCH /:id` | `invoices.ts` | Factures |
| `POST /:id/send` | `invoices.ts` | Factures |
| `POST /:id/cancel` | `invoices.ts` | Factures |
| `POST /:id/duplicate` | `invoices.ts` | Factures |
| `POST /:id/mark-paid` | `invoices.ts` | Factures |
| `POST /:id/apply-credit` | `invoices.ts` | Factures |
| `DELETE /:id` | `invoices.ts` | Factures |
| `GET /:id/pdf` | `invoices.ts` | Factures |
| `GET /` | `payments.ts` | Paiements |
| `GET /:id` | `payments.ts` | Paiements |
| `POST /` | `payments.ts` | Paiements |
| `DELETE /:id` | `payments.ts` | Paiements |
| `GET /` | `quotes.ts` | Devis |
| `GET /:id` | `quotes.ts` | Devis |
| `POST /` | `quotes.ts` | Devis |
| `PATCH /:id` | `quotes.ts` | Devis |
| `POST /:id/send` | `quotes.ts` | Devis |
| `POST /:id/approve` | `quotes.ts` | Devis |
| `POST /:id/reject` | `quotes.ts` | Devis |
| `POST /:id/convert` | `quotes.ts` | Devis |
| `DELETE /:id` | `quotes.ts` | Devis |
| `GET /` | `credits.ts` | Avoirs |
| `GET /:id` | `credits.ts` | Avoirs |
| `POST /` | `credits.ts` | Avoirs |
| `POST /:id/send` | `credits.ts` | Avoirs |
| `POST /:id/apply` | `credits.ts` | Avoirs |
| `DELETE /:id` | `credits.ts` | Avoirs |
| `GET /` | `recurring.ts` | Factures récurrentes |
| `GET /:id` | `recurring.ts` | Factures récurrentes |
| `POST /` | `recurring.ts` | Factures récurrentes |
| `PATCH /:id` | `recurring.ts` | Factures récurrentes |
| `POST /:id/status` | `recurring.ts` | Factures récurrentes |
| `POST /:id/run` | `recurring.ts` | Factures récurrentes |
| `DELETE /:id` | `recurring.ts` | Factures récurrentes |
| `GET /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `POST /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `PATCH /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `DELETE /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `POST /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `PATCH /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `DELETE /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `POST /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `POST /:id/status` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `DELETE /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `POST /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `PATCH /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `DELETE /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `POST /` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `PATCH /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `DELETE /:id` | `operations.ts` | Dépenses/Fournisseurs/Commandes/Projets/Tâches |
| `GET /accounts` | `bank.ts` | Banque |
| `POST /accounts` | `bank.ts` | Banque |
| `GET /transactions` | `bank.ts` | Banque |
| `POST /transactions/import` | `bank.ts` | Banque |
| `POST /transactions/:id/match` | `bank.ts` | Banque |
| `PATCH /transactions/:id` | `bank.ts` | Banque |
| `GET /` | `dashboard.ts` | Tableau de bord / Rapports |
| `GET /:type` | `dashboard.ts` | Tableau de bord / Rapports |
| `GET /` | `dashboard.ts` | Tableau de bord / Rapports |
| `GET /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `PATCH /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `GET /periods` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `POST /periods` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `DELETE /periods/:period` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `POST /rebuild-tax-lines` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `GET /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `POST /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `DELETE /:id` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `GET /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `POST /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `PATCH /:id` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `POST /:id/reset-password` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `POST /:id/reset-mfa` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `DELETE /:id` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `GET /` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
| `GET /verify` | `settings.ts` | Paramètres / Utilisateurs / Taxes / Périodes |
