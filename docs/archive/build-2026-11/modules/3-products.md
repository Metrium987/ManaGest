# M3 — Products (incl. categories, stock)
**Scope** (sheet `products.md`; ADDITION keep): CRUD, unit price/stock tracking (ADDITION judged ADOPT locally); product default tax status picker uses new TVA-status model (T-002); category list parameterised later with CC-RA-2 in M6 (shared setting pattern).
**Steps**: 1) form field additions (default tax status); 2) stock adjust endpoint guard (permissions + journal); 3) low-stock thresholds as setting (R-A).
**Tests**: CRUD + permission negatives; stock math boundaries (0, negative refused).
