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
| Sauvegardes | Activer les sauvegardes D1 et tester la restauration |
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
