# ManaGest — plan d'action production

**Date :** 6 novembre 2026  
**Statut :** proposition d'exécution, **non engagée** : aucune ligne n'est ouverte dans le plan
A-01…A-31, qui reste clos. Ce document transforme les 30 écarts de
[l'audit de préparation à la production](../AUDIT-PRODUCTION-READINESS-2026-11-06.md) en
solutions datées, chiffrées et sourcées.  
**Règle :** une solution n'entre en code qu'après la décision correspondante (§1), et chaque
tâche reprend les gates de [`VERIFICATION-GATES.md`](VERIFICATION-GATES.md).

---

## 0. Ce que ce plan change, et ce qu'il ne change pas

- Il **ne rouvre pas** A-31 : la réévaluation de change de clôture reste close tant qu'aucune
  facture non arrimée n'est émise. Si le déclencheur survient, la fiche archivée reste la
  spécification.
- Il **ne promet pas** la parité Odoo. Odoo Community et Enterprise n'offrent pas le même
  périmètre ; chaque solution ci-dessous indique le module de référence et l'édition.
- Il **ne copie pas** Odoo : les modules OCA sont des **inspirations de modèle et de
  comportement**, pas des dépendances. ManaGest reste un Worker Hono + D1, sans Python.
- Il **n'ouvre pas** les modules conditionnels (CRM, paie, GPAO, POS, multi-société) sans
  décision D-2/D-6.

---

## 1. Décisions à prendre avant d'engager les travaux

| # | Décision | Effet sur le plan |
|---|---|---|
| D-1 | ManaGest est-il le **système d'enregistrement comptable** ou un sous-registre ? | Si oui : G-07, G-08, G-09 passent en P0. Si non : ils restent P1 et la production peut démarrer plus tôt. |
| D-2 | **Segment cible** : services, négoce, artisanat, multi-société ? | Déclenche stock (G-21), achats (G-19/G-20), projets (G-22), multi-société (G-30). |
| D-3 | **Portail client et paiement en ligne** sont-ils un argument commercial ? | Déclenche G-16 et G-17 ; impose un prestataire et un cadre contractuel. |
| D-4 | Quels **formats bancaires** les banques polynésiennes fournissent-elles réellement ? | Détermine G-18 ; CSV/OFX peut suffire, le flux temps réel est optionnel. |
| D-5 | **Qui exploite** : sauvegarde, supervision, astreinte, réponse RGPD ? | Détermine G-01, G-02, G-11, G-12 et la responsabilité de traitement. |
| D-6 | **Multi-société** à court terme ? | Chantier de modèle (G-30), pas un réglage. |
| D-7 | **Validation comptable externe** des mentions, du 1010 et du taux archipels | Transforme la conformité « codée » en conformité « validée ». |

Tant que D-1 n'est pas tranchée, la Phase 0 peut avancer ; les Phases 1 et 2 ne doivent pas
engager G-07/G-08/G-09.

---

## 2. Séquence recommandée

| Phase | Contenu | Durée | Sortie |
|---|---|---|---|
| **0 — Production sûre** | G-01 à G-06, G-10 à G-12 | 3–4 semaines | Pilote réel avec cron, sauvegarde testée, MFA, charge et parcours prouvés |
| **1 — Comptabilité système d'enregistrement** | G-07 à G-09, G-13, G-14, G-19 | 6–8 semaines | Clôture, écritures manuelles, immobilisations, achats rapprochés |
| **2 — Parité commerciale** | G-15 à G-18, G-20 à G-24 | 8–12 semaines | Portail, échéanciers, paiement, banque, code-barres, Gantt, MIS, modèles |
| **3 — Extension conditionnelle** | G-25 à G-30 | sur décision | SSO, PWA, CRM, paie, GPAO/POS/multi-société |

**Total Phase 0 + 1 : 55–85 jours-homme.** Phase 2 : 70–110 jours-homme. Phase 3 : 120 jours+
et doit être chiffrée séparément.

---

## 3. Phase 0 — rendre l'existant exploitable

### G-01 — Planificateur quotidien supervisé (P0, 2–3 j)

**Problème.** Les récurrences, relances, purges et contrôles dépendent de `POST /api/runs/daily`,
appelé par personne.

**Solution.**
1. Si l'hébergement expose les Cron Triggers Cloudflare, ajouter un handler `scheduled()` qui
   appelle le **même service** que la route, sans passer par HTTP ni par le jeton.
2. Sinon, conserver la route et créer un cron externe (GitHub Actions ou cron système) qui
   appelle `POST /api/runs/daily` avec `Authorization: Bearer $DAILY_RUN_TOKEN`.
3. Ajouter une **alerte de mort** : si aucun `daily_run` réussi depuis 26 h, envoyer un e-mail
   ou un message au propriétaire (Healthchecks.io, Better Stack ou GitHub Actions).
4. Garder l'idempotence par jour tahitien et le bouton manuel.

**Inspiration.** Odoo planifie ses tâches par `ir.cron` ; OCA `contract` documente la génération
récurrente par cron. Cloudflare Cron Triggers sont en **UTC** : un run à 02:00 UTC correspond à
16:00 la veille à Tahiti, d'où le calcul explicite du jour métier.
Sources : [Cloudflare Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/),
[OCA/contract](https://github.com/OCA/contract).

**Tests / acceptation.** Deux appels le même jour tahitien → un seul passage ; jeton absent →
401 ; échec simulé → alerte reçue ; `daily_runs.summary_json` contient le résultat.

### G-02 — Sauvegarde automatique et restauration réelle (P0, 2–4 j + action hébergeur)

**Problème.** L'export/restauration est prouvé en local, pas sur la base hébergée ; la
sauvegarde automatique n'est pas activée.

**Solution.**
1. Activer D1 Time Travel (30 jours en Paid, 7 en Free) **et** un export SQL indépendant
   quotidien vers R2 (Workflow Cloudflare ou cron externe) : Time Travel est une restauration
   destructive, pas une archive comptable.
2. Conserver 12 exports mensuels et 30 exports quotidiens, chiffrés au repos.
3. Rejouer une restauration sur une base **jetable** : vérifier le nombre de lignes par table
   financière, les totaux et le checksum ; documenter le RTO/RPO.
4. Tester le retour arrière : un export restauré doit refuser une version de schéma supérieure.

**Inspiration.** Odoo documente la sauvegarde/restauration de base ; Cloudflare documente Time
Travel et l'export vers R2.
Sources : [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[Workflow backup D1](https://developers.cloudflare.com/workflows/examples/backup-d1/).

**Tests / acceptation.** Restauration datée sur base jetable, checksum identique, écart expliqué ;
une restauration ratée est réversible via `previous_bookmark`.

### G-03 — MFA obligatoire pour les rôles sensibles (P0, 2–3 j)

**Problème.** Le MFA TOTP existe mais reste facultatif, y compris pour propriétaire,
administrateur et comptable.

**Solution.**
1. Ajouter un réglage `mfa_required_roles` (défaut : `owner`, `admin`, `accountant`).
2. À la connexion, si le rôle est soumis et que `mfa_enabled = 0`, forcer l'enrôlement avant
   toute session utile (écran dédié, code de récupération affiché une fois).
3. Conserver un **code de secours** et une réinitialisation par un autre administrateur, avec
   ré-authentification et journal.
4. Journaliser l'activation, la désactivation, l'échec et la récupération.

**Inspiration.** Odoo propose la 2FA par utilisateur et des politiques par groupe ; OCA
`auth_totp` n'est pas nécessaire ici, le TOTP est déjà écrit.
Sources : [Odoo 2FA](https://www.odoo.com/documentation/19.0/applications/general/users/2fa.html).

**Tests / acceptation.** Connexion owner non enrôlé → enrôlement forcé ; code faux → 401 ;
code de secours → 200 puis refus à la réutilisation ; admin sans MFA ne peut pas désactiver
celui d'un autre sans ré-auth.

### G-04 — Mesure de charge (P0, 3–5 j)

**Problème.** Aucun p95, aucun test sur jeu réaliste.

**Solution.**
1. Générer un jeu jetable : 50 000 factures, 200 000 lignes, 20 000 clients, 10 000 mouvements.
2. Rejouer `scripts/load-test.mjs` en lecture (dashboard, listes, recherche, PDF, TVA) avec
   20–50 sessions.
3. Relever p50/p95/max, taux de 5xx, requêtes D1 par écran ; comparer aux limites D1
   (1 000 requêtes/invocation, 10 Go).
4. Corriger d'abord les scans (`EXPLAIN QUERY PLAN`), pas en ajoutant du cache.

**Inspiration.** Les tests de plan existent déjà (`tests/query-plans.test.ts`) ; ce chantier les
confronte à un volume réel. Sources : [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

**Tests / acceptation.** Rapport de charge daté, seuil p95 < 1 s pour les lectures et < 2 s pour
un PDF, aucun 5xx ; plan de capacité écrit.

### G-05 — Parcours navigateur et accessibilité (P0, 5–8 j)

**Problème.** Les scripts Playwright existent mais n'ont pas tourné ici ; aucun audit WCAG.

**Solution.**
1. Cinq scénarios : installation, client → devis → facture → envoi, encaissement partiel,
   avoir + TVA, import CSV + restauration.
2. Exécuter en CI sur un Worker local et une base migrée ; captures en cas d'échec.
3. Ajouter `axe-core` sur chaque écran et corriger les violations sérieuses.
4. Revue manuelle clavier + lecteur d'écran sur les écrans critiques ; consigner les limites.

Sources : [Playwright](https://playwright.dev/docs/intro),
[axe-core](https://github.com/dequelabs/axe-core).

**Tests / acceptation.** 5/5 scénarios verts, zéro violation critique axe, parcours clavier
documenté.

### G-06 — Répétition de migration de données réelles (P0, 3–5 j)

**Problème.** La migration d'un vrai fichier client n'a pas été rejouée.

**Solution.**
1. Obtenir un export anonymisé (clients, factures, paiements, produits, stock).
2. Le passer dans l'import existant, corriger les lignes refusées, rejouer jusqu'à zéro erreur.
3. Comparer les totaux (CA, TVA, encaissé, stock) avant/après ; expliquer chaque écart.
4. Répéter sur une base neuve, puis restauration de secours ; fenêtre de bascule et retour
   arrière écrits.

**Inspiration.** Odoo documente l'import/export avec validation et fichiers d'erreurs.
Sources : [Odoo import/export](https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html).

**Tests / acceptation.** Rapport de rapprochement signé, zéro ligne silencieusement perdue,
procédure de rollback testée.

### G-10 — Conformité données personnelles opérationnelle (P0, 3–5 j)

**Problème.** La rétention technique existe, mais il n'y a pas de registre, de procédure de
droits ni de base contractuelle.

**Solution.**
1. Registre des traitements (clients, prospects, salariés si paie, journaux, IP).
2. Base légale, durées, destinataires, sous-traitants (Cloudflare, Resend/Brevo, stockage).
3. Procédure d'accès/rectification/effacement/portabilité : export par client, suppression
   logique, refus si conservation comptable obligatoire.
4. Notice de confidentialité, DPA, analyse des transferts hors PF/UE ; le siège des données D1
   n'est pas documenté comme résidence PF.
5. Journaliser chaque demande et sa réponse.

**Inspiration.** CNIL applique le RGPD en Polynésie depuis 2019 ; la PF désigne un DPO à la DSI.
Sources : [CNIL outre-mer](https://cnil.fr/fr/loi-informatique-et-libertes-et-rgpd-ce-qui-change-pour-loutre-mer),
[Protection des données PF](https://www.service-public.pf/dsi/protection-des-donnees-rgpd/),
[CNIL — durées de conservation](https://cnil.fr/fr/les-durees-de-conservation-des-donnees).

**Tests / acceptation.** Export d'un client, effacement refusé si facture conservée, trace de la
demande, notice publiée.

### G-11 — Supervision externe et alerting (P0, 2–3 j)

**Problème.** `/api/health` existe, mais personne n'est réveillé si l'app tombe.

**Solution.**
1. Sonde HTTP externe sur `/api/health` (1 min) + alerte e-mail/SMS.
2. Exporter les logs Workers vers un stockage externe (Logpush/OpenTelemetry) : la rétention
   native est de 7 jours, insuffisante pour un audit fiscal.
3. Alertes sur 5xx, `daily_run` en échec, écart de stock, retard comptable, quota D1.
4. Tableau de bord SLO : disponibilité, latence, taux d'erreur.

Sources : [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs),
[Workers metrics](https://developers.cloudflare.com/workers/observability/metrics-and-analytics),
[D1 audit logs](https://developers.cloudflare.com/d1/observability/audit-logs/).

**Tests / acceptation.** Panne simulée → alerte reçue en < 5 min ; log de 8 jours retrouvé
hors plateforme.

### G-12 — Runbook, SLA et astreinte (P0, 2–3 j)

**Problème.** Aucune procédure d'incident, de restauration ou de rotation de secrets.

**Solution.** Écrire un runbook : severités, contacts, diagnostic, redéploiement, restauration,
rotation des clés, communication client, post-mortem. Fixer RTO/RPO et la fenêtre de support.
Faire un exercice à blanc avec une personne qui n'a pas écrit la procédure.

**Tests / acceptation.** Exercice réussi, runbook à jour, coordonnées vérifiées.

---

## 4. Phase 1 — comptabilité et achats

### G-07 — Écritures manuelles équilibrées (P0 si D-1 oui, 10–15 j)

**Solution.**
1. Table `journal_entries` déjà présente : ajouter `source = 'manual'`, `status = draft|posted|reversed`,
   `created_by`, `posted_by`, `posted_at`, `reversal_of`.
2. Écran : date, journal, libellé, lignes compte/débit/crédit, pièce jointe, brouillon → validation.
3. Refuser une écriture déséquilibrée (`422 UNBALANCED_ENTRY`), un compte inconnu, une période
   fermée ; une écriture validée n'est plus modifiable, seulement extournée.
4. Réutiliser `assertPeriodOpen`, le journal d'audit et la permission `accounting.write`.

**Inspiration.** Odoo `account.move` (brouillon/validé/extourne) ; OCA `account_move_template`
pour les modèles récurrents.
Sources : [Odoo year-end](https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html),
[OCA account_move_template](https://github.com/OCA/account-financial-tools/tree/18.0/account_move_template).

**Tests.** Écriture déséquilibrée refusée ; validation → balance et grand livre à jour ;
extourne ; période close 409 ; permission.

### G-08 — Exercice comptable et clôture (P0 si D-1 oui, 10–15 j)

**Solution.**
1. Table `fiscal_years` (libellé, début, fin, statut `open|closed`, clôturé par/le).
2. Rattacher les périodes à un exercice ; la clôture verrouille toutes les périodes.
3. Générer l'écriture de résultat (classes 6/7 → 12) et les à-nouveaux (classes 1–5) selon un
   modèle configurable ; conserver le détail par compte.
4. Interdire deux clôtures du même exercice ; réouverture réservée au propriétaire, journalisée.

**Inspiration.** OCA `account_fiscal_year` et `account_fiscal_year_closing` (Community, clôture
en beta) ; Odoo Enterprise pour la clôture avancée.
Sources : [OCA account_fiscal_year](https://github.com/OCA/account-financial-tools/tree/18.0/account_fiscal_year),
[OCA account_fiscal_year_closing](https://github.com/OCA/account-closing/tree/18.0/account_fiscal_year_closing).

**Tests.** Clôture → écritures suivantes refusées ; à-nouveaux équilibrés ; double clôture 409 ;
réouverture tracée.

### G-09 — Immobilisations et amortissements (P1, 8–12 j)

**Solution.**
1. `assets` : libellé, compte d'immobilisation, compte d'amortissement, valeur, date de mise en
   service, durée, méthode (linéaire/dégressif), prorata temporis, statut.
2. Générer le plan d'amortissement mensuel/annuel et les écritures, avec idempotence par
   `(asset_id, period)`.
3. Cession : sortie de l'actif, reprise du cumul, résultat de cession.
4. Écran registre + PDF/CSV.

**Inspiration.** OCA `account_asset_management` (mature) ; Odoo Enterprise pour l'interface
native. Source : [OCA account_asset_management](https://github.com/OCA/account-financial-tools/tree/18.0/account_asset_management).

**Tests.** Amortissement linéaire, prorata, cession, double génération, période close.

### G-19 — Facture fournisseur et rapprochement 3-way (P1, 10–15 j)

**Solution.**
1. Table `vendor_bills` (fournisseur, BC, référence, date, devise, TVA, total, statut).
2. Rapprochement BC ↔ réception ↔ facture : quantités, prix, tolérances configurables ; écart
   signalé, pas corrigé en silence.
3. Validation → écriture fournisseur et TVA déductible ; paiement et lettrage.
4. Écran de contrôle avec les trois colonnes et le motif d'écart.

**Inspiration.** Odoo `purchase_stock` (3-way matching, Community) ; OCA
`purchase_stock_picking_invoice_link`.
Sources : [Odoo vendor bills](https://www.odoo.com/documentation/18.0/applications/finance/accounting/vendor_bills.html),
[Odoo 3-way matching](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/manage.html),
[OCA purchase_stock_picking_invoice_link](https://apps.odoo-community.org/modules/purchase_stock_picking_invoice_link).

**Tests.** Facture conforme ; écart de prix/quantité ; réception partielle ; double validation ;
écriture et TVA justes.

### G-13 — Limite de débit par jeton d'API (P1, 2–3 j)

**Solution.** Compteur par jeton (fenêtre glissante en D1), quota configurable, `429
RATE_LIMITED` avec `Retry-After`, journal des refus, écran de révocation/rotation. Ne pas
réutiliser la limitation de connexion.

**Inspiration.** Odoo recommande des clés dédiées et rotatives ; la limite est une pratique
d'exploitation, pas un module OCA.
Source : [Odoo external API](https://www.odoo.com/documentation/18.0/developer/reference/external_api.html).

**Tests.** Seuil atteint → 429, jeton révoqué → 401, rotation sans downtime.

### G-14 — Webhooks sortants signés (P1, 4–6 j)

**Solution.**
1. Table `webhook_subscriptions` (URL, secret, événements, actif) et `webhook_deliveries`
   (payload, statut, tentatives, réponse).
2. Événements : `invoice.sent`, `invoice.paid`, `credit.applied`, `quote.accepted`,
   `stock.low`, `daily.failed`.
3. Signature HMAC-SHA256, timestamp, idempotency key, retries exponentiels, dead-letter,
   rejeu manuel, journal.
4. Pas de webhook dans le chemin critique : outbox écrite dans la même transaction, envoi après.

**Inspiration.** Odoo Studio propose des webhooks (Enterprise) ; il n'existe pas de module OCA
18/19 maintenu, donc le modèle est à écrire.
Sources : [Odoo webhooks](https://www.odoo.com/documentation/18.0/applications/studio/automated_actions/webhooks.html).

**Tests.** Signature valide, retry, dead-letter, rejeu, secret jamais exposé.

---

## 5. Phase 2 — parcours commercial et outillage

### G-15 — Acomptes et échéanciers (P1, 8–12 j)

**Solution.**
1. Conditions de paiement multi-lignes : pourcentage/montant, décalage jours/semaines/mois,
   fin de mois, jours fériés.
2. Calculer l'échéancier à l'émission, stocker chaque échéance, afficher l'aperçu.
3. Facture d'acompte distincte (TVA et compte de produit propres), imputée sur la facture finale.
4. Relances et balance âgée par échéance, pas seulement par facture.

**Inspiration.** Odoo payment terms et down payments (Community) ; OCA
`account_payment_term_extension`.
Sources : [Odoo payment terms](https://www.odoo.com/documentation/18.0/applications/finance/accounting/customer_invoices/payment_terms.html),
[Odoo down payments](https://www.odoo.com/documentation/18.0/applications/sales/sales/invoicing/down_payment.html),
[OCA account_payment_term_extension](https://github.com/OCA/account-payment/tree/19.0/account_payment_term_extension).

**Tests.** 30/70, décalage, mois, jour férié, acompte déduit, solde et TVA exacts.

### G-16 — Portail client (P1, 10–15 j)

**Solution.**
1. Table `portal_links` (token haché, client, expiration, révocation) distincte des liens
   document.
2. Écran client : documents, soldes, devis à accepter, téléchargement PDF, coordonnées.
3. Requêtes **toujours** filtrées par `client_id` du lien ; aucune fuite inter-clients.
4. Rate limiting par token/IP, journal d'accès, expiration, révocation immédiate.
5. Paiement uniquement si G-17 est livré.

**Inspiration.** Odoo portal (Community) : documents, signatures, paiement.
Source : [Odoo portal](https://www.odoo.com/documentation/18.0/applications/general/users/portal.html).

**Tests.** Deux clients isolés, révocation 410, lien document non réutilisable, accès journalisé.

### G-17 — Paiement en ligne (P1 conditionnel, 8–12 j)

**Solution.**
1. Abstraction `PaymentProvider` : création de session, redirection, webhook, remboursement,
   statut.
2. États `pending → completed | failed`, sans impact sur le solde avant `completed`.
3. **France/Polynésie** : Stripe n'est pas disponible pour un établissement PF ; PayPal
   n'accepte pas le XPF. Cibler d'abord **SOCREDO PAYZEN/VADS**, puis **NiuPay** (QR), et
   PayPal en EUR/USD si le client l'accepte.
4. Prévoir le passage ISO 20022/IBAN (C.O.P.S/SEPA-COM) et un mode virement manuel.

Sources : [Stripe global](https://stripe.com/global), [Stripe currencies](https://docs.stripe.com/currencies),
[PayPal currencies](https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies),
[SOCREDO VADS](https://www.socredo.pf/professionnels/produit/vente-a-distance),
[PAYZEN](https://www.socredo.pf/entreprises/produit/payzen-et-easy-pay),
[NiuPay](https://www.niupay.pf/p/paiement-qr-code),
[ISO 20022/SEPA-COM](https://www.sg-bdp.pf/news/c.o.p.s).

**Tests.** Fournisseur factice : pending n'affecte pas la facture, webhook complète, double
webhook idempotent, échec tracé, remboursement.

### G-18 — Banque : formats et règles (P1 conditionnel, 6–12 j)

**Solution.**
1. Registre de parseurs CSV/OFX/CAMT avec mapping de colonnes et détection de doublons
   (hash du fichier + ID externe).
2. Modèle relevé → lignes → écriture ; rapprochement suggestion/manuel, délettrage.
3. Règles éditables : montant, sens, libellé, tiers → action (rapprocher, lettrer, frais).
4. Préparer IBAN/ISO 20022 ; les banques PF n'exposent pas d'API publique documentée.

**Inspiration.** OCA `account_statement_import_*` et `account_reconcile_model_oca` ; Odoo
synchronisation bancaire = Enterprise.
Sources : [OCA bank-statement-import](https://github.com/OCA/bank-statement-import),
[Odoo bank sync](https://www.odoo.com/documentation/18.0/applications/finance/accounting/bank/bank_synchronization.html).

**Tests.** Import, doublon, règle, rapprochement, annulation, solde de compte.

### G-20 — Approbation des bons de commande (P2, 3–5 j)

**Solution.** Étendre `ApprovalEntity` à `purchase_order`, seuils par montant, une ou deux
étapes, décision journalisée, blocage de l'envoi au fournisseur avant accord.

**Inspiration.** Odoo `purchase` double validation (Community) ; OCA `purchase_tier_validation`.
Sources : [Odoo purchase](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase.html),
[OCA tier-validation](https://github.com/OCA/tier-validation).

**Tests.** Seuil, refus, approbation, envoi bloqué, journal.

### G-21 — Code-barres, unités de mesure, FEFO (P2, 8–12 j)

**Solution.**
1. Unités et conversions par catégorie ; prix et quantités stockés dans l'unité de référence.
2. Champ code-barres (EAN/GS1) + endpoint de scan + écran réception/vente/inventaire.
3. FEFO : consommer le lot dont la date d'expiration est la plus proche ; alerte péremption.
4. Ne pas construire un WMS multi-entrepôt.

**Inspiration.** Odoo `uom`, `barcodes`, `product_expiry` (Community) ; application Barcode =
Enterprise ; OCA `stock_barcodes`.
Sources : [Odoo UoM](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/configure/uom.html),
[Odoo expiry](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/product_management/product_tracking/expiration_dates.html),
[Odoo FEFO](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/inventory/shipping_receiving/removal_strategies/fefo.html),
[OCA stock_barcodes](https://github.com/OCA/stock-logistics-barcode).

**Tests.** Conversion, scan, lot le plus proche, péremption, stock inchangé après refus.

### G-22 — Dépendances de tâches et timeline (P2, 8–12 j)

**Solution.** Table `task_dependencies` (prédécesseur/successeur), refus de cycle, état
« bloquée », dates recalculées ; vue timeline (pas de Gantt drag-and-drop propriétaire).

**Inspiration.** Odoo `project` gère `depend_on_ids` en Community ; la vue Gantt est Enterprise ;
OCA `project_timeline`/`web_timeline` fournit une alternative.
Sources : [Odoo task dependencies](https://www.odoo.com/documentation/18.0/applications/services/project/tasks/task_dependencies.html),
[OCA/project](https://github.com/OCA/project).

**Tests.** Cycle refusé, état bloqué, date, suppression.

### G-23 — Constructeur d'états (P2, 8–12 j)

**Solution.** Modèle `report_definition` (lignes, formules, colonnes de période, source), écran
d'édition, aperçu, drill-down vers les écritures, export CSV/XLSX. Commencer par 3 sources :
grand livre, factures, stock.

**Inspiration.** OCA `mis_builder` (KPI × périodes, formules, drill-down, budgets).
Source : [OCA/mis-builder](https://github.com/OCA/mis-builder).

**Tests.** Formule, période, drill-down, export, permission.

### G-24 — Modèles de documents (P2, 8–12 j)

**Solution.** Versionner les modèles (header/body/footer, placeholders), aperçu avec un vrai
document, sélection par document, retour au modèle standard, restrictions par rôle. Pas
d'éditeur drag-and-drop complet.

**Inspiration.** Odoo Studio (Enterprise) ; OCA `report_py3o` pour des modèles ODT.
Sources : [Odoo Studio PDF](https://www.odoo.com/documentation/18.0/applications/studio/pdf_reports.html),
[OCA report_py3o](https://github.com/OCA/reporting-engine/tree/19.0/report_py3o).

**Tests.** Version, aperçu, rendu PDF, restauration du défaut.

---

## 6. Phase 3 — extensions conditionnelles

### G-25 — Robustesse des mots de passe (P2, 3–5 j)

Le runtime Workers plafonne PBKDF2 à 100 000 itérations, sous la recommandation OWASP. Décision :
conserver PBKDF2 + MFA obligatoire à court terme, ou déléguer l'authentification à un IdP
(Argon2id) et migrer les empreintes à la connexion. Documenter le choix et le tester.
Source : [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

### G-26 — SSO OIDC (P2, 5–8 j)

Flux authorization-code uniquement, découverte/JWKS, validation issuer/audience/nonce, mapping
des claims vers utilisateur/rôle, provisionnement optionnel, break-glass propriétaire.
Inspiration : OCA `auth_oidc`. Source : [OCA auth_oidc](https://github.com/OCA/server-auth/tree/19.0/auth_oidc).

### G-27 — PWA et mobile (P2, 10–15 j)

Manifest, service worker, cache lecture seule, file d'attente des saisies de temps, conflits
explicites, test sur petit écran et réseau lent. Inspiration : Odoo PWA.
Source : [Odoo mobile](https://www.odoo.com/documentation/18.0/administration/mobile.html).

### G-28 — CRM (conditionnel, 12–20 j)

Uniquement si D-2 le justifie : prospects, activités, pipeline, conversion en devis, pas de
marketing automation. Odoo `crm` est Community. Source : [Odoo CRM](https://www.odoo.com/documentation/18.0/applications/sales/crm.html).

### G-29 — Paie (conditionnel, ne pas construire à l'aveugle)

La paie PF est spécifique : DPAE, DMO mensuelle, CST-S progressif 4010/4010-A, taux CPS par
secteur. Odoo Payroll n'a pas de localisation PF. Solution recommandée : **export comptable**
et préparation des déclarations, pas un moteur de paie générique.
Sources : [CPS DPAE](https://cps.pf/employeurs/declaration-prealable-a-lembauche),
[CPS DMO](https://www.cps.pf/employeurs/declaration-de-main-doeuvre),
[DICP CST-S](https://www.service-public.pf/dicp/wp-content/uploads/sites/59/2025/06/06_CST-SALARIES_WEB.pdf),
[Odoo payroll localizations](https://www.odoo.com/documentation/18.0/applications/hr/payroll/payroll_localizations.html).

### G-30 — GPAO, POS, multi-société (conditionnel, 60 j+)

Ne pas engager sans cas d'usage chiffré. Odoo les couvre (MRP/POS Community, consolidation
Enterprise), mais chacun change le modèle de données et la promesse de service.
Sources : [Odoo MRP](https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp.html),
[Odoo POS](https://www.odoo.com/documentation/18.0/applications/sales/point_of_sale.html),
[Odoo multi-company](https://www.odoo.com/documentation/18.0/applications/general/companies/multi_company.html).

---

## 7. Adaptations Polynésie française à intégrer au plan

### 7.1 TVA et déclarations

1. **Ajouter le taux 9 %** (opérations immobilières) et le **1 % archipels** au référentiel
   `tax_rates`, avec dates d'effet ; le 1 % s'applique au 1/7/2026 et dépend de l'archipel
   vendeur/acheteur, du statut professionnel et de l'expédition.
2. **Franchise en base** : 10 000 000 XPF par défaut, **configurable** ; les pages DICP
   divergent encore (5 M sur certaines fiches de contrôle). Obtenir une confirmation écrite
   avant de figer la règle et documenter l'écart.
3. **Mentions** : nom/adresse/numéro Tahiti vendeur et client, date, description, prix HT,
   taux et montant de TVA, mention franchise le cas échéant.
4. **Formulaire 1010** : échéance le 15 du mois suivant (ou trimestre) ; produire un export
   conforme à la ligne 05–20 post-1/7/2026, sans prétendre transmettre.
5. **4010/4010-A et DMO** : uniquement si la paie est intégrée ; sinon fournir un export.

Sources : [DICP taux](https://www.service-public.pf/dicp/faq-items/quels-sont-les-principaux-taux-de-tva),
[DICP 1 %](https://www.service-public.pf/dicp/2026/06/23/tva-de-1-au-benefice-des-archipels-autres-que-la-societe),
[DICP 1010](https://www.service-public.pf/dicp/wp-content/uploads/sites/59/2026/06/Annexe-Formulaire-type-de-la-declaration-de-taxe-sur-la-valeur-ajoutee-modele-de-declaration-n%C2%B0-1010-4.pdf),
[DICP franchise](https://www.service-public.pf/dicp/professionnels/vos-impots/taxe-sur-la-valeur-ajoutee),
[DICP guide facture](https://www.service-public.pf/dicp/wp-content/uploads/sites/59/2025/06/04_ASSUJETI_TVA_WEB.pdf),
[calendrier 2026](https://www.service-public.pf/dicp/calendrier-fiscal-polynesie-2026).

### 7.2 Facturation électronique

Aucune obligation PF identifiée ; la réforme française Factur-X/PPF ne s'applique pas aux
émetteurs PF. En revanche, les marchés publics passent par **Chorus Pro**. Garder un modèle de
données structuré (TVA par ligne, identifiants, dates) pour qu'un futur mandat soit un adaptateur.
Sources : [DGFiP DROM](https://www.impots.gouv.fr/sites/default/files/media/1_metier/2_professionnel/EV/2_gestion/290_facturation_electronique/faq_drom.pdf),
[service-public.fr](https://entreprendre.service-public.gouv.fr/actualites/A15683),
[guide marchés publics PF](https://www.service-public.pf/marchespublics/wp-content/uploads/sites/29/2025/05/GOE-version-finale-090525-mise-en-page-impression.pdf).

### 7.3 Données personnelles et hébergement

Le RGPD s'applique via la loi Informatique et Libertés ; la CNIL est l'autorité de contrôle et
la PF dispose d'un DPO à la DSI. Mettre en place registre, droits, rétention, DPA et analyse des
transferts. La résidence des données D1 n'est pas documentée comme PF/UE : à vérifier avant de
promettre une localisation.
Sources : [CNIL outre-mer](https://cnil.fr/fr/loi-informatique-et-libertes-et-rgpd-ce-qui-change-pour-loutre-mer),
[PF données personnelles](https://www.service-public.pf/dsi/protection-des-donnees-rgpd/).

### 7.4 Paiements et banque

Stripe n'est pas disponible pour un établissement PF ; PayPal ne traite pas le XPF. Prioriser
SOCREDO PAYZEN/VADS, NiuPay (QR), puis PayPal EUR/USD ; conserver le virement manuel. Anticiper
IBAN/ISO 20022 (C.O.P.S/SEPA-COM), les banques PF ne documentant pas d'API publique.
Sources : [Stripe global](https://stripe.com/global),
[PayPal devises](https://developer.paypal.com/docs/reports/reference/paypal-supported-currencies),
[SOCREDO](https://www.socredo.pf/professionnels/produit/vente-a-distance),
[NiuPay](https://www.niupay.pf/p/paiement-qr-code),
[C.O.P.S](https://www.sg-bdp.pf/news/c.o.p.s).

### 7.5 Exploitation Cloudflare

Time Travel : 30 j (Paid) / 7 j (Free), restauration destructive ; export R2 indépendant
obligatoire. D1 : 10 Go, 1 000 requêtes/invocation. Cron en UTC : calculer le jour Tahiti.
Logs Workers : 7 j, externaliser pour l'audit.
Sources : [Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/),
[limites D1](https://developers.cloudflare.com/d1/platform/limits/),
[Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs).

---

## 8. Ordre d'exécution et dépendances

```text
G-01 cron ─┬─> G-02 backup ─> G-06 migration ─> pilote
G-03 MFA ──┤
G-04 charge ┼─> G-05 navigateur/a11y
G-10 RGPD ─┘
G-11 supervision ─> G-12 runbook

G-07 écritures ─> G-08 exercice ─> G-09 immobilisations
G-19 facture fournisseur ─> G-20 approbation BC
G-13 débit API ─> G-14 webhooks

G-15 échéanciers ─> G-16 portail ─> G-17 paiement
G-18 banque
G-21 code-barres/UoM
G-22 dépendances
G-23 MIS
G-24 modèles
```

Les tâches d'une même colonne peuvent avancer en parallèle ; G-07/G-08/G-09 attendent D-1.

---

## 9. Definition of done commune

Pour chaque gap :

1. Décision écrite et périmètre fermé.
2. Migration additive + retour arrière documenté (si schéma).
3. Permissions serveur, journal d'audit, validation Zod.
4. Tests unitaires + HTTP sur base migrée, cas 403/409/422.
5. Preuve d'échec sans le correctif (mutation ou test ciblé).
6. Documentation FR/EN, `PENDING.md` mis à jour, aucune donnée sensible dans les fixtures.
7. Typecheck 0, suite complète verte, build OK.

---

## 10. Risques et parades

| Risque | Parade |
|---|---|
| Le cron externe n'est pas supervisé | Alerte de mort + bouton manuel + journal `daily_runs` |
| La restauration D1 écrase la production | Toujours restaurer sur une base jetable ; `previous_bookmark` |
| La TVA 1 % est mal appliquée | Règle configurable + validation DICP écrite + tests par archipel |
| La franchise 5 M/10 M diverge | Défaut 10 M configurable, source documentée, confirmation écrite |
| Le paiement en ligne échoue au lancement | Fournisseur abstrait + mode virement + tests avec faux prestataire |
| Le multi-société explose le modèle | Ne pas l'ouvrir sans D-6 et chiffrage |
| Les écritures manuelles déséquilibrent le grand livre | Validation à la source + contrainte + test de balance |
| La paie PF est mal modélisée | Ne pas construire ; export/préparation avec un spécialiste local |

---

## 11. Sources Odoo/OCA utilisées

- Éditions et périmètre Community/Enterprise : <https://www.odoo.com/page/editions>
- Comptabilité Odoo : <https://www.odoo.com/documentation/18.0/applications/finance/accounting.html>
- Clôture annuelle : <https://www.odoo.com/documentation/18.0/applications/finance/accounting/reporting/year_end.html>
- OCA exercice : <https://github.com/OCA/account-financial-tools/tree/18.0/account_fiscal_year>
- OCA clôture : <https://github.com/OCA/account-closing/tree/18.0/account_fiscal_year_closing>
- OCA immobilisations : <https://github.com/OCA/account-financial-tools/tree/18.0/account_asset_management>
- OCA modèles d'écriture : <https://github.com/OCA/account-financial-tools/tree/18.0/account_move_template>
- OCA approbations multi-niveaux : <https://github.com/OCA/tier-validation>
- OCA crédit client : <https://github.com/OCA/credit-control>
- OCA conditions de paiement : <https://github.com/OCA/account-payment/tree/19.0/account_payment_term_extension>
- OCA contrats récurrents : <https://github.com/OCA/contract>
- OCA import bancaire : <https://github.com/OCA/bank-statement-import>
- OCA rapprochement : <https://github.com/OCA/account-reconcile>
- OCA MIS Builder : <https://github.com/OCA/mis-builder>
- OCA modèles ODT : <https://github.com/OCA/reporting-engine/tree/19.0/report_py3o>
- OCA audit : <https://github.com/OCA/server-tools/tree/19.0/auditlog>
- OCA OIDC : <https://github.com/OCA/server-auth/tree/19.0/auth_oidc>
- Odoo achats/3-way : <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/purchase/manage_deals/manage.html>
- Odoo code-barres : <https://www.odoo.com/documentation/18.0/applications/inventory_and_mrp/barcode.html>
- OCA code-barres : <https://github.com/OCA/stock-logistics-barcode>
- Odoo dépendances de tâches : <https://www.odoo.com/documentation/18.0/applications/services/project/tasks/task_dependencies.html>
- Odoo portail : <https://www.odoo.com/documentation/18.0/applications/general/users/portal.html>
- Odoo paiements : <https://www.odoo.com/documentation/18.0/applications/finance/payment_providers.html>
- Odoo PWA : <https://www.odoo.com/documentation/18.0/administration/mobile.html>
- Odoo CRM : <https://www.odoo.com/documentation/18.0/applications/sales/crm.html>
- Odoo paie : <https://www.odoo.com/documentation/18.0/applications/hr/payroll/payroll_localizations.html>
- Odoo multi-société : <https://www.odoo.com/documentation/18.0/applications/general/companies/multi_company.html>

**Limites de ce plan.** Les versions OCA 18/19 ne sont pas toutes au même stade de migration ;
les modules Enterprise cités ne sont pas open source ; les prestataires de paiement et les
banques PF doivent confirmer par écrit leurs API, webhooks et settlements en XPF. Ces points
sont des conditions de lancement, pas des détails d'implémentation.
