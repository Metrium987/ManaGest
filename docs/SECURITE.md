# Sécurité de ManaGest

Ce document décrit les mesures réellement implémentées, leurs limites et les points
à surveiller lors d'une mise en production.

## 1. Authentification

- **Mots de passe** hachés avec PBKDF2-HMAC-SHA256, **100 000 itérations**, sel aléatoire
  de 16 octets, sortie 256 bits. Le format stocké
  (`pbkdf2-sha256$itérations$sel$empreinte`) permet de renforcer le coût et de migrer
  les empreintes après une connexion réussie.
- **Politique** : 12 caractères minimum, 128 maximum, aucune règle de composition,
  refus des mots de passe courants et des variantes du nom ou de l'e-mail.
  Les phrases de passe sont encouragées ; aucun changement périodique imposé.
- **Énumération** : un compte inexistant exécute tout de même un calcul PBKDF2
  (empreinte factice) et renvoie le même message que pour un mot de passe incorrect.
- **Limitation** : 8 échecs par adresse e-mail sur 15 minutes, réponse `429`.
  Les tentatives sont journalisées par e-mail et adresse IP.

> **Limite assumée.** Le runtime Workers plafonne PBKDF2 à 100 000 itérations.
> OWASP recommande 600 000 itérations pour SHA-256. 100 000 reste nettement supérieur
> à un simple SHA ; pour un niveau de sécurité maximal, prévoir une migration vers
> Argon2id sur un runtime dédié ou une authentification déléguée.

## 2. Sessions

- Jeton opaque de **32 octets** aléatoires, transmis par cookie `HttpOnly`,
  `SameSite=Lax`, `Secure` en HTTPS, sans `Domain`.
- Seul le **haché SHA-256** du jeton est stocké en base.
- **Expiration** : inactivité (30 min par défaut, paramétrable) et durée absolue
  (12 h par défaut). Renouvellement glissant limité à la durée absolue.
- Le jeton est **recréé à chaque connexion** (pas de fixation de session).
- Déconnexion : suppression en base et expiration des cookies.
- Modification du mot de passe : révocation de toutes les autres sessions.
- Désactivation d'un utilisateur : révocation immédiate de ses sessions.
- L'utilisateur peut consulter et révoquer ses sessions actives.

## 3. Protection CSRF et origine

Chaque requête non sûre (POST, PATCH, DELETE) est contrôlée :

1. si un en-tête `Origin` est présent, son hôte doit correspondre à celui de la requête ;
2. le jeton `X-CSRF-Token` doit correspondre au cookie `mg_csrf` **et** au secret
   enregistré dans la session côté serveur (double vérification) ;
3. un jeton de session sans jeton CSRF valide est rejeté (`403 CSRF_TOKEN`).

`SameSite=Lax` est une défense supplémentaire, pas un substitut.

## 4. Autorisations

- Permissions de la forme `{domaine}.{action}` (`invoices.write`, `users.read`…).
- Matrice de rôles centralisée dans `shared/domain.ts`, appliquée **côté serveur**
  par `requirePermission`.
- **Rôles personnalisés (T-202b).** Un compte peut porter un rôle personnalisé
  (`users.role_key`) dont la liste de permissions est stockée. La résolution se fait
  au chargement de session : un rôle **système** se résout toujours depuis le code
  (les cinq rôles fixes ne peuvent pas dériver), un rôle personnalisé depuis sa
  liste, **filtrée contre les permissions déclarées** — une faute de frappe, un
  doublon, une valeur non textuelle ou un JSON malformé n'accorde rien. Un rôle
  système ne peut être ni modifié ni supprimé, un rôle encore attribué ne peut pas
  être supprimé, une permission inconnue est refusée en `422` (jamais réduite en
  silence) et retirer le dernier propriétaire actif est refusé. Toute création,
  modification, suppression et attribution est journalisée avec sa valeur
  précédente.
- **Écran de réglages réservé.** `settings.read` n'est pas hérité par les rôles
  opérationnels : le propriétaire, l'administrateur et le comptable ouvrent
  Paramètres ; vente et lecture seule ne le voient ni dans le menu ni par URL
  directe, et le serveur répond `403`. Pour saisir un document, ils lisent les
  taux de TVA par `GET /tax-rates`, gardée par `invoices.read` — la configuration
  reste chez ceux qui détiennent l'autorité, la donnée opérationnelle reste
  disponible à la saisie.
