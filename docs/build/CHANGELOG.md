## 2026-10-28 — build planning created (no code changed)
BUILD-PLAN, TODO (23 tasks + 4 R4 spec rows), module files M0-M12, VERIFICATION-GATES, TRACEABILITY, PLAN-OPEN-QUESTIONS.

## 2026-10-28 — plan review applied + M0 pilot executed
- T-000 backup task DONE (commit fb542f5 + D1 export + verified scratch restore).
- L/XL tasks split (T-002→4, T-102→3, T-104→3, T-201→3, T-202→3); new counts: R1 12, R2 13, R3 16 incl. new tasks; R4 4 spec rows; total 45.
- English variant rolled out: 'ui_language' setting (fr|en), variant = setting; full translation file task T-010 tracked.
- Owner answers recorded (OQ-021, locations, multi-company prep = CONFIRMED; override welcome).
- Coverage proof added to TRACEABILITY.md (0 unmapped, 2 justified exceptions).
- M0 built and verified: per-entity numbering + placeholder validation + gap register; TVA status model (unit tested); retention guard (live 409); settings extras; schema v4 additive migration. 49/49 unit tests; typecheck + build clean; live negative permission tests 403/manual fallbacks.
- Module report: docs/build/reports/M0.md. STOP after M0 per owner instruction — awaiting approval for M1.

## 2026-10-28 — M1 permissions core (T-008) DONE
- Static route-guard + role-matrix invariant tests; no unguarded route; live negative walk executed; full suite 3 files green; typecheck/build clean. Report: docs/build/reports/M1.md. STOP before M2 per protocol.
