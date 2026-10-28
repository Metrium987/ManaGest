# 16 — Hard-coding audit of ManaGest (2026-10-28, R-A)

Method: grep of every user-facing constant (lists, labels, rates, prefixes, defaults) in `shared/`, `server/`, `src/`, checking whether an authorised user can change it in settings. `IN TRANSITION TO CODE` items are business rules that R-A explicitly allows to stay in code, listed with the reason.

| # | Hard-coded item | Location | Should become | Severity | Release |
|---|---|---|---|---|---|
| 1 | Expense categories fixed enum (supplies…other) | `shared/domain.ts:119-122` + `server/routes/operations.ts:21` (zod enum) | Setting "Catégories de dépenses" (name list, French labels), validation from the list | **Major** (blocks OQ-011) | R2 (DEF-SESSION-02) |
| 2 | One shared `number_pattern` for all entities | `server/db/schema.ts:34`, `server/routes/settings.ts:34`, used at 9 call sites (FAC/DEV/AV/REG) | Per-entity pattern + editable prefix field (currently prefixes are literal 'FAC','DEV','AV','REG' in `invoices/quotes/credits/payments/bank/recurring`) | **Major** (prefix and format not adjustable per document; conflicts with the sheets' "per entity" claim) | R1 |
| 3 | TVA rate picklist fixed (16/13/5/0 with labels) | `shared/domain.ts:128-133` | Editable tax-rate list (name/rate/status) in settings — tax CRUD exists, the dual list must de-duplicate | Minor | R1 (OQ-004) |
| 4 | Payment methods fixed enum | `shared/domain.ts:114-116` (French labels via i18n translations) | Setting "Modes de paiement" (add/rename custom). Server enum must accept stored list | Minor | R3 |
| 5 | VAT regimes fixed two values | `shared/domain.ts:134` (standard/franchise) | Configurable labels + threshold already a setting (OQ-019 ≤10 M XPF); legal mentions editable | Minor | R1 |
| 6 | Currencies fixed list | `shared/domain.ts:138` | Mostly acceptable (ISO codes); make label/order editable; XPF default from setup | Cosmetic | R3 |
| 7 | Default timezone Pacific/Tahiti | `shared/domain.ts:144`, `server/db/schema.ts:24` | Setting exists as company field; UI field missing (§ S coverage) — data not hard-coded | Minor | R1 |
| 8 | Login lockout MAX_ATTEMPTS = 8 | `server/routes/auth.ts:20` | Configurable security setting (attempts/window) | Minor | R2 |
| 9 | Status labels & colours | labels in `src/lib/i18n.ts` (translatable = OK); colours as UI classes in detail/list components | Colour mapping becoming a small component setting; labels must move per-language (already i18n keys — verify no hard-coded fr in components) | Minor | R4 |
| 10 | Default footer/terms text | seeded defaults in `server/services/seed.ts` + `invoice_terms`/`invoice_footer` settings (routes exist `server/routes/settings.ts:50`) | Already parameterisable — confirm seed only as initial value | OK after confirm | R2 |
| 11 | Reminder/late-fee rules | not implemented yet (manual reminders R1) | When built: schedule, wording and computed late fee must be settings (OQ-020) | N/A now / Major at build | R2 |
| 12 | Email templates / PDF layouts | not implemented (email blocked PQ-2; PDF generated with fixed template) | PDF: layout choice per OQ-010 (2–3 layouts) + footer/terms from settings; email templates all settings | Major at build | R2 |
| 13 | Upload size cap (OQ-009) | not implemented yet | Administrator setting with 10 MB default | Minor (already decided) | R2 |
| 14 | FREQUENCIES / statuses enumerated values | `shared/domain.ts:101-111,124-125` | **IN TRANSITION TO CODE** — status machine identifiers must stay in code so transitions stay consistent (explicit R-A allowance); labels/colours stay configurable (item 9). Frequencies: keep enum, label list editable | Intentional | — |
| 15 | Transition rules (send/cancel/apply guards) | `server/services/status.ts`, handlers | **IN TRANSITION TO CODE** — invariant bookkeeping (balances, statuses, journal) must remain code to protect numbering/register integrity (OQ-005) | Intentional | — |
| 16 | Activity-text keys | `src/lib/i18n.ts:646-` (fr labels for codes) | Already parameterised per language — conforming | Conforming | — |

Totals: 2 Major (items 1, 2), 6 Minor, 1 Major-at-build each for 11/12, conforming/intentional items 14–16. Priority order: per-entity numbering + prefixes (2), tax list de-dup (3, 5), expense categories (1) → then 8, 4, 9, 6, 11, 12, 13.