- **Journal d'activité réservé.** `activity.read` est refusé à vente et lecture
  seule : la consultation du journal et la vérification de la chaîne de hachage
  sont réservées au propriétaire, à l'administrateur et au comptable. Les
  snapshots de champs contenant des prix ou des marges sont masqués pour un
  lecteur sans `products.cost.read`.
- Toute route protégée vérifie d'abord la session, puis la permission.
- Les données sont toujours filtrées par la société du déploiement ; aucun identifiant
  de société n'est accepté depuis le client.
- Un utilisateur ne peut pas se supprimer lui-même, ni retirer le dernier propriétaire.

## 5. En-têtes et navigateur

En HTTPS :

- `Content-Security-Policy` : `default-src 'self'`, scripts et connexions limités à
  l'origine, `frame-ancestors 'none'`, `base-uri 'self'`, `form-action 'self'`.
- `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`,
  `Permissions-Policy` restrictif.
- `Cache-Control: no-store` sur toutes les réponses API.
- `X-Robots-Tag: noindex, nofollow`.

## 6. Données et intégrité

- Requêtes SQL **préparées** avec paramètres liés (aucune concaténation de valeurs).
- Validation Zod de toutes les entrées ; erreurs renvoyées par code, sans détail interne.
- Montants en entiers, contrôles de dépassement de solde et d'appartenance au client.
- Journal d'audit append-only (`activities`) pour les connexions et opérations sensibles.
- Erreurs serveur inattendues : journalisées, réponse générique `INTERNAL_ERROR`.

## 7. Risques résiduels et recommandations

| Risque | Recommandation |
|---|---|
| PBKDF2 plafonné à 100 000 | Surveiller l'évolution du runtime ; prévoir Argon2id |
| Pas de 2FA dans cette version | Ajouter TOTP pour les rôles administrateurs |
| Réinitialisation de mot de passe par l'administrateur uniquement | Ajouter un envoi d'e-mail signé avec expiration courte |
| Sauvegardes | Activer les sauvegardes D1 (PQ-4) ; la restauration est prouvée en local par `tests/backup-restore.test.ts` |
| Verrouillage de compte | La limitation est temporaire ; surveiller les journaux `login_attempts` |
| CSP | Vérifier après ajout d'un domaine externe (polices, analytics) |

## 8. Vérifications effectuées

- `401` sur l'API sans session.
- `403` sur mutation sans jeton CSRF.
- `403` sur origine étrangère.
- Recalcul des soldes après paiement.
- Génération PDF valide (`application/pdf`, en-tête `%PDF`).
- Tests unitaires du moteur TVA, des statuts, permissions, dates et mots de passe.
- `401` anonyme, `403 CSRF_TOKEN`, `403` pour un rôle lecture seule sur la configuration e-mail et l'envoi d'un document.

## 9. Envoi des documents par e-mail

- **Quatre modes** : `manual` (défaut — aucun message ne part, le PDF se télécharge), Resend, Brevo ou
  un relais SMTP explicite. Le mode est un paramètre d'espace de travail, pas une constante de code.
- **Identifiants chiffrés au repos** : AES-GCM 256 bits, IV aléatoire par écriture, format `v1.<iv>.<chiffré>`.
  La clé de chiffrement (`MAIL_CONFIG_ENCRYPTION_KEY`, au moins 32 caractères) n'est **jamais** en base :
  elle vient des secrets de la plateforme. Sans elle, enregistrer un mot de passe ou une clé est refusé
  (`503 MAIL_ENCRYPTION_KEY_MISSING`) plutôt que stocké en clair.
- **Jamais renvoyés au client** : l'API ne renvoie que `has_api_key` / `has_smtp_password`. Les secrets de
  plateforme `RESEND_API_KEY`, `BREVO_API_KEY` et `SMTP_PASSWORD` sont prioritaires sur la valeur chiffrée,
  ce qui permet de changer une clé sans écrire en base.
- **Surface réduite** : la configuration et le message de test exigent `settings.write` (un rôle en lecture
  ne peut donc ni lire ni modifier la configuration) ; l'envoi d'une pièce exige la permission d'écriture
  du module concerné. Un type de document inconnu répond `404` avant toute requête.
