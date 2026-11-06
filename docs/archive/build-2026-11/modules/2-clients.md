# M2 — Clients & contacts
**Scope** (sheet `clients.md`; `18` ACC rows ADAPT-A? — client entities ADOPT): CRUD + contacts + statement; R-B detail view exists (keep); R-A: payment terms, tax status defaults from settings; local addressing: address fields free-form (commune/île/PK style supported by free text; phone +689 formats validated loosely).
**Prereq**: M0, M1. **Steps**: 1) schema review (buyer Tahiti number field exists `clients.tax_id` — surface in forms per PF-TAHITI-001); 2) View screen parity for contacts list entry; 3) empty/error states in French; 4) per-route permission negative tests; 5) statement correctness with credits (allocations from M4).
**Tests**: CRUD API incl. 403/409 (client with open invoices cannot be deleted — `openInvoicesWarning` behaviour), statement totals vs documents; boundary XPF balances.
**DoD**: module gate + report.
