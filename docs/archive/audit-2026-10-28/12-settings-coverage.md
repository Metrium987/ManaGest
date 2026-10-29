# Settings coverage — baseline → ManaGest (2026-10-28)

One line per Invoice Ninja setting group that is user-visible in the product's settings UI, mapped to the ManaGest screen where the same result is reachable. Source for the baseline: `reference/invoiceninja` settings blade/tab strings under `resources/views` + the settings feature tests, bundled (see 02-invoiceninja-inventory §6.x). ManaGest source: `SettingsPage.tsx` + `/api/settings/*`.

| IN setting group | ManaGest screen / setting | Verdict |
|---|---|---|
| Company details (name, address, phone, email) | Paramètres → onglet Société | CONFORMING [OBSERVED] |
| Localisation (currency, language, timezone) | Paramètres → onglet Société | PARTIAL (timezone not user-visible) |
| Tax settings (tax names/rates) | Paramètres → onglet Taxes | PARTIAL (no franchise exemption wording) |
| Numbering patterns (per entity) | Paramètres → onglet Numérotation | CONFORMING [OBSERVED] |
| Invoice defaults (terms, footer, due date) | Paramètres → onglet Documents | PARTIAL (no footer text field) |
| Email settings (SMTP / provider) | NOT-APPLICABLE (OQ-002: manual send in R1; email R2 PLATFORM-DEPENDENT) | NOT-APPLICABLE |
| User management / roles | Paramètres → Utilisateurs + Rôles | CONFORMING [OBSERVED] |
| Online payments / gateways | NOT-APPLICABLE (OQ-008 manual only) | NOT-APPLICABLE |
| Client portal | NOT-APPLICABLE (OQ-001 public links instead) | NOT-APPLICABLE |
| Templates / invoice designer | NOT-APPLICABLE (OQ-010 2-3 fixed layouts) | NOT-APPLICABLE |
| Groups / custom fields | NOT-APPLICABLE (OQ-010/OQ-011 simplified) | NOT-APPLICABLE |
| Bank / reconciliation | NOT in MA.md as a separate settings page — lives in the Bank module (R3) | MISSING |
| Security (2FA, password policy) | Profil → Sécurité | PARTIAL (no password-policy field) |
| Data export | Paramètres → Données → Exporter | CONFORMING [OBSERVED] |

Counts: 14 baseline groups — 5 CONFORMING, 3 PARTIAL, 5 NOT-APPLICABLE (owner decisions cited above), 1 MISSING.

## Detailed gaps of the PARTIAL groups (2026-10-28)
- Localisation (PARTIAL): currency/language selectable; missing user-visible timezone setting (API default Pacific/Tahiti). Minor, R1.
- Tax settings (PARTIAL): rate CRUD exists [OBSERVED]; missing taxable/exempt/franchise wording picklist per OQ-004. Major, R1, VALIDATE LOCALLY.
- Invoice defaults (PARTIAL): terms/defaults exist [OBSERVED]; missing footer text field. Minor, R2.
- Security (MISSING→policy setting): password rules hard-wired in `server/lib/passwords.ts` [OBSERVED]; no dedicated setting. Minor, R2.