- **Relais SMTP encadré** : nom d'hôte validé (pas d'adresse IP, pas de `localhost`, `.local` ou
  `.internal`, pas de port dans le nom) et ports 465 ou 587 uniquement, afin qu'un espace de travail ne
  puisse pas pointer le relais vers la plateforme elle-même.
- **Traçabilité** : changement de configuration, envoi de test et envoi d'un document produisent des
  entrées du journal (`activity.email_settings_changed`, `activity.email_test_sent`,
  `activity.<kind>_emailed` avec destinataire, fournisseur et identifiant du message).
- **Contenu** : le corps est échappé avant conversion en HTML ; les modèles n'acceptent que trois variables
  (client, numéro de pièce, société).

> **Limite assumée.** Aucun message n'a été réellement délivré depuis cet hébergement : il n'existe pas de
> identifiant de fournisseur ici, et un échec `502` ne distingue pas un refus du fournisseur d'un appel
> sortant bloqué (vérifié séparément : Resend répond `401` sans clé). Le chemin SMTP n'a jamais ouvert de
> connexion. En production, l'envoi transmet les factures à un sous-traitant : prévoir le contrat et la
> mention correspondante avant de l'activer.

## 10. Fichiers joints (justificatifs et preuves de paiement)

- **Portée** : un fichier est rattaché à **une** dépense ou **un** paiement, jamais à un client ni à un
  document partagé. La permission exigée est celle de la pièce concernée (`expenses.*` ou `payments.*`),
  vérifiée à chaque lecture, chaque téléchargement et chaque suppression.
- **Formats et taille** : PDF, JPEG, PNG, WebP uniquement ; plafond paramétrable de 1 à 25 Mo (10 Mo par
  défaut). La taille retenue est celle des **octets décodés**, jamais celle annoncée par le navigateur.
- **Noms** : le nom d'origine est conservé pour l'affichage, mais réduit à son dernier segment et privé de
  caractères de contrôle — un nom ne peut pas désigner un chemin.
- **Conservation** : la suppression est logique (la ligne reste, les octets partent) et l'action est
  journalisée avec le nom et la taille, ce qui laisse une trace après coup.
- **Téléchargement** : servi en pièce jointe (`Content-Disposition: attachment`), avec `nosniff` et
  `Cache-Control: private, no-store` ; un fichier n'est jamais rendu en ligne dans l'application.

> **Limites assumées.** Le type MIME est celui déclaré par le navigateur : il n'est pas déduit du contenu,
> donc un fichier renommé peut être stocké (il ne sera jamais exécuté ni affiché en ligne). Aucun antivirus
> n'est appliqué. Les octets résident dans la base : les sauvegardes D1 les couvrent, mais un volume
> important de justificatifs pèse sur la base — un bucket objet serait préférable si le volume devient
> significatif.

## 11. Passage quotidien automatisé

- **Aucune session acceptée** : `POST /api/runs/daily` est réservé à un appelant machine, authentifié par
  un jeton d'espace de travail (`DAILY_RUN_TOKEN`, secret de plateforme) transmis par `x-run-token` ou
  `Authorization: Bearer`. Le jeton est comparé en **temps constant** ; sans secret configuré, l'endpoint
  répond `503` au lieu d'accepter n'importe quel appel.
- **Limitation** : 10 tentatives par heure et par adresse IP, puis `429` avec un délai d'attente. Les
  tentatives anciennes sont purgées : un jeton divulgué n'est pas un levier illimité.
- **Idempotence par la donnée** : la journée (fuseau `Pacific/Tahiti`) est une clé primaire. La
  revendication est un `INSERT … ON CONFLICT DO NOTHING`, donc deux appels simultanés ne produisent qu'un
  passage ; le second reçoit le résumé du premier et n'écrit rien. Une journée en échec reste
  réessayable, la reprise étant elle aussi conditionnelle.
- **Traçabilité** : chaque passage réel écrit `activity.daily_run_completed` avec le nombre de factures
  créées, le nombre de rappels enregistrés, le nombre d'échecs, le nombre de modèles traités et l'adresse
  de l'appelant.
