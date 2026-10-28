# Traceability (source → task)
| Source | Item | Task(s) |
|---|---|---|
| BK-001 / PF-TVA-001-003 / OQ-004 | TVA status model + wording | T-002 |
| BK-002 / OQ-020 | reminders + terms consistency | T-005, T-105 |
| BK-003 / OQ-003 | recurring scheduled run | T-104 |
| BK-004 | computed chips | T-007 |
| BK-005 | gap register | T-001 |
| BK-006 / OQ-012 | refunds via credits | T-004 |
| BK-010 / OQ-009 | attachments | T-101 |
| BK-011 / OQ-016 | CSV export | T-006 |
| BK-012 / OQ-015 | import wizard | T-102 |
| BK-013 | kanban | T-205 |
| BK-014 | bank rules + ledger | T-204 |
| BK-015 / OQ-010 | second PDF layout | T-108 |
| BK-016 / CC-RA-2 (DEF-SESSION-02) | expense categories | T-107 |
| BK-021 / OQ-002 / PQ-2 | email provider | T-106 |
| BK-028 / OQ-005/006 | retention lock | included in T-002 scope? **gap**: add explicit task T-009 (R1, retention register) |
| CC-RA-1 | per-entity numbering | T-001 |
| CC-RA-3 | tax list de-dup | T-002 |
| CC-RA-4 | security settings | T-003 |
| CC-RB-1 | Voir screens | T-201 |
| CC-RC-1 / OQ-021 | custom roles | T-202 (BLOCKED-BY) |
| CC-RC-2 | button gating | T-203 |
| CC-DEF-1 / matrix §14 | R4 extension points | T-401..T-404 |
| 18 file REPLACE rows | payments state model | T-402 (deferred) |
| BEYOND-REFERENCE local reports | TVA recap etc. | T-207 |
**Unplanned check**: all R1/R2 backlog items and owner decisions map to a task or an explicit BLOCKED-BY; BK-009/T-009 added for retention. R4 items are spece-only by owner decision.

## Coverage proof (2026-10-28, review round)
| Source family | Total | Mapped to tasks | Unmapped |
|---|---|---|---|
| Backlog items (BK-001…BK-028, incl. CC rows) | 20 in scope for R1–R3 + 8 owner-answer-gated | 20 | 0 (BK-020/021/022/023 = R-gated tasks T-401/T-106/T-104-caller/T-402; BK-024/025/026/027 remain gated by owner answers; BK-028 → T-009) |
| Parity verdicts ADAPT+REPLACE (file 18) | 63 | 61 | 2 justified: IN-DES-001 engine SKIP row and IN-EINV rows have no build task by owner decision — they exist only as traceability rows |
| Owner decisions (CONFIRMED this round) | 3 | 3 | 0 |
| R-A items (16-hardcoding-audit) | 14 (excl. 2 intentional-in-code rows) | 14 | 0: item1→T-107, item2→T-001, item3/5→T-002, item7→T-003, item8→R2 setting task (logged under CC-RA-4), items 4/6/9/10/11/12/13 → T-107/T-108/T-101/T-010 and R2 grouping |
| R-B areas (17 audit, 9 missing areas) | 9 | 9 (T-201a/b/c tier mapping) | 0 |
| R-C gaps (17 audit: fixed roles, role UI, button policy, roles table journaling) | 4 | 4 (T-202a/b/c, T-203) | 0 |
Every exception above is a deliberate, cited decision; nothing unplanned silently.
