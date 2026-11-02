# H5 — contrôles hébergés : ce que je veux, à quoi ça sert, comment le faire

**2 novembre 2026.** Le code des contrôles hébergés est livré et prouvé localement.
Ce document dit exactement ce qui manque côté GitHub, pourquoi je ne peux pas le
créer moi-même, et la procédure à suivre (interface web ou `gh`).

## 1. Ce que je peux faire et ce que je ne peux pas

| Action | État | Preuve |
|---|---|---|
| Lire, récupérer et pousser des commits sur le dépôt | **possible** (connexion GitHub du projet, sans force-push) | `cloud_git fetch` / `push` |
| Créer les **secrets Actions** du dépôt | **impossible** | `gh auth status` → « not logged into any GitHub hosts » ; aucune variable `GH_TOKEN` ni `GITHUB_TOKEN` dans l'environnement ; la connexion du projet ne porte pas le droit `secrets:write` |
| Lancer le workflow | **impossible** tant que 2 et 3 ci-dessous ne sont pas faits | un `workflow_dispatch` n'existe que sur la branche par défaut, et sans secrets le job sort en **code 2** |
| Vérifier le quota D1 / republier la preview | **impossible** ici | quota `dailyD1Writes` atteint, remise à zéro le 3/11/2026 00:00 UTC |

Autrement dit : je ne peux pas écrire un secret, et c'est volontaire — un secret
est en écriture seule chez GitHub, personne ne peut le relire, moi compris. Les
valeurs doivent donc être saisies par vous, une fois.

## 2. Ce que je veux, précisément

Trois secrets de dépôt, et rien d'autre :

| Secret | Contenu attendu | À quoi il sert exactement |
|---|---|---|
| `PREVIEW_URL` | l'**origine** de la preview dédiée, par exemple `https://managest-preview.exemple.pf` (pas de chemin, pas de `/` final) | base de tous les appels HTTP des quatre scripts de contrôle |
| `PREVIEW_EMAIL` | le courriel d'un **compte de test en lecture seule** créé pour l'occasion | connexion de `check-screens.py`, `check-c2-e2-h2.py`, `check-h1-permission.py`, `check-planning-sla.py` |
| `PREVIEW_PASSWORD` | le mot de passe de ce compte | même chose ; jamais dans le dépôt, jamais dans un journal |

Pourquoi un compte dédié : les contrôles **se connectent réellement** et lisent des
écrans (tableau de bord, produits, C2/E2/H2, permissions H1, planning/SLA). Un
compte administrateur y donnerait des droits inutiles ; un compte en lecture seule
suffit et n'écrit rien.

## 3. Pourquoi ces trois-là et pas une URL publique

Les quatre scripts ne se contentent pas de vérifier qu'une page répond `200` : ils
ouvrent une session, lisent des tableaux et comparent des valeurs. Sans
identifiants, ils ne peuvent rien prouver. C'est aussi pourquoi la configuration est
**obligatoire** et vérifiée avant l'exécution : `scripts/check-preview-config.mjs`
refuse de continuer avec le **code de sortie 2** et nomme les variables manquantes,
ce qui distingue « mal configuré » de « contrôle rouge ».

## 4. Comment le faire — interface web (2 minutes)

1. Ouvrir le dépôt `Metrium987/ManaGest` sur GitHub.
2. **Settings → Secrets and variables → Actions → New repository secret**.
3. Créer les trois secrets du tableau ci-dessus, un par un.
4. Vérifier que le fichier `.github/workflows/preview-checks.yml` est bien sur la
   **branche par défaut** : `workflow_dispatch` et `repository_dispatch` ne sont
   proposés que depuis la branche par défaut. Il est aujourd'hui sur la branche
   `freebuff/a6f86ced7cc9d3ad744d42ee` ; il faut donc la fusionner (ou pousser le
   fichier) sur `main`.
5. **Actions → Hosted preview checks → Run workflow**.

## 5. Comment le faire — `gh` en ligne de commande

```bash
# une fois, sur une machine où vous êtes authentifié sur GitHub
gh auth login

gh secret set PREVIEW_URL      --repo Metrium987/ManaGest --body 'https://<origine-de-la-preview>'
gh secret set PREVIEW_EMAIL    --repo Metrium987/ManaGest --body '<compte-de-test>'
gh secret set PREVIEW_PASSWORD --repo Metrium987/ManaGest --body '<mot-de-passe>'

gh workflow run 'Hosted preview checks' --repo Metrium987/ManaGest
gh run watch --repo Metrium987/ManaGest
```

Pour vérifier seulement les noms (les valeurs ne sont jamais relisibles) :

```bash
gh secret list --repo Metrium987/ManaGest
```

## 6. Effet attendu, et ce qui se passe sans les secrets

| Situation | Résultat |
|---|---|
| secrets absents | le job s'arrête à l'étape « Check the hosted checks are configured », **code 2**, message nommant `PREVIEW_URL`, `PREVIEW_EMAIL`, `PREVIEW_PASSWORD` |
| secrets présents, preview indisponible | les scripts échouent en **code 1** avec l'URL en cause — un vrai rouge, pas une erreur de configuration |
| secrets présents, preview disponible | les quatre contrôles s'exécutent ; un échec est **signalé sans bloquer** le déploiement (décision du 2/11/2026) |

Déclenchement automatique facultatif : un crochet de déploiement peut envoyer un
`repository_dispatch` de type `preview-deployed` ; le job se lance alors après
chaque publication.

## 7. Variante locale, sans GitHub

Si vous voulez voir les contrôles tourner tout de suite, sans attendre les secrets :

```bash
# .env non suivi par git
PREVIEW_URL=http://localhost:8787
PREVIEW_EMAIL=<compte de test local>
PREVIEW_PASSWORD=<mot de passe local>

set -a; . ./.env; set +a
npm run check:preview:hosted
```

C'est exactement ce que fait le job, à l'URL près. Sans les variables, la commande
sort en **code 2** et nomme ce qui manque.

## 8. Ce qu'il reste après cette étape

Rien côté code : le workflow, le garde-fou de configuration, les quatre scripts et
leurs tests sont livrés (`tests/ui-preview-config.test.ts`). Il reste uniquement
les trois valeurs ci-dessus, la preview dédiée, et le quota D1 pour la publication.
