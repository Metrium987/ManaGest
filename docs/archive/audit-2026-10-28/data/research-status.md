# Research status (per audit brief §7)

Existing research reused without redoing (all sources accessed 2026-10-28):

1. **Invoice Ninja official feature surface** — `data/research-invoiceninja-features.md`
   Covered: vendor module list with hosted-tier gates (clients, invoices, quotes, credits, recurring, Payment Links, expenses, vendors, POs, projects/tasks, banking (Yodlee/GoCardless CSV), reports, portal, templates/designer, custom fields, taxes (Override Tax), currencies, numbering, e-invoicing (Peppol/ZUGFeRD/Facturae/Verifactu(alpha)/FatturaPA/FACT1/EN16931), API/webhooks, import/export, backups, multi-company, white-label. Latest release check: v5.13.50 (GitHub releases). Docs base: invoiceninja.github.io.
   Weak/uncovered: hosted-plan entitlements for several modules explicitly "not established"; API docs version label stale (5.12.55); no Fenix roadmap confirmation (forum URL dead-end); webhooks reference page thin.

2. **French Polynesia requirements** — `data/research-polynesia-requirements.md`, cross-checked into `08-polynesia-requirements.md`
   Covered: TVA rates 5/13/16 + exempt supplies; franchise en base (10M XPF threshold, mandated invoice sentence); impôt sur transactions & patente = business taxes, no invoice lines; CPS abolished 2023-10-01; Tahiti number mentions (DGAE fiche, OPH); Arrêté 692 CM 1997 + LP 410-1..LP 430-4; XPF whole-franc + EUR peg 1000 XPF=8.38; e-invoicing: PF outside metro reform (CCISM); PCG local per Délibération 2011-13 APF; retention = metro fallback 10 years.
   Weak/uncovered: number-continuity rule for PF (unverifiable from accessible primary text — metro fallback flagged); retention period PF-specific (unverified); invoice-guard fiche PDF not extractable (content inferred via OPH secondary); franchise threshold boundary at exactly 10M (ambiguous DICP wording).

3. **2026 SMB ERP expectations** — `data/research-2026-erp-expectations.md`
   Covered: security (MFA/passkeys/SSO, RBAC, audit history), finance-ops (bank feeds present in IN — documented as plan-gated; FX revaluation, accruals, internal approvals, period close/dual control), e-invoicing compliance (present formats; Factur-X ABSENT from IN list), integrations, productivity, data longevity (GDPR export/purge present; managed backup unestablished).
   Weak: several expectations rest on product docs rather than dual-independent standards statements; such claims are labelled accordingly in the file.

[ADDED] Spot-check of 5 Polynesian claims against primary sources → see the `docs/audit/08-polynesia-requirements.md` "Spot-check" section (results appended after the check run).
