# Archives

Ce dossier ne contient que des documents **figés**. Rien ici n'est mis à jour : ce sont des
pièces datées, conservées pour la traçabilité.

| Dossier | Contenu | Pourquoi il est là |
|---|---|---|
| `specifications/` | Les 19 documents de spécification d'origine (catalogue de modules, définitions d'entités, 17 FRD) | Source des exigences. Ils encombraient la racine du dépôt ; ils restent la référence de ce qui a été demandé, pas de ce qui est livré. |
| `audit-2026-10-28/` | L'audit daté du 28 octobre : inventaires, matrice de parité, règles métier, fiches de spécification, extraits de données, questions ouvertes (47 fichiers) | Ses constats ont été traités ou requalifiés depuis. Les renvois internes des fichiers citent encore l'ancien chemin `docs/audit/…`. |
| `build-reports/` | Rapports de module M0 → M10 et rapport de palier R1 | Preuves d'exécution des phases passées, pas un état courant. |

## Où lire l'état réel

- **Ce qui est livré et prouvé** : [`../AUDIT.md`](../AUDIT.md) §10, et [`../build/TODO.md`](../build/TODO.md).
- **Ce qui reste suspendu, différé ou non vérifié** : [`../build/PENDING.md`](../build/PENDING.md) — registre unique.
- **Journal des changements** : [`../build/CHANGELOG.md`](../build/CHANGELOG.md).

Règle : un document périmé déménage ici, il n'est ni réécrit ni supprimé. Un document vivant
reste dans `docs/` ou `docs/build/`.