- **Rappels** : un rappel est enregistré dans `invoice_reminders` avec son **niveau** (1 à 3, un par
  intervalle de 7 jours par défaut) sous une contrainte d'unicité par facture et par niveau. Aucun message
  n'est envoyé : tant qu'aucun fournisseur n'est configuré, un rappel est une intention datée et
  journalisée (`activity.reminder_automatic`), jamais un envoi silencieux.
- **Déclenchement manuel** : `POST /api/runs/daily/manual` exige une **session** avec la permission
  `recurring.write` et le jeton CSRF, et passe par **la même revendication de journée** que l'appelant
  machine : un second clic ne crée rien et renvoie le résumé du passage déjà effectué. Le jeton machine
  reste réservé au planificateur ; le bouton n'y donne pas accès.

> **Limite assumée.** Le déclencheur externe reste à la charge du propriétaire (PQ-1) : cet hébergement
> n'attache aucun planificateur, et aucun appelant réel n'a été configuré. La limitation de débit a été
> mesurée depuis une seule adresse.

## Iframe de préversion (A-21)

La préversion est la seule iframe supportée, et seulement pour sa propre origine : sur un hôte
`.style.dev`, la CSP porte `frame-ancestors https://<hôte>` et `X-Frame-Options` est retiré (il
contredirait la politique). Partout ailleurs, `X-Frame-Options: DENY` et
`frame-ancestors 'none'` restent la règle. Les cookies de session suivent la même décision
(`SameSite=None; Secure; Partitioned` sur la préversion, `Lax` sinon).

## Ré-authentification avant changement de facteur (A-22)

Une session valide ne suffit pas à modifier un facteur : `mfa/setup` et `mfa/enable` exigent le
mot de passe courant, `mfa/disable` accepte un code TOTP ou de secours valide **ou** ce mot de
passe. Un échec renvoie `401 INVALID_CREDENTIALS`, alimente la limitation de connexion (A-20) et
n'écrit rien. Aucun état « ré-authentifié » n'est conservé : le mot de passe est vérifié à chaque
appel, donc un `setup` autorisé ne vaut pas pour l'`enable` suivant et rien ne peut être rejoué.
Le mot de passe n'apparaît ni dans l'audit ni dans les logs ; seuls `enabled`/`disabled` sont
tracés, avec l'IP.

## Installation unique et limitation (A-23)

`/install` n'existe qu'une fois : l'insertion de la société est conditionnelle
(`WHERE NOT EXISTS (SELECT 1 FROM company)`), l'utilisateur propriétaire suit dans le même
`batch`, et la requête perdante reçoit `409 ALREADY_CONFIGURED` ; la contrainte
`company.singleton` (A-13) reste le dernier rempart au niveau base.

Les deux routes sans session, `/install` et `/recover-owner`, partagent la fenêtre de A-20 sous
des clés réservées : 5 tentatives par IP et par tranche de 15 minutes, puis
`429 TOO_MANY_ATTEMPTS` avec `retry_after`. Chaque requête est enregistrée dans
`login_attempts` ; aucun secret, jeton ni mot de passe n'y est écrit. `recover-owner` conserve
sa comparaison à temps constant et son marqueur `owner_recovery_used` à usage unique.

**Préversion non configurée.** Le premier visiteur qui atteint `/install` crée la société et
devient propriétaire. Une préversion non configurée ne doit donc jamais être exposée
publiquement : installez-la ou laissez-la hors ligne.

## Rétention et purges (A-24)

Les données ont une durée, appliquée par le passage quotidien (`purgeExpired`) et jamais par une
requête utilisateur :

