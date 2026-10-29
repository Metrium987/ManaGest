# ManaGest — état des lieux et feuille de route

**Date de l'audit :** 28 octobre 2026
**Périmètre :** code applicatif, API, schéma D1, matrice de permissions, comportement réel en exécution.
**Méthode :** revue statique, tests unitaires, audit *black-box* de l'API locale (91 contrôles), vérification HTTP de la préversion déployée, comparaison avec le code source d'Invoice Ninja v5 (clone de référence, 317 migrations, ~77 tables).

---

## 1. Ce qui est vérifié, et comment

| Vérification | Résultat |
|---|---|
| Typage TypeScript (client + Worker) | 0 erreur |
| Tests unitaires (`vitest`) | 30 / 30 |
| Audit API noir sur blanc (`node .tmp/audit-api.mjs`) | 91 / 91 |
| Build de production + bundle Worker | OK |
| Déploiement de préversion | OK (HTML, assets, routes SPA, API) |
| En-têtes de sécurité sur l'origine réelle | CSP, HSTS, `X-Frame-Options`, `nosniff` |
| Rejet CSRF / origine étrangère / anonyme | 403 / 403 / 401 |

L'audit API crée puis enchaîne de vraies opérations : client, produit, facture multi-taux, envoi, PDF, encaissement, devis → conversion, avoir → affectation, dépense, fournisseur, bon de commande, projet, tâche, compte bancaire, import et rapprochement, facture récurrente, paramètres, utilisateurs, journal.

### Flux métier validés

- **Facture multi-taux** : 2 × 10 000 F à 16 % + 1 × 5 000 F à 5 % → sous-total 25 000, TVA 3 450, total 28 450.
- **Cycle de statut** : brouillon → envoyée → payée ; double envoi refusé (409) ; surpaiement refusé (409).
- **PDF** : flux `%PDF-` valide, généré dans le Worker.
- **Devis** : envoi, acceptation, conversion en facture brouillon au bon total (11 600).
- **Avoir** : affectation partielle, solde de l'avoir et de la facture recalculés depuis les affectations.
- **Rapprochement bancaire** : import d'un virement, affectation à une facture ouverte, solde réduit.
- **Récurrence** : exécution manuelle génère la facture et avance la prochaine échéance.
- **Invariants** : statut et solde toujours dérivés des affectations, jamais saisis ; dernier propriétaire protégé ; sessions révoquées à la désactivation ou au changement de mot de passe.

---

## 2. Défauts trouvés et corrigés pendant l'audit

| # | Défaut | Gravité | Correctif |
|---|---|---|---|
| 1 | Matrice de rôles : `admin` construit avec `p !== 'users.write' \|\| true`, condition morte qui accordait **toutes** les permissions à l'administrateur, et `sales`/`viewer` héritaient de `users.read` et `activity.read` | Élevée (moindre privilège) | Matrice rendue explicite ; annuaire et journal réservés à propriétaire, administrateur et comptable ; suppression réservée à propriétaire/administrateur |
| 2 | `GET /api/tax-rates` renvoyait 404 alors que la ressource est annoncée | Moyenne (câblage) | Route ajoutée, lisible par tout rôle pouvant émettre un document |
| 3 | En-têtes immuables du binding `ASSETS` provoquaient une erreur 500 sur toutes les pages statiques | Bloquante en production | Copie des en-têtes sur une réponse neuve |
| 4 | Index secondaires absents sur les colonnes de filtre (`client_id`, `status`, `date`, `vendor_id`, `project_id`) | Performance | 13 index ajoutés, `SCHEMA_VERSION` = 2 |

> Les autres écarts relevés pendant l'audit provenaient du script de test lui-même (mauvaise répartition des taux attendue, statut attendu après conversion de devis) : le calcul et le comportement de l'application étaient corrects.

---

## 3. Modules : ce qui existe réellement

