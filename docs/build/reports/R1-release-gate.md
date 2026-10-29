# R1 release gate — end-to-end walk

Date: 2026-10-29 · environment: local Worker (`wrangler dev`, D1 local, demo data) · result: **14/14 checks passed**.

Executed as a real user journey against the running application (API level; the browser UI was not driven).

| # | Check | Result | Detail |
|---|---|---|---|
| 1 | 1. client created | PASS | 201 CLI-0042 |
| 2 | 2. quote created (2 × 15 000 @16%) | PASS | 201 DEV-2026-0020 |
| 3 | 3. quote converted to invoice | PASS | 200 FAC-2026-0087 |
| 4 | 4. invoice totals: 30 000 HT + 4 800 TVA = 34 800 | PASS | total 34800 |
| 5 | 5. payment registered for the full balance | PASS | 201 REG-2026-0042 |
| 6 | 6. invoice paid after payment | PASS | status paid, balance 0 |
| 7 | 7. refund credit note created (1/3) | PASS | 201 AV-2026-0029 |
| 8 | 8. credit is a draft of 11 600 with balance | PASS | status draft, balance 11600 |
| 9 | 9. credit applied to another invoice (balance reduced) | PASS | apply 200, balance 11600 (attendu 11 600 = 23 200 TTC − 11 600) |
| 10 | 10. credit fully used | PASS | status applied, balance 0 |
| 11 | 11. clients export | PASS | 200 |
| 12 | 12. client import | PASS | 201 created 1 |
| 13 | 13. journal records the flow | PASS | imported, exported, applied, sent, created, converted, login |
| 14 | 14. viewer cannot delete an invoice (server-side 403) | PASS | 403 |

## What the walk covers

Setup data existed already (company installed, users seeded), so the wizard itself was not re-run; it was verified during M0. The walk covers the commercial chain the owner uses daily:
client → quote → approval → conversion to invoice → send → payment → paid invoice → refund by credit note → credit sent → credit applied to another invoice → export → import → journal → permission refusal.

## Defect found by this gate and fixed

Applying a credit from the **invoice** side decremented the credit's counters by hand and never re-derived its status: a fully used credit stayed labelled « envoyé » with a zero balance. The route now recomputes the credit from its allocations (`recalcCredit`), so a used credit reads « utilisé » (status `applied`). Re-verified in the same walk (check 10).

## Not covered here

- Browser rendering and keyboard/accessibility behaviour (no browser in this environment).
- Outbound e-mail (platform capability pending, PQ-2).
- The daily scheduled run (R2, PQ-1).
- PDF content beyond generation (invoice PDF generation was exercised earlier; no visual inspection).
