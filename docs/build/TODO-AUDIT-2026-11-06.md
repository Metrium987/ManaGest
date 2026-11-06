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

**6 novembre 2026 — A-15 : les plafonds D1 sont tenus par construction.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-15 | **DONE** | `server/lib/sql.ts` (`chunks`/90, `placeholders`, `selectIn`, `runInChunks`, `firstIn`) remplace les 28 listes `IN (${…})` de `server/` ; `server/lib/search.ts` normalise et refuse > 50 octets en `422 VALIDATION_ERROR { q: 'too_long' }` avant requête ; `MAX_LINE_ITEMS = 200` nommé et 201e ligne refusée. `tests/sql-chunking.test.ts`, **5 cas** (90/91/200, ordre, 200 identifiants en 3 statements 90/90/20 en lecture et en écriture, `firstIn`) ; `tests/search-limits.test.ts`, **5 cas** (trim/minuscules, 50 vs 51 octets, accents en octets, 120 caractères, 200 vs 201 lignes). Mutations : `MAX_BOUND_PARAMS = 1000` et `MAX_SEARCH_BYTES = 500` → **5 cas en échec**. |

**6 novembre 2026 — A-16 : les listes lisent ce qu'elles affichent.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-16 | **DONE** | `server/routes/invoices.ts` : `INVOICE_LIST_COLUMNS` + `invoiceListSql(where)` projettent toutes les colonnes sauf `line_items` ; la liste ne renvoie plus le payload, `GET /:id` le conserve. `server/routes/clients.ts` : `CLIENT_LIST_COLUMNS` remplace `c.*`. `server/routes/public-links.ts` : `PUBLIC_LINK_COLUMNS` remplace les deux `SELECT *` (sans `token_hash`). `tests/list-projection.test.ts`, **4 cas** (aucun `line_items`/`i.*`/`SELECT *`, toutes les colonnes du schéma projetées, annuaire explicite et complet, liens publics nommés). Mutations : `i.*` rétabli et `c.deleted_at` retiré → **3 cas en échec**. |

**6 novembre 2026 — A-17 : recherche plein texte et sauvegarde compatible.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-17 | **DONE** | `server/db/search.ts` (table `search_documents` + déclencheurs sources + index FTS5 en contenu externe + `ensureSearchIndex`/`rebuildSearchIndex`), migration `0007_search_documents` (+ `.sql`), route `/search` en `MATCH` + `bm25()` + `snippet()` filtrée par permissions avec repli `LIKE`, export sans table virtuelle et restauration qui reconstruit l'index. `tests/search-fts.test.ts`, **8 cas** (accents/casse, « cafe » → « café », aucun résultat, ponctuation, insert/update/delete, produit, sauvegarde + restauration, repli sans FTS5). Mutation : `search_index_au` retiré → **2 cas en échec**. |


**6 novembre 2026 — A-18, tranche 1 : la comptabilité s'écrit à l'écriture.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-18 | **EN COURS** | `postDocumentEntry(database, type, id)` dans `server/services/accounting.ts` construit l'écriture d'une facture (émise/annulée), d'un avoir, d'un paiement (`completed`/`void`) et d'une dépense (postée/extournée) ; `syncAccounting` réutilise les mêmes constructeurs (`invoicePosting`, `creditPosting`, `paymentPosting`, `voidedPaymentPosting`, `expensePosting`, `reversedExpensePosting`). Câblage : envoi + annulation de facture (`invoices.ts`), encaissement (`settlements.ts`), émission d'avoir (`credits.ts`), création et suppression de dépense (`expenses.ts`, `operations.ts`). `tests/accounting-incremental.test.ts`, **9 cas** : nominal des quatre types, annulation de facture, `void` + extourne de dépense, brouillon non posté, double appel sans doublon, non-régression (écriture immédiate puis `syncAccounting` → 0 créé, journal et totaux identiques). Mutation : posteur neutralisé → **8 cas en échec sur 9**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **103 fichiers, 789 tests, 0 échec**.

