# ManaGest

**ERP de gestion pour les entreprises de Polynésie française.**

ManaGest réunit la facturation, les devis, les encaissements, la trésorerie et le pilotage
d'activité dans une interface unique, en français, pensée pour les usages locaux :
franc Pacifique (XPF, sans décimale), TVA polynésienne (5 %, 13 %, 16 %), numéro TAHITI,
fuseau `Pacific/Tahiti` (UTC−10) et mentions légales adaptées.

> Le code source est intégralement en anglais (identifiants, tables, API).
> Toute la documentation et tous les textes affichés à l'utilisateur sont en français.

---

## 1. Fonctionnalités

| Domaine | Modules |
|---|---|
| **Commercial** | Clients et contacts, devis (envoi, acceptation, refus, conversion), factures, avoirs, factures récurrentes |
| **Encaissements** | Paiements avec affectation automatique ou manuelle, règlement direct d'une facture, rapprochement bancaire |
| **Achats** | Fournisseurs, bons de commande, dépenses catégorisées |
| **Produits** | Catalogue, prix de vente et coût, suivi de stock |
| **Projets** | Projets, budget, tâches, temps facturable |
| **Analyse** | Tableau de bord, chiffre d'affaires, résultat, TVA collectée, balance âgée, ventes par client, dépenses, export CSV |
| **Administration** | Paramètres société, numérotation, taux de TVA, rôles et permissions, journal d'audit, sessions |
| **Sécurité** | Mots de passe PBKDF2, sessions opaques, CSRF, contrôle d'origine, limitation des tentatives, CSP, en-têtes de sécurité |

### Cycle de vie d'une facture

`Brouillon → Envoyée → Partielle → Payée` avec annulation possible tant qu'aucun
paiement n'est appliqué. Le solde et le statut sont **recalculés depuis les affectations
de paiement**, jamais saisis à la main, ce qui évite les dérives comptables.

### Calcul des montants

Un moteur unique (`shared/tax.ts`) est partagé par l'API et l'interface :

1. totaux de ligne : `prix unitaire × quantité` ;
2. remise globale répartie **au prorata** sur chaque ligne ;
3. TVA calculée par ligne, agrégée par taux ;
4. total = sous-total − remise + TVA.

Les montants sont stockés en **entiers** (unités mineures), jamais en flottants.
Pour le XPF, l'unité mineure est le franc : `1 500` représente 1 500 F CFP.

---

## 2. Spécificités polynésiennes

| Élément | Valeur retenue |
|---|---|
| Devise | `XPF` — 0 décimale |
| TVA | 16 % (normal), 13 % (intermédiaire), 5 % (réduit), exonération |
| Régime | Assujetti ou **franchise en base** (mention automatique sur les documents) |
| Identifiant | **Numéro TAHITI** : une lettre + 5 chiffres (ex. `T12345`) |
| Registre | RCS Papeete |
| Fuseau | `Pacific/Tahiti` (UTC−10), stockage UTC |
| Format de date | JJ/MM/AAAA à l'affichage, ISO en base |
| Retard de paiement | Pénalité 10 % + indemnité forfaitaire de 5 000 F CFP (paramétrable) |
| Facturation électronique | Pas de mandat Factur-X/PPF pour les opérations locales ; la conformité métropolitaine éventuelle reste à traiter séparément |

Sources vérifiées : DICP (`service-public.pf`), ISPF, CCISM, OPH.
Voir [`docs/CONFORMITE.md`](docs/CONFORMITE.md).

---

## 3. Stack technique

- **Interface** : React 19, TypeScript, Vite, Tailwind CSS 4, TanStack Query, React Router.
- **API** : Hono sur **Cloudflare Workers**.
- **Base** : **Cloudflare D1** (SQLite), schéma idempotent appliqué au premier démarrage.
- **PDF** : `pdf-lib`, généré côté Worker (aucun service externe).
- **Tests** : Vitest (moteur fiscal, statuts, permissions, dates, politique de mots de passe).

