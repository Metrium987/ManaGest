# Build spec — Audit journal (« Journal d'activité ») & accounting periods (« Clôtures »)

## 1. Menu tree
Administration → **Journal d'activité** (list + verify). Paramètres → **Clôtures** (section of settings; accountant+).

## 2. Journal
- **List** (permissions: activity.read — owner/admin/accountant): columns date/heure, utilisateur, action, entité, résumé (French via `activity.*` keys), IP; per-entry viewer: before/after JSON diff (human-readable fields); filters (utilisateur/action/entité/période); download CSV (R1 export rule).
- **Verify button**: "Vérifier l'intégrité" → recomputes the hash chain (prev_hash/hash) and reports ok/broken + first failing entry; legacy rows (pre-chain seed) are skipped gracefully (`[EXECUTED]`).

## 3. Periods (owner-relevant control, `ADDITION` beyond baseline)
- **Close**: month picker (YYYY-MM), optional note → period_locks row + audit entry.
- **Behaviour when closed**: creating/altering any document dated inside is refused 409 `PERIOD_LOCKED` for invoices, credits, payments, expenses, recurring runs `[EXECUTED all four types + recurring rule]`; dashboards/reports still read.
- **Reopen**: explicit administrative action (owner/admin/accountant), reason recorded in the journal.
- Guard applies also to re-dating a document out of/into a closed month (`assertPeriodOpen` takes both dates — `server/lib/locks.ts:26-49`).

## 4. Rules (GIVEN/WHEN/THEN)
- GIVEN closed 2026-05 WHEN invoice dated 2026-05-12 created THEN refused naming the month.
- GIVEN closed 2026-05 WHEN invoice dated 2026-04-30 re-dated into 2026-05 THEN refused (touching dates guarded).
- GIVEN chain intact WHEN verify THEN ok + count.
- GIVEN sales role WHEN close attempted THEN 403.

## 5. Verdicts (per 05)
Journal with diffs/IP/chain: `CONFORMING` core + cryptographic chain `ADDITION`. Period close/reopen: `ADDITION` (baseline document-level locks only — retained deliberately, owner-backed per FRD).
