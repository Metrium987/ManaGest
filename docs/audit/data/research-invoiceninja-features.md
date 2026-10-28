# Raw research — Invoice Ninja official feature surface (web)

Source agent: researcher_web, run 2026-10-28. Original question: "Invoice Ninja's CURRENT official feature list and documentation, to confirm nothing present in the product is missed in the code analysis."
Usage: feeds `02-invoiceninja-inventory.md` coverage checks and `08-polynesia-requirements.md` NOT. Cite the underlying URLs.

## Source status
- Latest 5.x stable: **v5.13.50**, release dated 2026-10-21 — https://github.com/invoiceninja/invoiceninja/releases (accessed 2026-10-28). Repo under audit is 5.13.49 (one release behind, ~1 week).
- Official docs: https://invoiceninja.github.io/ ; User Guide: https://invoiceninja.github.io/docs/user-guide ; self-host docs: https://invoiceninja.github.io/docs/self-host/self-host-installation ; API Reference: https://invoiceninja.github.io/docs/api-reference/invoice-ninja-api-reference .
- Old `docs.invoiceninja.com` redirects to the GitHub-hosted docs site. `https://invoiceninja.github.io/docs/` (rooted path) returns 404; the user-guide path works.
- Pricing page: https://invoiceninja.com/pricing-plans/ . Features page: https://invoiceninja.com/features/ .
- API reference page labels version 5.12.55 despite 5.13.50 being latest — treat version label as stale documentation, not stale product.
- `https://api-docs.invoicing.co/` returned an extraction error (response size); the api-reference path above was used instead.

## Module/feature surface as documented by the vendor (self-host minus otherwise stated)
- **Clients** — free self-hosted; hosted Free = up to 5 clients, unlimited on Pro+. Client records, multiple contacts, locations, imports, client settings. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/clients
- **Invoices** — free self-hosted; hosted Free = unlimited invoicing for up to 5 clients, Pro+ lifts limits. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/invoices
- **Quotes/proposals** — free self-hosted; hosted feature matrix does not gate quotes per se (bulk email of quotes is Pro). https://invoiceninja.com/features/ | https://invoiceninja.github.io/docs/user-guide/quotes
- **Credits/credit notes** — documented core module; applyable to invoices; used to correct e-invoices. https://invoiceninja.github.io/docs/user-guide/credits | https://invoiceninja.github.io/docs/user-guide/einvoicing
- **Recurring invoices & auto-billing** — free self-hosted, included in hosted Free. Docs describe scheduled generation + automatic charging of a saved payment method. https://invoiceninja.github.io/docs/user-guide/recurring-invoices
- **Subscriptions ⇒ "Payment Links"** — docs renamed the feature Payment Links (previously Subscriptions): hosted checkout, recurring products, self-service plan management. Hosted plan entitlement not established by the pages reviewed. https://invoiceninja.github.io/docs/user-guide/subscriptions | https://invoiceninja.github.io/docs/user-guide/client-portal
- **Expenses** — free self-hosted, in hosted Free. Billable expenses, categories, receipts, re-invoicing to clients. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/expenses
- **Vendors** — free self-hosted, part of the hosted Free expense features. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/vendors
- **Purchase orders** — documented core module, self-hosted available; separate hosted-plan row not established. https://invoiceninja.com/expenses/ | https://invoiceninja.github.io/docs/user-guide/purchase-orders
- **Projects/tasks/time tracking** — free self-hosted; hosted Free includes projects + billable time tracking + kanban; assigning tasks to team members = Enterprise. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.com/features/ | https://invoiceninja.github.io/docs/user-guide/projects
- **Banking/matching** — CSV transaction import documented (not Enterprise-gated by the pages reviewed); automated bank-account sync (Yodlee/GoCardless) is hosted Enterprise. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/banking | https://invoiceninja.github.io/docs/user-guide/transactions
- **Reports** — free self-hosted core; hosted pricing lists invoice/expense/P&L reports under Pro+. CSV exports, customisable columns, scheduled reports. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/reports
- **Client portal** — in hosted Free (basic); Pro = branded `YourSite.invoicing.co`; Enterprise = `Billing.YourCompany.com`. Client/vendor document upload = Enterprise. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/client-portal
- **PDF templates/designer** — hosted Free = 4 invoice templates, Pro+ = 11; invoice-design customisation is a paid hosted feature. Self-host HTML/CSS custom designs documented without a stated paid gate. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/advanced-topics/custom-fields | https://invoiceninja.github.io/docs/advanced-topics/templates
- **Custom fields** — documented: up to four additional fields per record type, several field types. https://invoiceninja.github.io/docs/user-guide/advanced-settings
- **Taxes ("STO"/Override Tax)** — docs use **Override Tax**: product-level tax category where a chosen tax (or none) overrides the customer's rate. Line- and invoice-level manual rates documented. Automatically calculated sales tax = hosted Pro/Enterprise. https://invoiceninja.github.io/docs/user-guide/taxes | https://invoiceninja.github.io/docs/user-guide/basic-settings
- **Currencies** — free hosted plan includes automatic conversions; client-level currency. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/basic-settings
- **Numbering** — configurable patterns/counters for invoices, quotes, clients, etc. No paid gate stated. https://invoiceninja.com/features/ | https://invoiceninja.github.io/docs/user-guide/advanced-settings
- **E-invoicing/Peppol** — hosted Enterprise includes Peppol access (250 credits listed); self-host proxied via Invoice Ninja's hosted platform. Formats documented: Peppol, ZUGFeRD/XRechnung, Facturae, Verifactu, FatturaPA, FACT1, EN16931. Verifactu = alpha/nearing release; FatturaPA & FACT1 generate but delivery connections not live. https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/user-guide/einvoicing
- **API/webhooks** — hosted REST API = Pro+; self-host has its own credentials. Docs include webhook endpoints (webhooks reference page is thin). https://invoiceninja.com/pricing-plans/ | https://invoiceninja.github.io/docs/api-reference/invoice-ninja-api-reference
- **Import/export** — CSV import/export documented; one-click imports: FreshBooks, Invoice2go, Invoicely, Wave, Zoho. https://invoiceninja.github.io/docs/advanced-topics/import-and-export
- **Backups/restore** — full-system backup/restore documented in Settings; self-host CLI export/backup expected. Plan entitlement not established. https://invoiceninja.github.io/docs/advanced-topics/import-and-export | https://invoiceninja.github.io/docs/self-host/self-host-installation
- **Multi-company** — hosted Pro interlinks 10 companies under one login. https://invoiceninja.com/pricing-plans/
- **White-label/branding** — hosted Free = logo on invoices; Pro removes "Created by Invoice Ninja" + branded subdomain; Enterprise = custom-domain portal. https://invoiceninja.com/features/
- **Roadmap evidence gap** — a France B2B e-invoicing (PDP/PPF 2026-2027) forum thread could not be verified: the requested thread resolved to a generic GitHub Discussions page. No confirmed roadmap statement. https://forum.invoiceninja.com/t/feature-request-france-support-for-mandatory-b2b-e-invoicing-via-pdp-ppf-2026-2027/23042 (checked 2026-10-28).

## Audit-relevant conclusions
1. The vendor feature list is broader than the code audit alone could prove (hosted pivot, e-invoicing proxy, mobile apps). Code remains the behavioural source of truth; the GITHUB code + docs verify together.
2. Anything marked "not established" above must be listed in `09-open-questions.md` instead of invented.
