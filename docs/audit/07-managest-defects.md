# 07 — ManaGest defects & technical debt (reported, not fixed)

Each entry: ID · evidence (verified this audit) · observed vs expected in user terms · carried into `06` where relevant. `[OBSERVED]` = read in code; `[EXECUTED]` = reproduced.

| ID | Defect / debt | Evidence | Observed vs expected | Related |
|---|---|---|---|---|
| DEF-001 | Number gaps on delete are untracked | `server/lib/numbering.ts` (no gap registry; soft delete only) | Expected: auditor-visible gap register | BK-005 / BR-NUM-011 |
| DEF-002 | Default terms promise 10 % penalty + 5 000 XPF indemnity; nothing computes them | `server/routes/setup.ts` `DEFAULT_TERMS` (line ~37) | Terms text should match behaviour (late fees exist or text is configurable without promising) | BK-002 |
| DEF-003 | `recurring_invoices.auto_send` stored but inert | schema column + `server/routes/recurring.ts` (no email step) | Flag unused until email capability exists — drives confusing expectations | BK-003/OQ-002 |
| DEF-004 | "Exonéré" modelled as a 0 % rate slab | `shared/domain.ts:TVA_RATES` (rate 0 labelled Exonéré), `server/services/pdf.ts:61` | Exempt supplies should read as exempt, not as a 0 % taxed row | BK-001 |
| DEF-005 | Cancel rule differs from baseline and is stricter on payments | `server/routes/invoices.ts:282-312` — cancels any non-cancelled invoice without payments (incl. DRAFT), refuses once `paid_total > 0`; baseline `ActionsInvoice` cancels only SENT/PARTIAL but allows partial | More permissive on DRAFT, more restrictive on PARTIAL — one deliberate rule should be chosen and written down | BK-004-adjacent |
| DEF-006 | Manual payments target only `sent`/`partial` invoices; draft invoices cannot receive payments except through `/mark-paid` | `server/routes/payments.ts:109-114` | Consistent payment target list (baseline allows paid-to-draft transitions) | UI pass item |
| DEF-007 | Bank import treats every date as issuer-provided; no validation of date format shown to user on failure (UI pass to confirm messaging) | `server/routes/bank.ts:58-88` | Clear user-facing validation messages | UI pass item |

Removed during self-check: two earlier speculative rows (allocation-cap inconsistency; "schema sampling") were withdrawn — verified inconsistent upon evidence (payments `AMOUNT_EXCEEDS_BALANCE`/`exceeds_amount`, credits `CREDIT_INSUFFICIENT_BALANCE` are uniform), so they were not defects.

## 2026-10-28 additions (from executed session, `14-session-run.md`)
- DEF-SESSION-01 (Minor): one invoice-credit apply inside a chained execution returned a non-2xx answer while the immediate identical retry succeeded; cause not established. Watch alongside payment/invoice recalculation. [EXECUTED]
- DEF-SESSION-02 (Major, R2, OQ-011): expense categories are a fixed server-side enum; owner decision OQ-011 asked user-editable categories. Current implementation is stricter than the decision. [EXECUTED]
- DEF-SESSION-03 (Cosmetic): API validation exposes English names (`display_name`, `valid_type` details); user-facing French presence confirmed in UI strings; API-only JSON codes stay English — acceptable, note only.

## 2026-10-28 — RESOLUTION of DEF-SESSION-01 (investigated, reproduced, root-caused)
**Cause: audit-script payload defect, not an application defect.** The inline `POST /credits/:id/apply` in the session-walk script omitted the required `amount` field; the handler schema (`server/routes/credits.ts:130`) requires `amount` = positive integer, so the call correctly answered 400 VALIDATION_ERROR. The scripted immediate "retry" did include `amount` and succeeded — which created the false impression of a transient failure.
**Reproduction evidence.**
- Full-walk script (without `amount`): 4/4 runs failed at apply, retried {ok:true} identical to the original session observation.
- Minimal re-script with `amount`: 7/7 successful first-time applies; the second apply each time correctly returned 409 (credit balance already consumed, `CREDIT_INSUFFICIENT_BALANCE` semantics), which also exercised the double-application guard as designed.
**Correct classification.** Application behaviour: correct in all 11 attempts overall (7 + 4 retried). The defect entry is re-labelled an audit-tooling defect; no application fix is required. DEF-SESSION-01 status: CLOSED (no defect). Session-run file: interpretation note to be updated.