| Module | Créer | Lire | Modifier | Supprimer | Garde de permission |
|---|---|---|---|---|---|
| Clients / contacts / relevé | ✔ | ✔ | ✔ | ✔ | ✔ |
| Produits / stock | ✔ | ✔ | ✔ | ✔ | ✔ |
| Factures (+ PDF, duplication, annulation, paiement direct) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Devis (+ conversion, refus, expiration) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Avoirs (+ affectation) | ✔ | ✔ | — | ✔ | ✔ |
| Paiements (+ affectation, suppression) | ✔ | ✔ | — | ✔ | ✔ |
| Factures récurrentes (+ exécution) | ✔ | ✔ | ✔ | ✔ | ✔ |
| Dépenses | ✔ | ✔ | ✔ | ✔ | ✔ |
| Fournisseurs | ✔ | ✔ | ✔ | ✔ | ✔ |
| Bons de commande | ✔ | ✔ | statut | ✔ | ✔ |
| Projets / tâches | ✔ | ✔ | ✔ | ✔ | ✔ |
| Banque (comptes, import, rapprochement) | ✔ | ✔ | statut | — | ✔ |
| Paramètres société, TVA, numérotation | — | ✔ | ✔ | — | ✔ |
| Utilisateurs, rôles, réinitialisation, sessions | ✔ | ✔ | ✔ | ✔ (logique) | ✔ |
| Journal d'audit | ✔ (auto) | ✔ | — | — | ✔ |
| Tableau de bord + 6 rapports + CSV | — | ✔ | — | — | ✔ |
| Recherche globale | — | ✔ | — | — | authentification seule |

Aucune page de l'interface ne pointe vers un point d'entrée inexistant : les 91 contrôles couvrent les surfaces listées ci-dessus, y compris les mutations.

---

## 4. Rôles et permissions

