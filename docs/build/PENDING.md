# ManaGest — registre de ce qui reste suspendu

**29 octobre 2026.** Ce document est le **registre unique** de tout ce qui n'est pas livré,
pas terminé, pas vérifié ou volontairement écarté. Il remplace les listes dispersées : si une
chose est repoussée, elle est écrite ici et nulle part ailleurs.

Ce qu'il n'est pas : ni l'ordre d'exécution (c'est [`TODO.md`](TODO.md)), ni l'état de ce qui
est livré (c'est [`../AUDIT.md`](../AUDIT.md) §10).

| Statut | Sens |
|---|---|
| **DÉCISION** | Attend une décision ou une donnée de votre part. Rien ne peut avancer sans elle. |
| **PLATEFORME** | Dépend d'une capacité de l'hébergeur ou d'un service externe. |
| **DIFFÉRÉ** | Spécifié, volontairement non construit (décision R4). |
| **NON PLANIFIÉ** | Identifié par l'audit, jamais mis au plan. |
| **LIMITE** | Comportement assumé du code livré, écrit pour ne pas le découvrir en production. |
| **NON VÉRIFIÉ** | Existe, mais n'a jamais été éprouvé dans les conditions réelles. |
| **RÉGLÉ** | Tranché par le propriétaire ; la décision est appliquée dans le code ou dans les réglages, plus rien n'attend. |

---

## 1. Ce qui attend une décision ou une donnée de votre part

| # | Sujet | Statut | Pourquoi c'est en suspens | Où c'est écrit |
|---|---|---|---|---|
| D-01 | **Soldes de reprise** (balance d'ouverture) | **RÉGLÉ** (2/11/2026) | Aucun chiffre communiqué : la reprise reste **à zéro**, sans valeur inventée. Le bilan reste vide tant que rien n'est saisi, et la saisie reste ouverte à tout moment (Comptabilité → Reprise de balance). | T-304 |
| D-02 | **Valeurs fiscales par défaut** | **RÉGLÉ** (2/11/2026) | Conservées telles quelles : ce sont des réglages ordinaires, modifiables sans code (rétention, franchise, régime). Décision du propriétaire : on n'y revient plus. | `settings_extra`, Paramètres → Société / Taxes ; depuis le 2/11/2026 les défauts d'installation sont polynésiens |
| D-03 | **Seuils d'approbation** | **RÉGLÉ** (2/11/2026) | Les trois seuils sont livrés **à 0**, c'est-à-dire règle désactivée : un avoir, une dépense ou une remise passe sans blocage par défaut. L'approbation reste **optionnelle** et paramétrable (Paramètres → Sécurité), pour les cas où vous la voulez. | `server/lib/settings-extra.ts`, Paramètres → Sécurité |
| D-04 | **Déclencheur du passage quotidien** | DÉCISION + PLATEFORME (reporté par le propriétaire) | L'endpoint `POST /api/runs/daily` existe et est protégé ; l'appelant externe (cron) sera branché plus tard. **Aucun jeton GitHub n'est nécessaire** : il faut un **jeton d'API ManaGest** (Paramètres → Sécurité, créé par vous) et un planificateur qui appelle l'endpoint avec ce jeton. | T-104a, [`../SECURITE.md`](../SECURITE.md) §11 |

## 2. Ce qui dépend de la plateforme ou d'un service externe

| # | Sujet | Statut | État exact | Déblocage |
|---|---|---|---|---|
| P-01 | **Envoi réel des e-mails** | PLATEFORME (prêt à recevoir la clé) | Le code est complet (Resend, Brevo, SMTP, mode manuel) et les identifiants sont chiffrés au repos. **L'écran existe** : Paramètres → onglet « Livraison des e-mails » → choisir Resend → coller la clé API → Enregistrer, puis « Envoyer un test ». Il ne manque que la clé dans cet écran. | PQ-2 |
| P-02 | **Réinitialisation de mot de passe en libre-service** | PLATEFORME | Inexistante : elle dépend entièrement de P-01. Seule la réinitialisation par un administrateur existe. | P-01 |
| P-03 | **Sauvegarde, export complet et restauration** | **PROUVÉ EN LOCAL** (sauvegarde hébergée restante) | Export complet JSON versionné (toutes les tables, empreinte SHA-256, version de schéma) et restauration vers une base neuve (`server/lib/backup.ts`). **Aller-retour prouvé** par `tests/backup-restore.test.ts` (8 cas) sur SQLite réel : mêmes lignes dans les 78 tables, identifiants / montants / dates identiques, liens entre entités vérifiés, empreinte re-exportée à l'identique ; refus prouvés d'un schéma plus récent, d'une empreinte fausse, d'une table inconnue et d'un écrasement non confirmé. En service : `GET /api/backup`, `POST /api/backup/restore` (propriétaire seul, `confirm: "RESTORE"`). **Reste hors de portée sans hébergement** : la sauvegarde automatique D1 (PQ-4), à activer dans le tableau de bord Cloudflare. | Pour la restauration, rien ; PQ-4 pour la sauvegarde automatique |
| P-04 | **Plafond d'hébergement des pièces jointes** | **RÉGLÉ** (2/11/2026) | Le plafond de la plateforme est affiché sous le composant de pièces jointes (« 100 Mo par requête ») ; le réglage de l'espace (1–25 Mo) reste la limite appliquée. | `src/components/domain/AttachmentsPanel.tsx` |
| P-05 | **Import XLSX** | **RÉGLÉ** (2/11/2026) | L'écran d'import accepte **.xlsx** en plus du CSV : le classeur est converti côté serveur (ZIP + XML, sans dépendance), les dates Excel deviennent `AAAA-MM-JJ`, puis le fichier passe par **exactement** le même pipeline (détection d'en-têtes, alias, aperçu, validation, commit). Prouvé par `tests/xlsx.test.ts`. | `server/lib/xlsx.ts`, `tests/xlsx.test.ts` |

## 3. Spécifié et volontairement non construit (décision R4)

Aucune ligne de code : c'est une décision, pas un oubli. Spécifications complètes dans
[`R4-EXTENSION-POINTS.md`](R4-EXTENSION-POINTS.md).

| # | Sujet | Pourquoi non construit |
|---|---|---|
| T-401 | Portail client (réutilise les liens publics par document) | Un portail implique une authentification client et un périmètre de données par client ; hors périmètre de cette version. |
| T-402 | États de paiement `pending` / `failed` + registre des moyens | Sans passerelle de paiement, ces états n'auraient aucun producteur ; la spécification nomme l'effet de bord à traiter (tous les lecteurs de paiements devraient filtrer `completed`). |
| T-403 | « Lieux » (un lieu, pas une location) | Tranché par vous le 29/10 ; la spécification est écrite, le code n'est pas commandé. |
| T-404 | Palette de commandes | Confort d'usage, aucun besoin métier derrière. |

Passerelles de paiement, Peppol et Factur-X restent également **hors périmètre assumé**
(cf. `README.md` §8) : la Polynésie n'impose pas le mandat métropolitain pour les opérations locales.

## 4. Identifié par l'audit, jamais planifié

| # | Sujet | Statut | Pourquoi ça compte |
|---|---|---|---|
| N-01 | **MFA (TOTP)** | NON PLANIFIÉ | **Le seul manque P0 de sécurité qui reste.** Un mot de passe administrateur volé suffit à tout modifier. Le schéma d'authentification le prévoyait ; il n'est pas branché. |
| N-02 | **Multi-devises** avec taux de change et écarts de conversion | DIFFÉRÉ (arbitrage 2/11/2026) | Une facture en devise tierce exige un taux figé par document et une conversion à la source (journal, TVA, règlements, avoirs, rapports, réévaluation) : livré à moitié, il produirait un journal faux silencieusement. Plan et condition de réouverture dans `TODO-produits-services.md`, section Q15. |
| N-03 | **Application installable (PWA) et lecture hors ligne** | NON PLANIFIÉ | Confort terrain ; aucun impact comptable. |
| N-04 | **Préparation de la déclaration de TVA (formulaire 1010)** | NON PLANIFIÉ | Le récapitulatif de TVA existe (T-207) mais le formulaire, lui, se remplit à la main. Inclut le taux réduit de **1 %** applicable aux archipels hors Société à compter du 1er juillet 2026. |
| N-05 | **Export CST-S (formulaire 4010) et échéances DICP/CPS** | NON PLANIFIÉ | Obligations déclaratives locales ; rien n'est produit aujourd'hui. |
| N-06 | **Chorus Pro** | NON PLANIFIÉ (précision 2/11/2026) | **Aucune obligation en B2B** : Chorus Pro ne concerne en Polynésie que les **marchés publics** (loi du pays n° 2025-22 du 15/07/2025, dématérialisation progressive des demandes de paiement, ordre de grandeur 1/1/2027 pour les marchés ≥ 500 000 XPF). À rouvrir seulement si vous facturez des acheteurs publics. | [Chorus Pro — Polynésie](https://portail.chorus-pro.gouv.fr/aife_documentation?id=kb_article_view&sysparm_article=KB0012182) |
| N-07 | **Modèles PDF paramétrables** (logo, couleurs, mentions par modèle) | NON PLANIFIÉ | Deux mises en page existent (`classic`, `compact`) et les mentions sont celles de la société ; pas de modèle par document. |
| N-08 | **Devis récurrents et dépenses récurrentes** | NON PLANIFIÉ | Seules les factures sont récurrentes (T-104b). |
| N-09 | **Étiquettes et champs personnalisés** | NON PLANIFIÉ | Aucun champ libre par entité au-delà des notes. |
| N-10 | **Notifications applicatives** | NON PLANIFIÉ | Aucune cloche, aucun centre de notifications ; tout passe par le tableau de bord et les relances. |
| N-11 | **Multi-société** | NON PLANIFIÉ | Les données sont portées par une société ; préparer plusieurs sociétés est un chantier de modèle, pas un réglage. |
| N-12 | **e-reporting des opérations situées en France** | NON PLANIFIÉ | Cas transfrontalier explicitement hors périmètre (cf. [`../CONFORMITE.md`](../CONFORMITE.md) §5). |

## 5. Limites connues du code livré

Ce ne sont pas des bugs ouverts : ce sont des comportements assumés, écrits pour être lus.

| # | Limite | Conséquence pratique |
|---|---|---|
| L-01 | **Le journal est figé par événement** : une écriture créée pour `(document, événement)` n'est jamais recalculée. | Modifier une facture déjà comptabilisée ne corrige pas son écriture. Il faut annuler (extourne) puis réémettre, ou passer une écriture d'ajustement — qui n'a pas d'écran. |
| L-02 | **Une seule reprise de balance par espace** (clé `opening/balances`). | Pas de reprise par exercice ni de multi-exercices : un deuxième exercice demanderait un modèle de période. |
| L-03 | **Bilan simplifié** : classes 1 à 5 plus le résultat de la période. | Pas d'amortissements, pas de tableau de flux, pas de détail des immobilisations. |
| L-04 | **Pas de saisie manuelle d'écriture** ; le journal d'opérations diverses se limite à la reprise de balance. | Un ajustement comptable se fait hors outil. |
| L-05 | **Rapprochement bancaire par suggestions uniquement.** | Rien n'est lettré automatiquement ; l'utilisateur confirme chaque rapprochement. |
| L-06 | **Relances enregistrées, non envoyées.** | Tant que P-01 n'est pas réglé, une relance est une intention auditable, pas un e-mail. |
| L-07 | **Moteur récurrent : dérive du 31 vers le 28.** | Un modèle démarré un 31 génère ensuite le 28 ; le test l'assume explicitement. |
| L-08 | **Pièces jointes : type MIME déclaré par le navigateur**, aucune analyse antivirus ; octets stockés en base par morceaux, pas dans un bucket objet. | Un fichier peut mentir sur son type ; il n'est jamais rendu en ligne, ce qui limite le risque sans le supprimer. |
| L-09 | **Approbations à un seul niveau**, par type de document. | Pas de circuit à deux niveaux, pas de délégation, pas de seuil par client. |
| L-10 | **Séparation des devoirs limitée à l'encaissement.** | Le créateur ne peut pas encaisser ; il peut toujours envoyer et annuler selon ses permissions. |
| L-11 | **Jetons d'API sans limite de débit propre.** | Les limites existantes (tentatives de connexion, passage quotidien) ne s'appliquent pas par jeton. |
| L-12 | **Exercice comptable non paramétré.** | La date d'ouverture est celle de l'import ; il n'existe pas de notion d'exercice clôturé au-delà du verrouillage de période. |

## 6. Ce qui n'a jamais été vérifié

À lire comme un engagement d'honnêteté : ce qui suit n'a pas été prouvé, même si le reste l'a été.

| # | Sujet | État réel |
|---|---|---|
| V-01 | **Écrans dans un navigateur** | Les trois écrans livrés (Bilan, Reprise de balance, Approbations) ont été parcourus par un **script navigateur** sur une base locale migrée le 2/11/2026 (27 contrôles, commit `7ff2e9b`), qui a révélé et fait corriger quatre défauts réels. Restent non vérifiés : le rendu visuel écran par écran et un lecteur d'écran. |
| V-02 | **Tests navigateur automatisés** | Toujours absents de la suite : les **671 tests** (79 fichiers) couvrent l'API et les fonctions partagées, et la vérification navigateur du 2/11/2026 était un script ponctuel, non rejoué automatiquement. |
| V-03 | **Concurrence** | Jamais éprouvée : deux utilisateurs modifiant le même document en même temps. |
| V-04 | **Charge** | Jamais mesurée au-delà de quelques centaines de documents ; les limites D1 et le coût des rapports ne sont pas connus. |
| V-05 | **Rendu PDF** | Jamais inspecté visuellement ; seule la validité du fichier (`%PDF`, type MIME) a été constatée. |
| V-06 | **Restauration de sauvegarde** | **Prouvée en local** : `tests/backup-restore.test.ts` (aller-retour vers une base neuve, intégrité ligne à ligne). Non rejouée sur D1 hébergé (quota) ; sauvegarde automatique de l'hébergeur à activer (P-03). |
| V-07 | **Accessibilité formelle** | Règles implémentées (libellés, focus, contrastes, annonces) mais **aucun audit RGAA/WCAG**. |

## 7. Ce qui est terminé, pour éviter la confusion

Toutes les tâches identifiées du plan sont fermées : T-000 → T-009, T-010, T-100 → T-108,
T-201 → T-207, T-301 → T-304. Les quatre points d'extension R4 (T-401 → T-404) sont
**spécifiés**, pas construits — c'est leur état final, pas un retard.

Le détail, la preuve et les limites de chaque tâche sont dans [`TODO.md`](TODO.md) et
[`CHANGELOG.md`](CHANGELOG.md). L'audit d'origine reste lisible dans
[`../archive/audit-2026-10-28/`](../archive/audit-2026-10-28/), ses constats à jour dans
[`../AUDIT.md`](../AUDIT.md) §10.

## 8. Règle de tenue

1. Toute chose repoussée est ajoutée **ici**, avec son statut et la raison.
2. Un statut ne passe à « terminé » qu'avec une preuve : test, marche HTTP ou validation de votre part.
3. `TODO.md` garde l'ordre d'exécution ; ce registre garde ce qui n'y est pas planifiable.
4. Une archive ne se réécrit pas : elle se consulte.