Reste de A-18 : la mise à jour d'une dépense n'est pas re-postée (clé `(expense, id, 'posted')` déjà posée ; une correction de montant demande une règle d'extourne) ; les cinq lectures appellent encore `syncAccounting` — curseur `app_meta.journal_synced_at`, rattrapage borné, route de réparation `POST /accounting/sync` et mesure des requêtes D1 restent à faire. Aucune mesure de performance n'a été exécutée.

**6 novembre 2026 — A-18, tranche 2 : corriger une dépense déjà postée.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-18 | **EN COURS** | `syncExpenseState` (même module, appelé par `postDocumentEntry('expense', id)` et par `syncAccounting`) compare le net posté par compte à l'état courant ; en cas d'écart il poste `reversal:<signature>` (extourne du net posté) puis `corrected:<signature>` (nouvel état), signatures dérivées des lignes. Rejeu = aucun doublon ; deux corrections = deux paires, une extourne chacune. `PATCH /expenses` poste la correction au moment de l'écriture. `tests/accounting-incremental.test.ts`, **13 cas** (les 9 de la tranche 1 + correction nominale, deux corrections + rejeu, dépense modifiée avant câblage rattrapée par le balayage puis 0, balayage après correction sans changement). Mutation : `syncExpenseState` neutralisé → **5 cas en échec sur 13**. Aucune migration. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **103 fichiers, 793 tests, 0 échec**.

Reste de A-18 : les cinq lectures appellent encore `syncAccounting` — curseur `app_meta.journal_synced_at`, rattrapage borné, route de réparation `POST /accounting/sync` et mesure réelle des requêtes D1. Aucune mesure de performance n'a été exécutée.

**6 novembre 2026 — A-18, tranche 3 : le chemin de lecture devient incrémental.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-18 | **DONE** | `catchUpAccounting` : curseur `app_meta.journal_synced_at` monotone, ordre `(updated_at, id)`, page de N documents (défaut 50), posting via `postDocumentEntry` (aucune logique dupliquée), rapport `{ processed, created, remaining, cursor }`. Les cinq lectures appellent la passe bornée ; `POST /accounting/sync` reste la réparation complète ; `POST /accounting/catch-up` (`accounting.write`, journalisé) expose les compteurs. `tests/accounting-incremental.test.ts` **17 cas** (2e passe 0 écriture + curseur stable ; bornage 12 docs / pages de 5 → `[5, 5, 2, 0]`, 12 écritures distinctes ; correction d'écriture → 0 à poster) et `tests/accounting-catch-up-route.test.ts` **2 cas** (owner 200, viewer 403). Mesure instrumentée : passe bornée 10 docs = **84 requêtes**, balayage complet 30 docs = **118 requêtes**. Mutation (avance du curseur neutralisée) : **2 cas en échec**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **104 fichiers, 799 tests, 0 échec**.

A-18 est complète (écriture + lecture). Prochaine fiche : **A-19 — chaîne d'audit sans course** (réclamation atomique de `seq`, `audit_tail`, test de concurrence).

**6 novembre 2026 — A-19 : la chaîne d'audit a un ordre total.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-19 | **DONE** | Migration `0008_audit_chain` (`activities.seq`, index unique `idx_activities_seq`, table `audit_tail(id=1, seq)` semée à 0), `SCHEMA_STATEMENTS` aligné. `logActivity` réclame un `seq` par `UPDATE audit_tail SET seq = seq + 1 … RETURNING seq` (une instruction atomique), sérialise réclamation → prédécesseur → insertion, et `verifyActivityChain` exige `seq` contigu (trou signalé) en plus du chaînage `prev_hash`, en tolérant les entrées antérieures sans `seq`. `tests/audit-chain-concurrency.test.ts` **5 cas** : 50 écritures concurrentes → `seq` 1..50 distincts et contigus, chaîne `{ ok: true, checked: 50 }` ; queue/liens ; trou `seq` 3 → 9 rapporté ; `prev_hash` falsifié détecté ; entrée legacy tolérée. Mutation (file retirée) : **1 cas en échec sur 5**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **105 fichiers, 804 tests, 0 échec**.

`audit_tail` est incluse dans la sauvegarde (table additionnelle hors ordre de schéma) et recréée par le schéma à la restauration. Prochaine fiche : **A-20 — limitation des tentatives par IP et par compte**.

**6 novembre 2026 — A-20 : limitation des tentatives de connexion par IP et par compte.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-20 | **DONE** | `server/lib/limits.ts` : fenêtre 15 min, 8 échecs/compte, 50 échecs/IP, `Retry-After` dérivé de l'échec le plus ancien ; enregistrement par un `INSERT … SELECT … WHERE` unique (compteurs dans l'instruction) donc pas de dépassement concurrent ; contrôles avant vérification du mot de passe. `/login` et `/mfa/verify` partagent le module ; refus journalisés avec adresse masquée, `Retry-After` posé par `onError`. Migration `0009_login_attempts_ip` (index IP + created_at), `SCHEMA_STATEMENTS` aligné ; purge > 90 jours dans le passage quotidien. `tests/login-throttle.test.ts` **5 cas** : compte → 429 + `Retry-After`, réouverture après fenêtre ; IP 50 comptes → 429, autre IP intacte ; 20 tentatives simultanées → 8 échecs exactement ; journal sans adresse complète ; purge. Mutation (garde neutralisée) : **4 cas en échec sur 5**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **106 fichiers, 809 tests, 0 échec**.

Prochaine fiche : **A-21 — en-têtes de sécurité sur l'origine réelle**.

**6 novembre 2026 — A-21 : en-têtes de sécurité sur l'origine réelle.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-21 | **DONE** | `securityHeaders` déduit l'origine réelle (`url.protocol`, `x-forwarded-proto: https`, hôte `.style.dev`) : CSP/HSTS émis derrière le proxy, HSTS absent en clair sur localhost. Préversion supportée pour sa seule origine (`frame-ancestors https://<hôte>`, sans `X-Frame-Options`), ailleurs `DENY` + `frame-ancestors 'none'` — cohérent avec les cookies `SameSite=None; Partitioned`. En-têtes posés après `next()`, donc sur succès et erreurs. Décision documentée dans `docs/SECURITE.md`. `tests/security-headers.test.ts` **6 cas** sur les réponses réelles de `server/worker` : https complet, 404, 409, préversion, proxy, localhost. Mutation (HSTS retiré) : **4 cas en échec sur 6**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **107 fichiers, 815 tests, 0 échec**.

Prochaine fiche : **A-22 — ré-authentification pour changer un facteur**.

**6 novembre 2026 — A-22 : ré-authentification pour changer un facteur.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-22 | **DONE** | `mfa/setup` et `mfa/enable` exigent `current_password` ; `mfa/disable` accepte un code valide **ou** le mot de passe. Absent/faux → `401 INVALID_CREDENTIALS`, compté par la limitation A-20 (`login_attempts` +1, `429` au quota), sans écriture de `mfa_secret`. Aucune fenêtre de ré-authentification : rien n'est mémorisé, le mot de passe du `setup` n'autorise pas le `enable`. Mot de passe jamais journalisé, `enabled`/`disabled` tracés avec l'IP, défi MFA 5 min intact, champ mot de passe dans l'interface fr/en. `tests/mfa-flow.test.ts` **5 cas** (flux historique + 4 nouveaux). Mutation (vérification neutralisée) : **3 cas en échec sur 5**. Pas de migration. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **107 fichiers, 819 tests, 0 échec**.

Prochaine fiche : **A-23 — installation : verrou et limitation**.

**6 novembre 2026 — A-23 : installation singleton et limitée.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-23 | **DONE** | Insertion conditionnelle (`INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM company)`) et propriétaire inséré dans le même `batch` seulement si la société a gagné ; relecture du `companyId` → `409 ALREADY_CONFIGURED` pour la perdante, en plus de la contrainte A-13. Limitation réutilisant A-20 sur `setup:install` et `setup:recover-owner` : 5 tentatives/IP/15 min, 6e → `429` + `retry_after`. `recover-owner` garde son jeton constant-time et son usage unique. Préversion non configurée = premier visiteur propriétaire : documenté dans `README.md` et `docs/SECURITE.md`. `tests/setup-concurrency.test.ts` **3 cas** (concurrence `[201, 409]` + 1 société/1 propriétaire ; 6 tentatives → `429` et autre IP servie ; récupération : 5×401 puis 429, jeton valide `200` puis `409 RECOVERY_ALREADY_USED`). Mutation (gardes retirées) : **2 cas en échec sur 3**. Pas de migration. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **108 fichiers, 822 tests, 0 échec**.

Prochaine fiche : **A-24 — rétention et purges**.

**6 novembre 2026 — A-24 : rétention et purges.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-24 | **DONE** | Politiques dans `server/lib/retention.ts` (activities 10 ans, login_attempts 90 j, sessions expirées 30 j, public_link_access 12 mois, mfa_challenges 7 j, password_reset_tokens 24 h, morceaux orphelins 1 j), purge par lots de 500 (20 max) via `DELETE … RETURNING`, idempotente et sûre en concurrence, `summary.purged` dans `daily_runs.summary_json` + entrée d'audit `retention_purged`, diagnostic `GET /api/settings/retention`. Migration 0010 (index de purge) sans table nouvelle ; chaîne d'audit préservée par ancre `audit_chain_anchor`. `tests/retention-purge.test.ts` **6 cas** (bornes de chaque politique, idempotence, 1 050 lignes en 3 lots, morceaux vivants/orphelins, chaîne vérifiée après purge, rapport). Mutation (fenêtres à zéro) : **3 cas en échec sur 6**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **109 fichiers, 828 tests, 0 échec**.

Prochaine fiche : **A-25 — observabilité métier**.

**6 novembre 2026 — A-25 : observabilité métier.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-25 | **DONE** | `server/lib/observability.ts` : écarts d'intégrité et de stock, retard comptable (compté, sans écriture), dernier passage + échecs récents, état des purges, version de schéma, 10 plus grosses tables. Carte `GET /api/dashboard/observability` réservée à `activity.read`/`accounting.read` (403 sinon) et affichée sur le tableau de bord (fr/en) ; `/api/health` enrichi (statut, version, compteurs, purges) sans aucune donnée personnelle, repli `unavailable` sans base. Aucune migration. `tests/observability.test.ts` **5 cas** sur le vrai worker (écart injecté visible carte + health puis réparé, absence d'e-mail/IP/chemin, 403 viewer, état de purge). Mutation (garde retirée) : **1 cas en échec sur 5**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **110 fichiers, 833 tests, 0 échec**.