44 permissions atomiques, 5 rôles, vérification **côté serveur** sur chaque route (l'interface ne fait que masquer les actions).

| Capacité | Propriétaire | Administrateur | Comptable | Commercial | Lecture seule |
|---|---|---|---|---|---|
| Factures, devis, paiements | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | ✔ / ✔ | lecture |
| Avoirs | ✔ | ✔ | ✔ | lecture | lecture |
| Achats, dépenses, banque | ✔ | ✔ | ✔ | — | lecture |
| Paramètres société | ✔ | ✔ | lecture | — | lecture |
| Utilisateurs | ✔ | ✔ | — | — | — |
| Journal d'audit | ✔ | ✔ | ✔ | — | — |
| Suppressions | ✔ | ✔ | — | — | — |

Garde-fous complémentaires dans les routes : un non-propriétaire ne peut ni créer, ni promouvoir, ni supprimer un compte propriétaire ; le dernier propriétaire actif ne peut être ni rétrogradé ni supprimé ; la réinitialisation d'un mot de passe révoque toutes les sessions de la cible.

**Limite assumée :** propriétaire et administrateur partagent la même matrice ; la distinction est appliquée par les contrôles de gestion des comptes, pas par une permission séparée. C'est suffisant pour une PME, pas pour une séparation des tâches stricte (voir § 7).

---

## 5. Base de données

**26 tables** couvrant le cycle commercial complet, contre **~77** dans Invoice Ninja v5. Le schéma est idempotent et provisionné par le Worker au premier appel.

### Catégories présentes
Clients, contacts, produits, TVA, factures, devis, avoirs, paiements + affectations, récurrences, dépenses, fournisseurs, bons de commande, projets, tâches, banque (comptes + transactions), utilisateurs, sessions, tentatives de connexion, séquences de numérotation, journal d'activité, société.

### Catégories absentes (comparaison Invoice Ninja)
| Catégorie | Tables amont | Impact |
|---|---|---|
| Pièces jointes / documents | `documents` | Impossible d'attacher un justificatif, un contrat, un reçu |
| Modèles de documents | `designs` | Une seule mise en page PDF, non paramétrable |
| Relances et invitations | `*_invitations`, `reminders` | Aucun envoi d'e-mail, aucune relance automatique |
| Passerelles de paiement | `gateways`, `company_gateways`, `client_gateway_tokens` | Pas de paiement en ligne |
| Abonnements / liens de paiement | `subscriptions`, `payment_hashes` | Pas d'encaissement récurrent par carte |
| Portail client | `client_gateway_tokens`, invitations | Pas d'espace client |
| Facturation électronique | `e_invoicing_tokens`, `e_invoicing_logs` | Hors périmètre local, à prévoir pour Chorus Pro |
| Intégrations | `webhooks`, `company_tokens` | Pas d'API tierce ni de jetons d'API |
| Multi-société / groupes | `companies`, `company_user`, `group_settings` | Mono-société uniquement |
| Comptabilité générale | `company_ledgers` | Pas de plan comptable, ni journal, ni grand livre |
| Divers | `tags`, `locations`, `currencies`, `task_statuses`, `backups`, `system_logs`, `passkeys` | Pas d'étiquettes, de taux de change, de sauvegardes applicatives, de MFA |

### Efficacité constatée
- Agrégations faites **en SQL** pour le tableau de bord, la balance âgée, les ventes par client, les dépenses et le résultat.
- **Pagination** serveur partout (25 par défaut, 100 maximum) + `COUNT(*)` séparé.
- **Suppression logique** (`deleted_at`) sur toutes les entités financières ; aucune suppression physique de facture.
- Statistiques client calculées par sous-requêtes corrélées (`CLIENT_STATS_SQL`), désormais couvertes par index.
- 28 index au total (clés primaires exclues), dont 13 ajoutés lors de cet audit.

**Faiblesse identifiée :** le rapport de TVA recharge les lignes JSON de toutes les factures de la période et les recompose en JavaScript. Correct et exact, mais coût croissant. Correctif recommandé : table `invoice_tax_lines` (une ligne par taux et par facture) alimentée à l'enregistrement, pour un `GROUP BY` direct.

**Table inutilisée :** `company_settings` (clé/valeur) n'est référencée par aucun code ; les paramètres vivent dans la table `company`. À supprimer ou à affecter à un usage explicite.

---

## 6. Sécurité — état et manques

En place : PBKDF2-SHA-256 avec politique de mot de passe (longueur, mots de passe courants, identité), sessions opaques hachées avec expiration d'inactivité et absolue, rotation du jeton CSRF par session, contrôle d'`Origin`, limitation des tentatives, révocation des sessions, en-têtes CSP/HSTS, `no-store` sur l'API, journal d'audit, permissions serveur.

Manques, par ordre d'importance :

1. **MFA (TOTP)** — prévu par la spécification d'authentification, absent. Un compte administrateur compromis suffit à tout modifier.
2. **Réinitialisation de mot de passe en libre-service** — inexistante (seule la réinitialisation par un administrateur existe), faute d'envoi d'e-mail.
3. **Journal d'audit sans valeurs avant/après** et sans chaînage d'intégrité : il prouve l'action, pas la modification exacte.
4. **Pas de verrouillage de période** : une facture peut être modifiée ou annulée rétroactivement après clôture.
5. **Pas d'approbation / séparation des tâches** : la même personne peut créer, envoyer, encaisser et annuler.
6. **Pas de pièces jointes** : les justificatifs restent hors système.
7. **Sauvegarde** : dépend de l'hébergeur ; aucun export complet restaurable ni test de restauration documenté.

---

## 7. Écart avec les standards ERP

Le socle actuel est un **suite de facturation et de gestion commerciale solide**, pas encore un **ERP comptable**. La différence tient à cinq briques :

| Brique | État | Pourquoi c'est déterminant |
|---|---|---|
| Plan comptable + journal + grand livre + balance | Absent | Sans écritures en partie double, les états financiers ne sont pas auditables |
| Clôture et verrouillage de période | Absent | Un contrôle fiscal ou un commissaire aux comptes exige des périodes figées |
| Piste d'audit avec valeurs avant/après | Partiel | Preuve des modifications, pas seulement des actions |
| Approbations et séparation des tâches | Absent | Contrôle interne de base dès qu'il y a plusieurs salariés |
| MFA et gestion du cycle de vie des identités | Partiel | Condition d'accès aux données financières |

### Feuille de route proposée

**P0 — socle de contrôle (avant de se dire « ERP »)**
1. Plan comptable (PCG) + journaux + écritures automatiques depuis factures, avoirs, paiements, dépenses.
2. Grand livre, balance, compte de résultat, bilan simplifié.
3. Clôture mensuelle et verrouillage de période (avec exception tracée).
4. Journal d'audit enrichi (avant/après, acteur, IP) et non modifiable par l'administrateur audité.
5. Approbations par seuil (avoirs, remises, dépenses) et séparation création/encaissement.
6. MFA TOTP + réinitialisation par e-mail + jetons d'API nommés et révocables.
7. Pièces jointes (R2) sur factures, dépenses et fournisseurs.
8. Export complet et restauration testée.

**P1 — maturité commerciale**
9. Relances automatiques et modèles d'e-mail ; historique des envois.
10. Portail client (factures, devis, paiements, relevés).
11. Import CSV (clients, produits, factures, relevés bancaires) avec contrôle et rapport d'erreurs.
12. Multi-devises avec taux de change et écarts de conversion.
13. Modèles PDF paramétrables (logo, couleurs, mentions).
14. Devis récurrents, dépenses récurrentes, étiquettes et champs personnalisés.

**P2 — conformité locale et usages avancés**
15. Préparation de la déclaration de TVA (base du formulaire 1010), y compris le taux réduit de 1 % applicable aux archipels hors Société à compter du 1er juillet 2026.
16. Export des données CST-S (formulaire 4010) et suivi des échéances DICP/CPS.
17. Chorus Pro pour la facturation aux entités publiques.
18. Notifications applicatives, filtres enregistrés, recherche étendue.
19. Application installable (PWA) et mode hors ligne en lecture.
20. Multi-société si le besoin se confirme.

---

## 8. Ce qui n'a pas été vérifié

- **Interface dans un navigateur réel** : les parcours ont été validés par l'API et par les tests HTTP, pas par clic ni par lecteur d'écran. Les règles d'accessibilité sont implémentées (libellés, focus, contrastes, annonces) mais non auditées formellement (RGAA/WCAG).
- **Concurrence** : pas de test de deux utilisateurs modifiant le même document simultanément.
- **Charge** : aucun test au-delà de quelques centaines de documents ; les limites D1 et le coût du rapport de TVA en JavaScript restent à mesurer.
- **E-mails et PDF visuel** : l'envoi est simulé (statut), le rendu PDF n'a pas été inspecté visuellement.
- **Restauration de sauvegarde** : non testée.

---

## 9. Conclusion

Les 17 documents de spécification sont couverts sur le périmètre **commercial, achats, projets, banque, rapports et administration**. Les défauts trouvés lors de cet audit ont été corrigés et sont couverts par des tests. Le chemin restant vers un ERP au sens du marché est connu, borné et priorisé ci-dessus ; il commence par la comptabilité générale et le verrouillage des périodes, pas par de nouvelles fonctionnalités visibles.

---

## 10. Mise à jour du 29 octobre 2026 — ce qui a été comblé depuis l'audit

Cet audit reste la référence datée du 28 octobre. Les manques listés au §6 et les briques du §7 ont évolué ; voici l'état réel, sans réécrire l'audit.

| Manque (§6 / §7) | État au 29/10 | Preuve |
|---|---|---|
| Pièces jointes (justificatifs, preuves de paiement) | **Comblé** — octets stockés en base, découpés en morceaux, plafond paramétrable | T-101, marche HTTP avec SHA-256 identique |
| Journal d'audit sans avant/après ni chaînage | **Comblé** — valeurs modifiées seulement, chaîne de hachage vérifiable | `verifyActivityChain`, tests |
| Verrouillage de période | **Comblé** — clôture et réouverture motivée, refus d'écriture en période close | T-104b, `period_locks` |
| Relances automatiques | **Comblé (enregistrées)** — niveaux mémorisés, pas deux fois la même relance | T-105, 10 tests |
| Envoi d'e-mail | **Code livré, envoi réel bloqué** par l'absence de fournisseur (PQ-2) | T-106, 502 sans clé |
| Rôles personnalisés | **Comblé** — CRUD, attribution, matrice, vérification serveur | T-202a/b/c, marche live |
| Plan comptable, journaux, grand livre, écritures automatiques | **Comblé (P0.1–P0.2)** — comptes PCG, écritures dérivées des documents, balance, compte de résultat | module comptabilité, 9 tests |
| Bilan | **Comblé** — dérivé du journal une fois la reprise de balance importée ; l'écart de reprise va au report à nouveau, jamais inventé | T-304, 7 tests, bilan live équilibré |
| Approbations par seuil / séparation des tâches | **Comblé** — seuils paramétrables (avoir, dépense, remise), auto-approbation refusée, séparation création/encaissement activable, file d'approbation journalisée | T-302, 6 tests de règles, marche HTTP |
| Réinitialisation de mot de passe en libre-service | **Absent** — dépend de l'envoi d'e-mail (PQ-2) | dépendance |
| Jetons d'API nommés et révocables | **Comblé** — jetons liés à un compte, portée limitée à ses permissions, expiration et nombre paramétrables, valeur affichée une fois, révocation immédiate et journalisée | T-303, marche réelle : `clients 200`, `invoices 403`, jeton révoqué `401` |
| Multi-devises, PWA, portail client | **Absent / spécifié** — portail et paiements en attente spécifiés en R4, pas construits | R4 |
| Sauvegarde et restauration testées | **Absent** — dépend de l'hébergeur | à planifier |

**Ce que cela change à la conclusion du §9.** Le socle n'est plus seulement « facturation et gestion commerciale » : il tient la partie double, produit une balance, un résultat et désormais un **bilan** dès que la reprise de balance est importée, et il contrôle qui approuve quoi. Les cinq briques du §7 qui manquaient sont donc comblées, sauf deux qui ne relèvent pas du code : la **MFA** sur les comptes administrateurs et une **restauration de sauvegarde réellement éprouvée**.
