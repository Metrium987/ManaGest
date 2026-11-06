# M6 — Expenses
**Scope** (sheet `expenses.md` + CC-RA-2/DEF-SESSION-02; BK-016 T-107; BK-010 T-101): CRUD + categories from settings; billable flag; attachments (receipts/proofs) via platform R2 bucket with configurable size default 10 MB (ceiling display pending PQ-3).
**Steps**: category setting table + migration of existing enum values; upload flow with type checks (image/PDF); storage binding per manifest (deploy access env.FILES); size setting enforced server-side.
**Tests**: category round-trip; oversize file 422; type refusal; permission negatives; expense→invoice billable display.
