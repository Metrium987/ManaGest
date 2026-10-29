# ManaGest — Master TODO (orders, gates in VERIFICATION-GATES.md; status updated 2026-10-28: T-000, T-001, T-002a, T-003, T-006, T-009 DONE (M0 pilot); L/XL tasks split)

Legend: Eff S/M/L/XL; status TODO|IN PROGRESS|DONE|BLOCKED; every row cites evidence.

## R1 — Foundations & compliance (startable now)
| ID | Title | Module | Evidence | Deps | Blockers | Eff | Gate |
|---|---|---|---|---|---|---|---|
| T-000 | Baseline backup: code checkpoint + full D1 data export + restore test on scratch | M0 | owner review #4 | — | — | S | DONE (commit fb542f5; scratch restore verified 71 inv / 36 cli / 388 act) |
| T-001 | Per-entity numbering: editable pattern+prefix per document type (FAC/DEV/AV/REG stored, gap register) | M0 | CC-RA-1; BK-005 | — | — | M | DONE (server API + register + placeholder validation; admin UI screen part of T-201c sweep) |
| T-002a | TVA status model: LineItem.tax_status + exempt handling in computeTotals + line schema | M0 | BK-001 | T-001 | — | S | DONE (4 unit tests) |
| T-002b | Tax-status wording on invoice/quote PDF and exports | M4 | BK-001 | T-002a | accountant confirm | S | DONE for invoice PDF + reports; quote PDF NOT FOUND as a feature (quotes have no PDF output at all — logged) |
| T-002c | Line editor UI field for tax_status | M4 | sheet invoices; R-A | T-002a | — | S | DONE (per-line taxable/exempt selector; live: exempt line produced no VAT bucket) |
| T-002d | Reports: exempt lines without 0% bucket | M10 | BK-001 | T-002a | — | S | DONE (tax report splits taxable base and exempt base; 0% rows filtered; live summary verified) |
| T-003 | Settings: extras KV (retention, ui_language variant); timezone/footer/session fields verified already in UI | M0 | 12-settings-coverage; CC-RA-4 | — | — | S | DONE (login-attempts setting stays R2) |
| T-004 | Refunds via credit notes: reverse allocation flow (no separate refund flow) | M4 | BK-006; OQ-012 | T-002 | — | M | DONE (refund ceiling helper + 409 guard; "Établir un avoir" modal on invoice detail; live 201 avoir AV-2026-0026 / 409 over-ceiling / 422 zero; 65 tests) |
| T-005 | Manual reminders + terms/behaviour consistency (no phantom late fee, OQ-020) | M4 | BK-002 (manual part); OQ-020 | T-002 | scheduled part → R2 | S | DONE manual half (Relancer action on overdue invoices, journalled; default terms rewritten truthfully); automatic reminders R2 |
| T-006 | In-app CSV export of every list with round-trip headers | M7 | BK-011 (R1 scope per OQ-016 owner answer); import-export sheet | T-001 | — | S | DONE (7 list pages wired; live 200 CSV + journal + viewer-read matrix; route-guard test extended with documented handler-level check; 61 tests green) |
| T-007 | Overdue/computed status chips (expired quote) list/detail | M4 | BK-004 | T-002 | — | S | DONE (computed `expired` flag in quote API, chips on list and detail; overdue already computed for invoices; live flags verified) |
| T-009 | Retention: issued-doc delete guard + gap register + configurable years | M0 | OQ-005/006; BK-028 | T-001 | accountant confirm | M | DONE (live 409 evidence) |
| T-008 | Permissions: server checks sweep + audit test helper (fixed roles) | M1 | CC-RC (enforcement part); 17 §R-C | — | — | M | DONE (invariant + matrix tests; live negatives incl. 403s; no unguarded route) |

