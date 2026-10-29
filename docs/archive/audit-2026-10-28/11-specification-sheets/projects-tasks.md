# Build spec — Projects (« Projets ») & Tasks (« Tâches »)

## 1. Menu tree
Opérations → **Projets** (list) → project detail (with its tasks). Opérations → **Tâches** (global task list). Quick-add "+" → Projet / Tâche.

## 2. Module contents
- **Project list**: columns nom, client, statut (actif/terminé/archivé), budget, échéance; filters (client/statut); row actions: voir, modifier, supprimer (owner/admin).
- **Project form**: nom (required), client (optional), description, budget HT, date de début, échéance, statut.
- **Project detail**: task list grouped by statut; totals — budget vs heures facturées (sum of billable minutes × hourly rate of done tasks); client card link.
- **Task list (global)**: columns titre, projet, client, statut (à faire/en cours/terminé), durée, facturable; filters (statut/projet/facturable); quick status change.
- **Task form**: titre (required), projet (optional), client (optional), description, statut, durée en minutes, taux horaire, facturable (default true — seed evidence).

## 3. Rules (GIVEN/WHEN/THEN)
- GIVEN billable done task WHEN "facturer les tâches sélectionnées" (R2) runs THEN the draft invoice gains one line per task (description + duration + rate), tasks stamped invoice_id and can no longer be re-invoiced (server field exists — `01` MG-PRJ; the pick-and-add UI is the R2 gap).
- GIVEN archived project WHEN a new task is created THEN allowed with a warning (level decided at build).
- GIVEN task deleted WHEN project totals recompute THEN hours/budget sums update.

## 4. Verdicts (per 05)
Projects/tasks CRUD: `CONFORMING` `[OBSERVED]`. Kanban board: `MISSING` (R2 — BK-013). Invoice-billable-tasks flow: `PARTIAL` (schema support exists, UI flow R2).
