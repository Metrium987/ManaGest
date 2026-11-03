# ManaGest — registre de ce qui reste suspendu

**3 novembre 2026.** Ce document est le **registre unique** de tout ce qui n'est pas livré,
pas terminé, pas vérifié ou volontairement écarté. Il remplace les listes dispersées : si une
chose est repoussée, elle est écrite ici et nulle part ailleurs.

Ce qu'il n'est pas : ni l'ordre d'exécution (c'est [`TODO.md`](TODO.md)), ni l'état de ce qui
est livré (c'est [`../AUDIT.md`](../AUDIT.md) §10).

| Statut | Sens |
|---|---|
| **ACTION UTILISATEUR** | Le code est livré et prouvé ; il manque une donnée que seul le propriétaire peut fournir (DNS, secret, réglage d'hébergeur, planificateur externe). La démarche exacte est écrite ici. |
| **DÉCISION PRODUIT** | Tranché : non construit, volontairement. Une ligne dit pourquoi et à quelle condition le rouvrir. Aucune tâche de code n'est ouverte. |
| **LIMITE** | Comportement assumé du code livré, écrit pour ne pas le découvrir en production. |
| **CONSTAT DE VÉRIFICATION** | Ce qui n'a pas été éprouvé dans les conditions réelles, avec la condition précise qui le débloquerait. Ce n'est pas une tâche de code. |
| **LIVRÉ** | Fermé avec une preuve exécutée (test ou commande), citée sur la ligne. |

---

## 1. Ce qui dépend d'une action que seul le propriétaire peut faire

Aucune de ces lignes ne demande de code : le code est livré, testé et déjà en service. Elles
attendent une donnée externe.

| # | Sujet | Statut | Démarche exacte |
|---|---|---|---|
| P-01 | **Envoi réel des e-mails (Resend)** | ACTION UTILISATEUR | La clé API est saisie (3/11/2026) et les refus du prestataire sont maintenant expliqués (clé, domaine, expéditeur, quota). Pour écrire à vos clients : Resend → **Domains → Add domain**, recopier les enregistrements **SPF/DKIM** chez l'hébergeur du domaine, attendre **Verified**, puis Paramètres → Livraison des e-mails → adresse d'envoi sur ce domaine → **Enregistrer** → **Envoyer un test**. En attendant, seul le mode test fonctionne : expéditeur `onboarding@resend.dev`, destinataire = adresse du compte Resend. Procédure complète : [`../UTILISATION.md`](../UTILISATION.md) §« Envoi des e-mails avec Resend ». |
| P-03 | **Sauvegarde automatique D1** | ACTION UTILISATEUR | L'export complet et la restauration sont livrés et **prouvés** (`tests/backup-restore.test.ts`, 78 tables, empreinte SHA-256). La sauvegarde automatique est un réglage de l'hébergeur : tableau de bord Cloudflare → D1 → la base du projet → **Backups** → activer la politique de rétention. Aucun code ne peut l'activer à votre place. |
| D-04 | **Déclencheur du passage quotidien** | ACTION UTILISATEUR | L'endpoint `POST /api/runs/daily` est livré, protégé par `DAILY_RUN_TOKEN` (comparaison à temps constant, 10 tentatives/heure, idempotence par jour tahitien) et prouvé (401 sans jeton, 200 avec, 429 au 11ᵉ appel). Il faut définir le secret de plateforme **`DAILY_RUN_TOKEN`** (fichier `.dev.vars` en local, Secrets de l'hébergeur en ligne), puis un planificateur (cron de l'hébergeur, GitHub Actions, cron système) qui appelle chaque jour `POST /api/runs/daily` avec `Authorization: Bearer <valeur du secret>`. Les **jetons d'API** de Paramètres → Sécurité servent aux utilisateurs de l'API, **pas** à ce déclencheur ; aucun jeton GitHub n'est nécessaire. En local, le bouton « Lancer maintenant » suffit et le secret est inutile. |

### Décisions déjà tranchées (plus rien n'attend)

| # | Sujet | État |
|---|---|---|
| D-01 | **Soldes de reprise** | RÉGLÉ : reprise à zéro, saisie ouverte à tout moment (Comptabilité → Reprise de balance). |
| D-02 | **Valeurs fiscales par défaut** | RÉGLÉ : ce sont des réglages ordinaires ; depuis le 2/11/2026 une installation neuve est polynésienne (XPF, Pacific/Tahiti, plan 0/5/13/16 + 1 % daté, défaut 13 %). |
| D-03 | **Seuils d'approbation** | RÉGLÉ : livrés à 0 (règle désactivée), activables dans Paramètres → Sécurité. |

---

## 2. Livré et prouvé (fermé dans ce passage)

| # | Sujet | Preuve exécutée |
|---|---|---|
| P-02 | **Réinitialisation de mot de passe en libre-service** | **LIVRÉ.** `POST /api/auth/forgot-password` (public) émet un lien **valable 1 h, à usage unique**, stocké **haché en SHA-256** ; la réponse est identique que l'adresse existe ou non (pas d'énumération de comptes), plafonnée à **5 demandes par heure et par IP**, silencieuse si l'envoi n'est pas configuré. `POST /api/auth/reset-password` applique la politique de mot de passe existante, **révoque toutes les sessions**, efface les liens en attente et journalise. Écrans `/mot-de-passe-oublie` et `/reinitialiser-mot-de-passe` (FR/EN), lien depuis la connexion. Preuve : `tests/password-reset.test.ts`, **6 cas** — lien reçu et token haché, réinitialisation, ancienne session **401**, ancien mot de passe **401**, nouveau **200**, réutilisation **422 `INVALID_RESET_TOKEN`**, adresse inconnue muette, mot de passe faible **422**, lien expiré et inexistant **422**, mode manuel sans envoi, quota **200×5 puis 429**. |
| N-01 | **MFA (TOTP)** | **LIVRÉ (le code existait, il est maintenant prouvé).** Le second facteur était déjà implémenté (secret TOTP, activation par code, défi de 5 min, codes de secours à usage unique, désactivation, journal). Preuve de bout en bout : `tests/mfa-flow.test.ts` — inscription, activation avec code généré, connexion renvoyant `mfa_required` **sans cookie**, code faux **401**, code valide **200 + session**, code de secours accepté puis **refusé à la réutilisation**, désactivation, connexion simple ensuite. Le « seul manque P0 » de l'audit est donc fermé. |
| P-04 | **Plafond d'hébergement des pièces jointes** | **LIVRÉ** (2/11/2026). Le plafond de la plateforme (100 Mo par requête) est affiché sous le composant de pièces jointes ; le réglage de l'espace (1–25 Mo) reste la limite appliquée (`src/components/domain/AttachmentsPanel.tsx`). |
| P-05 | **Import XLSX** | **LIVRÉ** (2/11/2026). Le classeur est converti côté serveur (ZIP + XML, sans dépendance), les dates Excel deviennent `AAAA-MM-JJ`, puis le même pipeline que le CSV s'applique (détection d'en-têtes, aperçu, validation, commit). Preuve : `tests/xlsx.test.ts`. |
| V-05 | **Rendu PDF visuel** | **VÉRIFIÉ le 3/11/2026.** Une facture réaliste (prestation de service à 13 %, deux parties identifiées) a été rendue en image 2× puis inspectée. Quatre défauts réels ont été trouvés et corrigés : le **RIDET et le NIF du client** étaient poussés hors du cadre par la limite de cinq lignes (identifiants désormais sur une ligne compacte dédiée) ; la ligne **« TVA 13 % » était recouverte** par le bandeau « Total TTC » (bandeau décalé sous la ligne précédente) ; l'en-tête **« TOTAL HT » touchait le bord** (marge de 8 pt) ; les **dates s'affichaient en ISO** (désormais JJ/MM/AAAA). La page corrigée montre l'en-tête société avec TAHITI/RIDET/NIF, le bloc client avec ses trois identifiants, 100 000 HT, TVA 13 % = 13 000 et 113 000 XPF. |

---

## 3. Décisions produit — non planifié (aucune tâche ouverte)

| # | Sujet | Pourquoi, et condition de réouverture |
|---|---|---|
| T-401 | Portail client | Un portail exige une authentification client et un périmètre par client : hors de cette version. Rouvrir si des clients doivent se connecter eux-mêmes. |
| T-402 | États de paiement `pending` / `failed` + registre des moyens | Sans passerelle de paiement, aucun producteur : rouvrir avec une passerelle. |
| T-403 | « Lieux » (un lieu, pas une location) | Spécification écrite, construction non commandée. Rouvrir sur demande explicite. |
| T-404 | Palette de commandes | Confort d'usage, aucun besoin métier. |
| N-02 | Multi-devises avec taux et écarts de conversion | DIFFÉRÉ : livré à moitié, il produirait un journal faux. Plan complet en `TODO-produits-services.md` Q15 ; rouvrir avec un besoin réel de facturation en devise tierce. |
| N-03 | PWA et lecture hors ligne | Confort terrain, aucun impact comptable. |
| N-04 | Formulaire de déclaration de TVA 1010 | Le récapitulatif de TVA existe ; la déclaration se remplit à la main. Rouvrir si vous voulez la pré-remplir (le taux 1 % daté est déjà modélisé). |
| N-05 | Export CST-S (4010) et échéances DICP/CPS | Obligations déclaratives locales hors périmètre. |
| N-06 | Chorus Pro | **Aucune obligation en B2B** ; ne concerne que les marchés publics. Rouvrir seulement si vous facturez un acheteur public. |
| N-07 | Modèles PDF paramétrables | Deux mises en page existent (`classic`, `compact`), pas de modèle par document. |
| N-08 | Devis et dépenses récurrents | Seules les factures sont récurrentes. |
| N-09 | Étiquettes et champs personnalisés | Aucun champ libre par entité au-delà des notes. |
| N-10 | Notifications applicatives | Tout passe par le tableau de bord et les relances. |
| N-11 | Multi-société | Chantier de modèle, pas un réglage. |
| N-12 | e-reporting des opérations situées en France | Cas transfrontalier explicitement hors périmètre (`../CONFORMITE.md` §5). |

---

## 4. Limites connues du code livré

Ce ne sont pas des bugs ouverts : ce sont des comportements assumés, écrits pour être lus.

| # | Limite | Conséquence pratique |
|---|---|---|
| L-01 | **Le journal est figé par événement** : une écriture créée pour `(document, événement)` n'est jamais recalculée. | Modifier une facture déjà comptabilisée ne corrige pas son écriture ; il faut extourner puis réémettre. |
| L-02 | **Une seule reprise de balance par espace** (`opening/balances`). | Pas de reprise par exercice ni de multi-exercices. |
| L-03 | **Bilan simplifié** : classes 1 à 5 plus le résultat de la période. | Pas d'amortissements, pas de tableau de flux, pas de détail des immobilisations. |
| L-04 | **Pas de saisie manuelle d'écriture** ; le journal d'opérations diverses se limite à la reprise de balance. | Un ajustement comptable se fait hors outil. |
| L-05 | **Rapprochement bancaire par suggestions uniquement.** | Rien n'est lettré automatiquement ; l'utilisateur confirme chaque rapprochement. |
| L-06 | **Relances enregistrées, non envoyées.** | Tant que P-01 n'est pas réglé, une relance est une intention auditable, pas un e-mail. |
| L-07 | **Moteur récurrent : dérive du 31 vers le 28.** | Un modèle démarré un 31 génère ensuite le 28 ; le test l'assume explicitement. |
| L-08 | **Pièces jointes : type MIME déclaré par le navigateur**, aucune analyse antivirus ; octets stockés en base par morceaux. | Un fichier peut mentir sur son type ; il n'est jamais rendu en ligne. |
| L-09 | **Approbations à un seul niveau**, par type de document. | Pas de circuit à deux niveaux, pas de délégation, pas de seuil par client. |
| L-10 | **Séparation des devoirs limitée à l'encaissement.** | Le créateur ne peut pas encaisser ; il peut envoyer et annuler selon ses permissions. |
| L-11 | **Jetons d'API sans limite de débit propre.** | Les limites existantes (connexion, passage quotidien, réinitialisation) ne s'appliquent pas par jeton. |
| L-12 | **Exercice comptable non paramétré.** | Pas de notion d'exercice clôturé au-delà du verrouillage de période. |

---

## 5. Ce qui n'a jamais été vérifié (constat, pas une tâche)

| # | Sujet | État réel et condition de déblocage |
|---|---|---|
| V-01 | **Écrans dans un navigateur** | Trois écrans (Bilan, Reprise de balance, Approbations) parcourus par un script navigateur le 2/11/2026 (27 contrôles, commit `7ff2e9b`), quatre défauts réels corrigés. Le reste demande une revue humaine écran par écran, et un lecteur d'écran pour l'accessibilité. |
| V-02 | **Tests navigateur automatisés** | Absents du dépôt : la suite (API + fonctions partagées) ne remplace pas un clic. Ce serait un choix d'outillage (Playwright + navigateur en CI), non planifié. |
| V-03 | **Concurrence** | Deux utilisateurs modifiant le même document simultanément ne sont pas éprouvés ; demande un environnement à deux clients. |
| V-04 | **Charge** | Non mesurée au-delà de quelques centaines de documents ; demande un jeu de données et un hébergement disponibles. |
| V-06 | **Restauration de sauvegarde** | Prouvée en local sur SQLite réel ; non rejouée sur D1 hébergé (dépend du quota et de votre base). |
| V-07 | **Accessibilité formelle** | Règles implémentées, aucun audit RGAA/WCAG : demande un auditeur. |

---

## 6. Ce qui est terminé, pour éviter la confusion

Toutes les tâches du plan sont fermées : T-000 → T-009, T-010, T-100 → T-108,
T-201 → T-207, T-301 → T-304. Les quatre points d'extension R4 (T-401 → T-404) restent
**spécifiés et non construits** : c'est leur état final (décision produit), pas un retard.

Le détail, la preuve et les limites de chaque tâche sont dans [`TODO.md`](TODO.md) et
[`CHANGELOG.md`](CHANGELOG.md). L'audit d'origine reste lisible dans
[`../archive/audit-2026-10-28/`](../archive/audit-2026-10-28/), ses constats à jour dans
[`../AUDIT.md`](../AUDIT.md) §10.

## 7. Règle de tenue

1. Toute chose repoussée est ajoutée **ici**, avec son statut et la raison.
2. Un statut ne passe à « livré » qu'avec une preuve exécutée : test, marche HTTP ou validation de votre part.
