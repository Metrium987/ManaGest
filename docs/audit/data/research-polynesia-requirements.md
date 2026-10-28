# Raw research — French Polynesia ERP/invoicing requirements (2026)

Source agent: researcher_web, run 2026-10-28. Feeds `08-polynesia-requirements.md` and the Polynesia-relevance column of the parity backlog. This file is the raw extraction; the deliverable adds ManaGest cross-checks.

## 1. Taxes affecting invoice lines
- **TVA rates: 5%, 13%, 16%.** 5% reduced: specified goods/services (certain food, water/non-alcoholic drinks, some medicines, books/press, disability equipment, hotel accommodation, passenger transport, electricity, some tourism). 13% intermediate: generally services neither reduced nor exempt. 16% normal: generally non-exempt goods. Some supplies **exempt** (not zero-rated): DICP lists basic necessities, unprocessed agricultural/fish products, certain medical services, rentals, exports. Lists are non-exhaustive ⇒ ERP must support an exempt **status**, not only rates. https://www.service-public.pf/dicp/professionnels/vos-impots/taxe-sur-la-valeur-ajoutee/ | https://www.service-public.pf/ade/investir/la-fiscalite/
- **Franchise en base:** threshold **10 M XPF** annual turnover; no TVA charged/deducted; invoice must carry **"TVA non applicable, franchise en base"**. Pro-rated for mid-year starts; crossing it in-year switches TVA on from the first day of the following month. Boundary ambiguity: TVA page says "below 10 M", TPE page says "≤ 10 M in franchise by default" — confirm exact-threshold treatment with DICP (→ open question). Same two URLs.
- **No general per-line turnover tax.** An **impôt sur les transactions** (annual, turnover-based, for certain sole proprietors/specified entities) exists — business tax, NOT an invoice line. https://www.service-public.pf/dicp/declarations-les-imprimes/ | https://www.ccism.pf/la-ccism/se-developper/connaitre-ses-obligations/connaitre-ses-obligations-fiscales
- **Patente:** still exists (annual business tax for non-salaried professional activity, with exemptions); not an invoice line; TPE individuals may be exempt. https://www.service-public.pf/dicp/professionnels/vos-impots/la-contribution-des-patentes/
- **CPS:** removed from 1 October 2023 — must NOT be added to invoices. https://www.oph.pf/p/mentions-factures

## 2. Invoice mentions / Tahiti number / year / numbering
- Local consumer invoice rules: **Arrêté n° 692 CM du 16 juillet 1997** (as amended) — DGAE. Professional purchases/services: **Code de la concurrence de Polynésie, articles LP 410-1 to LP 430-4**. https://www.service-public.pf/dgae/reglementations/textes-reglementaires/consommation-qualite-et-securite/ | .../droit-commercial-societes-concurrence-et-relations-entre-professionnels/
- Business identifier = **numéro Tahiti** (not SIREN). DGAE invoice/receipt guidance (PDF, not extractable in agent's interface): seller/provider Tahiti number, invoice date, invoice/order number; buyer info incl. Tahiti number when buyer is a business. Fiche PDF: https://www.service-public.pf/dgae/wp-content/uploads/sites/44/2024/07/10-Fiche-info-facture-et-ticket-de-caisse.pdf — readable secondary: OPH requires supplier name/address, Tahiti number, RCS ref, invoice date/number, item/service detail, TVA, totals: https://www.oph.pf/p/mentions-factures
- TVA invoice: applicable TVA rate + amount; if exempt, state the exemption; franchise phrase as above.
- **Practical ERP invoice template fields:** seller legal name+address, Tahiti number, buyer identity/address (+Tahiti number for registered business), invoice issue date and number, transaction/delivery date, description+quantity, unit/line prices, discount, TVA rate/status+amount, HT/TTC totals, payment due date; RCS details where applicable.
- **Display of "invoicing year":** no PF rule found requiring a distinct year field; invoice date (full calendar date incl. year) is the confirmed element. Do not treat `2026-0001` prefixes as locally mandated. DGAE fiche.
- **Numbering continuity:** local materials confirm a number is required; precise PF rule on sequence continuity/series/year-reset not verifiable from accessible primary text. **Metropolitan fallback:** unique, chronological, continuous; no reuse; document gaps. https://entreprendre.service-public.gouv.fr/vosdroits/F31808 (fallback only!)

## 3. XPF and transaction records
- Currency = franc CFP, **XPF**; circulating coins 5/10/20/50/100/200 + bills 500/1000/5000/10000 ⇒ whole-franc display; keep internal precision. https://www.ieom.fr/Les-pieces-et-billets-en-circulation
- Peg: **1000 XPF = 8.38 EUR** (≈ 119.3317 XPF/EUR); conversion relation, not a mandate to invoice in EUR. https://www.ieom.fr/ | https://www.ieom.fr/IMG/rapport_annuel_ieom_polynesie_francaise_2022/files/basic-html/page24.html
- Cash rounding is a **settlement** matter; no PF rounding tie-break verified. https://www.ieom.fr/Les-pieces-et-billets-en-circulation
- TVA deduction support documents identify supplier, goods/services, HT, TVA, total; services also record payment date. https://www.service-public.pf/dicp/professionnels/vos-impots/taxe-sur-la-valeur-ajoutee/

## 4. E-invoicing
- **PF businesses are outside the metropolitan 2026–27 B2B e-invoicing reform** for domestic PF operations (CCISM); they may have French **e-reporting** duties for operations in France subject to French TVA. https://www.ccism.pf/infos-entreprises-une-enquete-sur-la-facturation-electronique-destination-des-professionnels | https://www.impots.gouv.fr/japprofondis-mes-connaissances-sur-la-reforme
- This is exclusion from the *metropolitan* reform, not proof of zero local e-invoice obligations: local commercial rules exist, public purchasers impose own routing (e.g. Chorus Pro PF guidance: https://portail.chorus-pro.gouv.fr/aife_documentation?id=kb_article_view&sysparm_article=KB0012182 ).

## 5. Accounting framework
- **Polynesian local Plan comptable général** per **Délibération n° 2011-13 APF du 5 mai 2011** (not SYSCOHADA; historical root PCG-1982). https://www.service-public.pf/dgae/reglementations/textes-reglementaires/droit-commercial-societes-concurrence-et-relations-entre-professionnels/
- TPE **individuals**: chronological receipts book + purchases register — regime/entity-eligibility must be determined, not assumed. https://www.service-public.pf/dicp/faq-items/obligations-comptables/ | https://www.service-public.pf/dicp/professionnels/vos-impots/regime-fiscal-simplifie-des-tres-petites-entreprises/

## 6. Retention
- PF-specific period unconfirmed. **Metropolitan fallback:** 10 years from year close (books + documents). https://entreprendre.service-public.gouv.fr/vosdroits/F10029 (fallback only). ERP default: configurable 10-year retention; confirm locally.

## Recommended configuration (research summary)
- TVA codes: 5%, 13%, 16%, **exempt (status)**, franchise-in-base (status). Don't model franchise as 0% taxable.
- Franchise sentence: "TVA non applicable, franchise en base".
- XPF whole-franc display; internal precision; verify rounding locally.
- Tahiti number as seller identifier; RCS where applicable.
- No patente/impôt-transactions/CPS lines.
- Continuous auditable numbering + full date (conservative; metropolitan fallback for continuity).
