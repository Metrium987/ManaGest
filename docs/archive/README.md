# Archives

Ce dossier ne contient que des documents **figés**. Rien ici n'est mis à jour : ce sont des
pièces datées, conservées pour la traçabilité.

| Dossier | Contenu | Pourquoi il est là |
|---|---|---|
| `specifications/` | Les 19 documents de spécification d'origine (catalogue de modules, définitions d'entités, 17 FRD) | Source des exigences. Ils encombraient la racine du dépôt ; ils restent la référence de ce qui a été demandé, pas de ce qui est livré. |
| `audit-2026-10-28/` | L'audit daté du 28 octobre : inventaires, matrice de parité, règles métier, fiches de spécification, extraits de données, questions ouvertes (47 fichiers) et **`AUDIT.md`**, l'état des lieux d'origine (archivé le 6/11/2026) | Ses constats ont été traités ou requalifiés depuis. Les §5 et §6 d'`AUDIT.md` sont **périmés** : les **26 tables** et **28 index** qu'ils annoncent sont à comparer aux **89 tables et 89 index** constatés dans l'audit du 6 novembre, et des modules qui y sont listés comme manquants sont livrés. Ne pas s'y fier, lire l'audit du 6 novembre. Les renvois internes des fichiers citent encore l'ancien chemin `docs/audit/…`. |
| `build-reports/` | Rapports de module M0 → M10 et rapport de palier R1 | Preuves d'exécution des phases passées, pas un état courant. |
| `build-2026-11/` | TODO clos, plan A-01…A-31, build plan, traçabilité, revue d'architecture, questions ouvertes et fiches module M0–M12 | Documents d'exécution figés après la clôture de toutes les tâches ; le plan d'action de production et l'audit de préparation les remplacent. |

## Où lire l'état réel

- **Ce qui est livré et ce qui reste à faire** : [`../AUDIT-PRODUCTION-READINESS-2026-11-06.md`](../AUDIT-PRODUCTION-READINESS-2026-11-06.md) et le [plan d'action](../build/PLAN-ACTION-PRODUCTION-2026-11-06.md), avec le constat technique daté [`../AUDIT-2026-11-06.md`](../AUDIT-2026-11-06.md).
- **Ce qui reste suspendu, différé ou non vérifié** : [`../build/PENDING.md`](../build/PENDING.md) — registre unique.
- **Journal des changements** : [`../build/CHANGELOG.md`](../build/CHANGELOG.md).

Règle : un document périmé déménage ici, il n'est ni réécrit ni supprimé. Un document vivant
reste dans `docs/` ou `docs/build/`.