**6 novembre 2026 — A-26 : les P0 prouvés en HTTP sur une base migrée.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-26 | **DONE** | `tests/integration/p0-http.test.ts` : le vrai worker sur une base `node:sqlite` recréée et migrée par cas (`provisionDatabase()`, migrations A-10 + colonnes + rôles), sans mock de handler. 8 cas : encaissement/solde, immutabilité (409 + ligne inchangée), avoir TVA (totaux + `credit_tax_lines` + écriture), contre-écriture (suppression du règlement restaure le solde), approbation d'avoir (409, demande en attente, auto-approbation 403, inconnu 404), stock persisté, rapport EUR+XPF en XPF. Statuts, corps **et** lignes persistées. Aucune migration ; `npm run test:integration`. Défaut réel trouvé et corrigé : parenthèse en trop dans l'`INSERT` clients. Mutation (`requireApprovalIfNeeded` court-circuité) : **1 cas en échec sur 8**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **111 fichiers, 841 tests, 0 échec**.

**6 novembre 2026 — A-27 : la documentation vivante dit ce que le code fait.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-27 | **DONE** | Audit du 28 octobre laissé **figé** dans `docs/archive/audit-2026-10-28/AUDIT.md` ; sa note nomme les chiffres périmés (26 tables / 28 index) et renvoie au 6 novembre. Constat daté remis d'aplomb : **89 tables / 89 index**, recomptés après A-17 et A-19. `README.md` : plan, audit, archive, règle « tous les agrégats en XPF », tests d'intégration. `docs/ARCHITECTURE.md` : agrégats XPF, rétention, migrations versionnées. `PENDING.md` : CSRF des routes anonymes (L-13), absence de planificateur (L-14), devise dépenses/BC livrée par A-08. `SECURITE.md` : origine contrôlée, jeton exigé seulement avec session. Garde `tests/docs-integrity.test.ts`, **3 cas**. Mutation (chiffre falsifié) : **1 cas en échec sur 3**. Aucune migration. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **112 fichiers, 844 tests, 0 échec**.

**6 novembre 2026 — A-28 : les courses critiques sont reproduites et verrouillées.**

| Tâche | État | Preuve exécutée |
|---|---|---|
| A-28 | **DONE** | `tests/concurrency/http-concurrency.test.ts` : vrai worker, base migrée par cas, barrière sur l'instruction critique (les deux requêtes lisent le même état avant la première écriture). Double envoi : `UPDATE … WHERE status = 'draft'` réclamé, perdant `409 INVALID_TRANSITION` avant tout mouvement, brouillon restauré si le stock refuse ; un seul mouvement, quantité 10 → 9. Double encaissement : `UPDATE … WHERE balance >= ?` par affectation, second `409 AMOUNT_EXCEEDS_BALANCE`, un paiement, `paid_total` = total, solde 0. Clôture de période : écriture déjà engagée acceptée, écritures suivantes `409 PERIOD_LOCKED` (fenêtre documentée). Double installation et 50 écritures d'audit : déjà prouvés par A-23/A-19. Aucune migration. Mutations : chaque garde neutralisée → **1 cas sur 3 en échec**. |

Porte : `npm run typecheck` → **0 erreur** ; `npx vitest run` → **113 fichiers, 847 tests, 0 échec**.

