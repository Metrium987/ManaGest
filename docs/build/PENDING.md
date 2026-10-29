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

---

## 1. Ce qui attend une décision ou une donnée de votre part

| # | Sujet | Statut | Pourquoi c'est en suspens | Où c'est écrit |
|---|---|---|---|---|
| D-01 | **Soldes de reprise** (balance d'ouverture) | DÉCISION | L'outil est livré et prouvé (T-304) : il attend **vos chiffres**. Tant qu'ils ne sont pas saisis, le bilan reste vide, et ce n'est pas un défaut du calcul. | `TODO.md` T-304, Comptabilité → Reprise de balance |
| D-02 | **Valeurs fiscales par défaut** : rétention 10 ans, franchise 10 000 000 XPF, mentions de régime | DÉCISION | Adoptées le 29/10 **faute de comptable disponible**, exposées comme paramètres. Elles ne sont certifiées par personne et doivent être revues (OQ-004/005/006/019). | `settings_extra`, [`../CONFORMITE.md`](../CONFORMITE.md) |
| D-03 | **Seuils d'approbation** : avoir 100 000, dépense 250 000, remise 20 %, séparation des devoirs désactivée | DÉCISION | Valeurs standard choisies pour ne pas bloquer un espace à une seule personne. Elles décrivent votre contrôle interne : à ajuster à votre fonctionnement réel. | `settings_extra`, Paramètres → Sécurité, `PATCH /api/settings/extras` |
| D-04 | **Déclencheur du passage quotidien** | DÉCISION + PLATEFORME | L'endpoint `POST /api/runs/daily` existe et est protégé ; **l'appelant externe (cron) n'existe pas**. L'hébergement n'attache aucun planificateur. | `TODO.md` T-104a, PQ-1, [`../SECURITE.md`](../SECURITE.md) §11 |

## 2. Ce qui dépend de la plateforme ou d'un service externe

| # | Sujet | Statut | État exact | Déblocage |
|---|---|---|---|---|
| P-01 | **Envoi réel des e-mails** | PLATEFORME (déprioritisé par vous) | Le code est complet (mode manuel par défaut, Resend, Brevo, SMTP explicite), les identifiants sont chiffrés au repos. **Aucun message n'a jamais été délivré depuis cet hôte** : pas de fournisseur configuré. Un 502 prouve un échec, pas une réception. | Une clé de fournisseur (PQ-2) |
| P-02 | **Réinitialisation de mot de passe en libre-service** | PLATEFORME | Inexistante : elle dépend entièrement de P-01. Seule la réinitialisation par un administrateur existe. | P-01 |
| P-03 | **Sauvegarde, export complet et restauration** | PLATEFORME | Export complet `PLATFORM-DEPENDENT` (PQ-4). **Aucune restauration n'a jamais été testée** : c'est le trou le plus sérieux qui reste. | Réponse de l'hébergeur + un test de restauration |
| P-04 | **Plafond d'hébergement des pièces jointes** | PLATEFORME (cosmétique) | Le plafond local (10 Mo, paramétrable 1–25) fonctionne ; seul l'affichage du plafond **de l'hébergeur** manque (PQ-3). | Réponse plateforme |
| P-05 | **Import XLSX** | PLATEFORME (non tranché) | Seul le CSV est importé, et il est prouvé. Le XLSX n'a jamais été validé (PQ-5). | Décision ou bibliothèque validée |

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
| N-02 | **Multi-devises** avec taux de change et écarts de conversion | NON PLANIFIÉ | Une facture en devise étrangère n'a aujourd'hui aucun taux ni gain/perte de change. |
| N-03 | **Application installable (PWA) et lecture hors ligne** | NON PLANIFIÉ | Confort terrain ; aucun impact comptable. |
| N-04 | **Préparation de la déclaration de TVA (formulaire 1010)** | NON PLANIFIÉ | Le récapitulatif de TVA existe (T-207) mais le formulaire, lui, se remplit à la main. Inclut le taux réduit de **1 %** applicable aux archipels hors Société à compter du 1er juillet 2026. |
| N-05 | **Export CST-S (formulaire 4010) et échéances DICP/CPS** | NON PLANIFIÉ | Obligations déclaratives locales ; rien n'est produit aujourd'hui. |
| N-06 | **Chorus Pro** (facturation aux entités publiques) | NON PLANIFIÉ | Nécessaire seulement si vous facturez le secteur public. |
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
| V-01 | **Écrans dans un navigateur** | Je n'en ai ouvert **aucun**. Vous avez validé certains écrans (rôles, comptabilité, jetons), jamais les plus récents : **Bilan**, **Reprise de balance**, **Approbations**. |
| V-02 | **Tests navigateur automatisés** | Inexistants. Les 245 tests sont unitaires ; la compilation ne remplace pas un clic. |
| V-03 | **Concurrence** | Jamais éprouvée : deux utilisateurs modifiant le même document en même temps. |
| V-04 | **Charge** | Jamais mesurée au-delà de quelques centaines de documents ; les limites D1 et le coût des rapports ne sont pas connus. |
| V-05 | **Rendu PDF** | Jamais inspecté visuellement ; seule la validité du fichier (`%PDF`, type MIME) a été constatée. |
| V-06 | **Restauration de sauvegarde** | Jamais testée (cf. P-03). |
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