## R2 — Productivity & platform-dependent
| ID | Title | Module | Evidence | Deps | Blockers | Eff | Gate |
|---|---|---|---|---|---|---|---|
| T-101 | Attachments: R2 bucket binding + uploads for receipts/proofs (configurable size, default 10 MB) | M6 | BK-010; OQ-009 (owner-accepted) | T-003 | PQ-3 (ceiling display) | M | G-R2.1 |
| T-102a | Import backend: upload/parse/validate/commit (CSV, transactional) | M7 | OQ-015 | T-006 | — | M | DONE (template/columns/preview/commit endpoints; 11 parser+validation tests; live 401 anon, 422 missing column, 409 invalid rows, 201 create/update, journal) |
| T-102b | Import wizard UI: templates, preview, row errors, result report | M7 | OQ-015 | T-102a | — | M | DONE (5-step page at /importer, nav « Importer des données »; template download, file or paste, per-row create/update + French issues, explicit exclude-invalid consent, result report; typecheck/build/tests green, browser render not verified) |
| T-102c | Import invoices entity (per OQ-015, last) | M7 | OQ-015 | T-102b | — | M | DONE (one row per line item, grouped by number; client resolved by email/number/name; header conflicts, unknown client and existing number refused; live: 2 lines → 1 draft FAC-2026-9001 total 80 040, duplicate 409; export now line-per-row round-trip) |
| T-103 | Public per-document links (token/expiry/revocation/log) + accept-quote action | M4 | OQ-001 interim; portal sheet security rows | T-008 | — | M | G-R2.3 |
| T-104a | Daily-run endpoint: bearer secret + rate limit + Tahiti-day idempotency | M5 | OQ-003 | T-005 | — | M | TODO |
| T-104b | Run pipeline: recurring + reminders + journal + stored result | M5 | BK-003 | T-104a | — | M | TODO |
| T-104c | Dashboard last-run card + manual run button | M5 | OQ-003 spec 5-6 | T-104b | — | S | TODO |
| T-105 | Reminders automated part (via T-104 pipeline) | M5 | BK-002 | T-104 | — | S | G-R2.5 |
| T-106 | Email: manual fallback done in R1 — provider option per PQ-2 answer (provider key in Secrets) | M11 | BK-021; OQ-002 | T-104 | PQ-2 + owner provider choice | M | G-R2.6 |
| T-107 | Expense categories management screen | M6 | BK-016; CC-RA-2 (DEF-SESSION-02) | T-003 | — | S | G-R2.7 |
| T-108 | Second PDF layout variant + per-document choice | M4 | BK-015; OQ-010 | T-002 | — | M | G-R2.8 |

## R3 — Owner-answer-dependent
| ID | Title | Module | Evidence | Deps | Blockers | Eff | Gate |
|---|---|---|---|---|---|---|---|
| T-201a | Voir: payments + expenses detail screens | M11 | CC-RB-1 tier1 | T-008 | — | M | TODO |
| T-201b | Voir: vendors, POs, products, projects/tasks | M11 | CC-RB-1 tier2 | T-201a | — | M | TODO |
| T-201c | Voir: bank, users, settings entries + row "Voir" everywhere | M11 | CC-RB-1 tier3 | T-201b | — | M | TODO |
| T-202a | Roles table + schema + server-side permission resolution refactor | M1 | CC-RC-1 | T-008 | — | M | TODO |
| T-202b | Role CRUD endpoints + journaling + negative tests | M1 | CC-RC-1 | T-202a | — | M | TODO |
| T-202c | Role management UI + read-only matrix view | M1 | CC-RC-1 | T-202b | — | M | TODO |
| T-203 | Button gating policy (disabled-with-message) | M1 | CC-RC-2 | T-201 | — | S | G-R3.3 |
| T-204 | Bank matching rules + ledger view | M9 | BK-014; 14_Bank sheet r/acct rows | T-004 | — | M | G-R3.4 |
| T-205 | Kanban board + invoice-billable-tasks flow | M9 | BK-013; projects-tasks sheet | T-204? no — T-004 | — | M | G-R3.5 |
| T-206 | Saved filters per list (palette already R4) | M11 | OQ-013 (filters half, R3) | T-201 | — | S | G-R3.6 |
| T-207 | BEYOND-REFERENCE local report outputs (TVA declaration recap, chiffre d'affaires) | M10 | 18 file REP rows ADAPT; PF-ACCT-001 | T-004 | accountant confirm | M | G-R3.7 |

## R4 — Extension points only (CC-DEF-1, matrix §14)
| ID | Title | Module | Evidence | Note |
|---|---|---|---|---|
| T-401 | Portal wrapper spec (reuses public links) | M12 | matrix §14 | spec rows only |
| T-402 | Payment states pending/failed + method registry spec | M12 | matrix §14; 16 item 4 | spec only |
| T-403 | Locations address slot spec — meaning confirmation pending | M12 | 15 §locations | BLOCKED-BY owner OQ-011 meaning |
| T-404 | Command palette spec (reuses nav/labels) | M12 | matrix §14 | spec only |

## Added tasks (review round)
| T-010 | Full English translation file + language switch (variant = setting; default stays fr) | M0-fallback | owner review #3; OQ-014 | T-003 | — | M | TODO |