Prochaine fiche : **A-29 — aucune valeur métier en dur**.
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
- **Effort.** L. **Statut.** DONE (2026-11-06). Statut « TODO » retiré : le travail est livré
  et prouvé, comme le disaient déjà le tableau de bord et le journal. `server/db/migrations/`
  porte la baseline figée sans seeds plus `0002_credit_tax_lines`, `0003_approvals_revision`,
  `0004_expense_po_currency` ; `runMigrations()` (`server/db/migrate.ts`) journalise dans
  `d1_migrations` et renvoie **0** au rejeu ; `provision()` exécute les fichiers puis garde
  `applyColumnMigrations` en filet ; `ensureSchema` reste un filet de développement.
  `tests/schema-migrations.test.ts` (base ancienne migrée sans perte, rejeu = 0, structure
  finale identique à `SCHEMA_STATEMENTS`). Écart : `wrangler d1 migrations apply --remote`
  n'est pas exécutable ici (déploiement Cloudflare, B-1) ; la commande locale et la
  documentation sont en place.

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
- **Effort.** M. **Statut.** DONE (2026-11-06). `server/lib/sql.ts` fournit `chunks` (90),
  `placeholders`, `selectIn`, `runInChunks` et `firstIn` ; les **28** sites `IN (${…})` de
  `server/` passent par ce helper (routes `operations`/`invoices`/`products`/`stock-counts`/
  `import-sheets`, libs `product-links`/`catalogue`/`settings-extra`/`expertise`/
  `client-pricing`, services `stock`/`accounting`/`stock-counts`/`lots`), donc une facture de
  200 lignes ne dépasse jamais 90 paramètres liés. `server/lib/search.ts` normalise la
  recherche (trim, minuscules) et refuse au-delà de 50 octets en
  `422 VALIDATION_ERROR { q: 'too_long' }` **avant** toute requête. `MAX_LINE_ITEMS = 200` est
  nommé, la 201e ligne est refusée, et le maximum sérialisé reste très en dessous des 2 Mo.
  Preuve : `tests/sql-chunking.test.ts` (5 cas : 90/91/200, ordre préservé, 200 identifiants
  lus puis écrits en 3 statements 90/90/20, `firstIn` trouvé au dernier lot) et
  `tests/search-limits.test.ts` (5 cas : trim/minuscules, 50 vs 51 octets, accents comptés en
  octets — 26 « é » = 52 octets refusés, 120 caractères refusés, 200 lignes acceptées / 201
  refusées). Mutations : plafond de découpage porté à 1000 et plafond de recherche à 500 octets
  → **5 cas en échec**. Écart documenté : l'étape 5 (compter les requêtes par invocation) n'est
  pas instrumentée, faute de compteur de requêtes dans le projet ; la borne est prouvée par les
  tests de découpage plutôt que par une mesure de production.
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
- **Effort.** M. **Statut.** DONE (2026-11-06). `INVOICE_LIST_COLUMNS` +
  `invoiceListSql(where)` projettent toutes les colonnes de la facture **sauf** `line_items` :
  la liste ne renvoie plus le payload (le mapping qui le réinjectait est retiré), le détail
  `GET /invoices/:id` le renvoie toujours. `CLIENT_LIST_COLUMNS` remplace `c.*` dans
  l'annuaire et `PUBLIC_LINK_COLUMNS` remplace les deux `SELECT *` sur `public_links` (jamais
  `token_hash`). Preuve : `tests/list-projection.test.ts`, 4 cas — la liste des factures ne
  contient ni `line_items`, ni `i.*`, ni `SELECT *`, conserve l'alias `client_name` et l'ordre ;
  elle projette **toutes** les autres colonnes du schéma (aucun champ affiché perdu) ; la
  projection clients est explicite et complète ; la projection des liens publics exclut
  `token_hash`. Mutations : retour à `i.*` et suppression de `c.deleted_at` → **3 cas en
  échec**. Écart : la taille de réponse avant/après sur 100 factures n'est pas mesurée (aucun
  jeu de 100 factures dans le dépôt) ; le gain est structurel — le JSON `line_items` n'est plus
  lu du tout par la liste.
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
- **Effort.** L. **Statut.** DONE (2026-11-06). `server/db/search.ts` crée la table
  **ordinaire** `search_documents(kind, ref_id, title, body)` alimentée par des déclencheurs
  `AFTER INSERT/UPDATE/DELETE` sur `clients`, `invoices`, `quotes` et `products`, puis l'index
  FTS5 en **contenu externe** (`content='search_documents'`, `content_rowid='rowid'`,
  `unicode61 remove_diacritics 2`) avec ses déclencheurs de synchronisation ; la migration
  `0007_search_documents` (+ `.sql`) et `SCHEMA_STATEMENTS` portent le même schéma.
  `searchDocuments()` interroge `MATCH` + `bm25()` + `snippet()`, restreint aux `kind` autorisés
  par les permissions de l'utilisateur, et retombe sur `LIKE` sur `search_documents` si FTS5
  manque (`ensureSearchIndex` renvoie alors `false`). Sauvegarde (C-5) :
  `FTS_SHADOW_TABLE` exclut `search_index` et ses tables d'ombre de l'export,
  `search_documents` est conservée mais **dérivée** — la restauration la reconstruit par les
  déclencheurs et `rebuildSearchIndex()` rejoue `INSERT INTO search_index(search_index)
  VALUES('rebuild')`. Preuve : `tests/search-fts.test.ts`, **8 cas** — « société »/« SOCIÉTÉ »,
  « cafe » trouve « café », terme inconnu → aucun résultat sans erreur, ponctuation
  (`"`, `*`, `:`, `-`) neutralisée, insert → update → delete suivis, déclencheur produit,
  export sans table virtuelle + recherche après restauration, et repli sur `search_documents`
  sans FTS5. Mutations : retrait du déclencheur `search_index_au` → **2 cas en échec**
  (update/delete et restauration). Écarts assumés : aucune mesure de performance n'a été
  exécutée (pas de jeu de données de référence) ; la route `/search` n'a pas de test HTTP —
  le filtre par permission est prouvé par `searchDocuments(..., kinds)` et `can()`, pas par un
  appel authentifié.
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
- **Livré (tranche 1, 2026-11-06).** `postDocumentEntry(database, type, id)` construit
  l'écriture d'une facture (émise ou annulée), d'un avoir, d'un paiement (y compris `void`)
  et d'une dépense (y compris extourne) ; `syncAccounting` réutilise exactement ces
  constructeurs, donc balayage et écriture partagent le même calcul. Branchements : envoi et
  annulation de facture (`server/routes/invoices.ts`), encaissement
  (`server/services/settlements.ts`), émission d'avoir (`server/routes/credits.ts`), création
  (`server/services/expenses.ts`) et suppression (`server/routes/operations.ts`). Aucune
  migration : le schéma est inchangé. Preuve : `tests/accounting-incremental.test.ts`
  (9 cas) — nominal facture/avoir/paiement/dépense, annulation, `void` + extourne de dépense,
  brouillon non posté, double appel sans doublon, non-régression (écriture immédiate puis
  `syncAccounting` → 0 créé, journal et totaux identiques). Mutation : `postDocumentEntry`
  neutralisé (`return false`) → **8 cas en échec sur 9**. Typecheck 0 erreur ; suite
  **103 fichiers / 789 tests**.
