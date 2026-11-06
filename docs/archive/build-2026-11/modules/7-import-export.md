# M7 — Import/Export
**Scope** (`import-export.md`; OQ-015 spec; BK-011/012): in-app export of every list with round-trip headers (T-006 done in R1 for CSV); import wizard 5 steps (upload → preview w/ row-level French errors → confirm; no partial silent import; result report); templates per entity; XLSX feasibility check first (UNVERIFIED — CSV-only until validated).
**Tests**: round-trip re-import unchanged; duplicate-key insert/update; malformed-row rejection listing; permission negatives (import admin-only).
