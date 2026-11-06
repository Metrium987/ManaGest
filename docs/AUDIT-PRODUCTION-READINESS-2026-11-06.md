# ManaGest — audit de préparation à la production

**Date :** 6 novembre 2026  
**Objet :** évaluer ManaGest module par module, fonction par fonction, face aux standards
d'un ERP de PME en 2026 (Odoo 18/19, Invoice Ninja), et chiffrer le travail restant pour
une mise en production réelle.  
**Périmètre :** code exécuté (`server/`, `src/`, `shared/`, `tests/`), schéma D1,
documentation vivante, configuration de build et de déploiement.  
**Nature :** audit de lecture et de mesure. Aucun code produit n'est modifié par ce
document ; les écarts listés sont des propositions, pas des tâches ouvertes du plan
A-01…A-31, qui reste clos.

---

## 0. Ce qui a été exécuté, et ce que cela prouve

| Contrôle | Commande | Résultat au 6/11/2026 |
|---|---|---|
| Typage client + Worker + tests UI | `npm run typecheck` | **0 erreur** |
| Suite complète | `npx vitest run` | **115 fichiers, 858 tests, 0 échec**, 5,4 s |
| Build de production | `npm run build` | **OK** ; Worker bundlé **2,5 Mo**, client Vite généré |
| Surface HTTP | extraction des routes | **507 handlers** (`GET` 342, `POST` 99, `DELETE` 30, `PATCH` 21, `PUT` 15) |
| Surface écran | `CLIENT_ROUTES` + `src/features` | **35 pages**, dont 32 protégées et 3 publiques |
| Schéma | `SCHEMA_STATEMENTS` + migrations | **89 tables, 89 index, 4 clés étrangères déclarées** |
| Journal d'audit | `tests/audit-chain-concurrency.test.ts` | chaîne vérifiée, y compris en concurrence |
| Migrations | `tests/schema-migrations.test.ts` | versionnées, idempotentes, testées |
| Sauvegarde | `tests/backup-restore.test.ts` | export + restauration locale prouvés |

**Ce que ces chiffres ne prouvent pas :** aucun test de charge, aucun parcours navigateur
automatisé exécuté dans cet environnement, aucune restauration sur D1 hébergé, aucune
validation par un comptable externe, aucun audit RGAA/WCAG. Ces limites sont détaillées
en §10.

---

## 1. Verdict en une page

ManaGest est **un back-office de PME polynésienne solide, largement au-dessus d'un
prototype**, et déjà crédible pour une entreprise mono-société qui facture, encaisse,
achète, suit son stock, ses projets et sa TVA. Les P0 de l'audit du 6 novembre (devise
des encaissements, TVA des avoirs, immutabilité, contre-écritures, approbations,
multi-devises des états, migrations, stock, rétention, concurrence) sont **fermés et
prouvés** par A-01…A-30.

Il n'est **pas encore « production ready au standard du marché »** pour quatre raisons :