- **Livré (tranche 2, 2026-11-06).** Correction d'une dépense déjà postée : `syncExpenseState`
  compare l'état posté (`SUM(debit - credit)` par compte) à l'état courant du document ; en cas
  d'écart il poste l'extourne de l'état posté (`reversal:<signature>`) puis le nouvel état
  (`corrected:<signature>`), la signature étant les lignes de l'état — rejouer la même
  correction ne crée rien, deux corrections successives donnent deux paires distinctes avec
  une seule extourne chacune. `syncAccounting` appelle la même fonction, donc rattrapage et
  écriture ne divergent pas. Câblage : `PATCH /expenses` poste la correction immédiatement.
  `tests/accounting-incremental.test.ts` porte à **13 cas** (correction nominale, deux
  corrections + rejeu, dépense modifiée avant câblage rattrapée par le balayage puis 0,
  balayage après correction sans aucun changement). Mutation : `syncExpenseState` neutralisé
  (`return false`) → **5 cas en échec sur 13**. Aucune migration (schéma inchangé).
- **Livré (tranche 3, 2026-11-06).** `catchUpAccounting(database, limit = 50)` lit au plus N
  documents postérieurs au curseur `app_meta.journal_synced_at`, ordonnés `(updated_at, id)`
  (donc ni saut ni doublon à la frontière de page), les poste avec `postDocumentEntry` — même
  calcul que l'écriture — puis avance le curseur de façon monotone. Rapport
  `{ processed, created, remaining, cursor }`. Les cinq lectures comptables appellent ce
  rattrapage borné ; `POST /accounting/sync` reste la réparation complète et
  `POST /accounting/catch-up` (permission `accounting.write`, journalisé) expose la passe
  bornée avec ses compteurs. Aucune migration : le curseur vit dans `app_meta`, déjà couvert
  par la sauvegarde/restauration. Preuve : `tests/accounting-incremental.test.ts` (**17 cas**)
  — deuxième passe = 0 écriture et curseur inchangé, bornage 12 documents par pages de 5 →
  `[5, 5, 2, 0]` avec 12 écritures distinctes, correction d'écriture laissant 0 à poster ;
  `tests/accounting-catch-up-route.test.ts` (2 cas) : owner 200, viewer 403. Mesure réelle des
  requêtes D1 instrumentée dans le test : **passe bornée de 10 documents = 84 requêtes**
  contre **balayage complet de 30 documents = 118 requêtes**. Mutation : avance du curseur
  neutralisée → **2 cas en échec**.
- **Effort.** L. **Statut.** DONE.

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
- **Livré (2026-11-06).** Migration `0008_audit_chain` (`.ts` + `.sql`, enregistrée) : colonne
  `activities.seq`, index unique partiel `idx_activities_seq`, table `audit_tail(id=1, seq)`
  semée à 0 ; `SCHEMA_STATEMENTS` aligné (colonne en **dernière** position, comme l'`ALTER`
  l'ajoute). `logActivity` réclame son numéro par une seule instruction atomique
  `UPDATE audit_tail SET seq = seq + 1 WHERE id = 1 RETURNING seq`, sérialise réclamation →
  lecture du prédécesseur → insertion dans l'isolate, et chaîne `prev_hash` sur la ligne
  `seq - 1`. `verifyActivityChain` ordonne par `(seq NULL d'abord, seq, created_at, rowid)`,
  tolère les entrées antérieures sans `seq`, et **signale tout trou de numérotation** comme
  rupture. `audit_tail` est exportée par la sauvegarde (table hors ordre, donc reprise comme
  table additionnelle) et recréée par le schéma à la restauration.
  Preuve : `tests/audit-chain-concurrency.test.ts` (**5 cas**) — 50 écritures concurrentes
  (`Promise.all`) donnent `seq` 1..50 distincts et contigus, `verifyActivityChain` = `{ ok: true,
  checked: 50 }` ; la queue et les liens `prev_hash` suivent ; un trou (`seq` 3 → 9) est
  rapporté (`checked: 2`) ; un `prev_hash` falsifié est détecté ; une entrée d'avant la chaîne
  (hash NULL) est tolérée. Mutation : file d'écriture retirée → **1 cas en échec sur 5**
  (« fifty concurrent writes… » renvoie `ok: false, checked: 1`). Typecheck 0 erreur ; suite
  **105 fichiers / 804 tests**.
- **Effort.** M. **Statut.** DONE.

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
- **Livré (2026-11-06).** `server/lib/limits.ts` : fenêtre glissante de 15 min, quota
  **8 échecs par compte** et **50 échecs par IP**, `Retry-After` calculé sur l'expiration de
  l'échec le plus ancien de la fenêtre bloquante. L'échec est enregistré par une **seule**
  instruction conditionnelle `INSERT … SELECT … WHERE` (compteurs inclus), donc des tentatives
  simultanées ne peuvent pas dépasser le quota ; `loginThrottle` vérifie les deux quotas avant
  toute vérification de mot de passe (pas de fuite par le temps). `POST /login` et
  `POST /mfa/verify` partagent ce module. Les refus sont journalisés (`login_blocked`) avec
  l'adresse **masquée** (`o***@example.test`) et sans mot de passe ; `Retry-After` est posé par
  le gestionnaire d'erreurs. Migration `0009_login_attempts_ip` (`.ts` + `.sql`, enregistrée) :
  index `login_attempts(ip, created_at)` et `(created_at)` pour le quota IP et la purge ;
  `SCHEMA_STATEMENTS` aligné. Le passage quotidien purge les tentatives de plus de 90 jours
  (`purgeLoginAttempts`).
  Preuve : `tests/login-throttle.test.ts` (**5 cas**) — quota compte → 429 + `Retry-After`
  ∈ (0, 900], mot de passe correct toujours refusé, réouverture après la fenêtre ; quota IP sur
  50 comptes distincts → 429, autre IP non affectée ; **20 tentatives simultanées → exactement
  8 échecs enregistrés** (8×401, 12×429) ; refus journalisé sans adresse complète ni mot de
  passe ; purge au-delà de 90 jours. Mutation : garde de quota neutralisée
  (`false &&` sur les deux seuils + `recordLoginFailure` toujours vrai) → **4 cas en échec
  sur 5**. Typecheck 0 erreur ; suite **106 fichiers / 809 tests**.
- **Effort.** S. **Statut.** DONE.

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
- **Livré (2026-11-06).** Choix (a) : l'iframe de préversion est **supportée**, mais seulement
  pour sa propre origine. `securityHeaders` calcule l'origine réelle (`https` de l'URL, ou
  `x-forwarded-proto: https`, ou un hôte `.style.dev`) : CSP et HSTS sont émis derrière le
  proxy, HSTS reste absent en clair sur `localhost`. Sur `.style.dev`, la politique devient
  `frame-ancestors https://<hôte>` et `X-Frame-Options` est retiré (il contredisait la
  politique) — cohérent avec `cookieSecurity()` qui pose déjà `SameSite=None; Secure;
  Partitioned` sur cette origine. Ailleurs : `X-Frame-Options: DENY` +
  `frame-ancestors 'none'`. En-têtes appliqués après `next()`, donc sur les succès **et** les
  erreurs (404, 409, 429…), assets compris. `docs/SECURITE.md` documente la décision.
  Preuve : `tests/security-headers.test.ts` (**6 cas**) sur les vraies réponses de
  `server/worker` — matrice origine × en-têtes : document https complet (CSP avec
  `style-src`, `img-src`, `font-src`, `connect-src` réellement utilisés, aucun
  `frame-ancestors *`), 404 et 409 avec les mêmes en-têtes, préversion `frame-ancestors
  https://preview-abc.style.dev` sans `X-Frame-Options`, proxy `x-forwarded-proto: https`,
  `localhost` sans HSTS ni CSP mais avec `nosniff`. Mutation : suppression de l'émission HSTS
  → **4 cas en échec sur 6**. Typecheck 0 erreur ; suite **107 fichiers / 815 tests**.
