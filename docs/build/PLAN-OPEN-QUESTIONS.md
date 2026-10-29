# Open questions blocking build tasks
| # | Decision/answer needed | Blocks | Where |
|---|---|---|---|
| 1 | OQ-021 default permission model confirmation | T-202, T-203 | 09-open-questions |
| 2 | "Locations" meaning confirmation | T-403 | 15 §locations |
| 3 | Multi-company preparation items 1-2 approval | T-001 design detail | 10 OQ-007 |
| 4 | PQ-1..PQ-5 platform answers | T-104 caller contract, T-106 provider, attachment ceiling display | data/platform-questions |
| 5 | Local validations OQ-019/004/005/006 [VALIDATE LOCALLY] | T-002 final wording, retention register values | 09 |
| 6 | Provider choice for email (R2) | T-106 | owner |

## 2026-10-28 update
- #1, #2, #3 marked answered per the instructions above; dependent tasks T-202a–c, T-203, T-403, T-001/T-002 design prep unblocked.
- Still open: #4 (PQ-1…PQ-5), #5 (locally-approved DICP wording), #6 (email provider choice).


## Owner decision 2026-10-29 — no accountant available

The three items that waited on an accountant/DICP are **closed** by adopting standard defaults, exposed as ordinary parameters (Paramètres → Taxes → « Valeurs fiscales par défaut ») and marked in the interface as awaiting later review:

| Item | Default adopted | Where it lives |
|---|---|---|
| Retention of issued documents | 10 years | `settings_extra.retention_years` (delete guard reads it) |
| Franchise in base ceiling | 10 000 000 XPF | `settings_extra.franchise_threshold` |
| Tax-status wording and legal mentions | company `legal_notes` + `vat_regime` (standard / franchise) | Paramètres → Entreprise / Facturation |

Nothing in the interface or the documents claims these values are legally certified. Remaining open points are platform questions only (PQ-1, PQ-2, PQ-3) and the owner's meaning of « locations » (OQ-011).