1. **Exploitation incomplète** : aucun planificateur attaché (récurrences, relances,
   purges et contrôles quotidiens dépendent d'un cron externe), sauvegarde automatique
   non activée, restauration non rejouée sur l'hébergement, pas de supervision externe
   ni d'alerting.
2. **Comptabilité de système d'enregistrement incomplète** : le grand livre est dérivé
   et fiable pour les documents, mais il n'existe ni saisie manuelle d'écriture, ni
   exercice comptable clôturé, ni immobilisations/amortissements, ni clôture annuelle.
   Un comptable devra sortir de l'outil pour ces opérations.
3. **Intégrations et parcours client absents** : pas de portail client, pas de passerelle
   de paiement, pas de flux bancaire, pas de webhooks, pas de signature électronique.
   Ce sont des standards d'Invoice Ninja/Odoo, mais plusieurs sont **conditionnels** au
   modèle de l'entreprise.
4. **Preuves d'exploitation manquantes** : charge, navigateur, accessibilité, migration
   de données réelles et reprise après sinistre ne sont pas mesurés. Le code est bon ;
   la confiance en production ne l'est pas encore.

### Note globale : **3,4 / 5** — pilote avancé, production possible sous conditions

| Dimension | Note | État |
|---|---:|---|
| Couverture fonctionnelle back-office | 4,0 / 5 | Très bonne pour une PME mono-société |
| Exactitude comptable et TVA | 3,4 / 5 | Documents fiables ; clôture et écritures manuelles absentes |
| Intégrité des données | 4,0 / 5 | Migrations, contrôles, concurrence ; FK encore rares |
| Sécurité applicative | 4,0 / 5 | Sessions, CSRF, MFA, rôles, audit ; MFA non imposé |
| Exploitation et résilience | 2,3 / 5 | Cron, sauvegarde auto, supervision, DR à finir |
| Performance et montée en charge | 3,0 / 5 | Requêtes maîtrisées ; aucune mesure de charge |
| UX, accessibilité, mobile | 3,0 / 5 | Interface complète ; pas d'audit WCAG ni de mobile dédié |
| Intégrations et écosystème | 1,8 / 5 | API interne, e-mail ; pas de webhooks/portail/paiement |
| Conformité locale | 4,0 / 5 | TVA, mentions, fuseau, rétention ; validation comptable externe à faire |
| Documentation et support | 3,5 / 5 | Documentation riche ; runbook/SLA/astreinte à formaliser |

---

## 2. Référence marché : ce que font Odoo et Invoice Ninja

**Avertissement de comparaison.** Odoo distingue Community (open source) et Enterprise
(licence) ; la documentation 19.0 décrit l'ensemble, pas chaque édition. La
synchronisation bancaire n'est notamment **pas** incluse dans Community. Invoice Ninja
est une référence forte en facturation, devis, paiements, dépenses, projets et stock
léger, mais **pas** un grand livre généraliste comparable à Odoo Comptabilité.

| Attendu marché | Odoo | Invoice Ninja | ManaGest |
|---|---|---|---|
| Devis → facture → paiement → avoir | Oui | Oui | **Oui** |
| Factures récurrentes | Oui | Oui | **Oui** (moteur + cron externe) |
| Portail client | Oui (modules) | Oui | **Non** (liens publics seulement) |
| Paiement en ligne | Oui (prestataires) | Oui (passerelles) | **Non** |
| Comptabilité partie double | Oui (édition) | Non (registres) | **Oui, dérivée** |
| Écritures manuelles / clôture annuelle | Oui | Non | **Non** |
| Immobilisations / amortissements | Oui | Non | **Non** |
| TVA et états locaux | Oui (localisations) | Partiel | **Oui, Polynésie** |
| Stock, lots, valorisation | Oui (riche) | Léger | **Oui** (lots, emplacements, coût moyen) |
| Achats / BC / réceptions | Oui | Oui | **Oui** (BC, réception, dépense) |
| Projets / tâches / temps | Oui | Oui | **Oui** (planning, SLA, facturation) |
| Banque : import + rapprochement | Oui | Oui (CSV) | **Oui** (CSV, suggestions) |
| Flux bancaire automatisé | Oui (payant) | Partiel | **Non** |
| Rôles et permissions | Oui | Oui | **Oui** (rôles système + sur mesure) |
| MFA | Oui | Oui | **Oui** (facultatif) |
| SSO / OIDC | Oui (Enterprise/ modules) | Partiel | **Non** |
| Journal d'audit financier | Oui | Activité documentaire | **Oui, chaîné** |
| API et webhooks | Oui | Oui | **API oui, webhooks non** |
| Multi-société | Oui | Non | **Non** (mono-déploiement) |
| CRM / paie / GPAO / POS | Oui | Partiel | **Non** (hors périmètre assumé) |
| E-invoicing | Oui (localisations) | Partiel | **Non** (non requis localement) |

**Conclusion du benchmark.** ManaGest couvre le **cœur back-office** au niveau attendu,
et dépasse Invoice Ninja sur la comptabilité dérivée, les lots, la TVA polynésienne, les
rôles personnalisés et l'audit chaîné. Il reste en dessous d'Odoo sur la **profondeur
comptable**, l'**écosystème**, le **multi-société** et l'**exploitation**.

Sources principales : [Odoo 19 — Comptabilité](https://www.odoo.com/documentation/19.0/applications/finance/accounting.html),
[Odoo — Facturation client](https://www.odoo.com/documentation/19.0/applications/finance/accounting/customer_invoices.html),
[Odoo — Inventaire](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory.html),
[Odoo — Achats](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase.html),
[Odoo — Projets/temps](https://www.odoo.com/documentation/19.0/applications/services/timesheets.html),
[Odoo — Droits d'accès](https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html),
[Odoo — Synchronisation bancaire](https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/bank_synchronization.html),
[Odoo — Éditions](https://www.odoo.com/page/editions),
[Invoice Ninja — Guide utilisateur](https://invoiceninja.github.io/docs/user-guide),
[Invoice Ninja — API](https://invoiceninja.github.io/docs/api-reference/invoice-ninja-api-reference),
[Invoice Ninja — Webhooks](https://invoiceninja.github.io/docs/api-reference/webhooks).

---

## 3. Revue module par module

Notation : **5/5** = au niveau des meilleurs de la catégorie pour une PME ; **4/5** =
solide, quelques écarts ; **3/5** = utilisable mais depth/exploitation incomplète ;
**2/5** = partiel ; **1/5** = absent.

### M1 — Socle : réglages, numérotation, i18n, rétention — **4,5 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Réglages d'espace typés, bornés, journalisés | **Livré** | `settings-extra.ts`, `tests/settings-extra.test.ts`, A-29/A-30 |
| Numérotation par entité, registre des trous | **Livré** | `lib/numbering.ts`, `tests/number-uniqueness.test.ts` |
| TVA, mentions, fuseau, locale paramétrables | **Livré** | `docs/CONFORMITE.md`, `tests/config-driven-format.test.ts` |
| Rétention et purges | **Livré** | `lib/retention.ts`, `tests/retention-purge.test.ts`, A-24 |
| Rôles et permissions | **Livré** | voir M2 |
| Exercice comptable / période annuelle | **Absent** | verrou mensuel seulement (L-12) |
| Modèles de documents personnalisables | **Partiel** | deux mises en page (`classic`, `compact`), pas d'éditeur |

**Reste à faire :** exercice comptable et clôture annuelle (mutualisé avec M10) ;
éditeur de modèles si des clients exigent leur charte. Aucun chantier de socle
prioritaire.

### M2 — Identité, utilisateurs, rôles, audit, API — **4,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Mots de passe PBKDF2, politique NIST | **Livré** | `lib/passwords.ts`, `tests/password-reset.test.ts` |
| Sessions opaques, expiration, révocation | **Livré** | `services/session.ts` |
| CSRF, origine, en-têtes, CSP | **Livré** | `tests/security-headers.test.ts` |
| MFA TOTP + codes de secours | **Livré, facultatif** | `tests/mfa-flow.test.ts` ; pas d'obligation par rôle |
| Rôles système + rôles sur mesure | **Livré** | `tests/roles.test.ts`, `tests/settings-authority.test.ts` |
| Journal d'audit chaîné | **Livré** | `tests/audit-chain-concurrency.test.ts`, A-19 |
| Jetons d'API hachés, permissions | **Livré** | `tests/api-tokens.test.ts` |
| Limite de débit par jeton | **Absent** | L-11 |
| SSO / OIDC / SAML | **Absent** | acceptable pour PME, attendu en croissance |
| Webhooks sortants | **Absent** | aucun événement poussé vers un tiers |

**Reste à faire :** imposer MFA aux rôles `owner`/`admin`/`accountant` (et proposer une
procédure de récupération) ; limite de débit et rotation des jetons d'API ; webhooks
signés avec reprise ; SSO seulement si un client le demande.

### M3 — Clients et contacts — **4,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| CRUD clients, contacts, identifiants TAHITI/RIDET/NIF | **Livré** | `routes/clients.ts`, `tests/client-surface.test.ts` |
| Conditions de paiement, exonération, devise | **Livré** | schéma `clients`, `services/documents.ts` |
| Relevé de compte, documents liés | **Livré** | `ClientDetailPage`, `ClientDocumentsPanel` |
| Tarifs par client | **Livré** | `lib/client-pricing.ts`, `tests/client-pricing.test.ts` |
| Portail client | **Absent** | T-401, décision produit |
| Adresses multiples / livraison | **Non trouvé** | adresse libre, pas de carnet d'adresses |
| Limite de crédit / encours surveillé | **Non trouvé** | pas de blocage à la commande |
| Fusion de doublons | **Absent** | import seulement |

**Reste à faire :** portail (si le modèle le justifie), adresses multiples, limite de
crédit, fusion/dédoublonnage. Ces points sont P1/P2 selon le segment.

### M4 — Ventes : devis, factures, avoirs, paiements, récurrences — **4,5 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Cycle devis → facture → paiement → avoir | **Livré** | `tests/integration/p0-http.test.ts`, `tests/credit-note.test.ts` |
| Statuts et transitions verrouillés | **Livré** | `services/status.ts`, `tests/document-immutability.test.ts` |
| Numérotation, immuabilité, annulation | **Livré** | A-02, A-03, A-04 |
| Paiements partiels, affectation, écart de change | **Livré** | `tests/settle-invoice.test.ts`, `tests/accounting-reversals.test.ts` |
| Avoirs avec TVA et contre-écriture | **Livré** | `tests/vat-credits.test.ts`, A-03/A-04 |
| Factures récurrentes | **Livré, dépend d'un cron** | `services/recurring.ts`, `tests/daily-run.test.ts` |
| Relances | **Livré en intention, envoi manuel** | L-06 ; e-mail dépend de P-01 |
| PDF (facture, devis, avoir) | **Livré** | `tests/pdf-documents.test.ts`, `tests/pdf-layout.test.ts` |
| Liens publics de document | **Livré** | `tests/public-links.test.ts` |
| Envoi e-mail (manuel, Resend, Brevo, SMTP) | **Livré** | `tests/email.test.ts` ; domaine à vérifier côté propriétaire |
| Portail client, signature, acomptes/échéanciers | **Absent** | standards Invoice Ninja/Odoo |
| Paiement en ligne | **Absent** | T-402 ; dépend d'une passerelle |
| Facturation électronique | **Hors périmètre local** | `docs/CONFORMITE.md` §5 |

**Reste à faire :** fiabiliser le cron et l'envoi réel des relances ; acomptes et
échéanciers ; portail/signature si attendus ; passerelle de paiement uniquement après
validation du prestataire et de la devise XPF. Le cœur documentaire est mature.

### M5 — Abonnements et récurrence — **3,5 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Modèle récurrent, génération, cycles | **Livré** | `services/recurring.ts` |
| Idempotence du passage quotidien | **Livré** | `daily_runs`, `tests/daily-run.test.ts` |
| Pause/reprise, date de fin | **Partiel** | selon schéma/modèle ; à vérifier par cas |
| Décalage 31 → 28 | **Limite assumée** | L-07, testé |
| Prélèvement automatique | **Absent** | dépend d'une passerelle |
| Alerte d'échec de génération | **Partielle** | daily run tracé ; pas d'alerte externe |

**Reste à faire :** planificateur supervisé, alerting sur échec, pause/reprise explicite
si absente, proration. Effort faible à moyen.

### M6 — Produits, stock, inventaire — **4,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Catalogue, prix, coût, familles, TVA | **Livré** | `routes/products.ts`, `tests/product-erp.test.ts` |
| Mouvements signés, lots, emplacements | **Livré** | `tests/stock-integrity.test.ts`, `tests/lots.test.ts` |
| Valorisation, coût moyen, marges | **Livré** | `tests/valuation.test.ts`, `tests/margin.test.ts` |
| Kits/nomenclatures, composants | **Livré** | `tests/kit-explosion.test.ts` |
| Réapprovisionnement, alertes | **Livré** | `tests/replenishment.test.ts`, `tests/stock-alerting.test.ts` |
| Inventaires physiques | **Livré** | `tests/stock-count.test.ts` |
| Retours client | **Livré** | `tests/stock-returns.test.ts` |
| Lots/expiration | **Partiel** | `stock_lots.expiry_date` ; pas de règle FEFO identifiée |
| Code-barres, unités de mesure, variantes | **Non trouvé** | aucun champ/scan identifié |
| Multi-entrepôt / WMS | **Hors périmètre** | décision produit |

**Reste à faire :** code-barres et unités de mesure si le terrain l'exige, FEFO si
produits périssables, réconciliation périodique exposée (déjà partiellement via
observabilité). Le stock est l'un des modules les plus complets.

### M7 — Achats, fournisseurs, dépenses — **3,5 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Fournisseurs, prix, liens produits | **Livré** | `tests/vendor-links.test.ts` |
| Bons de commande, réceptions | **Livré** | `tests/landed-cost.test.ts`, `purchase_order_receipts` |
| Dépenses, catégories, justificatifs | **Livré** | `tests/attachments.test.ts`, A-08 |
| Devise des dépenses/BC, taux figé | **Livré** | `tests/expenses-fx.test.ts` |
| Conversion BC → dépense | **Livré** | routes opérations |
| Approbation des dépenses | **Livré** | `lib/approvals.ts` (`expense`) |
| Approbation des BC | **Absent** | types approuvés : facture, avoir, dépense |
| Rapprochement facture fournisseur / 3-way match | **Absent** | pas de facture fournisseur normalisée |
| OCR des justificatifs | **Absent** | pièce jointe seulement |
| Portail fournisseur | **Absent** | décision R4 |

**Reste à faire :** facture fournisseur et rapprochement BC/réception/facture,
approbation des BC, OCR optionnel. C'est le module le plus en retrait face à Odoo
Achats, mais il couvre le besoin d'une PME de services.

### M8 — Projets, tâches, planning, SLA — **4,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Projets, budgets, tâches, statuts | **Livré** | `tests/planning.test.ts`, `tests/project-template.test.ts` |
| Temps facturable, facturation des tâches | **Livré** | `tests/task-billing.test.ts`, `tests/timesheet-billing.test.ts` |
| Planning, capacités, jours fériés | **Livré** | `tests/planning-sla.test.ts` |
| SLA par priorité | **Livré** | `tests/planning-sla.test.ts` |
| Modèles de projet versionnés | **Livré** | `tests/project-template.test.ts` |
| Gantt / dépendances de tâches | **Non trouvé** | pas de graphe de dépendances identifié |
| Portail client projet | **Absent** | T-401 |
| Minuteur / mobile terrain | **Partiel** | saisie de temps, pas d'app mobile |

**Reste à faire :** dépendances/Gantt si pilotage projet complexe, portail, mobile.
Pour une PME de services, le module est déjà au niveau attendu.

### M9 — Banque et trésorerie — **3,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Comptes bancaires, transactions | **Livré** | `routes/bank.ts`, `tests/bank-match.test.ts` |
| Import CSV, suggestions de rapprochement | **Livré** | `tests/bank-match.test.ts` |
| Rapprochement manuel, idempotence | **Livré** | `tests/bank-match.test.ts`, A-28 |
| Ledger des documents | **Livré** | `/api/bank/ledger` |
| Flux bancaire automatisé | **Absent** | aucun fournisseur local vérifié |
| Règles de rapprochement éditables | **Partiel** | suggestions par montant/libellé |
| Lettrage / clôture de compte | **Partiel** | confirmation unitaire |
| Frais bancaires, virements multiples | **Non trouvé** | à vérifier selon besoin |

**Reste à faire :** import OFX/CAMT si les banques locales le fournissent, règles
éditables, écran de clôture de compte, virements multiples. Le CSV est un minimum
acceptable ; le flux temps réel est conditionnel.

### M10 — Comptabilité, TVA, multi-devises — **3,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Grand livre dérivé des documents | **Livré** | `tests/accounting.test.ts`, `tests/accounting-incremental.test.ts` |
| Partie double, balance, résultat, bilan simplifié | **Livré** | `routes/accounting.ts` (`trial-balance`, `income-statement`, `balance-sheet`) |
| Contre-écritures paiements/dépenses | **Livré** | A-05, `tests/accounting-reversals.test.ts` |
| Verrouillage de période | **Livré** | A-28, `tests/accounting-catch-up-route.test.ts` |
| TVA (1010) par taux, avoirs déduits | **Livré** | `tests/vat-return.test.ts` |
| Multi-devises, taux figé, écarts réalisés | **Livré** | `tests/reports-multicurrency.test.ts` |
| Reprise de balance | **Livré** | `tests/opening-balances.test.ts` |
| Saisie manuelle d'écriture | **Absent** | L-04 : ajustements hors outil |
| Exercice comptable, clôture annuelle | **Absent** | L-12 : verrou mensuel seulement |
| Immobilisations, amortissements | **Absent** | L-03 |
| Bilan détaillé, flux de trésorerie | **Partiel** | bilan simplifié, pas de tableau de flux |
| Analytique / centres de coût | **Partiel** | `profit_centers`, à confronter aux besoins |
| Consolidation multi-société | **Absent** | N-11 |

**Reste à faire — le chantier le plus structurant :** écritures manuelles équilibrées,
exercice et clôture, immobilisations/amortissements, éventuellement analytique et
tableau de flux. Sans cela, ManaGest reste un **excellent sous-registre documentaire**,
pas un **système d'enregistrement comptable complet** face à Odoo.

### M11 — Rapports et tableau de bord — **4,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| KPI, facturation/encaissement, soldes | **Livré** | `routes/dashboard.ts`, `tests/reports.test.ts` |
| CA, résultat, balance âgée, ventes par client | **Livré** | `routes/reports.ts` |
| TVA (1010), récapitulatif, multi-devises | **Livré** | `tests/vat-return.test.ts` |
| Marges, stock, santé des données | **Livré** | `tests/observability.test.ts` |
| Export CSV | **Livré** | `tests/csv.test.ts` |
| Rapport personnalisable / constructeur | **Absent** | pas de créateur d'états |
| Exports planifiés | **Absent** | export à la demande |
| Drill-down document depuis un agrégat | **Partiel** | selon écran |

**Reste à faire :** constructeur d'états simple et exports planifiés si les besoins
reporting grandissent. Les états standards sont couverts.

### M12 — Import/export, recherche, sauvegarde — **4,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Import CSV/XLSX, aperçu, validation, erreurs | **Livré** | `tests/import*.test.ts`, `tests/xlsx.test.ts` |
| Import factures, TVA, tarifs | **Livré** | tests dédiés |
| Export complet, restauration, checksum | **Livré** | `tests/backup-restore.test.ts` |
| Recherche FTS5, limites | **Livré** | `tests/search-fts.test.ts`, `tests/search-limits.test.ts` |
| Sauvegarde automatique | **Action propriétaire** | P-03 |
| Restauration sur D1 hébergé | **Non vérifiée** | V-06 |
| Export planifié / API d'export | **Absent** | à la demande |

**Reste à faire :** activer et tester la sauvegarde hébergée, documenter une procédure
de restauration annuelle, éventuellement exports planifiés. Le socle est bon.

### M13 — Administration, e-mail, exploitation — **3,0 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Paramètres société, taxes, mentions | **Livré** | `SettingsPage`, A-29/A-30 |
| Utilisateurs, sessions, rôles | **Livré** | `tests/roles.test.ts` |
| E-mail manuel/Resend/Brevo/SMTP, secrets chiffrés | **Livré** | `tests/email.test.ts`, `docs/SECURITE.md` §9 |
| Journal d'audit, santé, rétention | **Livré** | A-24/A-25 |
| Planificateur quotidien | **Absent côté hébergement** | D-04 : cron externe |
| Supervision externe / alerting | **Absent** | health endpoint seulement |
| Runbook, SLA, astreinte | **Absent** | à formaliser |
| Sauvegarde automatique | **Action propriétaire** | P-03 |
| Tests de charge / navigateur | **Non exécutés** | V-02/V-04 |

**Reste à faire :** c'est le bloc qui bloque le plus la production. Un cron supervisé,
une alerte sur échec du daily run, une sauvegarde testée et un runbook valent plus que
dix fonctionnalités.

### M14 — UX, accessibilité, mobile, intégrations — **2,5 / 5**

| Fonction | État | Preuve / écart |
|---|---|---|
| Interface FR/EN, cohérente, responsive | **Livré** | 35 pages, i18n testée |
| Accessibilité de base (labels, focus, rôles) | **Partiel** | règles présentes, aucun audit WCAG |
| Mobile/PWA | **Absent** | N-03 |
| Portail client | **Absent** | T-401 |
| CRM | **Absent** | hors périmètre |
| Paie | **Absent** | hors périmètre, localement sensible |
| GPAO / POS | **Absent** | hors périmètre |
| Multi-société | **Absent** | N-11 |
| Webhooks / SSO | **Absent** | voir M2 |
| Passerelle de paiement | **Absent** | T-402 |

**Reste à faire :** ne pas construire ces modules par principe de parité. Les ouvrir
seulement sur un besoin client documenté. En revanche, l'audit WCAG et un parcours
mobile des tâches quotidiennes sont des attentes de marché.

---

## 4. Tableau de synthèse : où en est chaque module

| Module | Note | Livré | Reste à faire principal | Effort restant |
|---|---:|---|---|---|
| M1 Socle | 4,5 | Réglages, numérotation, i18n, rétention | Exercice/clôture (avec M10) | 8–12 j |
| M2 Identité | 4,0 | Sessions, MFA, rôles, audit, API | MFA imposé, débit API, webhooks, SSO | 8–14 j |
| M3 Clients | 4,0 | CRUD, contacts, relevé, tarifs | Portail, adresses, limite de crédit | 6–12 j |
| M4 Ventes | 4,5 | Devis, factures, avoirs, paiements, PDF, liens | Cron/relances, acomptes, portail, paiement | 10–20 j |
| M5 Récurrence | 3,5 | Modèles, génération, idempotence | Supervision, pause/reprise, proration | 3–6 j |
| M6 Produits/stock | 4,0 | Lots, emplacements, valorisation, kits | Code-barres, UoM, FEFO | 8–15 j |
| M7 Achats/dépenses | 3,5 | BC, réceptions, dépenses, devise | Facture fournisseur, 3-way match, approbation BC | 12–20 j |
| M8 Projets | 4,0 | Tâches, temps, planning, SLA, modèles | Gantt/dépendances, portail, mobile | 8–15 j |
| M9 Banque | 3,0 | CSV, suggestions, rapprochement | Flux bancaire, règles, clôture | 6–12 j |
| M10 Comptabilité | 3,0 | Grand livre, TVA, multi-devises, période | Écritures manuelles, exercice, immobilisations | 20–35 j |
| M11 Rapports | 4,0 | États standards, TVA, marges, CSV | Constructeur, exports planifiés | 6–10 j |
| M12 Import/backup | 4,0 | CSV/XLSX, FTS5, export/restauration | Sauvegarde hébergée, restauration réelle | 3–6 j |
| M13 Admin/ops | 3,0 | Paramètres, e-mail, audit, santé | Cron, supervision, runbook, sauvegarde | 8–14 j |
| M14 UX/intégrations | 2,5 | Interface complète, i18n | WCAG, mobile, portail, modules conditionnels | 15–40 j |

**Total « production confortable » (hors modules conditionnels) : 95–170 jours-homme.**
**Total « parité marché large » (avec portail, CRM, paie, GPAO, POS, multi-société) :
300–500 jours-homme**, à ne pas engager sans validation du segment.

---

## 5. Registre des écarts prioritaires

Sévérité : **P0** = bloque une production sérieuse ; **P1** = nécessaire pour un usage
quotidien fiable ou une exigence marché forte ; **P2** = finition, différenciation.

| ID | Module | Sévérité | Écart | Action recommandée | Effort | Critère de fin |
|---|---|---|---|---|---|---|
| G-01 | Ops | **P0** | Aucun planificateur attaché : récurrences, relances, purges, contrôles quotidiens ne partent pas seuls | Cron supervisé + alerte sur échec + bouton manuel conservé | 2–3 j | Un daily run échoué déclenche une alerte ; 30 jours de runs tracés |
| G-02 | Ops | **P0** | Sauvegarde automatique non active ; restauration non rejouée sur D1 hébergé | Activer la politique de sauvegarde, tester une restauration réelle, documenter | 2–4 j + action hébergeur | Restauration datée sur base jetable, checksum vérifié |
| G-03 | Sécurité | **P0** | MFA facultatif, y compris pour propriétaire/comptable | Imposer MFA aux rôles sensibles, procédure de secours, test | 2–3 j | Connexion admin sans MFA refusée ou guidée ; récupération testée |
| G-04 | Ops | **P0** | Aucune mesure de charge | Exécuter `load:test` sur jeu réaliste, seuils p95, correction | 3–5 j | p95 documenté, aucun 5xx, plan de capacité |
| G-05 | Qualité | **P0** | Parcours navigateur et accessibilité non validés | Playwright sur 5 parcours critiques + audit WCAG | 5–8 j | Scénarios verts, défauts corrigés, limites consignées |
| G-06 | Données | **P0** | Migration d'un vrai jeu de données non répétée | Répétition import/export + restauration + contrôle des totaux | 3–5 j | Totaux identiques avant/après, écarts expliqués |
| G-07 | Comptabilité | **P0** (si système d'enregistrement) | Pas de saisie manuelle d'écriture | Écran d'écriture équilibrée, validation, journal, permissions | 10–15 j | Écriture déséquilibrée refusée ; journal et balance à jour |
| G-08 | Comptabilité | **P0** (si système d'enregistrement) | Pas d'exercice ni de clôture annuelle | Exercice paramétrable, à-nouveaux, clôture, verrou | 10–15 j | Clôture rejouable, ouverture suivante cohérente |
| G-09 | Comptabilité | **P1** | Pas d'immobilisations/amortissements | Registre, plan d'amortissement, écritures | 8–12 j | Amortissement posté, tableau et PDF |
| G-10 | Conformité | **P0** | Politique RGPD/données personnelles non opérationnelle | Registre, base légale, export/suppression, DPA, rétention | 3–5 j | Demande d'accès traitée, procédure écrite |
| G-11 | Ops | **P0** | Pas de supervision externe ni d'alerting | Logs/metrics exportés, alerte disponibilité et erreurs | 2–3 j | Alerte reçue sur panne simulée |
| G-12 | Ops | **P0** | Pas de runbook/SLA/astreinte | Documenter incidents, restauration, contacts, RTO/RPO | 2–3 j | Runbook testé par une personne externe |
| G-13 | API | **P1** | Pas de limite de débit par jeton | Quota par jeton, 429, journal | 2–3 j | 429 après seuil, métrique exposée |
| G-14 | API | **P1** | Pas de webhooks | Événements signés, reprise, journal | 4–6 j | Livraison, signature, retry testés |
| G-15 | Ventes | **P1** | Pas d'acomptes/échéanciers | Facture d'acompte, échéancier, affectation | 8–12 j | Acompte déduit, solde et TVA justes |
| G-16 | Ventes | **P1** | Pas de portail client | Réutiliser liens publics + authentification client | 10–15 j | Client voit documents et paie (si passerelle) |
| G-17 | Paiement | **P1** (conditionnel) | Pas de paiement en ligne | Choisir un prestataire compatible XPF, intégrer, tester | 8–12 j | Paiement test, remboursement, webhook |
| G-18 | Banque | **P1** (conditionnel) | Pas de flux bancaire | Vérifier la banque locale, connecteur ou OFX/CAMT | 5–10 j | Import automatique ou manuel documenté |
| G-19 | Achats | **P1** | Pas de facture fournisseur ni de 3-way match | Facture fournisseur, rapprochement BC/réception | 10–15 j | Écart prix/quantité signalé, comptabilisation |
| G-20 | Achats | **P2** | Approbation des BC absente | Étendre les seuils aux BC | 3–5 j | BC au-dessus du seuil bloqué |
| G-21 | Stock | **P2** | Pas de code-barres/UoM | Champs, scan, conversion | 8–12 j | Réception/vente scanée, UoM converties |
| G-22 | Projets | **P2** | Pas de Gantt/dépendances | Graphe, vue, contrôle de cycle | 8–12 j | Dépendances visibles, cycle refusé |
| G-23 | Reporting | **P2** | Pas de constructeur d'états | Filtres, colonnes, sauvegarde, export | 8–12 j | État créé et exporté sans code |
| G-24 | Documents | **P2** | Pas d'éditeur de modèles | Éditeur ou modèles multiples par document | 8–12 j | Modèle appliqué au PDF |
| G-25 | Sécurité | **P2** | PBKDF2 plafonné à 100 000 | Étudier Argon2id/délégué, documenter | 3–5 j | Décision et migration planifiée |
| G-26 | Sécurité | **P2** | Pas de SSO | OIDC/SAML si demande entreprise | 5–8 j | Connexion SSO testée |
| G-27 | UX | **P2** | Pas de mobile/PWA | PWA ou app des tâches terrain | 10–15 j | Parcours mobile utilisable hors ligne |
| G-28 | Produit | **P2** (conditionnel) | CRM absent | Pipeline, activités, conversion devis | 12–20 j | Besoin client validé |
| G-29 | Produit | **P2** (conditionnel) | Paie absente | Ne pas construire sans spécialiste local | 30 j+ | Cadre local validé |
| G-30 | Produit | **P2** (conditionnel) | GPAO/POS/multi-société absents | Ouvrir uniquement sur segment | 60 j+ | Cas d'usage chiffré |

---

## 6. Feuille de route proposée

### Phase 0 — « Production sûre » (2 à 3 semaines)

Objectif : rendre l'existant exploitable sans surprise.

1. G-01 cron supervisé + G-11 supervision + G-12 runbook.
2. G-02 sauvegarde automatique et restauration réelle.
3. G-03 MFA imposé aux rôles sensibles.
4. G-04 charge + G-05 navigateur/accessibilité + G-06 migration réelle.
5. G-10 politique de données personnelles.

**Sortie :** un pilote chez une PME réelle, avec sauvegarde testée, alertes, MFA et
parcours critiques prouvés. C'est le **seuil minimal** avant de parler de production.

### Phase 1 — « Comptabilité système d'enregistrement » (4 à 6 semaines)

1. G-07 écritures manuelles.
2. G-08 exercice et clôture.
3. G-09 immobilisations/amortissements.
4. G-19 facture fournisseur et rapprochement achats.
5. G-13/G-14 limites API et webhooks.

**Sortie :** un comptable peut tenir les ajustements, la clôture et les achats dans
ManaGest, sans export parallèle.

### Phase 2 — « Parité commerciale » (2 à 3 mois, conditionnelle)

Portail client, acomptes/échéanciers, paiement en ligne, flux bancaire, code-barres/UoM,
Gantt, constructeur d'états. Chaque point est ouvert **après validation d'un besoin
client**, pas pour cocher une case face à Odoo.

### Phase 3 — « Extension » (3 à 6 mois, conditionnelle)

CRM, paie, GPAO, POS, multi-société, SSO. Ces modules changent le modèle de données et
la promesse de service ; ils ne doivent pas être engagés sans chiffrage et sans
propriétaire produit.

---

## 7. Décisions à prendre avant d'engager le reste

| # | Décision | Pourquoi elle change l'audit |
|---|---|---|
| D-1 | **ManaGest est-il le système d'enregistrement comptable** ou un sous-registre alimentant un comptable externe ? | Si oui, G-07/G-08/G-09 sont P0 ; si non, ils sont P1 et le périmètre production est plus court. |
| D-2 | **Segment cible** : services, négoce, artisanat, multi-société ? | Détermine stock, achats, projets, multi-société. |
| D-3 | **Portail client et paiement en ligne** sont-ils attendus commercialement ? | Déclenche G-16/G-17 et une dépendance prestataire. |
| D-4 | **Banque locale** : quels formats/flux sont réellement disponibles ? | Détermine G-18 ; le CSV peut suffire. |
| D-5 | **Hébergement et SLA** : qui exploite, sauvegarde, supervise, répond aux incidents ? | Détermine G-01/G-02/G-11/G-12 et la responsabilité RGPD. |
| D-6 | **Multi-société** à court terme ? | Un chantier de modèle, pas un réglage (N-11). |
| D-7 | **Validation comptable externe** des mentions, du 1010 et du taux archipels | Transforme la conformité « codée » en conformité « validée ». |

---

## 8. Ce qu'il ne faut pas construire maintenant

- **CRM, paie, GPAO, POS, multi-société** : aucun besoin prouvé dans le dépôt, coût
  élevé, risque de dilution. Les garder comme extensions conditionnelles.
- **E-invoicing / Peppol / Chorus** : la Polynésie n'est pas soumise au mandat
  métropolitain ; aucune obligation locale vérifiée. À rouvrir sur contrainte client.
- **WMS multi-entrepôt, EDI fournisseur, GPAO** : explicitement hors périmètre du
  backlog produit.
- **Microservices, file de messages, cache distribué** : la charge cible ne le justifie
  pas ; D1 + Worker suffisent si les mesures de charge le confirment.

---

## 9. Ce que ManaGest fait déjà mieux que la moyenne du marché

1. **TVA polynésienne modélisée avec preuves** : taux datés, franchise, mentions,
   ventilation par taux, avoirs déduits.
2. **Immuabilité et contre-écritures** : documents émis verrouillés, annulations
   compensées, journal chaîné.
3. **Multi-devises rigoureux** : taux figé par document, montants XPF, écarts réalisés,
   aucun taux deviné.
4. **Stock à trois niveaux** (mouvements, lots, emplacements) avec contrôle d'écart
   exposé, au-delà d'Invoice Ninja.
5. **Rôles personnalisés et anti-élévation**, rares dans les ERP de cette taille.
6. **Rétention, purges et observabilité** intégrées, pas ajoutées après incident.
7. **Documentation de décision** : chaque limite est écrite, chaque correctif a sa
   preuve. C'est un actif rare et précieux pour la suite.

---

## 10. Limites de cet audit

- **Aucune exécution navigateur** : les 35 écrans n'ont pas été parcourus ici ; les
  constats UI viennent du code et des tests existants.
- **Aucun test de charge** : les performances sont déduites des requêtes et des tests
  de plan, pas mesurées sur un jeu réaliste.
- **Aucune restauration sur D1 hébergé** : la preuve existe en local, pas sur la cible.
- **Aucune validation comptable externe** : les règles sont conformes aux sources
  citées, pas validées par un expert-comptable polynésien.
- **Aucun audit WCAG/RGAA** : l'accessibilité est implémentée par intentions et tests
  partiels, pas certifiée.
- **Benchmark non exhaustif** : Odoo et Invoice Ninja sont des références, pas des
  cahiers des charges. Les modules conditionnels doivent être validés par le modèle
  économique, pas par parité.

---

## Annexe A — Preuves par domaine

| Domaine | Fichiers de test représentatifs |
|---|---|
| Documents/ventes | `p0-http`, `document-immutability`, `credit-note`, `settle-invoice`, `pdf-documents` |
| Comptabilité/TVA | `accounting`, `accounting-incremental`, `accounting-reversals`, `vat-return`, `vat-credits` |
| Multi-devises | `multi-currency`, `reports-multicurrency`, `expenses-fx` |
| Stock | `stock-integrity`, `lots`, `lot-balances`, `valuation`, `replenishment`, `kit-explosion` |
| Achats/dépenses | `vendor-links`, `landed-cost`, `attachments`, `approvals` |
| Projets/planning | `planning`, `planning-sla`, `task-billing`, `timesheet-billing`, `project-template` |
| Banque | `bank-match` |
| Sécurité/identité | `security-headers`, `mfa-flow`, `password-reset`, `roles`, `permissions`, `api-tokens` |
| Exploitation | `daily-run`, `retention-purge`, `observability`, `backup-restore`, `schema-migrations` |
| Qualité | `docs-integrity`, `query-plans`, `db-constraints`, `integrity`, `concurrency/http-concurrency` |

## Annexe B — Sources externes

- Odoo 19 — Comptabilité : <https://www.odoo.com/documentation/19.0/applications/finance/accounting.html>
- Odoo 19 — Factures client : <https://www.odoo.com/documentation/19.0/applications/finance/accounting/customer_invoices.html>
- Odoo 19 — Inventaire : <https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/inventory.html>
- Odoo 19 — Achats : <https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase.html>
- Odoo 19 — Temps : <https://www.odoo.com/documentation/19.0/applications/services/timesheets.html>
- Odoo 19 — Droits d'accès : <https://www.odoo.com/documentation/19.0/applications/general/users/access_rights.html>
- Odoo 19 — Multi-devises : <https://www.odoo.com/documentation/19.0/applications/finance/accounting/get_started/multi_currency.html>
- Odoo — Éditions Community/Enterprise : <https://www.odoo.com/page/editions>
- Odoo — Synchronisation bancaire (non Community) : <https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/bank_synchronization.html>
- Invoice Ninja — Guide : <https://invoiceninja.github.io/docs/user-guide>
- Invoice Ninja — API : <https://invoiceninja.github.io/docs/api-reference/invoice-ninja-api-reference>
- Invoice Ninja — Webhooks : <https://invoiceninja.github.io/docs/api-reference/webhooks>
- DICP — TVA : <https://www.service-public.pf/dicp/professionnels/vos-impots/taxe-sur-la-valeur-ajoutee/>
- DICP — Taux de TVA : <https://www.service-public.pf/dicp/faq-items/quels-sont-les-principaux-taux-de-tva/>
- Protection des données en Polynésie : <https://www.service-public.pf/dsi/protection-des-donnees-rgpd/>
- Facturation électronique — territoires non concernés : <https://entreprendre.service-public.gouv.fr/actualites/A15683>