- **Effort.** M. **Statut.** DONE.

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
- **Livré (2026-11-06).** `mfa/setup` et `mfa/enable` exigent `current_password` ;
  `mfa/disable` accepte indifféremment un code TOTP / code de secours valide **ou** le mot de
  passe courant. Un mot de passe absent, vide ou faux renvoie `401 INVALID_CREDENTIALS` (jamais
  `400` : le schéma reste optionnel pour que l'absence soit un refus d'authentification), est
  enregistré par `recordLoginFailure` — donc compté par la limitation A-20, avec `429` +
  `retry_after` au-delà du quota — et n'écrit rien (`mfa_secret` inchangé). Il n'existe
  **aucune fenêtre de ré-authentification** : le mot de passe n'est pas mémorisé, chaque appel
  le revérifie, donc celui du `setup` n'autorise pas le `enable` suivant. Le mot de passe n'est
  jamais journalisé ; `enabled`/`disabled` restent tracés avec l'IP via `logActivity`. Le défi
  de connexion MFA (5 min) est intact. Interface : champ mot de passe dans les trois panneaux
  (`ProfilePage.tsx`), libellés fr/en.
  Preuve : `tests/mfa-flow.test.ts`, **5 cas** (flux historique + 4 nouveaux) sur les vraies
  routes — « refuses to start MFA setup without the current password » (401, `mfa_secret`
  toujours NULL, **+1 ligne `login_attempts`**), « counts a wrong password and only stores the
  secret with the right one » (401 puis 200), « needs the password again to enable, even though
  the setup carried it » (401 sans mot de passe, `mfa_enabled` reste 0, puis 200),
  « refuses a wrong password to disable, and accepts the current one alone » (401 puis 200,
  `mfa_enabled` 1 → 0). Mutation : `assertCurrentPassword` rendu inconditionnellement valide
  → **3 cas en échec sur 5**. Aucune migration (pas de nouvelle table ni colonne) ; typecheck
  0 erreur ; suite **107 fichiers / 819 tests**.