| Donnée | Durée | Base de la coupure |
|---|---|---|
| `activities` (journal d'audit) | 10 ans | `created_at` — exigence comptable |
| `login_attempts` | 90 jours | `created_at` |
| `sessions` expirées | 30 jours | `expires_at` |
| `public_link_access` | 12 mois | `created_at` |
| `mfa_challenges` | 7 jours | `created_at` |
| `password_reset_tokens` | 24 h | `created_at` |
| morceaux d'attachement orphelins | 1 jour | pièce absente, ou supprimée depuis plus d'un jour |

La suppression se fait par lots de 500, au plus 20 lots par passe, en une instruction
`DELETE … WHERE rowid IN (SELECT … LIMIT 500) RETURNING` : la passe est idempotente et deux
passes concurrentes ne se marchent pas dessus. Chaque passe écrit une entrée
`activity.retention_purged` avec ses comptes. Les documents financiers (factures, paiements,
avoirs, dépenses, grand livre) ne figurent dans aucune politique et ne peuvent donc pas être
purgés.

Purger d'anciennes entrées du journal ne doit pas casser la chaîne de hachage : les lignes
partent dans l'ordre de `seq`, la plus récente retirée devient l'ancre
`app_meta.audit_chain_anchor` (mise à jour uniquement vers l'avant), et la vérification repart
de cette ancre. Un morceau d'attachement n'a pas d'horodatage propre : la règle d'un jour est
lue sur la pièce (parent absent = orphelin ; parent supprimé depuis plus d'un jour), et un
morceau de pièce vivante n'est jamais supprimé.

Diagnostic en lecture seule : `GET /api/settings/retention` (permission `settings.read`) renvoie
le nombre de lignes et une estimation des octets de charge par table.

## Observabilité et santé publique (A-25)

La carte « Santé des données » (`GET /api/dashboard/observability`) est réservée aux rôles qui
portent déjà `activity.read` ou `accounting.read` : écarts d'intégrité (A-12), écarts de stock
(A-14), retard comptable (A-18, compté sans être posté), dernier passage quotidien et échecs des
sept derniers jours, état des purges (A-24), version de schéma et dix plus grosses tables.

`GET /api/health` est **public** : il ne renvoie que des agrégats et des versions — statut
`ok`/`degraded`, version de schéma et dernière migration, nombre d'écarts d'intégrité et de
stock, retard comptable, statut du dernier passage, date et volume de la dernière purge. Aucune
adresse e-mail, adresse IP, chemin de requête, identifiant d'utilisateur ou échantillon de ligne
n'y figure, et aucun contenu de requête n'est journalisé. Sans base initialisée, la route répond
`unavailable` avec `schema_version: null`.

## Concurrence des écritures (A-28)

Deux envois simultanés d'une même facture ne peuvent pas consommer le stock deux fois : la
transition `draft → sent` est réclamée par un `UPDATE … WHERE status = 'draft'` unique, le
perdant reçoit `409 INVALID_TRANSITION` avant tout mouvement, et un refus ultérieur (stock court,
taux absent) restaure le brouillon. Deux encaissements simultanés du même solde se départagent
de la même façon : chaque affectation réclame le solde par `UPDATE … WHERE balance >= ?`, le
second reçoit `409 AMOUNT_EXCEEDS_BALANCE` et aucune allocation n'est écrite.

**Fenêtre assumée de la clôture.** Le contrôle de période et l'écriture ne partagent pas une
transaction : une écriture déjà passée par `assertPeriodOpen` peut se valider juste après la
fermeture. Toute écriture dont le contrôle a lieu après la fermeture est refusée
(`409 PERIOD_LOCKED`). Preuves : `tests/concurrency/http-concurrency.test.ts`, **3 cas**
déterministes ; neutraliser chaque garde fait échouer son cas.

## Routes anonymes et CSRF (A-27)

Le middleware CSRF vérifie **l'origine** de toute mutation, avec ou sans session : une requête
d'une autre origine est refusée (`403 CSRF_ORIGIN`). Le jeton (`x-csrf-token`, comparé au cookie
`mg_csrf` et au secret de session en temps constant) n'est exigé que lorsqu'un cookie de session
est présent. Les mutations anonymes — `/install`, `/recover-owner`, `/login`, mot de passe
oublié/réinitialisé — n'ont donc pas de jeton à présenter : elles reposent sur le contrôle
d'origine, la limitation de débit (A-20/A-23) et, pour `recover-owner`, un jeton à usage unique.
C'est une limite assumée, écrite aussi dans `build/PENDING.md` (L-13).

## Tests d'intégration HTTP (A-26)

`tests/integration/p0-http.test.ts` exerce le vrai worker sur une base D1 locale migrée, recréée
pour chaque cas. Les fixtures sont **synthétiques** (`example.test`, `10.6.0.x`) : aucun e-mail,
jeton, identifiant, chemin ni adresse réelle n'est écrit dans un test ou un journal. Les cas
d'intégration vérifient aussi les refus (403, 404, 409) et les effets persistés.