```
shared/        Domaine partagé (constantes, monnaie, TVA)
server/        Worker : routes, services, schéma D1, PDF, sécurité
src/           Application React : pages, composants, i18n français
tests/         Tests unitaires
docs/          Documentation fonctionnelle et technique (français)
```

Le serveur suit une séparation stricte : **routes** (HTTP et validation) →
**services** (règles métier) → **accès D1**. Les modules sont indépendants et
peuvent évoluer sans impacter les autres.

---

## 4. Démarrage local

Prérequis : Node.js ≥ 20.19, npm.

```bash
npm install

# Terminal 1 — API locale (D1 émulée par Wrangler, port 8787)
npm run dev:api

# Terminal 2 — interface (port 3000, proxy /api vers 8787)
npm run dev
```

Ouvrir <http://localhost:3000>. Au premier accès, ManaGest propose
l'**assistant d'installation** : société, compte administrateur, préférences,
et éventuellement un jeu de données de démonstration.

### Scripts

| Commande | Rôle |
|---|---|
| `npm run dev` | Interface Vite avec proxy API |
| `npm run dev:api` | Worker + D1 locale |
| `npm run typecheck` | Vérification TypeScript (client + serveur) |
| `npm test` | Tests unitaires Vitest |
| `npm run build` | Build de production (client + Worker) |
| `npm run preview` | Build puis Worker local |

### Hébergement (Freebuff Sites)

ManaGest est hébergé sur Freebuff Sites : le Worker Hono sert l'API et les fichiers
statiques du build Vite, et la base est une **D1** attachée au Worker sous le binding
`DB`. Le schéma est créé automatiquement à la première requête API : aucune migration
manuelle n'est nécessaire.

- Manifeste de déploiement : [`deploy.json`](deploy.json)
- Environnements : `preview` et `production`, chacun avec sa propre base D1
- Commande : `npm run build`, puis déploiement du manifeste depuis Freebuff

L'environnement de prévisualisation est volontairement livré **non configuré** :
il affiche l'assistant d'installation au premier accès.

---

## 5. Rôles

| Rôle | Portée |
|---|---|
| **Propriétaire** | Tous les droits, y compris la gestion des utilisateurs |
| **Administrateur** | Tous les modules, paramètres inclus |
| **Comptable** | Documents financiers, dépenses, banque, rapports |
| **Commercial** | Clients, devis, factures, paiements, abonnements |
| **Lecture seule** | Consultation uniquement |

Les permissions sont vérifiées **côté serveur** à chaque requête ; l'interface ne fait
que masquer les actions non autorisées. Voir [`docs/SECURITE.md`](docs/SECURITE.md).

---

## 6. Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — structure, flux de données, modules.
- [`docs/SECURITE.md`](docs/SECURITE.md) — authentification, sessions, CSRF, limites connues.
- [`docs/CONFORMITE.md`](docs/CONFORMITE.md) — TVA, mentions légales, sources.
- [`docs/UTILISATION.md`](docs/UTILISATION.md) — prise en main pas à pas.
- [`docs/AUDIT.md`](docs/AUDIT.md) — état des lieux, couverture des modules et feuille de route.

---

## 7. Accessibilité

- Structure sémantique : en-tête, navigation, `main`, saut de contenu.
- Formulaires : libellés associés, erreurs annoncées (`role="alert"`), champs obligatoires signalés.
- Dialogues : piège de focus, fermeture par `Échap`, restitution du focus.
- Contrastes conformes AA, focus visible, respect de `prefers-reduced-motion`.
- Tableaux avec en-têtes de colonnes et résumés accessibles pour les graphiques.

---

## 8. Licence et état

Version 1.0 — périmètre fonctionnel complet pour une PME polynésienne.
Les intégrations externes (SMTP, passerelles de paiement, Peppol) sont volontairement
hors périmètre de cette version et peuvent être ajoutées comme modules indépendants.