- **Pièges.** Ne pas casser la connexion MFA (le défi de 5 min reste inchangé).
- **Effort.** S. **Statut.** DONE.

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
- **Livré (2026-11-06).** La contrainte A-13 (`company.singleton` + index unique) reste le
  dernier rempart ; l'insertion devient conditionnelle : `INSERT INTO company (…) SELECT …
  WHERE NOT EXISTS (SELECT 1 FROM company)`, et l'utilisateur propriétaire suit dans le même
  `batch` avec `WHERE EXISTS (SELECT 1 FROM company WHERE id = ?)`. Après le batch, la route
  relit son `companyId` : absent → `409 ALREADY_CONFIGURED`. Deux installations simultanées ne
  peuvent donc plus créer deux sociétés, et la perdante est refusée proprement au lieu de
  laisser une erreur de contrainte. Limitation A-20 réutilisée via une clé réservée
  (`setup:install`, `setup:recover-owner`) : **5 tentatives par IP et par fenêtre de 15 min**,
  la 6e répond `429 TOO_MANY_ATTEMPTS` avec `retry_after` (en-tête `Retry-After` posé par
  `onError`). Chaque requête est enregistrée dans `login_attempts`, sans jamais journaliser de
  secret. `recover-owner` garde son jeton `x-recovery-token` à comparaison constante et son
  marqueur `owner_recovery_used` à usage unique. Documentation : `README.md` et
  `docs/SECURITE.md` rappellent qu'une préversion non configurée donne le rôle propriétaire au
  premier visiteur et ne doit jamais être exposée publiquement.
  Preuve : `tests/setup-concurrency.test.ts`, **3 cas** sur les vraies routes — deux
  installations concurrentes (`Promise.all`) → `[201, 409]`, **une** société et **un**
  propriétaire ; six installations depuis une IP → `201` puis quatre `409` puis **`429`**, avec
  `retry_after > 0`, et une autre IP toujours servie (`409`) ; six jetons de récupération
  devinés → cinq `401` puis **`429`**, puis le jeton valide reste à usage unique (`200` puis
  `409 RECOVERY_ALREADY_USED`, un seul marqueur). Mutation : gardes de limitation retirées →
  **2 cas en échec sur 3**. Aucune migration (la contrainte A-13 suffit) ; typecheck 0 erreur ;
  suite **108 fichiers / 822 tests**.
- **Pièges.** `recover-owner` reste à usage unique ; ne pas affaiblir sa protection.
- **Effort.** S. **Statut.** DONE.

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
- **Livré (2026-11-06).** Table de politiques dans `server/lib/retention.ts` :
  `activities` 10 ans, `login_attempts` 90 j, `sessions` (sur `expires_at`) 30 j,
  `public_link_access` 12 mois, `mfa_challenges` 7 j, `password_reset_tokens` 24 h, morceaux
  d'attachement orphelins 1 j. `purgeExpired()` supprime par lots de **500**, au plus **20**
  lots par passe, avec `DELETE … WHERE rowid IN (SELECT … LIMIT 500) RETURNING rowid` : chaque
  passage est idempotent, deux passages concurrents suppriment des lignes disjointes et le
  compte est exact. Le passage quotidien appelle la purge avant tout le reste, publie
  `summary.purged` (stocké dans `daily_runs.summary_json`) et la purge écrit elle-même une
  entrée d'audit `activity.retention_purged` avec les comptes par politique. Route de
  diagnostic en lecture seule `GET /api/settings/retention` (`settings.read`) : lignes et
  octets de charge par table. Migration **0010** : index `sessions(expires_at)`,
  `public_link_access(created_at)`, `mfa_challenges(created_at)`,
  `password_reset_tokens(created_at)`, `attachments(deleted_at)` (+ alignement
  `SCHEMA_STATEMENTS`, fichier `.sql` de référence) ; aucune table nouvelle, donc
  sauvegarde/restauration inchangées et toujours vertes.
  **Chaîne d'audit.** Purger d'anciennes `activities` cassait A-19 (numérotation depuis 1) :
  la suppression suit `seq`, le plus récent retiré devient l'ancre `app_meta.audit_chain_anchor`
  (mise à jour seulement vers l'avant), `verifyActivityChain` repart de cette ancre et
  `previousHash` s'y raccroche quand le prédécesseur a disparu.
  **Écart assumé.** Un morceau n'a pas d'horodatage : la règle « 1 j » est lue sur la pièce
  (parent absent = orphelin ; parent supprimé depuis plus d'un jour). Un morceau de pièce
  vivante n'est jamais touché.
  Preuve : `tests/retention-purge.test.ts`, **6 cas** — purge de chaque politique avec bornes
  (91 j vs 89 j, session expirée 31 j vs active, etc.), lignes financières hors politiques,
  idempotence (2e passe = 0), **1 050 lignes → 3 lots de 500**, morceaux (vivant et supprimé
  récemment gardés, orphelin et supprimé depuis 2 j purgés), chaîne d'audit ancrée puis
  vérifiée après une nouvelle écriture, rapport de diagnostic. Mutation : fenêtres ramenées à
  zéro → **3 cas en échec sur 6**. Typecheck 0 erreur ; suite **109 fichiers / 828 tests**.
- **Pièges.** Ne jamais purger `activities` avant la durée comptable ; ne pas supprimer un
  morceau d'attachement référencé.
- **Effort.** M. **Statut.** DONE.

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
- **Livré (2026-11-06).** `server/lib/observability.ts` agrège, en lecture seule, les écarts
  d'intégrité (A-12), les écarts de stock (A-14), le retard comptable (A-18, calculé sur le
  même ensemble de candidats que le rattrapage mais **compté** au lieu d'être posté, sans
  écrire), le dernier passage quotidien et les échecs des 7 derniers jours, l'état des purges
  (A-24, clés `app_meta.retention_last_purged_*`), la version de schéma (`d1_migrations`) et
  les **10 plus grosses tables** (octets de charge estimés par `PRAGMA table_info` + longueurs).
  Carte `GET /api/dashboard/observability`, réservée aux rôles portant `activity.read` **ou**
  `accounting.read` (403 sinon), affichée sur `DashboardPage` avec libellés fr/en.
  `GET /api/health` devient enrichi : `status` (`ok`/`degraded`), version et dernière migration,
  compteurs agrégés, retard, dernier passage, purges — **aucune** adresse, identifiant, chemin
  ni échantillon (la route est publique). Repli `unavailable` si la base n'existe pas encore.
  Aucune migration : tout est déjà indexé/stocké.
  Preuve : `tests/observability.test.ts`, **5 cas** sur le vrai worker —
  carte servie avec version de schéma et plus grosses tables ; écart injecté (session vers un
  utilisateur inexistant) visible dans la carte **et** dans `/api/health` (`degraded`), puis
  `ok` après réparation ; réponse publique sans adresse e-mail, IP, chemin ni clé sensible ;
  rôle `viewer` refusé en **403 FORBIDDEN** ; purge réelle puis état de purge exposé.
  Mutation : garde de permission retirée → **1 cas en échec sur 5**. Typecheck 0 erreur ; suite
  **110 fichiers / 833 tests**.
- **Pièges.** Aucune donnée personnelle dans `/api/health` (public).
- **Effort.** M. **Statut.** DONE.

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
- **Tests.** `tests/integration/p0-http.test.ts`.
- **Livré (2026-11-06).** Harnais retenu : le vrai worker Hono (`worker.request`) sur une base
  `node:sqlite` **recréée et migrée à chaque cas** par `provisionDatabase()` (nouvel export de
  `server/db/index.ts` : migrations A-10, rattrapage des colonnes, rôles système). Aucun mock de
  handler : routes, permissions, sessions, CSRF, validation, SQL et effets persistés sont ceux de
  l'application. Écart documenté : `@cloudflare/vitest-pool-workers` n'est pas une dépendance du
  projet et `wrangler dev --local` n'est pas utilisable dans le runner ; l'adaptateur D1 du projet
  sur une base réellement migrée remplace donc le pool Workers (cf. `PENDING.md`).
  Huit cas : encaissement et solde soldé, immutabilité d'une facture émise (409, ligne inchangée),
  totaux d'un avoir TVA, ligne de TVA d'avoir **et** son écriture comptable, suppression de
  règlement qui restaure le solde, seuil d'approbation d'un avoir (409 `APPROVAL_REQUIRED`,
  demande en attente, auto-approbation refusée 403, identifiant inconnu 404), ajustement de stock
  persisté, rapport de chiffre d'affaires EUR + XPF agrégé en XPF. Chaque assertion lit le statut,
  le corps **et** les lignes persistées. Aucune migration ; `npm run test:integration` ajouté et
  les fichiers restent exécutés par `npx vitest run`. La couverture a trouvé un vrai défaut : une
  parenthèse en trop dans l'`INSERT` des clients (`server/routes/clients.ts`) faisait échouer
  toute création de client en erreur de syntaxe SQL — corrigé.
  Preuve : **8 cas**, suite complète **111 fichiers / 841 tests**, typecheck 0 erreur.
  Mutation : `requireApprovalIfNeeded` court-circuité pour les avoirs → **1 cas en échec sur 8**.
  Fixtures synthétiques uniquement (`example.test`, `10.6.0.x`).
- **Pièges.** Une base D1 locale doit être migrée par A-10 avant ; ne pas dépendre d'un état
  résiduel (recréer la base à chaque exécution).
- **Effort.** L. **Statut.** DONE.

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
- **Tests.** `tests/docs-integrity.test.ts` (3 gardes) : chiffres du constat daté comparés au
  schéma déclaré, liens relatifs des documents vivants résolus, audit du 28 octobre archivé et
  signalé périmé. Mutation : un chiffre faux dans le constat → **1 cas en échec sur 3**.
- **Livré (2026-11-06).** L'audit du 28 octobre reste **figé** dans
  `docs/archive/audit-2026-10-28/AUDIT.md` ; sa note d'archive nomme désormais les chiffres
  périmés (**26 tables / 28 index** annoncés, contre **89 tables / 89 index** recomptés) et
  renvoie à l'audit du 6 novembre. Le constat daté a été remis d'aplomb : « 89 tables, 89 index,
  4 clés étrangères » (recompté après A-17 et A-19), et les trois passages qui répétaient
  « 81 tables » suivent. `README.md` liste le plan du 6 novembre, l'audit, l'archive et le
  registre ; il énonce la règle **« tous les agrégats en XPF au taux figé »** et la couverture
  d'intégration HTTP. `docs/ARCHITECTURE.md` documente cette règle, la rétention (renvoi à
  `SECURITE.md`) et les migrations versionnées A-10. `docs/build/PENDING.md` consigne la limite
  **CSRF des routes anonymes** (L-13), l'**absence de planificateur** (L-14) et la livraison de la
  **devise des dépenses et BC** par A-08. `docs/SECURITE.md` décrit le contrôle d'origine et le
  jeton exigé seulement avec une session. Aucune migration.
  Preuve : `tests/docs-integrity.test.ts`, **3 cas** ; suite complète **112 fichiers / 844 tests**,
  typecheck 0 erreur. Mutation : chiffre de tables falsifié dans le constat → **1 cas en échec sur 3**.
- **Pièges.** Ne pas présenter A-26 comme fait avant qu'il ne le soit.
- **Effort.** S. **Statut.** DONE.

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
- **Tests.** `tests/concurrency/http-concurrency.test.ts` (3 cas déterministes) ; double
  installation et 50 écritures d'audit restent prouvés par `tests/setup-concurrency.test.ts`
  et `tests/audit-chain-concurrency.test.ts`. `scripts/concurrency-check.mjs` reste l'outil
  manuel sur une base vivante (V-03).
- **Livré (2026-11-06).** Harnais A-26 (vrai worker, base `node:sqlite` migrée par cas) complété
  par une **barrière** sur l'instruction critique : les deux requêtes ont lu le même état avant
  que l'une écrive, ce qui rend la course reproductible sans dépendre du timing.
  Double envoi : la transition `draft → sent` est réclamée par un `UPDATE … WHERE status = 'draft'`
  unique ; le perdant reçoit `409 INVALID_TRANSITION` **avant** tout mouvement, et un refus
  ultérieur (stock court, taux absent) restaure le brouillon. Double encaissement : chaque
  affectation réclame le solde par `UPDATE … WHERE balance >= ?` ; le second reçoit
  `409 AMOUNT_EXCEEDS_BALANCE`, une seule allocation est écrite, `paid_total` reste au total.
  Clôture de période : issue **documentée** — une écriture déjà passée par `assertPeriodOpen`
  peut se valider juste après la fermeture, toute écriture contrôlée ensuite est refusée en
  `409 PERIOD_LOCKED`. Aucune migration ; aucune donnée sensible.
  Preuve : `tests/concurrency/http-concurrency.test.ts`, **3 cas** ; suite complète
  **113 fichiers / 847 tests**, typecheck 0 erreur.
  Mutations : garde d'envoi neutralisée → **1 cas sur 3 en échec** ; garde de solde neutralisée
  → **1 cas sur 3** ; contrôle de période retiré du paiement → **1 cas sur 3**.
- **Pièges.** D1 local (`wrangler dev`) sérialise aussi : la concurrence réelle doit être
  simulée par des requêtes parallèles, pas par des threads SQLite.
- **Effort.** M. **Statut.** DONE.

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
| A-15 | Plafonds D1 (IN, LIKE) | 3 | M | — | DONE |
| A-16 | Projections des listes | 5 | M | — | DONE |
| A-17 | FTS5 + sauvegarde | 5 | L | A-10, A-11 | DONE |
| A-18 | Comptabilité incrémentale | 5 | L | A-05 | DONE |
| A-19 | Chaîne d'audit sans course | 4 | M | — | DONE |
| A-20 | Limitation par IP et compte | 6 | S | — | DONE |
| A-21 | En-têtes de sécurité cohérents | 6 | M | — | DONE |
| A-22 | Ré-auth MFA | 6 | S | — | DONE |
| A-23 | Installation verrouillée | 6 | S | A-13 | DONE |
| A-24 | Rétention et purges | 6 | M | A-15 | DONE |
| A-25 | Observabilité métier | 6 | M | A-12, A-14 | DONE |
| A-26 | Tests HTTP d'intégration | 6 | L | A-10 | DONE |
| A-27 | Documentation | 6 | S | A-01…A-31 | DONE |
| A-28 | Tests de concurrence | 6 | M | A-19, A-23 | DONE |
| A-29 | Aucune valeur métier en dur | 6 | M | A-10 | TODO |
| A-30 | Autorité sur les paramètres | 6 | M | — | TODO |
| A-31 | Réévaluation de change de clôture | 3 | L | A-01, A-08 | TODO (conditionnelle) |
