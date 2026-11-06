# ManaGest — plan d'exécution de l'audit du 6 novembre 2026

**Rôle de ce document.** Il traduit chaque constat de
[`../AUDIT-2026-11-06.md`](../AUDIT-2026-11-06.md) en tâches exécutables, ordonnées par
dépendance, avec pour chacune : le but, la preuve du défaut, les fichiers, les étapes,
les critères d'acceptation, les tests à ajouter et les pièges.

Il **complète** [`TODO.md`](TODO.md) (plan R1 → R4, clos) sans le réécrire : les lignes
ci-dessous sont additives et portent l'identifiant `A-xx`. Ce qui reste suspendu, différé ou
non vérifiable continue d'être consigné dans [`PENDING.md`](PENDING.md).

**Règles d'exécution.** Une tâche ne démarre que si ses dépendances sont `DONE`. Chaque
tâche passe le *task gate* de [`VERIFICATION-GATES.md`](VERIFICATION-GATES.md) : tests verts,
typecheck propre, permission serveur testée, journal d'audit alimenté, aucune valeur
configurable codée en dur. Une vérification impossible (navigateur, D1 hébergé, authentification
Cloudflare) est **rapportée comme non exécutée**, jamais cochée.

**Légende.** Effort : S (≤ ½ j), M (1–2 j), L (3–5 j), XL (> 1 semaine).
Statut : `TODO` | `IN PROGRESS` | `DONE` | `BLOCKED`.

---

## 0. Règle de résolution des ambiguïtés (s'applique à toutes les tâches)

**Aucune question en suspend ne bloque le travail, et aucune valeur métier n'est écrite dans le
code.** L'application est paramétrable dans tous les modules : un seuil, un taux, un délai, un
plafond, un compte ou un libellé qui décide d'un comportement est un **réglage**, pas une
constante. Cette règle prime sur toute hésitation rencontrée en exécutant une fiche.

| # | Règle | Application concrète |
|---|---|---|
| **R-1** | **Rien en dur.** Toute valeur métier vit dans les paramètres (`settings_extra`, `settings`, `tax_rates`, `currencies`, `entity_numbering`, tables de référence). | Le registre `EXTRA_KEYS` / `EXTRA_DEFAULTS` / `EXTRA_RULES` (`server/lib/settings-extra.ts`) est le point d'entrée unique : une clé, un défaut documenté, une plage de validation, un champ dans Paramètres. |
| **R-2** | **Une valeur inconnue prend un standard documenté**, jamais un `TODO` bloquant. | Ordre de préférence : obligation légale polynésienne (DICP, PCG) → pratique de référence d'un ERP établi (Odoo, cité en source) → pratique du secteur → valeur la plus permissive qui n'invente rien. Le défaut est **écrit avec sa source** dans le commentaire de la clé et dans `CONFORMITE.md`. |
| **R-3** | **Tout réglage est éditable sans déploiement.** | Défaut livré, libellé FR/EN, plage de validation, et un test qui prouve que **changer le réglage change le comportement**. Un réglage non prouvé est un réglage mort. |
| **R-4** | **L'accès aux paramètres est réservé à une autorité.** | Lecture et écriture passent par `requirePermission('settings.read' / 'settings.write')` ; seuls les rôles disposant d'une autorité écriture l'obtiennent (`owner`, `admin`, et `accountant` seulement si le propriétaire l'a décidé). Chaque écriture est **journalisée avec l'ancienne et la nouvelle valeur**, et un porteur de `users.write` ne peut pas s'élargir lui-même (principe Odoo : seul un administrateur modifie les droits). Voir A-30. |

