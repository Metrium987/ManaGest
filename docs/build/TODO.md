# ManaGest — Master TODO (orders, gates in VERIFICATION-GATES.md; status all TODO)

Legend: Eff S/M/L/XL; status TODO|IN PROGRESS|DONE|BLOCKED; every row cites evidence.

## R1 — Foundations & compliance (startable now)
| ID | Title | Module | Evidence | Deps | Blockers | Eff | Gate |
|---|---|---|---|---|---|---|---|
| T-001 | Per-entity numbering: editable pattern+prefix per document type (FAC/DEV/AV/REG stored, gap register view) | M0 | CC-RA-1; BK-005; sheet invoices "Numérotation" row | — | — | M | G-R1.1 |
| T-002 | TVA status model (taxable / exonéré / franchise) on documents & lines + official DICP sentences on PDF/reports | M0 | BK-001; PF-TVA-001/002/003 [VALIDATE LOCALLY OQ-004/OQ-019] | T-001 | accountant confirm | L | G-R1.2 |
| T-003 | Company settings: timezone field, footer text, security settings (login attempts) surfaced | M0 | 12-settings-coverage gaps; CC-RA-4; 16 item 7/8 | — | — | S | G-R1.3 |
| T-004 | Refunds via credit notes: reverse allocation flow (no separate refund flow) | M4 | BK-006; OQ-012 | T-002 | — | M | G-R1.4 |
| T-005 | Manual reminders + terms/behaviour consistency (no phantom late fee, OQ-020) | M4 | BK-002 (manual part); OQ-020 | T-002 | scheduled part → R2 | S | G-R1.5 |
| T-006 | In-app CSV export of every list with round-trip headers | M7 | BK-011 (R1 scope per OQ-016 owner answer); import-export sheet | T-001 | — | S | G-R1.6 |
| T-007 | Overdue/computed status chips (depôt? expired quote) list/detail | M4 | BK-004 | T-002 | — | S | G-R1.7 |
| T-009 | Retention register: configurable lock (default 10 y) + blocking check before non-destructive purge of older issued docs | M0 | OQ-005/006; BK-028 | T-001 | accountant confirm | M | G-R1.9 |
| T-008 | Permissions: server checks sweep + audit test helper (fixed roles) | M1 | CC-RC (enforcement part); 17 §R-C current state | — | OQ-021 only blocks CUSTOM roles | M | G-R1.8 |

## R2 — Productivity & platform-dependent
| ID | Title | Module | Evidence | Deps | Blockers | Eff | Gate |
|---|---|---|---|---|---|---|---|
| T-101 | Attachments: R2 bucket binding + uploads for receipts/proofs (configurable size, default 10 MB) | M6 | BK-010; OQ-009 (owner-accepted) | T-003 | PQ-3 (ceiling display) | M | G-R2.1 |
| T-102 | Import wizard: templates, preview, row errors, no partial commit (CSV; XLSX after feasibility) | M7 | OQ-015 spec (`import-export.md`); BK-012 | T-006 | XLSX UNVERIFIED | L | G-R2.2 |
| T-103 | Public per-document links (token/expiry/revocation/log) + accept-quote action | M4 | OQ-001 interim; portal sheet security rows | T-008 | — | M | G-R2.3 |
| T-104 | `POST /api/runs/daily` protected endpoint + dashboard last-run card + manual button | M5 | OQ-003 spec (10-analyst); BK-003 | T-005 | external caller (owner) | L | G-R2.4 |
| T-105 | Reminders automated part (via T-104 pipeline) | M5 | BK-002 | T-104 | — | S | G-R2.5 |
| T-106 | Email: manual fallback done in R1 — provider option per PQ-2 answer (provider key in Secrets) | M11 | BK-021; OQ-002 | T-104 | PQ-2 + owner provider choice | M | G-R2.6 |
| T-107 | Expense categories management screen | M6 | BK-016; CC-RA-2 (DEF-SESSION-02) | T-003 | — | S | G-R2.7 |
| T-108 | Second PDF layout variant + per-document choice | M4 | BK-015; OQ-010 | T-002 | — | M | G-R2.8 |

## R3 — Owner-answer-dependent
| ID | Title | Module | Evidence | Deps | Blockers | Eff | Gate |
|---|---|---|---|---|---|---|---|
| T-201 | Read-only "Voir" detail screens + buttons for the ~9 gap areas | M11 | CC-RB-1; 17 §R-B table | T-008 | — | L | G-R3.1 |
| T-202 | Custom roles: roles table + per-role permission sets + role CRUD + journaling | M1 | CC-RC-1; 17 gaps | T-008 | **OQ-021** | XL | G-R3.2 |
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
