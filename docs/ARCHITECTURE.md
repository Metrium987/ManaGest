# Architecture de ManaGest

## 1. Vue d'ensemble

ManaGest est une application **mono-déploiement, multi-utilisateurs**. Un déploiement
héberge une société, ses utilisateurs et ses données. L'interface et l'API sont servies
par le même Worker Cloudflare : les fichiers statiques sont renvoyés par le binding
`ASSETS`, l'API est montée sous `/api`.

```
Navigateur
   │  HTTPS, cookie de session HttpOnly, jeton CSRF
   ▼
Worker Hono ──► middleware (sécurité, base, authentification, permissions)
   │
   ├─► routes      validation Zod, codes d'erreur stables
   ├─► services    règles métier (documents, PDF, sessions, démonstration)
   └─► D1          SQL préparé, schéma idempotent
```

Aucune donnée métier n'est stockée dans le navigateur. Les montants, statuts et soldes
sont calculés côté serveur.

## 2. Organisation du code

| Dossier | Contenu |
|---|---|
| `shared/` | Domaine commun : rôles, permissions, statuts, taux de TVA, devises, moteur de calcul |
| `server/db/` | Schéma D1, provisionnement, helpers typés |
| `server/lib/` | Cryptographie, monnaie, TVA, dates, numérotation, validation, erreurs, audit |
| `server/services/` | Documents, statuts, PDF, sessions, données de démonstration |
| `server/routes/` | Un routeur par domaine fonctionnel |
| `src/features/` | Pages React regroupées par module |
| `src/components/` | Bibliothèque UI (boutons, formulaires, dialogues, tableaux, graphiques) |
| `src/lib/` | Client API, session, formats, types, traduction |

### Règle de dépendance

`features → components → lib → shared` et `routes → services → lib → shared`.
Une page n'accède jamais directement à la base ; elle passe par l'API.
Le calcul financier est partagé (`shared/tax.ts`) pour que l'aperçu client et
l'enregistrement serveur donnent **exactement** le même résultat.

## 3. Modèle de données

Tables principales :

- `company` : identité, paramètres, coordonnées bancaires, sécurité des sessions ;
- `users`, `sessions`, `login_attempts` : accès et traçabilité ;
- `clients`, `client_contacts` ;
- `invoices`, `quotes`, `credits`, `recurring_invoices` ;
- `payments`, `payment_allocations`, `credit_allocations` ;
- `products`, `tax_rates`, `number_sequences` ;
- `vendors`, `purchase_orders`, `expenses` ;
- `projects`, `tasks` ;
- `bank_accounts`, `bank_transactions` ;
- `activities` : journal d'audit append-only.

### Choix structurants

1. **Montants entiers.** Toutes les colonnes monétaires sont des entiers en unités
   mineures. Aucun flottant, donc aucune dérive d'arrondi.
2. **Lignes en JSON.** Les lignes de document sont stockées en JSON, comme dans la
   référence Invoice Ninja, ce qui préserve l'historique du libellé et du prix au moment
   de l'émission.
3. **Soldes recalculés.** `paid_total` et `balance` sont recalculés depuis
   `payment_allocations` et `credit_allocations` après chaque opération
   (`recalcInvoice`). Le statut en découle.
4. **Suppression logique.** `deleted_at` protège l'audit ; les numéros ne sont jamais réutilisés.
5. **Numérotation atomique.** `INSERT … ON CONFLICT … RETURNING` garantit l'unicité
   des numéros même en cas de requêtes concurrentes.

## 4. Cycle de vie des documents

### Facture

- Création en `draft`, numéro attribué immédiatement (comportement `when_saved`).
- `send` : `draft → sent`, horodatage.
- Paiement : `sent → partial → paid` selon les affectations.
- `cancel` : interdit si un paiement est appliqué ; solde ramené à zéro.
- `duplicate` : recopie les lignes dans un nouveau brouillon.

### Devis

`draft → sent → approved | rejected → converted`. La conversion crée un brouillon de
facture et lie les deux documents. Un devis converti ou refusé est verrouillé.

### Avoirs

Créés en brouillon, envoyés, puis appliqués à une facture du même client.
Le solde disponible est recalculé depuis les affectations.

### Abonnements

Un modèle récurrent porte les lignes, la fréquence, la date de prochaine exécution et
le nombre de cycles. « Générer maintenant » produit une facture, avance la date et
décrémente les cycles ; l'abonnement se termine à zéro cycle ou à la date de fin.

## 5. API

Toutes les routes sont sous `/api`. Les mutations exigent le jeton CSRF et une origine
identique. Les erreurs renvoient un **code stable** (`INVOICE_HAS_PAYMENTS`,
`AMOUNT_EXCEEDS_BALANCE`, etc.) traduit côté interface ; aucune prose technique n'est
exposée.

| Méthode | Exemple | Rôle |
|---|---|---|
| `GET` | `/api/invoices?status=sent&page=1` | Liste paginée |
| `POST` | `/api/invoices` | Création (brouillon) |
| `PATCH` | `/api/invoices/:id` | Modification contrôlée |
| `POST` | `/api/invoices/:id/send` | Transition d'état |
| `GET` | `/api/invoices/:id/pdf` | PDF bilingue FR, `application/pdf` |
| `GET` | `/api/reports/tax?from=…&to=…` | Rapport TVA |

## 6. Interface

- **Coquille** : barre latérale sombre groupée par domaine, barre supérieure avec
  recherche globale, menu utilisateur, accès rapide à la création de facture.
- **Composants** : tableaux denses, badges de statut, cartes d'indicateurs, graphique
  de facturation/encaissement, formulaires en deux colonnes avec panneau de totaux.
- **Langue** : tous les libellés passent par `src/lib/i18n.ts`. Aucun texte français
  n'est écrit en dur dans les composants.
- **Accessibilité** : voir le README, section 7.

## 7. Déploiement

Le build produit :

```
dist/client/       fichiers statiques (HTML, JS, CSS, polices)
dist/worker/index.js   Worker ES module (API + fallback ASSETS)
```

Le Worker est déployé sur Freebuff Sites avec un binding D1 `DB`. Le schéma est appliqué
au premier appel (`ensureSchema`), puis mémorisé par isolate. Aucune étape de migration
manuelle n'est nécessaire.

Pour un déploiement hors Sites, fournir un binding D1 nommé `DB` et un binding
`ASSETS` (ou servir `dist/client` séparément).