**Ce que la règle ne couvre pas.** Un garde-fou technique (taille maximale d'un champ, plafond de
paramètres liés d'une requête, limite dure de la plateforme) n'est pas une valeur métier : il
reste une constante, mais **commentée avec sa raison** et, si possible, dérivée d'une constante
partagée. La distinction est explicite dans A-29 : métier → réglage ; technique → constante
documentée.

---

## 0 bis. Journal d'exécution

**6 novembre 2026 — phase 1 entamée.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-01 | **DONE** | `server/services/settlements.ts` : un seul chemin d'encaissement — devise de la facture, taux figé, base XPF, écart réalisé, allocation et passage brouillon → émis dans un `batch`. `mark-paid` l'appelle ; plus de règlement sans devise. `tests/settle-invoice.test.ts`, **5 cas** (XPF, USD +5 000 d'écart, EUR à parité fixe donc écart nul, refus annulée/soldée/taux manquant, brouillon encaissé). |
| A-02 | **DONE** | Garde unique `assertEditable` + `loadDocumentForEdit` (factures, devis, avoirs) : `409 DOCUMENT_IMMUTABLE` avec `{ document, status }`. `PATCH /credits/:id` ajouté pour qu'un brouillon reste éditable ; bouton « Modifier » conditionné au statut réel. `tests/document-immutability.test.ts` — matrice des statuts + refus sans écriture. |
| A-04 | **DONE** | Table `credit_tax_lines` et miroir écrit à la création, à l'envoi, à l'édition d'un brouillon et depuis un avoir de facture ; récapitulatif TVA et état `tax` soustraient les avoirs émis. `tests/vat-credits.test.ts` — 4 cas. |
| A-05 | **DONE** | `paymentReversalLines` / `expenseReversalLines` + rattrapage idempotent dans `syncAccounting` (événements `voided` / `reversed`). `tests/accounting-reversals.test.ts` — miroirs équilibrés, double passe sans doublon. |
| A-03 | **DONE** | `server/lib/credit-note.ts` : avoir prérempli depuis la facture, un bucket par taux, prorata sur un remboursement partiel, devise et taux figés repris, `tax_exempt` hérité au lieu d'être forcé. `tests/credit-note.test.ts`, **6 cas**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **92 fichiers, 734 tests, 0 échec**.

**6 novembre 2026 — A-08 et A-11 : devise des dépenses/BC et indexation.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-08 | **DONE** | `server/services/expenses.ts` (`expenseFx`, `createExpense`) fige le taux à la date et écrit `currency`/`exchange_rate`/`amount_xpf`/`tax_amount_xpf` ; `POST`/`PATCH /expenses` acceptent `currency` ; `POST /purchase-orders` (et `from-suggestions`) enregistrent `exchange_rate` + `subtotal_xpf`/`tax_total_xpf`/`total_xpf` ; `receiveAgainstBalance` lit le taux figé et `receiptUnitCost()` convertit la ligne **avant** `landedUnitCost`/coût moyen ; rapports dépenses et total d'achat par fournisseur en XPF via `baseAmountSql`. `tests/expenses-fx.test.ts`, **4 cas** : dépense 100,00 USD à 119,33 → `amount_xpf` 11 933, taux figé (un taux postérieur ne réécrit rien), agrégat XPF ≠ somme des devises, réception 25,00 USD → 2 983 XPF par unité. |
| A-11 | **DONE** | Migration `0005_indexes_and_number_uniqueness` (SQL + `.ts`, enregistrée) : `idx_activities_entity`, `idx_stock_movements_reference`, `idx_sessions_expiry`, `idx_products_deleted`, index partiels `invoices`/`payments`/`credits(client_id, date) WHERE deleted_at IS NULL`, unicité `payments`/`purchase_orders`/`recurring_invoices(number)` ; doublon `idx_stock_count_lines_product` retiré de `schema.ts`. `tests/query-plans.test.ts`, **4 plans** : plus de `SCAN activities` / `SCAN stock_movements` / `SCAN products` / `SCAN sessions`. `tests/number-uniqueness.test.ts`, **3 cas** : doublon refusé, plusieurs `NULL` acceptés. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **95 fichiers, 745 tests, 0 échec**.

**6 novembre 2026 — A-12 et A-13 : intégrité mesurée, contraintes dans la base.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-12 | **DONE** | `server/lib/integrity.ts` : huit relations (`payment_allocations.invoice_id`, `credit_allocations.credit_id`, `credit_allocations.invoice_id`, `invoice_tax_lines.invoice_id`, `journal_lines.entry_id`, `stock_movements.product_id`, `stock_lots.product_id`, `sessions.user_id`) comptées par `NOT EXISTS`, avec échantillons d'ids ; `GET /dashboard/integrity` (`reports.read`) ; le passage quotidien journalise `integrity_gap` et renseigne `RunSummary.integrity_gaps`. `tests/integrity.test.ts`, **4 cas** : 8 relations déclarées, 0 écart sur base saine, 1 écart nommé sur allocation orpheline, suppression logique d'un client non comptée. |
| A-13 | **DONE** | Migration `0006_integrity_constraints` : `journal_lines` reconstruite avec `CHECK (debit >= 0)`, `CHECK (credit >= 0)` et `CHECK (debit = 0 OR credit = 0)` (index recréés) ; `idx_currencies_single_base` partiel après normalisation sur XPF ; `company.singleton` + `idx_company_singleton` ; déclencheurs `BEFORE INSERT/UPDATE` refusant un montant négatif sur `payments.amount`, `invoices.balance`, `credits.total`, `expenses.amount`. `tests/db-constraints.test.ts`, **4 cas** : débit+crédit simultanés, montants négatifs (journal, paiement, solde, avoir, dépense), deuxième devise de base, deuxième société — et `0` accepté. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **97 fichiers, 753 tests, 0 échec**.

**6 novembre 2026 — phases 2 et 3 : approbations, agrégats XPF, décimales, migrations.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-06 | **DONE** | `approvals` reconstruite par la migration 0003 (`revision`, `controlled_amount`, `controlled_discount`, `superseded_at`, `UNIQUE(entity_type, entity_id, revision)`). `requireApprovalIfNeeded` compare montant et remise **courants** aux valeurs contrôlées : dépassement après approbation ou re-soumission après refus → révision `pending` + `409 APPROVAL_REQUIRED` avec `previous`/`revision` ; `approvalOf` lit `ORDER BY revision DESC LIMIT 1` ; `decideApproval` refuse une révision périmée (`409 ALREADY_DECIDED`) et l'auto-approbation (`403 SAME_APPROVER`). `tests/approvals-revision.test.ts`, **4 cas** : remise 15 % → 35 % rouvre une demande, montant contrôlé accepté tel quel, refus puis correction, révision périmée. |
| A-07 | **DONE** | Règle unique `baseAmountSql()` / `baseBalanceSql()` (`server/lib/reports.ts`), utilisée par tous les KPI, `revenue-summary`, `aging` et `client-sales`. `RevenuePeriod` expose `taxable_xpf` / `exempt_xpf` / `total_xpf` / `collected_xpf` ; `aging` renvoie `balance_xpf` au prorata du taux figé, à côté de `balance` et `currency` d'origine ; en-têtes CSV « (XPF) ». `tests/reports-multicurrency.test.ts`, **3 cas** : 1 000 EUR à 119,33 + 100 000 XPF = **219 330**, `taxable + exempt = total`, solde âgé = 59 665 + 40 000, total nul non écrasé. |
| A-09 | **DONE** | `currencyDecimals(currency, decimals?)` (`shared/money.ts`) : la valeur configurée 0–4 fait foi, la map XPF/JPY n'est qu'un repli hors ligne ; `toMinor`/`fromMinor`/`formatMoney` et `src/lib/format.ts` prennent le même paramètre. `tests/money-decimals.test.ts` : XPF, EUR, KWD (3 décimales), devise inconnue. |
| A-10 | **DONE** | `server/db/migrations/` : baseline figée sans seeds + `0002_credit_tax_lines`, `0003_approvals_revision`, `0004_expense_po_currency` ; `runMigrations()` (`server/db/migrate.ts`) journalise dans `d1_migrations` et renvoie **0** quand tout est appliqué ; `provision()` exécute les fichiers puis garde `applyColumnMigrations` en filet ; `db:migrate:local` = `wrangler d1 migrations apply`. `tests/schema-migrations.test.ts` : base **ancienne** migrée **sans perte**, rejeu = 0, structure finale identique à `SCHEMA_STATEMENTS`. |

---

**6 novembre 2026 — A-14 : une seule vérité de stock.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-14 | **DONE** | `server/lib/stock-balance.ts` (`stockBalanceRows`, `stockBalanceReport`, `stockBalance`) compare mouvements signés, `products.quantity_milli`, `stock_lots` et `lot_balances` ; `GET /dashboard/stock-balance` et le passage quotidien (`stock_gaps`, activité `stock_gap`) **signalent** sans réécrire. Le retour client écrit `lot_balances` + `stock_valuations` ; `consumeInvoiceStock` refuse `422 KIT_COMPONENT_MISSING` ; `unresolvedReferences` + `assertProductReferences` refusent une nomenclature pointant sur un produit supprimé. `docs/ARCHITECTURE.md` fixe la source de vérité. `tests/stock-integrity.test.ts`, **5 cas** : réception 10 → assemblage 2 kits → vente 1 → désassemblage 1 avec quatre quantités égales à chaque étape ; compteur trafiqué (`+5`) → 1 écart `counter_gap_milli` conservé ; casier ≠ lot → `shelf_gap_milli` ; kit au composant supprimé refusé ; références manquantes nommées. Mutations : garde kit neutralisée et écart de casier forcé à 0 → 2 cas en échec. |

## 1. Contraintes de plateforme vérifiées (elles décident de plusieurs tâches)

Ces points ont été vérifiés dans la documentation officielle pendant l'élaboration du plan.
Ils **corrigent deux recommandations de l'audit** et évitent des tâches impossibles.

| # | Contrainte | Conséquence sur le plan | Source |
|---|---|---|---|
| C-1 | **D1 applique les clés étrangères par défaut**, comme `PRAGMA foreign_keys = on` pour chaque transaction ; `PRAGMA defer_foreign_keys` permet de différer le contrôle dans une transaction (utile en migration). | Les FK ne sont pas « inertes » faute de PRAGMA (ce que l'audit supposait) : le problème est qu'elles ne sont **pas déclarées**. Ajouter une FK à une table existante impose une reconstruction de table (SQLite ne sait pas `ALTER TABLE … ADD CONSTRAINT`). | [D1 — foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/) |
| C-2 | **`batch()` est atomique** : les instructions sont exécutées et validées séquentiellement, non concurrentement ; un échec annule la séquence. **`BEGIN`/`COMMIT`/`SAVEPOINT` ne sont pas supportés.** | Les écritures groupées existantes sont sûres. En revanche, deux requêtes séparées forment une **séquence non atomique** : c'est là que se logent les courses (journal chaîné, numéro + insertion, statut + stock). Les correctifs doivent tenir dans **un seul `batch`**. | [D1 — Database API](https://developers.cloudflare.com/d1/worker-api/d1-database) |
| C-3 | **Limites D1** : base **10 Go** (Workers Paid) / 500 Mo (Free) ; **1 000 requêtes par invocation** (50 en Free), un `batch` comptant pour **une** ; ligne/chaîne **2 Mo** ; **100 paramètres liés par requête** ; **motif `LIKE`/`GLOB` ≤ 50 octets** ; résultat ≤ 50 Mo ; requête ≤ 30 s. | Justifie : chunking des `IN (…)`, validation de la recherche à 50 octets, purge des tables d'historique, et un plafond dur au `syncAccounting` actuel (une requête par document). | [D1 — Limits](https://developers.cloudflare.com/d1/platform/limits/) |
| C-4 | **FTS5 est disponible** dans D1 (`MATCH`, `bm25`, `highlight`). | La recherche plein texte est réalisable sans service externe. | [D1 — SQL statements](https://developers.cloudflare.com/d1/sql-api/sql-statements), [SQLite FTS5](https://sqlite.org/fts5.html) |
| C-5 | **L'export D1 ne supporte pas les tables virtuelles.** Un export en cours bloque les autres requêtes. | Si FTS5 est ajouté (A-17), la sauvegarde applicative (A-17) et la restauration doivent **exclure les tables virtuelles et leurs tables d'ombre** et **reconstruire l'index** après restauration — sinon `tests/backup-restore.test.ts` casse. | [D1 — Import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) |
| C-6 | **Migrations D1** : `wrangler d1 migrations create <db> <nom>` crée `NNNN_nom.sql` ; `migrations apply` suit l'ordre, enregistre dans `d1_migrations`, **capture une sauvegarde**, et **annule la migration en échec** en laissant les précédentes appliquées. `migrations_dir` est déjà déclaré dans `wrangler.jsonc`. | Le passage à des migrations versionnées est direct et déjà à moitié configuré. Le déploiement distant exigera une authentification Cloudflare (cf. § 6). | [D1 — Migrations](https://developers.cloudflare.com/d1/reference/migrations/), [wrangler d1](https://developers.cloudflare.com/workers/wrangler/commands/d1/) |
| C-7 | **PCG 2026** : les écarts de change sur **créances et dettes commerciales** vont en **656 / 756** ; 666 / 766 sont réservés aux **opérations financières**. | Le code poste les écarts de règlement client en **666000 / 766000** (`shared/accounts.ts`). À corriger par défaut (les codes restent paramétrables). | [PCG 2026 (ANC)](https://www.anc.gouv.fr/files/anc/files/1_Normes_fran%C3%A7aises/Plans%20comptables/2026/PCG--1er-janvier-2026.pdf) |
| C-8 | **TVA mentionnée à tort** : celui qui mentionne la TVA la doit ; la régularisation passe par une **facture rectificative** (avoir). En Polynésie, la DICP rappelle la même règle et les mentions obligatoires (Tahiti, HT, TVA, total). | Confirme l'obligation d'**immuabilité** d'une facture émise (A-02) et le rôle obligatoire de l'avoir (A-03/A-04). | [BOFiP — mentions erronées](https://bofip.impots.gouv.fr/export/pdf/361280), [DICP — franchise](https://www.service-public.pf/dicp/le-controle-fiscal-et-la-lutte-contre-la-fraude/fiches-prevention-des-risques/facturation-de-la-tva-par-un-franchise-en-base/) |

---

## 2. Graphe de dépendances

```
A-01 encaissement devise ─┐
A-02 immutabilité ────────┼─> A-07 rapports multi-devises ─> A-08 achats/dépenses devise
A-03 avoirs TVA/devise ───┘                                   │
A-04 miroir TVA avoirs ───────────────> A-26 tests HTTP ──────┤
A-05 contre-écritures ────────────────> A-18 comptabilité ────┤
A-06 approbations ────────────────────────────────────────────┤
                                                              │
A-10 migrations versionnées ─> A-11 index ─> A-12 FK ─> A-13 CHECK ─> A-15 plafonds D1
                                   │            │
                                   └─> A-14 stock ─> A-17 FTS5 ─> A-16 projections
A-19 chaîne d'audit ─> A-28 concurrence
A-20..A-25 sécurité/exploitation (parallélisables après A-10)
A-27 documentation (en continu, clôture)
```

Trois pistes parallèles : **chiffres justes** (A-01…A-08), **schéma** (A-10…A-17),
**sécurité/exploitation** (A-19…A-25). Elles ne se bloquent qu'aux points indiqués.

**Transverses.** A-29 (valeurs en dur) et A-30 (autorité des paramètres) s'appliquent à toutes
les phases ; les lancer après A-10 pour que les nouveaux réglages naissent dans un schéma
versionné.

**Conditionnelle.** A-31 (réévaluation de change de clôture) ne démarre que sur une devise non
arrimée à l'euro ; elle dépend de A-01 et A-08 mais ne bloque personne.

---

## 3. Phase 1 — Chiffres justes (à faire avant toute démonstration à un comptable)

### A-01 — Encaissement direct respectant la devise

- **But.** « Marquer payée » produit un règlement correct en devise, avec taux figé, base XPF
  et écart de change, ou refuse l'action hors XPF.
- **Pourquoi.** `POST /invoices/:id/mark-paid` insère dans `payments` sans `currency`,
  `exchange_rate`, `amount_xpf`, `fx_difference` (`server/routes/invoices.ts:747`), ni dans
  `payment_allocations`. Sur une facture EUR : règlement étiqueté XPF, écart perdu, journal
  faux, KPI « encaissé » faux.
- **Fichiers.** `server/routes/invoices.ts`, `server/routes/payments.ts`,
  `server/services/documents.ts`, `server/services/currencies.ts`, `server/lib/fx.ts`.
- **Étapes.**
  1. Extraire de `POST /api/payments` un service `recordSettlement(database, {client_id, date,
     amount, currency, method, reference, allocations, userId})` qui : résout/fige le taux
     (`freezeFx`), calcule `amount_xpf` et `fx_difference` par allocation (même formule que
     `allocationFx`), écrit paiement + allocations **dans un seul `batch`**, puis `recalcInvoice`.
  2. `mark-paid` lit la facture (`currency`, `exchange_rate`, `currency_decimals`, `total`,
     `balance`), appelle `recordSettlement` avec `amount = balance` et l'allocation unique.
  3. Refus explicite `409 CURRENCY_RATE_MISSING` si le taux du jour manque ; refus
     `409 INVOICE_NOT_PAYABLE` si `balance <= 0` ou statut `cancelled`.
  4. Conserver le comportement « encaisser un brouillon l'émet » (stock + `sent_at`) mais
     l'exécuter **avant** l'écriture du règlement, dans la même logique de service.
- **Critères d'acceptation.** Facture XPF : `amount_xpf = amount`, `fx_difference = 0`.
  Facture EUR : `amount_xpf = round(amount × 119,3317)`, et **écart nul par construction** — le
  franc Pacifique est arrimé à l'euro à parité fixe (`XPF_PER_EUR`, `shared/landed-cost.ts:33`),
  donc un écart EUR/XPF ne peut venir que d'une saisie erronée. L'écart réalisé se teste sur une
  devise **non arrimée** (USD, AUD, NZD). Le journal contient banque (débit XPF) / client (crédit
  XPF) / gain ou perte de change. Aucune ligne `payments` avec `amount_xpf = 0` alors que
  `amount > 0`.
- **Tests.** `tests/mark-paid-fx.test.ts` : XPF, EUR (parité fixe → écart nul), **USD gain**,
  **USD perte**, taux manquant (422), double encaissement (409), brouillon encaissé (stock
  consommé une seule fois).
- **Pièges.** Ne pas réutiliser `body.amount` du client : c'est le **solde** qui fait foi.
  Vérifier qu'un second appel ne crée pas un deuxième règlement (idempotence par solde).
- **Effort.** M. **Statut.** **DONE** — service `server/services/settlements.ts`, appelé par
  `mark-paid` ; preuve `tests/settle-invoice.test.ts` (5 cas). Le journal hérite de l'écart par
  `paymentLines` (chemin inchangé), non rejoué de bout en bout dans ce test.

### A-02 — Immutabilité des documents émis

- **But.** Un document émis (`sent`, `partial`, `paid`, `cancelled`) n'est plus modifiable par
  `PATCH` ; la correction passe par un avoir ou une annulation.
- **Pourquoi.** `invoiceRoutes.patch` ne refuse que `cancelled` et `paid`
  (`server/routes/invoices.ts`) : lignes, montants, client, date et échéance restent
  réécrits après envoi, en contradiction avec le discours produit, la rétention, le
  verrouillage de période et l'obligation de facture rectificative (C-8).
- **Référence.** Odoo applique exactement cette règle : « issuing a credit/debit note is the
  **only legal method** for canceling, refunding, or modifying a validated invoice », et le
  document émis n'est plus réécrit. C'est la référence retenue à la place d'une validation
  externe (R-2).
- **Fichiers.** `server/routes/invoices.ts`, `server/routes/quotes.ts`,
  `server/routes/credits.ts`, `src/features/invoices/InvoiceFormPage.tsx`.
- **Étapes.**
  1. Refuser `PATCH /invoices/:id` dès que `status !== 'draft'` : `409 DOCUMENT_IMMUTABLE`
     avec `{ document: 'invoice', status }`.
  2. Faire de même pour les devis **hors** `draft` (un devis envoyé se révise par un nouveau
     devis ou un refus, pas par réécriture) et pour les avoirs hors `draft`.
  3. Sur brouillon : remplacer l'écriture directe `balance = total` par `recalcInvoice` après
     la mise à jour (les crédits déjà appliqués ne doivent pas être écrasés).
  4. Interface : masquer/désactiver « Modifier » hors brouillon et afficher l'action
     « Créer un avoir » à la place ; message traduit FR/EN.
- **Critères d'acceptation.** `PATCH` sur `sent`/`partial` → 409 et aucune modification en
  base. `PATCH` sur brouillon → 200 et solde recalculé depuis les affectations.
- **Tests.** `tests/document-immutability.test.ts` : facture `sent` (409), `partial` (409),
  `paid` (409), `cancelled` (409), brouillon (200), devis `sent` (409), avoir `sent` (409).
- **Pièges.** Les tests existants qui modifient une facture envoyée devront passer par un
  avoir : vérifier `tests/` avant de changer le comportement, et corriger le test, pas le
  garde-fou.
- **Effort.** S. **Statut.** **DONE** — garde unique `assertEditable`
  (`server/services/status.ts`) et `loadDocumentForEdit` (`server/services/immutability.ts`),
  utilisés par `PATCH` factures, devis et avoirs : `409 DOCUMENT_IMMUTABLE` avec
  `{ document, status }`. Un brouillon reste éditable (nouveau `PATCH /credits/:id`), et le
  bouton « Modifier » suit `status === 'draft'`. Preuve : `tests/document-immutability.test.ts`.

### A-03 — Avoir créé depuis une facture : TVA, devise, change

- **But.** L'avoir reprend la TVA, la devise et le taux de la facture d'origine ; le total
  remboursé reste cohérent.
- **Pourquoi.** `POST /invoices/:id/credit-note` (`server/routes/invoices.ts:923`) crée un
  avoir `tax_exempt = 1` à `tax_rate = 0` sur un plafond **TTC**, sans
  `exchange_rate`/`currency_decimals`/`*_xpf`. La TVA n'est jamais reversée.
- **Référence.** Odoo : un avoir créé depuis une facture est **prérempli avec les détails exacts
  de la facture d'origine** (lignes, taxes, devise) et produit une **écriture inverse** qui
  annule les lignes de la facture. Le remboursement partiel est un avoir partiel, jamais une
  réécriture. C'est le comportement attendu ici (R-2).
- **Fichiers.** `server/routes/invoices.ts`, `server/routes/credits.ts`,
  `server/services/documents.ts`, `shared/tax.ts`, `server/services/status.ts`,
  `shared/archipelago.ts`.
- **Étapes.**
  1. Lire la facture source (`currency`, `exchange_rate`, `currency_decimals`, `line_items`,
     `discount_*`, `tax_exempt`, `total`, `paid_total`, `balance`).
  2. Construire l'avoir **au prorata** : montant demandé / total facture appliqué à chaque
     ligne (quantité × prix), en conservant `tax_rate` et `tax_status` de chaque ligne ;
     `computeTotals` donne le HT, la TVA et le TTC de l'avoir.
  3. Écrire `exchange_rate`, `currency_decimals`, `subtotal_xpf`, `tax_total_xpf`,
     `total_xpf` figés comme pour une facture, et **ne pas** forcer `tax_exempt` si la
     facture est taxée.
  4. Plafond : vérifier que le TTC de l'avoir ≤ `refundableAmount(...)` et que le HT ne
     dépasse pas le HT facturé.
  5. Avoir manuel (`POST /api/credits`) : vérifier qu'il accepte les mêmes champs devise/taux
     (déjà partiellement présent) et documenter la règle.
- **Critères d'acceptation.** Avoir de 113 000 TTC sur facture 13 % : HT 100 000, TVA 13 000,
  TTC 113 000, en devise d'origine. Aucun avoir `tax_exempt` créé depuis une facture taxée.
  Le plafond refuse un montant supérieur.
- **Tests.** `tests/credit-note-vat.test.ts` : facture 13 % (avoir partiel puis total),
  facture exonérée (avoir exonéré), facture EUR (devise et taux repris), dépassement (409),
  avoir sur facture soldée (plafond = payé).
- **Pièges.** Un avoir partiel doit répartir la remise globale de la facture, sinon la TVA
  reversée est fausse. Vérifier `discount_type = 'amount'`.
- **Effort.** M. **Statut.** **DONE** — `server/lib/credit-note.ts`, branché sur
  `POST /invoices/:id/credit-note` ; preuve `tests/credit-note.test.ts` (6 cas).

### A-04 — Miroir TVA des avoirs et déduction dans les états

- **But.** La TVA collectée des états = TVA des factures **moins** TVA des avoirs.
- **Pourquoi.** `/tva-recap` et `type = 'tax'` n'agrègent que `invoice_tax_lines` et
  `invoices` (`server/routes/dashboard.ts`) : un avoir ne réduit jamais la TVA déclarée.
- **Fichiers.** `server/db/schema.ts` (nouvelle table), `server/services/documents.ts`,
  `server/routes/dashboard.ts`, `server/routes/credits.ts`, `server/lib/reports.ts`.
- **Étapes.**
  1. Ajouter `credit_tax_lines` (même forme que `invoice_tax_lines` : `credit_id`, `rate`,
     `base`, `amount`, `UNIQUE(credit_id, rate)` + index).
  2. Écrire `syncCreditTaxLines` à chaque création/modification d'avoir, depuis le **même**
     `computeTotals` que les totaux stockés.
  3. Dans les deux lectures TVA : `UNION ALL` factures et avoirs en **soustrayant** la TVA des
     avoirs, et ne compter que les avoirs non `cancelled`/non supprimés.
  4. Réparer l'existant : passe idempotente qui reconstruit le miroir des avoirs (comme
     `ensureInvoiceTaxLines`).
  5. Adapter `tvaRecapCsv` pour que la colonne « TVA collectée » reste une somme exacte.
- **Critères d'acceptation.** Facture 100 000 HT / 13 000 TVA + avoir 50 000 HT / 6 500 TVA
  → état : base 50 000, TVA 6 500. Le CSV somme la même chose que l'écran.
- **Tests.** `tests/vat-credits.test.ts` : avoir total, avoir partiel, avoir exonéré sur
  facture taxée (refusé en amont), avoir supprimé (ignoré), réparation d'un miroir absent.
- **Pièges.** La marge (`/reports/margin`) soustrait déjà les avoirs : ne pas compter deux
  fois. Un avoir `draft` ne doit pas réduire la TVA déclarée (seulement `sent`/`partial`/
  `applied`).
- **Effort.** M. **Statut.** **DONE** — table `credit_tax_lines`, `syncCreditTaxLines` /
  `syncCreditFromRow` / `ensureCreditTaxLines` (`server/services/documents.ts`) ; miroir écrit à
  la création, à l'envoi, à l'édition d'un brouillon et depuis un avoir de facture. Le
  récapitulatif TVA et l'état `tax` soustraient les avoirs émis, en nettant par taux ; brouillons
  et avoirs supprimés sont ignorés. Preuve : `tests/vat-credits.test.ts` (4 cas).

### A-05 — Contre-écritures des paiements annulés et dépenses supprimées

- **But.** Annuler un règlement ou supprimer une dépense laisse le journal équilibré et
  sincère.
- **Pourquoi.** `DELETE /api/payments/:id` passe en `void` mais `syncAccounting` ne poste que
  `status = 'completed'` avec la clé `(source, id, 'completed')` : l'écriture reste. Idem
  pour une dépense supprimée (`expenses/posted`).
- **Fichiers.** `server/lib/accounting.ts`, `server/services/accounting.ts`,
  `server/routes/payments.ts`, `server/routes/operations.ts`.
- **Étapes.**
  1. Ajouter `paymentReversalLines(amount, reference, accounts, settlement)` = miroir exact de
     `paymentLines` (débit client, crédit banque, écart inversé).
  2. Ajouter `expenseReversalLines(...)` = miroir de `expenseLines`.
  3. Poster l'événement `voided` (paiement) et `reversed` (dépense) avec la même clé
     d'idempotence, depuis la route de suppression, **dans la même transaction logique** que
     le `UPDATE` (un `batch` si possible, sinon poster immédiatement après et rendre la
     réparation détectable).
  4. `syncAccounting` : poster aussi l'événement inverse pour tout paiement `void`/supprimé et
     toute dépense `deleted_at` non nulle qui n'a pas encore son reversal (rattrapage).
  5. Réutiliser `assertPeriodOpen` sur la date de l'écriture inverse.
- **Critères d'acceptation.** Paiement de 100 000 annulé → deux écritures, débit = crédit
  sur chacune, solde de trésorerie revenu à l'état antérieur, solde facture recalculé.
  Dépense supprimée → charge et TVA déductible annulées.
- **Tests.** `tests/accounting-reversals.test.ts` : paiement annulé, dépense supprimée,
  double annulation (pas de seconde écriture), période close (409), solde de balance à zéro.
- **Pièges.** Ne pas supprimer l'écriture d'origine (le journal est append-only). Ne pas
  inverser un paiement déjà inversé.
- **Effort.** M. **Statut.** **DONE** — `paymentReversalLines` / `expenseReversalLines`
  (`server/lib/accounting.ts`) et rattrapage idempotent dans `syncAccounting` : événements
  `voided` / `reversed` avec leur propre clé, le journal d'origine reste intact.
  Preuve : `tests/accounting-reversals.test.ts` (miroirs équilibrés, double passe sans doublon).

### A-06 — Approbations : re-contrôle et nouvelle demande

- **But.** Une approbation couvre un montant précis ; une correction peut être re-soumise.
- **Pourquoi.** `approvals` est unique `(entity_type, entity_id)` ; `requireApprovalIfNeeded`
  ne contrôle que `status = 'approved'`. Après approbation, une remise augmentée passe sans
  contrôle ; après refus, la demande est définitive (409 à vie).
- **Fichiers.** `server/db/schema.ts`, `server/services/approvals.ts`,
  `server/routes/approvals.ts`, `server/routes/invoices.ts`, `server/routes/credits.ts`,
  `server/routes/operations.ts`.
- **Étapes.**
  1. Reconstruire `approvals` dans une migration : `revision INTEGER NOT NULL DEFAULT 1`,
     `controlled_amount`, `controlled_discount` (valeurs **contrôlées**, pas celles du
     document), `superseded_at`, et `UNIQUE(entity_type, entity_id, revision)`.
     (SQLite ne sait pas retirer une contrainte inline : reconstruction de table obligatoire,
     cf. C-1/C-2.)
  2. `requireApprovalIfNeeded` : si la dernière décision est `approved`, comparer le montant
     et la remise **courants** aux valeurs contrôlées ; en cas d'écart, créer une révision
     `pending` et refuser `409 APPROVAL_REQUIRED` avec `{ previous: revision - 1 }`.
  3. Après un refus, une nouvelle demande crée une révision `pending` au lieu d'un 409
     définitif ; l'ancienne est `superseded_at`.
  4. Re-vérifier également **à l'émission** (`/send`, `/payments/:id` selon l'entité), pas
     seulement à la création.
  5. Interface : afficher la révision et le montant contrôlé ; bouton « Soumettre à nouveau »
     après refus.
- **Critères d'acceptation.** Remise 15 % approuvée puis portée à 35 % → nouveau 409.
  Document inchangé après approbation → envoi 200. Refus puis correction → nouvelle demande
  possible, ancienne conservée en historique.
- **Tests.** `tests/approvals-revision.test.ts` : approbation valable, dépassement après
  approbation, nouvelle demande après refus, auto-approbation toujours 403, historique
  conservé, `decideApproval` sur révision périmée (409).
- **Pièges.** L'unicité sert aussi d'idempotence : la remplacer par `(…, revision)` impose de
  recalculer « la dernière révision » explicitement (`ORDER BY revision DESC LIMIT 1`).
- **Effort.** L. **Statut.** DONE (2026-11-06). Révisions `(entity_type, entity_id, revision)` ; preuve dans le journal d'exécution.

---

## 4. Phase 2 — Multi-devises complet

### A-07 — Une seule règle d'agrégation : tout en XPF

- **But.** Tous les états additionnent des XPF ; aucune ligne ne mélange deux unités.
- **Pourquoi.** `revenue-summary` additionne `taxable`/`exempt` en `total` (devise) et `total`
  en `total_xpf` ; `aging` et `client-sales` additionnent `balance`/`i.balance` sans
  conversion (`server/routes/dashboard.ts`).
- **Fichiers.** `server/routes/dashboard.ts`, `server/lib/reports.ts`,
  `src/features/reports/ReportsPage.tsx`.
- **Étapes.**
  1. Introduire un helper SQL unique `BASE_AMOUNT(own, xpf)` documenté (CASE `xpf > 0 THEN
     xpf ELSE own`) et **l'utiliser partout**, y compris `balance` via
     `ROUND(balance * 1.0 * total_xpf / total)` (déjà fait pour les KPI).
  2. `revenue-summary` : `taxable_xpf`, `exempt_xpf`, `total_xpf` (colonnes ou alias), avec
     `taxable + exempt = total`.
  3. `aging` : convertir `balance` en XPF au prorata du document ; afficher la devise
     d'origine par ligne.
  4. `client-sales` : solde en XPF ; ajouter une colonne « dont devise » si utile à l'écran.
  5. Étiqueter les colonnes dans l'interface : « (XPF) » dans l'en-tête.
- **Critères d'acceptation.** Facture 1 000 EUR (taux 119,33) + facture 100 000 XPF :
  CA total = 219 330 ; `taxable + exempt = total` ; balance âgée = somme des soldes convertis.
- **Tests.** `tests/reports-multicurrency.test.ts` : chaque type de rapport avec un jeu
  mixte ; vérifier l'égalité `taxable + exempt = total` et la somme de la balance âgée.
- **Pièges.** Un document XPF a `total_xpf = total` : le CASE ne doit pas écraser un `0`
  légitime (document à total zéro). Les avoirs doivent suivre la même règle.
- **Effort.** M. **Statut.** DONE (2026-11-06). `baseAmountSql`/`baseBalanceSql` sont la règle unique ; preuve dans le journal.

### A-08 — Devise des dépenses et des bons de commande

- **But.** Une dépense ou un achat en devise est stocké avec son taux et sa base XPF.
- **Pourquoi.** `expenses` n'a **aucune** colonne devise ; `purchase_orders` a `currency`
  mais ni `exchange_rate` ni `total_xpf` ; `receivePurchaseOrder` utilise `line.unit_price`
  comme coût sans conversion.
- **Fichiers.** `server/db/schema.ts` (migration), `server/routes/operations.ts`,
  `server/services/stock.ts`, `server/routes/import.ts`, `server/lib/valuation.ts`.
- **Étapes.**
  1. Migration : `expenses.currency`, `expenses.exchange_rate`, `expenses.amount_xpf`,
     `expenses.tax_amount_xpf`; `purchase_orders.exchange_rate`, `.subtotal_xpf`,
     `.tax_total_xpf`, `.total_xpf`. Valeurs par défaut XPF/1/0 puis backfill.
  2. Routes dépenses/BC : accepter `currency`, figer le taux à la date, calculer la base.
  3. Réception d'achat : convertir le prix reçu en XPF **avant** le coût moyen
     (`landedUnitCost` prend une valeur XPF).
  4. Coût moyen et valorisation : documenter que `products.cost` est en XPF.
  5. Rapports dépenses/achats : agréger en XPF ; test mixte.
- **Critères d'acceptation.** Dépense 100 USD (taux 100) → `amount_xpf = 10 000` ; le
  résultat mensuel ne bouge pas quand la devise change sans impact XPF.
- **Tests.** `tests/expenses-fx.test.ts`, extension de `tests/landed-cost.test.ts` et
  `tests/stock-*` pour un BC en devise.
- **Pièges.** Un import CSV existant ne fournit pas la devise : défaut XPF, ne pas casser
  `tests/import*.test.ts`. Vérifier `tests/backup-restore.test.ts` après ajout de colonnes.
  Deux représentations du taux coexistent : `exchange_rate REAL` sur les documents (`invoices`,
  `quotes`, `credits`, `payments`, `recurring_invoices`) et `exchange_rate_micro INTEGER`
  (×1e6) sur `landed_cost_sheets` et `import_sheets`. Suivre la convention des documents pour
  les dépenses et les bons de commande, et **documenter** l'écart (précision des coûts
  d'import) plutôt que d'introduire une troisième forme.
- **Effort.** L. **Statut.** DONE (2026-11-06). `expenses` accepte `currency` et fige le taux à la date (0004 déjà en place) ; `createExpense`/`expenseFx` stockent `amount_xpf`/`tax_amount_xpf` ; les BC acceptent `currency` et enregistrent `exchange_rate` + `subtotal_xpf`/`tax_total_xpf`/`total_xpf` ; la réception valorise la ligne en XPF (`receiptUnitCost`) avant `landedUnitCost` ; les rapports dépenses/achats agrègent en XPF. Preuve : journal.### A-09 — Décimales : une seule source de vérité

- **But.** Le nombre de décimales affiché est celui de la devise configurée, pas une table
  codée en dur.
- **Pourquoi.** `currencies.decimals` accepte 0–4, mais `currencyDecimals()` renvoie 0 pour
  XPF/JPY et **2 sinon** (`shared/money.ts`) : une devise à 3 décimales s'affiche faux.
- **Fichiers.** `shared/money.ts`, `src/lib/format.ts`, `server/routes/currencies.ts`,
  `src/features/settings/SettingsPage.tsx`.
- **Étapes.**
  1. Faire passer le nombre de décimales depuis l'API (`decimals` déjà renvoyé par
     `/api/currencies` et figé sur les documents) jusqu'aux formateurs ; garder le map
     actuel comme **repli** quand la devise n'est pas chargée.
  2. Documenter la règle : `currencies.decimals` fait foi ; `currencyDecimals()` n'est qu'un
     défaut hors ligne.
  3. Aligner la saisie (`toMinor`) sur le même paramètre.
- **Critères d'acceptation.** Devise à 3 décimales : 1,234 s'affiche 1,234 et se stocke 1234.
  XPF reste sans décimale.
- **Tests.** `tests/money-decimals.test.ts` : XPF, EUR, KWD (3), devise inconnue (repli 2).
- **Pièges.** Les montants déjà stockés ne changent pas ; ne pas « corriger » rétroactivement.
- **Effort.** S. **Statut.** DONE (2026-11-06). `currencyDecimals(currency, decimals?)` ; preuve dans le journal.

---

## 5. Phase 3 — Schéma, migrations et intégrité

### A-10 — Migrations versionnées (remplace le DDL au premier appel)

- **But.** Chaque changement de schéma est un fichier daté, appliqué une fois, avec un
  historique lisible.
- **Pourquoi.** `server/db/index.ts` exécute le DDL à la première requête, avec ~150
  `PRAGMA table_info` + `ALTER` par montée de version ; `package.json` pointe vers
  `server/db/migrations/0001_init.sql` **inexistant** ; `wrangler.jsonc` déclare ce dossier.
- **Fichiers.** `server/db/migrations/`, `wrangler.jsonc`, `package.json`,
  `server/db/index.ts`, `server/db/schema.ts`, `deploy.json`, `README.md`.
- **Étapes.**
  1. `wrangler d1 migrations create managest-db baseline` puis figer `0001_baseline.sql` à
     partir des `CREATE TABLE/INDEX` **sans** les `INSERT`/`UPDATE` de seeds (C-6).
  2. Sortir les seeds (devises, catégories, tarifs, règles douanières, rôles système) dans un
     module idempotent séparé, appelé une fois après migration (`seedReferenceData`).
  3. Ajouter les migrations manquantes : index (A-11), tables TVA des avoirs (A-04),
     reconstruction `approvals` (A-06), colonnes devise (A-08).
  4. Conserver `ensureSchema` comme **filet** pour une base vide en développement, mais
     derrière un drapeau explicite (`SCHEMA_BOOTSTRAP=1`), et le retirer du chemin de requête
     en production.
  5. `npm run db:migrate:local` = `wrangler d1 migrations apply managest-db --local` ;
     documenter la commande distante dans `README.md`.
  6. Test de non-régression : base neuve migrée vs base créée par l'ancien chemin → même
     `sqlite_master` (tables, colonnes, index), hors `d1_migrations`.
- **Critères d'acceptation.** Une base neuve se crée par migrations seules ; aucune requête
  utilisateur n'exécute de DDL ; `d1_migrations` liste les versions ; un second `apply` ne
  fait rien.
- **Tests.** `tests/schema-migrations.test.ts` (parcours des fichiers, idempotence, égalité de
  `sqlite_master`), et `tests/schema-version.test.ts` (plus de PRAGMA par colonne).
- **Pièges.** `SCHEMA_STATEMENTS` contient un `DROP TABLE` et des `UPDATE` : ne pas les
  copier dans la baseline. Les seeds doivent rester rejouables après restauration de
  sauvegarde (A-17).
- **Effort.** L. **Statut.** TODO. `apply --remote` ne concerne qu'un déploiement Cloudflare,
  hors périmètre de ce projet (B-1) : tout le travail — fichiers de migration, tests, base
  locale — est livrable et vérifiable ici.

### A-11 — Indexation : ajouter les manquants, retirer le doublon

- **But.** Chaque requête listée dans l'audit §3.7 a un index qui la sert.
- **Pourquoi.** Aucun index sur `products`, `activities(entity_type, entity_id)`,
  `stock_movements(reference)`, `sessions(expires_at)` ; pas d'unicité sur les numéros de
  paiements/BC/récurrences ; `idx_stock_count_lines_product` déclaré deux fois
  (`server/db/schema.ts:1357-1358`).
- **Fichiers.** migration SQL, `server/db/schema.ts` (retrait du doublon), requêtes concernées.
- **Étapes.**
  1. Créer dans **une** migration :
     `idx_activities_entity (entity_type, entity_id, created_at DESC)`,
     `idx_stock_movements_reference (reference, reason)`,
     `idx_products_catalogue (deleted_at, family, lifecycle_status)`,
     `idx_products_type (item_type)`,
     `idx_clients_account (account_status, archived)`,
     `idx_sessions_expiry (expires_at)`,
     `UNIQUE idx_payments_number (number)`,
     `UNIQUE idx_purchase_orders_number (number)`,
     `UNIQUE idx_recurring_number (number)`.
  2. Index partiels pour le soft delete sur les grosses tables :
     `… ON invoices(client_id, date) WHERE deleted_at IS NULL`, idem `payments`, `credits`.
  3. Supprimer le doublon de `schema.ts`.
  4. Vérifier avec `EXPLAIN QUERY PLAN` avant/après sur les 5 requêtes de l'audit, et
     consigner les plans dans la preuve de la tâche.
- **Critères d'acceptation.** Les plans ne contiennent plus `SCAN activities` /
  `SCAN stock_movements` / `SCAN products` pour ces requêtes. Les unicités de numéros
  refusent un doublon (test).
- **Tests.** `tests/query-plans.test.ts` sur SQLite en mémoire (les plans sont ceux de SQLite,
  D1 s'appuyant dessus), et `tests/number-uniqueness.test.ts`.
- **Pièges.** Une unicité sur `number` casse une base qui contient déjà des doublons :
  détecter et signaler avant de créer l'index (`SELECT number, COUNT(*) … HAVING COUNT(*) > 1`).
  `NULL` reste autorisé plusieurs fois avec un index unique SQLite — comportement voulu.
- **Effort.** M. **Statut.** DONE (2026-11-06). Migration 0005 : `idx_activities_entity`, `idx_stock_movements_reference`, `idx_sessions_expiry`, `idx_products_deleted`, index partiels `invoices`/`payments`/`credits(client_id, date) WHERE deleted_at IS NULL`, unicités `payments`/`purchase_orders`/`recurring_invoices(number)` ; doublon `idx_stock_count_lines_product` retiré. Écart documenté : les index `products(family, lifecycle_status)` et `clients(account_status, archived)` de la fiche ne sont pas applicables — ces colonnes ne sont pas dans la baseline figée mais ajoutées par le filet de colonnes ; l'index catalogue porte donc sur `deleted_at`. Preuve : journal.### A-12 — Intégrité référentielle : décider et appliquer

- **But.** Le noyau financier ne peut pas contenir d'orphelin, ou l'écart est détecté
  automatiquement.
- **Pourquoi.** 4 FK pour 81 tables ; D1 **applique** les FK déclarées (C-1), donc l'absence
  de déclaration est le seul obstacle. Ajouter une FK à une table existante impose une
  reconstruction.
- **Fichiers.** migrations, `server/services/daily-run.ts` (contrôle), `server/routes/dashboard.ts`.
- **Étapes.**
  1. **Décision documentée** dans la migration : (a) reconstruction des tables du noyau
     (`payment_allocations.invoice_id`, `credit_allocations.*`, `invoice_tax_lines.invoice_id`,
     `journal_lines.entry_id`, `stock_movements.product_id`, `stock_lots.product_id`,
     `sessions.user_id`, `api_tokens.user_id`) avec FK `ON DELETE RESTRICT` ; ou (b) contrôle
     d'intégrité automatisé si la reconstruction est jugée trop risquée.
  2. Si (a) : migration par table — créer `_new`, copier, supprimer, renommer, recréer les
     index ; `PRAGMA defer_foreign_keys = on` pendant l'opération (C-1).
  3. Si (b) : `server/lib/integrity.ts` avec 8 requêtes `NOT EXISTS` (une par relation), exposé
     par le passage quotidien et une carte du tableau de bord ; journaliser tout écart.
  4. Interdire à la suppression logique de créer des orphelins « actifs » : un document
     supprimé ne doit plus être référencé par une allocation nouvelle (déjà vrai, à tester).
- **Critères d'acceptation.** Soit les FK existent et refusent un `INSERT` orphelin (test),
  soit le contrôle renvoie 0 écart sur une base saine et 1 sur une base trafiquée.
- **Tests.** `tests/integrity.test.ts` (les deux variantes selon la décision), et un test
  « suppression d'un client avec factures » qui vérifie le comportement choisi.
- **Pièges.** `ON DELETE CASCADE` n'a de sens que si les suppressions physiques existent ;
  ici tout est logique, donc `RESTRICT` est le bon défaut. Ne pas activer de cascade sur des
  documents financiers.
- **Effort.** L. **Statut.** DONE (2026-11-06). Variante (b) retenue et motivée : reconstruire huit tables financières sur une base vivante est plus risqué que mesurer l'écart, et D1 n'applique que les FK déclarées. `server/lib/integrity.ts` (`INTEGRITY_RELATIONS`, `relationGaps`, `integrityReport`) vérifie les 8 relations par `NOT EXISTS` ; `GET /dashboard/integrity` expose la carte et `runDailyPipeline` journalise `integrity_gap` + `RunSummary.integrity_gaps` quand le total n'est pas nul. Preuve : journal d'exécution.### A-13 — Contraintes de cohérence dans la base

- **But.** La base refuse ce que le code ne devrait jamais écrire.
- **Pourquoi.** Aucun `CHECK` sur les montants, le grand livre, la cardinalité `company` ni
  l'unicité de `is_base`.
- **Fichiers.** migrations, `server/db/schema.ts`, tests.
- **Étapes.**
  1. `journal_lines` : `CHECK (debit >= 0 AND credit >= 0 AND (debit = 0 OR credit = 0))`
     (reconstruction de table).
  2. `payments`, `invoices`, `credits`, `expenses` : `CHECK (amount >= 0)`, `CHECK (balance >= 0)`
     là où applicable.
  3. `CREATE UNIQUE INDEX … ON currencies(is_base) WHERE is_base = 1`.
  4. Société unique : `CREATE UNIQUE INDEX … ON company(id) WHERE …` impossible sur une PK ;
     utiliser une colonne `singleton INTEGER NOT NULL DEFAULT 1 CHECK (singleton = 1)` +
     index unique, ou une table `app_meta(key='company_id')` comme source.
  5. Mettre à jour `server/types.ts` et les requêtes `LIMIT 1` si la cardinalité devient
     garantie.
- **Critères d'acceptation.** Un `INSERT` de ligne de journal avec débit et crédit non nuls
  échoue ; deux devises de base échouent ; deux sociétés échouent.
- **Tests.** `tests/db-constraints.test.ts`.
- **Pièges.** Les tests existants insèrent des montants `0` : vérifier que les `CHECK`
  autorisent `0`. Attention aux lignes de journal d'annulation (débit et crédit peuvent être
  nuls tous les deux pour un montant nul — décider et tester).
- **Effort.** M. **Statut.** DONE (2026-11-06). Migration 0006 : `journal_lines` reconstruite avec `CHECK (debit >= 0)`, `CHECK (credit >= 0)` et `CHECK (debit = 0 OR credit = 0)` ; `UNIQUE INDEX currencies(is_base) WHERE is_base = 1` (après normalisation sur XPF) ; colonne `company.singleton` + index unique ; montants négatifs refusés par déclencheurs sur `payments.amount`, `invoices.balance`, `credits.total`, `expenses.amount`. Écart documenté : l'étape 2 utilise des déclencheurs (refus au niveau base) au lieu de reconstruire quatre tables financières — même garantie sans copie risquée ; `0` reste autorisé, y compris l'extourne à débit et crédit nuls. Preuve : journal d'exécution.### A-14 — Stock : une vérité, ou un écart mesuré

- **But.** `products.quantity_milli` n'est plus une troisième comptabilité parallèle.
- **Pourquoi.** Trois quantités coexistent ; le retour client met à jour `stock_lots` mais
  **pas** `lot_balances`, et aucune réconciliation n'existe.
- **Fichiers.** `server/services/stock.ts`, `server/routes/invoices.ts` (retours),
  `server/routes/products.ts`, `server/lib/valuation.ts`, `server/services/daily-run.ts`.
- **Étapes.**
  1. Écrire `lot_balances` dans le chemin de retour client (même clé lot + emplacement que la
     sortie), et une ligne `stock_valuations` pour le retour.
  2. Ajouter `stockBalance(database)` : par produit, `SUM(mouvements signés)`,
     `products.quantity_milli`, `SUM(stock_lots.quantity_milli)`, `SUM(lot_balances)` ;
     exposer les écarts (route + carte tableau de bord + journal).
  3. Décider la source de vérité pour la disponibilité : recommandé = compteur produit
     **uniquement** comme cache, recalculé par le passage quotidien à partir des mouvements ;
     documenter le choix dans `ARCHITECTURE.md`.
  4. Valider les nomenclatures : refuser l'enregistrement d'un `bom`/`substitutes`/
     `accessories` référençant un produit supprimé ; à la consommation, **refuser** un kit
     dont un composant manque au lieu de l'ignorer silencieusement.
  5. Test de propriété : vente → retour → assemblage → désassemblage, somme des mouvements =
     quantité en main à chaque étape.
- **Critères d'acceptation.** Après le scénario, les quatre quantités sont égales. Un kit avec
  composant supprimé est refusé avec un code explicite.
- **Tests.** `tests/stock-integrity.test.ts`, extension de `tests/stock-returns.test.ts` et
  `tests/kit-explosion.test.ts`.
- **Pièges.** Le compteur peut déjà être faux en base existante : la réconciliation doit
  produire un **rapport** avant toute correction automatique, jamais un écrasement silencieux.
- **Effort.** L. **Statut.** DONE (2026-11-06). Mouvements = vérité, compteur = cache : le passage
  quotidien **rapporte** les écarts (`stock_gaps`, activité `stock_gap`, carte
  `GET /dashboard/stock-balance`) et ne réécrit jamais un compteur — une correction silencieuse
  effacerait la preuve du mouvement fautif (écart assumé avec l'étape 3, qui suggérait un
  recalcul ; `docs/ARCHITECTURE.md` documente le choix). Le retour client écrit `lot_balances`
  et `stock_valuations` (même clé lot + emplacement que la sortie) ; `receiptUnitCost` reste la
  seule conversion. Nomenclatures : `unresolvedReferences` refuse un `bom`/`substitutes`/
  `accessories` pointant sur un produit supprimé, et `consumeInvoiceStock` refuse un kit
  incomplet en `422 KIT_COMPONENT_MISSING` au lieu de l'ignorer. Preuve :
  `tests/stock-integrity.test.ts`, 5 cas (réception → assemblage → vente → désassemblage avec
  `counter_gap_milli`/`shelf_gap_milli` nuls à chaque étape, compteur trafiqué détecté et
  conservé, écart de casier nommé, kit supprimé refusé, références manquantes nommées) ;
  mutations vérifiées : désactiver la garde kit ou l'écart de casier fait échouer deux cas.

### A-15 — Respecter les plafonds D1 dans les requêtes

- **But.** Aucune requête ne dépasse 100 paramètres liés ni 50 octets de motif `LIKE`.
- **Pourquoi.** `lineItemsSchema` accepte 200 lignes → `IN (…)` jusqu'à 200 identifiants dans
  `invoices.ts`, `stock.ts`, `products.ts`, `operations.ts` ; la recherche globale n'a aucune
  limite de longueur (`dashboard.ts:546`). Limites : 100 paramètres, motif 50 octets (C-3).
- **Fichiers.** `server/lib/validation.ts`, `server/routes/dashboard.ts`,
  `server/routes/invoices.ts`, `server/services/stock.ts`, `server/routes/products.ts`,
  `server/routes/operations.ts`, nouveau `server/lib/sql.ts`.
- **Étapes.**
  1. Helper `chunks(ids, 90)` + `inClause(ids)` qui découpe et fusionne les résultats.
  2. Appliquer aux **25 occurrences** de `IN (${…})` recensées dans `server/` (dont
     `services/lots.ts`, `services/stock.ts`, `services/accounting.ts`, `routes/invoices.ts`,
     `routes/operations.ts`, `routes/products.ts`).
  3. Recherche : refuser au-delà de 50 octets (`422 VALIDATION_ERROR { q: 'too_long' }`) ou
     tronquer explicitement, et normaliser (trim, minuscules) ; documenter dans l'API.
  4. Vérifier la taille des `line_items` (200 lignes × texte 500) vis-à-vis de la limite de
     ligne 2 Mo ; refuser au-delà avec un code clair.
  5. Mesurer le nombre de requêtes par invocation des routes les plus lourdes (log local) et
     consigner les valeurs.
- **Critères d'acceptation.** Facture à 200 lignes : envoi et retour fonctionnent. Recherche
  de 120 caractères : réponse 422, pas une erreur D1.
- **Tests.** `tests/sql-chunking.test.ts` (90/91/200 identifiants, ordre préservé),
  `tests/search-limits.test.ts`.
- **Pièges.** `chunks` doit préserver l'ordre attendu par les appelants ; certaines requêtes
  font `Map` sur les résultats, d'autres un tableau — vérifier chaque site.
- **Effort.** M. **Statut.** DONE (2026-11-06). `server/db/migrations/` + `runMigrations()` ; preuve dans le journal.

---

## 6. Phase 4 — Requêtes et performance

### A-16 — Projections au lieu de `SELECT *` sur les listes

- **But.** Les listes ne lisent plus le JSON `line_items` de chaque document.
- **Pourquoi.** `SELECT i.*` dans la liste des factures, `SELECT *` sur `clients` et sur
  `public_links` : octets et lignes D1 inutiles, payload alourdi.
- **Fichiers.** `server/routes/invoices.ts`, `clients.ts`, `quotes.ts`, `credits.ts`,
  `payments.ts`, `public-links.ts`.
- **Étapes.**
  1. Lister les colonnes réellement affichées (écran + export) et écrire la projection.
  2. Conserver `line_items` uniquement sur le détail (`GET /:id`).
  3. Vérifier que les tests UI (`tests/ui-*.test.ts`) et les composants ne dépendent pas d'un
     champ retiré.
- **Critères d'acceptation.** La liste ne renvoie plus `line_items` ; le détail le renvoie ;
  taille de réponse mesurée avant/après sur un jeu de 100 factures.
- **Tests.** `tests/list-projection.test.ts` (colonnes attendues, absence de `line_items`).
- **Pièges.** Le drawer « Voir » lit la ligne de liste : vérifier qu'il n'a pas besoin d'un
  champ retiré.
- **Effort.** M. **Statut.** TODO.

### A-17 — Recherche plein texte (FTS5) et sauvegarde compatible

- **But.** La recherche globale et les listes filtrent sans `LIKE '%…%'`.
- **Pourquoi.** 10 routes en `LIKE` non indexable, et une limite de 50 octets sur le motif.
- **Fichiers.** migration (tables virtuelles + triggers), `server/routes/dashboard.ts`,
  `server/lib/backup.ts`, `tests/backup-restore.test.ts`.
- **Étapes.**
  1. Créer une table **ordinaire** `search_documents(kind, ref_id, title, body)` alimentée par
     des triggers `AFTER INSERT/UPDATE/DELETE` sur clients, factures, devis, produits, puis une
     table FTS5 en **contenu externe** `USING fts5(title, body, content='search_documents',
     content_rowid='rowid')` (C-4). Une table « sans contenu » (`content=''`) est écartée : sa
     mise à jour exige des `INSERT … VALUES('delete', …)`, plus fragiles et invisibles à la
     sauvegarde.
  2. Route de recherche : `MATCH` + `bm25()` + `snippet()`, filtrée par permissions.
  3. **Sauvegarde** : exclure la table virtuelle et ses tables d'ombre (`search_index_data`,
     `_idx`, `_docsize`, `_config`) de `listWorkspaceTables`/export, mais **conserver**
     `search_documents` ; après restauration, recréer l'index et `INSERT INTO search_index(search_index)
     VALUES('rebuild')` (C-5).
  4. Tests : recherche accentuée/insensible à la casse, restauration puis recherche à nouveau
     fonctionnelle.
- **Critères d'acceptation.** « société » trouve « Société », « cafe » trouve « café » (selon
  tokenizer choisi) ; l'export ne contient aucune table virtuelle ; après restauration la
  recherche fonctionne.
- **Tests.** `tests/search-fts.test.ts`, extension de `tests/backup-restore.test.ts`.
- **Pièges.** Un export D1 bloquerait sur une table virtuelle (C-5) : la documentation de
  sauvegarde doit le dire. Ne pas indexer de données personnelles inutiles (RGPD).
- **Effort.** L. **Statut.** TODO.

### A-18 — Comptabilité incrémentale

- **But.** Lire la comptabilité ne relit plus tous les documents.
- **Pourquoi.** `syncAccounting` charge toutes les factures/avoirs/paiements/dépenses et poste
  une écriture par document manquant, à chaque lecture — coût linéaire en requêtes, plafond
  de 1 000 requêtes par invocation (C-3).
- **Fichiers.** `server/services/accounting.ts`, `server/routes/accounting.ts`,
  `server/routes/invoices.ts`, `payments.ts`, `credits.ts`, `operations.ts`.
- **Étapes.**
  1. Poster à l'écriture (émission, annulation, encaissement, avoir, dépense) via
     `postJournalEntry`, déjà idempotent.
  2. Garder `syncAccounting` comme **outil de réparation administrative** (route explicite,
     permission `accounting.write`), plus comme chemin de lecture.
  3. Ajouter un curseur (`app_meta.journal_synced_at`) pour un rattrapage borné (N documents
     par appel) au lieu d'un balayage complet.
  4. Mesurer : nombre de requêtes D1 par lecture avant/après, consigné dans la preuve.
- **Critères d'acceptation.** `GET /api/accounting/trial-balance` n'émet plus qu'un nombre
  constant de requêtes ; une facture envoyée est postée immédiatement ; le rattrapage reste
  idempotent.
- **Tests.** `tests/accounting-incremental.test.ts` (posting immédiat, pas de doublon,
  rattrapage après insertion manuelle).
- **Pièges.** L'ordre des écritures (facture avant paiement) ne doit pas créer de doublon :
  la clé `(source, id, event)` protège. Attention aux périodes closes.
- **Effort.** L. **Statut.** TODO.

### A-19 — Chaîne d'audit sans course

- **But.** Deux écritures simultanées ne cassent plus la chaîne.
- **Pourquoi.** `logActivity` lit le dernier `hash` puis insère ; entre les deux, une autre
  requête peut insérer. D1 sérialise **chaque requête**, pas la séquence (C-2).
- **Fichiers.** `server/lib/audit.ts`, migration (`activities.seq`, table `audit_tail`),
  `scripts/concurrency-check.mjs`.
- **Étapes.**
  1. Ajouter `seq INTEGER` + index unique, et une ligne `audit_tail(id=1, seq)`.
  2. Réclamer un `seq` par `UPDATE audit_tail SET seq = seq + 1 … RETURNING seq` (atomique),
     puis insérer dans le **même `batch`** avec `prev_hash = (SELECT hash FROM activities WHERE
     seq = ? - 1)`.
  3. Vérificateur : exiger `seq` contigu et `prev_hash` égal au hash du `seq - 1` ; tolérer
     l'absence de `seq` sur les lignes antérieures (début de chaîne).
  4. Test de concurrence : N écritures en parallèle (Promise.all) → chaîne valide, N lignes.
- **Critères d'acceptation.** 50 écritures concurrentes → `verifyActivityChain` OK, aucune
  rupture ; l'ordre est total.
- **Tests.** `tests/audit-chain-concurrency.test.ts`, mise à jour de
  `tests/audit-coverage.test.ts`.
- **Pièges.** Une écriture qui échoue après la réclamation laisse un trou de `seq` : décider
  (trou toléré et signalé, ou rejeu). Ne pas réécrire les lignes existantes.
- **Effort.** M. **Statut.** TODO.

---

## 7. Phase 5 — Sécurité et exploitation

### A-20 — Limitation des tentatives par IP et par compte

- **But.** Ni verrouillage ciblé facile, ni balayage massif depuis une IP.
- **Pourquoi.** `MAX_ATTEMPTS = 8` par **e-mail** seulement (`server/routes/auth.ts`) : un
  attaquant verrouille un compte connu ; aucune limite par IP.
- **Fichiers.** `server/routes/auth.ts`, `server/lib/limits.ts` (nouveau), migration (index
  `login_attempts(ip, created_at)`), `tests/password-reset.test.ts` (quota déjà testé).
- **Étapes.**
  1. Compter par e-mail **et** par IP sur la fenêtre ; refuser avec `429` +
     `Retry-After` calculé.
  2. Ajouter un délai progressif (temporisation) plutôt qu'un blocage dur après 8 échecs par
     compte, pour ne pas offrir un déni de service.
  3. Purger les tentatives > 90 jours dans le passage quotidien.
  4. Journaliser les refus (sans le mot de passe, sans l'e-mail complet).
- **Critères d'acceptation.** 8 échecs sur un compte puis un mot de passe correct → `429`
  avec `Retry-After`, puis succès après la fenêtre. 50 échecs depuis une IP sur 50 comptes →
  `429` sur l'IP.
- **Tests.** `tests/login-throttle.test.ts`.
- **Pièges.** Ne pas révéler l'existence d'un compte par un message différent.
- **Effort.** S. **Statut.** TODO.

### A-21 — En-têtes de sécurité sur l'origine réelle

- **But.** CSP/HSTS émis partout où c'est possible, et politique d'iframe cohérente.
- **Pourquoi.** `securityHeaders` conditionne CSP/HSTS à `url.protocol === 'https:'` ; derrière
  le proxy, le Worker voit du HTTP. `X-Frame-Options: DENY` + `frame-ancestors 'none'`
  contredisent `cookieSecurity()` écrit pour une iframe `.style.dev`.
- **Fichiers.** `server/middleware.ts`, `server/services/session.ts`, `docs/SECURITE.md`.
- **Étapes.**
  1. Décider : (a) iframe de préversion supportée → `frame-ancestors` limité à l'origine de
     préversion et suppression de `X-Frame-Options` sur ce chemin ; ou (b) iframe non
     supportée → retirer le mode `SameSite=None/Partitioned` et documenter.
  2. Émettre CSP/HSTS dès que `x-forwarded-proto: https` ou hôte `.style.dev`, pas seulement
     sur `url.protocol`.
  3. Test d'en-têtes sur trois origines (localhost, style.dev, https réel).
- **Critères d'acceptation.** Une seule politique cohérente, vérifiée par test ; la préversion
  s'affiche ou ne s'affiche pas, mais pas « parfois ».
- **Tests.** `tests/security-headers.test.ts` (matrice origine × en-têtes).
- **Pièges.** Ne pas élargir `frame-ancestors` à `*`. Vérifier que le PDF et les assets
  gardent `nosniff`.
- **Effort.** M. **Statut.** TODO.

### A-22 — Ré-authentification pour changer un facteur

- **But.** Activer/désactiver la MFA exige le mot de passe courant.
- **Pourquoi.** `mfa/setup` + `mfa/enable` n'exigent que la session : une session volée peut
  activer l'authentificateur de l'attaquant et verrouiller le propriétaire.
- **Fichiers.** `server/routes/auth.ts`, `tests/mfa-flow.test.ts`,
  `src/features/settings/ProfilePage.tsx`.
- **Étapes.**
  1. `mfa/setup`, `mfa/enable`, `mfa/disable` : exiger `current_password` (ou un code TOTP
     valide pour `disable`).
  2. Échec → `401 INVALID_CREDENTIALS`, compté dans la limitation.
  3. Journaliser le changement de facteur avec l'IP.
  4. Interface : champ mot de passe dans le panneau MFA.
- **Critères d'acceptation.** Sans mot de passe → 401 ; avec → 200 ; le flux existant
  (`tests/mfa-flow.test.ts`) passe avec le mot de passe ajouté.
- **Tests.** `tests/mfa-flow.test.ts` étendu (4 cas).
- **Pièges.** Ne pas casser la connexion MFA (le défi de 5 min reste inchangé).
- **Effort.** S. **Statut.** TODO.

### A-23 — Installation : verrou et limitation

- **But.** Une seule société, une seule installation, même sous concurrence.
- **Pourquoi.** `setup/install` teste `loadCompany` puis insère ; deux appels simultanés
  peuvent créer deux sociétés (`LIMIT 1` en choisit une). Aucune limitation.
- **Fichiers.** `server/routes/setup.ts`, migration (contrainte singleton, cf. A-13),
  `docs/SECURITE.md`, `README.md`.
- **Étapes.**
  1. Contrainte d'unicité (A-13) + insertion conditionnelle `INSERT … WHERE NOT EXISTS
     (SELECT 1 FROM company)` dans un `batch` avec l'utilisateur.
  2. Limitation par IP (réutiliser A-20) sur `/install` et `/recover-owner`.
  3. Documenter explicitement : une préversion non configurée donne le rôle propriétaire au
     premier visiteur ; ne jamais l'exposer publiquement.
- **Critères d'acceptation.** Deux installations concurrentes → une seule société, l'autre
  reçoit `409 ALREADY_CONFIGURED`. 6e tentative → 429.
- **Tests.** `tests/setup-concurrency.test.ts`.
- **Pièges.** `recover-owner` reste à usage unique ; ne pas affaiblir sa protection.
- **Effort.** S. **Statut.** TODO.

### A-24 — Rétention et purges

- **But.** La base ne croît plus indéfiniment et les données personnelles ont une durée.
- **Pourquoi.** Aucune purge de `activities`, `login_attempts`, `sessions` expirées,
  `public_link_access`, `mfa_challenges`, `attachment_chunks` orphelins ; D1 plafonne à 10 Go
  (C-3).
- **Fichiers.** `server/services/daily-run.ts`, `server/lib/retention.ts` (étendre),
  `docs/SECURITE.md`, migration (index `activities(created_at)`, `sessions(expires_at)`).
- **Étapes.**
  1. Table de politiques : `activities` 10 ans (exigence comptable), `login_attempts` 90 j,
     `sessions` expirées 30 j, `public_link_access` 12 mois, `mfa_challenges` 7 j,
     `password_reset_tokens` 24 h (déjà), morceaux orphelins 1 j.
  2. Passe de purge par lots (`LIMIT 500` en boucle bornée) dans le passage quotidien, avec
     compte rendu dans `daily_runs.summary_json`.
  3. Route de diagnostic : nombre de lignes et taille estimée par table.
  4. Documenter la politique dans `SECURITE.md` et `PENDING.md`.
- **Critères d'acceptation.** Un jeu de données ancien est purgé selon la politique, sans
  jamais toucher aux documents financiers ; la purge est journalisée.
- **Tests.** `tests/retention-purge.test.ts` (chaque politique, bornes, idempotence).
- **Pièges.** Ne jamais purger `activities` avant la durée comptable ; ne pas supprimer un
  morceau d'attachement référencé.
- **Effort.** M. **Statut.** TODO.

### A-25 — Observabilité métier

- **But.** Les écarts deviennent visibles avant l'incident.
- **Pourquoi.** Le tableau de bord expose l'activité, pas la santé des données (écart de
  stock, intégrité, échecs de passage, taille des tables).
- **Fichiers.** `server/routes/dashboard.ts`, `server/services/daily-run.ts`,
  `src/features/dashboard/DashboardPage.tsx`, `GET /api/health`.
- **Étapes.**
  1. Compteurs : écarts de stock (A-14), écarts d'intégrité (A-12), écritures comptables en
     retard (A-18), derniers échecs de passage, taille des 10 plus grosses tables.
  2. `/api/health` enrichi (version de schéma, dernière migration, état des purges) sans
     donnée sensible.
  3. Carte tableau de bord réservée à `activity.read`/`accounting.read`.
- **Critères d'acceptation.** Un écart injecté apparaît sur le tableau de bord et dans
  `/api/health`.
- **Tests.** `tests/observability.test.ts`.
- **Pièges.** Aucune donnée personnelle dans `/api/health` (public).
- **Effort.** M. **Statut.** TODO.

---

## 8. Phase 6 — Qualité, tests et documentation

### A-26 — Tests d'intégration HTTP sur D1 locale

- **But.** Les P0 sont couverts par des tests qui échouent avant correctif.
- **Pourquoi.** 698 tests passent sans base ni HTTP ; les chemins des P0 ne sont pas couverts.
- **Fichiers.** `vitest.config.ts`, `scripts/`, `tests/integration/`, `package.json`.
- **Étapes.**
  1. Choisir le harnais : `@cloudflare/vitest-pool-workers` (à valider avec Vitest 5 et
     `@cloudflare/workers-types`) **ou** un script qui démarre `wrangler dev --local` sur une
     base migrée et appelle l'API en `fetch` (déjà utilisé par `scripts/check-*.py`).
  2. Écrire un test par P0 : encaissement devise, immutabilité, avoir TVA, TVA des avoirs,
     contre-écriture, approbations.
  3. Test de propriété stock (vente/retour/assemblage).
  4. Test de rapport multi-devises (EUR + XPF).
  5. Brancher dans `npm test` ou une commande séparée `npm run test:integration` documentée.
- **Critères d'acceptation.** Les six tests échouent sur le code actuel (preuve), passent
  après correctifs.
- **Tests.** Ce sont eux.
- **Pièges.** Une base D1 locale doit être migrée par A-10 avant ; ne pas dépendre d'un état
  résiduel (recréer la base à chaque exécution).
- **Effort.** L. **Statut.** TODO.

### A-27 — Documentation remise d'aplomb

- **But.** La documentation dit ce que le code fait.
- **Pourquoi.** L'ancien `docs/AUDIT.md` annonçait 26 tables / 28 index (réel : 81 / 68) et
  listait comme manquants des modules livrés ; il est désormais **archivé figé** avec l'audit du
  28 octobre, et sa note d'archive doit dire lesquels de ses chiffres sont périmés. `README.md`
  ne mentionnait pas le plan du 6 novembre ; les limites assumées (CSRF anonyme, devise des
  dépenses, immutabilité) ne sont pas écrites.
- **Fichiers.** `docs/archive/README.md`, `README.md`, `docs/SECURITE.md`,
  `docs/build/PENDING.md`, `docs/ARCHITECTURE.md`.
- **Étapes.**
  1. **Ne pas corriger l'ancien audit** : il déménage dans
     `docs/archive/audit-2026-10-28/AUDIT.md` sans réécriture, et la note d'archive dit que ses
     §5/§6 sont périmés et renvoie à l'audit du 6 novembre (règle du dossier : un document
     périmé déménage, il n'est ni réécrit ni supprimé).
  2. Ajouter ce plan et l'audit à la liste de documentation du `README.md`.
  3. Consigner dans `PENDING.md` : CSRF des routes anonymes, devise des dépenses tant que
     A-08 n'est pas fait, devise des BC, absence de planificateur.
  4. Documenter la politique de rétention et la règle « tout agrège en XPF ».
- **Critères d'acceptation.** Aucun chiffre faux dans les documents **vivants** ; l'ancien audit
  est archivé sans modification et signalé comme périmé ; chaque limite connue est écrite une
  fois, à un endroit.
- **Tests.** Relecture croisée : chaque affirmation de table/index vérifiée par une commande.
- **Pièges.** Ne pas présenter A-26 comme fait avant qu'il ne le soit.
- **Effort.** S. **Statut.** TODO.

### A-28 — Tests de concurrence

- **But.** Les courses identifiées sont reproduites puis verrouillées.
- **Pourquoi.** Aucun test de concurrence ; journal chaîné, verrou de période, double
  installation, double envoi.
- **Fichiers.** `scripts/concurrency-check.mjs`, `tests/concurrency/`.
- **Étapes.**
  1. Double envoi simultané d'une facture → un seul `sent`, un seul mouvement de stock.
  2. Deux encaissements simultanés du même solde → un seul passe (ou second refusé).
  3. Clôture de période concurrente à une écriture → issue déterministe et documentée.
  4. Double installation (A-23) et 50 écritures d'audit (A-19).
- **Critères d'acceptation.** Chaque scénario a une issue définie, testée, et la base reste
  cohérente.
- **Tests.** Ces scripts, exécutés en CI.
- **Pièges.** D1 local (`wrangler dev`) sérialise aussi : la concurrence réelle doit être
  simulée par des requêtes parallèles, pas par des threads SQLite.
- **Effort.** M. **Statut.** TODO.

### A-29 — Aucune valeur métier en dur (R-1, R-2, R-3)

- **But.** Tout seuil, taux, délai, plafond ou compte qui décide d'un comportement est un
  réglage livré avec un défaut standard documenté.
- **Pourquoi.** Le registre existe déjà et couvre fiscalité, comptes, approbations, tarifs : la
  règle est à **généraliser**, pas à inventer. Restent des valeurs de règle en dur, par exemple
  `MAX_ATTEMPTS = 8` (`server/routes/auth.ts:21`) ou le plafond de 200 lignes d'un document
  (`server/lib/validation.ts:79`), et des littéraux dispersés dans les services.
- **Fichiers.** `server/lib/settings-extra.ts`, `shared/domain.ts`, `server/routes/settings.ts`,
  `src/features/settings/SettingsPage.tsx`, `docs/CONFORMITE.md`,
  `tests/settings-coverage.test.ts` (nouveau).
- **Étapes.**
  1. Inventaire mécanique : extraire les littéraux numériques et les codes de compte des chemins
     de règle (`server/services`, `server/lib`, `shared`) et les classer en trois colonnes :
     **métier** (→ réglage), **garde-fou technique** (→ constante commentée), **plafond de
     plateforme** (C-3).
  2. Pour chaque valeur métier : clé dans `EXTRA_KEYS`, défaut dans `EXTRA_DEFAULTS` avec **la
     source en commentaire** (DICP, PCG, Odoo, pratique du secteur), validation dans
     `EXTRA_RULES`, libellé FR/EN, champ dans Paramètres. Le défaut reproduit le comportement
     actuel, sauf si l'audit a prouvé que celui-ci est faux (A-01…A-09).
  3. Consommer la clé via `getExtra`/`getAccountCodes` : aucun `?? 8` ni `|| 200` ne doit
     subsister dans un chemin de décision.
  4. Écrire dans `CONFORMITE.md` la table « valeur → défaut → source → où la changer ».
  5. Test de couverture : pour chaque clé, écrire le réglage change le résultat observable.
- **Critères d'acceptation.** Aucune valeur métier littérale dans une décision (revue + test de
  recherche) ; chaque réglage a un défaut sourcé, une plage et un effet prouvé ; une
  installation neuve se comporte comme aujourd'hui, sauf correction documentée.
- **Tests.** `tests/settings-coverage.test.ts` (clé par clé : défaut, validation, effet) ;
  extension de `tests/settings-extra.test.ts`.
- **Pièges.** Ne pas transformer un garde-fou technique en réglage (les 100 paramètres liés de
  D1 ne se négocient pas). Ne pas changer un défaut sans décider du sort des lectures passées :
  un réglage livré à une nouvelle valeur peut modifier un état déjà calculé.
- **Effort.** M. **Statut.** TODO.

### A-30 — Autorité sur les paramètres (R-4)

- **But.** Seuls les rôles à autorité écrivent les paramètres, chaque écriture laisse une trace
  lisible, et personne ne peut élargir ses propres droits.
- **Pourquoi.** La matrice est **déjà conforme** (`shared/domain.ts:123-132` : `owner` et `admin`
  ont `PERMISSIONS`, `accountant` n'a que `settings.read`) et les routes sont gatées. Ce qui
  manque n'est pas le contrôle mais **la preuve** : aucun test ne fige la matrice, et le journal
  d'une écriture ne contient que la **nouvelle** valeur — `meta: { key, value }` pour le `PUT`
  (`server/routes/settings.ts:355`) comme pour le `PATCH` en lot (`:330`) — jamais l'ancienne, si
  bien qu'on ne peut pas dire ce qui a été changé sans le deviner.
- **Fichiers.** `shared/domain.ts`, `server/routes/settings.ts`, `server/routes/roles.ts`,
  `server/lib/audit.ts`, `src/features/settings/SettingsPage.tsx`,
  `tests/settings-authority.test.ts` (nouveau).
- **Étapes.**
  1. Test de matrice : `owner`/`admin` → 200 sur `PATCH /api/settings/extras` ;
     `accountant`/`sales`/`viewer` → 403. Figer aussi `settings.read` (accountant oui,
     sales/viewer non).
  2. Journaliser chaque écriture avec `{key, before, after}` (jamais un secret : masquer les
     valeurs de messagerie et de jetons) et exposer cet historique dans Paramètres → Journal.
  3. Vérifier le chemin d'élévation : un porteur de `users.write` ne peut pas s'attribuer un rôle
     ou une permission qu'il ne possède pas (`403 SELF_ESCALATION`) ; seul le propriétaire nomme
     un administrateur.
  4. Interface : lecture visible avec `settings.read`, champs désactivés sans `settings.write` ;
     le serveur reste seul juge (test 403 sur appel direct).
  5. Documenter « qui peut changer quoi » dans `SECURITE.md`, matrice en tableau.
- **Critères d'acceptation.** `accountant` lit mais n'écrit pas ; l'écriture produit une ligne
  d'audit avec avant/après ; aucune auto-élévation possible ; le test échoue si la matrice
  s'élargit par mégarde.
- **Tests.** `tests/settings-authority.test.ts` (matrice complète, journalisation,
  auto-élévation), extension des tests de permissions.
- **Pièges.** Un `PATCH` en lot journalise **par clé** modifiée, pas une ligne globale. Ne jamais
  journaliser un secret en clair.
- **Effort.** M. **Statut.** TODO.

### A-31 — Réévaluation de change de fin d'exercice (conditionnelle)

- **But.** À la clôture, les créances et dettes en devise **non arrimée** sont réévaluées au taux
  de clôture, l'écart latent est posté en 656/756, et l'ouverture suivante produit l'écriture
  inverse — sans jamais réécrire le document.
- **Pourquoi.** Le plan couvre l'écart **réalisé** au règlement (A-01) mais pas l'écart **latent**
  de clôture : une facture USD non réglée au 31/12 reste au taux d'émission, donc le bilan et le
  résultat de l'exercice sont faux. Le backlog produits l'avait identifié (Q15) et l'avait
  reporté faute de transaction en devise tierce, avec une condition de réouverture nommée :
  « une première facture émise dans une devise non arrimée à l'euro ».
- **Référence.** Q15 (`docs/TODO-produits-services.md`) pour l'arbitrage et le plan en trois
  étapes ; **PCG 2026** (C-7) pour les comptes **656/756** — l'ancien document citait 666/766,
  corrigé depuis. Parité fixe XPF/EUR (`XPF_PER_EUR = 119,3317`) : **aucune réévaluation n'est
  possible ni nécessaire entre XPF et EUR**, seulement pour USD/AUD/NZD.
- **Fichiers.** `server/services/currencies.ts` (`freezeFx`, `rateOn`),
  `server/services/accounting.ts`, `server/lib/accounting.ts`, `server/routes/accounting.ts`,
  `shared/accounts.ts`, `server/services/locks.ts` (période).
- **Étapes.**
  1. `revalueOpenDocuments(database, { date })` : pour chaque facture/avoir non soldé et chaque
     dette fournisseur en devise non arrimée, comparer `solde_devise × taux_clôture` au solde
     XPF du document, puis agréger par tiers et par sens.
  2. Poster une écriture par contrepartie (source `fx_revaluation`, event `closing`), clé
     `(source, id, event, date)` pour l'idempotence, sous `assertPeriodOpen`.
  3. Poster l'écriture inverse à l'ouverture suivante (`event = 'reversal'`), pour que la
     réévaluation ne « colle » pas au bilan de l'exercice suivant.
  4. Utiliser les comptes **paramétrés** (`account_fx_gain` / `account_fx_loss`, défaut 756/656),
     jamais un littéral (R-1).
  5. Rapport « réévaluation de clôture » : documents, taux retenu, écart par document, total par
     compte ; export CSV comme les autres états.
- **Critères d'acceptation.** Facture USD 1 000 non réglée, taux 100 à l'émission, 105 à la
  clôture → écart latent 5 000 sur 656 ou 756 ; **aucune ligne** pour un document XPF ou EUR ;
  l'écriture inverse existe au lendemain ; relancer la clôture ne double rien ; une période
  close refuse l'opération.
- **Tests.** `tests/fx-revaluation.test.ts` : USD en perte, USD en gain, EUR (parité fixe, aucun
  écart), XPF (aucun écart), double exécution (idempotente), période close (409), avoir
  partiellement réglé, sens fournisseur.
- **Pièges.** Ne pas réévaluer un document déjà réglé (écart réalisé, A-01). Ne pas toucher au
  document : seule l'écriture bouge. Un taux de clôture manquant doit refuser l'opération
  (`409 RATE_MISSING`), jamais valoir 1.
- **Déclencheur.** Aucune facture en devise tierce n'existe aujourd'hui : la tâche reste
  spécifiée et `TODO`, et devient prioritaire à la première facture USD/AUD/NZD non réglée. Elle
  n'est le prérequis d'aucune autre.
- **Effort.** L. **Statut.** TODO (conditionnelle).

---

## 9. Séquencement recommandé

| Semaine | Contenu | Sortie attendue |
|---|---|---|
| 1 | A-01, A-02, A-03, A-04, A-05 | Plus aucun chiffre faux sur facture/avoir/encaissement ; TVA déclarée juste |
| 2 | A-06, A-10, A-11 | Approbations solides ; schéma versionné ; requêtes indexées |
| 3 | A-07, A-08, A-09, A-15, A-31 (si déclenchée) | Multi-devises complet et plafonds D1 respectés |
| 4 | A-12, A-13, A-14, A-19 | Intégrité défendue par la base ; stock réconcilié ; audit sans course |
| 5 | A-16, A-17, A-18 | Performance et recherche ; comptabilité incrémentale |
| 6 | A-20 à A-25, A-26, A-27, A-28, A-29, A-30 | Durcissement, purges, observabilité, tests, documentation, paramétrabilité |

**Chemin critique.** A-10 bloque A-11/A-12/A-13 (migrations) ; A-04 dépend de A-03 ; A-07
dépend de A-01/A-03 ; A-17 dépend de A-10 (migration FTS5) et impacte A-26 (sauvegarde).

---

## 10. Ce que ce plan ne fait pas

**Hérité du backlog produits (`docs/TODO-produits-services.md`), intégré le 6/11/2026 plutôt
qu'archivé.** Seul son contenu qui appelle du code entre dans ce plan : la **réévaluation de
change de clôture** devient A-31, et deux corrections en découlent (A-01 teste l'écart réalisé
sur une devise non arrimée, A-08 suit la convention `exchange_rate` des documents). Le reste
n'est pas une tâche de code et reste à sa place : MRP/GPAO hors périmètre (détail H8 du
backlog) ; paliers SLA par priorité, horaires et jours fériés sont des **valeurs à décider**,
donc `PENDING.md` ; H4/H5 sont des **actions utilisateur** (fichiers de l'ancien logiciel,
secrets de la préversion hébergée), donc `PENDING.md`. La note de quota D1 du 2/11 est obsolète
(hébergement hors Cloudflare, D-05) et n'est pas reprise.

- Pas de portail client, pas de passerelle de paiement, pas de Factur-X/Peppol : ces sujets
  restent des décisions produit de `PENDING.md` (T-401, T-402).
- Pas de multi-société, pas de refonte de l'interface, pas de changement de framework.
- Pas de « correction silencieuse » des données existantes : toute réconciliation produit un
  rapport, et toute migration destructive est précédée d'une sauvegarde (C-6).
- Pas de promesse de vérification non exécutable ici : les points marqués **BLOCKED** le sont
  explicitement.

---

## 11. Blocages connus

| # | Blocage | Conséquence | Déblocage |
|---|---|---|---|
| B-1 | **Cloudflare hors périmètre** (décision du propriétaire, 6/11/2026) : l'application n'est pas déployée sur Cloudflare. | Aucune conséquence sur ce plan : `wrangler d1 migrations apply --remote` et les lignes qui décrivent un tableau de bord Cloudflare ne s'appliquent pas. **Conservé pour mémoire**, pas supprimé : si l'hébergement change, la procédure reste écrite. | Rien à débloquer. Le travail local (fichiers, tests, base `--local`) est complet ; `PENDING.md` D-05 porte la décision. |
| B-2 | Aucun navigateur ni base D1 hébergée dans cet environnement. | A-21 (en-têtes sur origine réelle), A-26 (harnais selon choix), A-17 (comportement FTS après restauration sur D1) ne peuvent pas être validés de bout en bout ici. | Exécution locale `wrangler dev --local` + tests ; validation finale par le propriétaire. |
| B-3 | **Validation comptable externe — RÉGLÉ** (6/11/2026). | Aucun expert-comptable n'est requis : la référence est le **PCG 2026** (C-7) pour les comptes et **Odoo** pour le comportement d'un avoir (écriture inverse, préremplissage depuis la facture d'origine, remboursement partiel par avoir partiel). A-03, A-04 et A-05 s'appuient sur ces sources, citées dans les fiches. | — |
| B-4 | Planificateur quotidien non attaché (`PENDING.md` D-04). | A-24 (purges) et A-18 (rattrapage) reposent sur le passage quotidien. | Cron externe appelant `POST /api/runs/daily`. |

---

## 12. Tableau de bord des tâches

| ID | Titre | Phase | Effort | Dépend de | Statut |
|---|---|---|---|---|---|
| A-01 | Encaissement direct en devise | 1 | M | — | **DONE** |
| A-02 | Immutabilité des documents émis | 1 | S | — | **DONE** |
| A-03 | Avoir : TVA, devise, change | 1 | M | — | **DONE** |
| A-04 | Miroir TVA des avoirs | 1 | M | A-03 | **DONE** |
| A-05 | Contre-écritures paiements/dépenses | 1 | M | — | **DONE** |
| A-06 | Approbations : révision et re-contrôle | 2 | L | A-10 | **DONE** |
| A-07 | Agrégats multi-devises | 3 | M | A-01, A-03 | **DONE** |
| A-08 | Devise des dépenses et BC | 3 | L | A-07 | **DONE** |
| A-09 | Décimales, source unique | 3 | S | — | **DONE** |
| A-10 | Migrations versionnées | 2 | L | — | **DONE** |
| A-11 | Index manquants et doublon | 2 | M | A-10 | **DONE** |
| A-12 | Intégrité référentielle | 4 | L | A-10 | **DONE** |
| A-13 | Contraintes de cohérence | 4 | M | A-10 | **DONE** |
| A-14 | Stock : une vérité | 4 | L | A-10 | DONE |
| A-15 | Plafonds D1 (IN, LIKE) | 3 | M | — | TODO |
| A-16 | Projections des listes | 5 | M | — | TODO |
| A-17 | FTS5 + sauvegarde | 5 | L | A-10, A-11 | TODO |
| A-18 | Comptabilité incrémentale | 5 | L | A-05 | TODO |
| A-19 | Chaîne d'audit sans course | 4 | M | — | TODO |
| A-20 | Limitation par IP et compte | 6 | S | — | TODO |
| A-21 | En-têtes de sécurité cohérents | 6 | M | — | TODO |
| A-22 | Ré-auth MFA | 6 | S | — | TODO |
| A-23 | Installation verrouillée | 6 | S | A-13 | TODO |
| A-24 | Rétention et purges | 6 | M | A-15 | TODO |
| A-25 | Observabilité métier | 6 | M | A-12, A-14 | TODO |
| A-26 | Tests HTTP d'intégration | 6 | L | A-10 | TODO |
| A-27 | Documentation | 6 | S | A-01…A-31 | TODO |
| A-28 | Tests de concurrence | 6 | M | A-19, A-23 | TODO |
| A-29 | Aucune valeur métier en dur | 6 | M | A-10 | TODO |
| A-30 | Autorité sur les paramètres | 6 | M | — | TODO |
| A-31 | Réévaluation de change de clôture | 3 | L | A-01, A-08 | TODO (conditionnelle) |
