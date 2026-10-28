# Build spec — Settings (« Paramètres ») & profile

## 1. Menu tree
Administration → **Paramètres** (settings screen, sectioned). Avatar menu → **Profil**. Administration → **Utilisateurs** (separate sheet). Administration → **Journal d'activité**.

## 2. Settings screen sections (a section per row; every input saved via `PATCH /settings`, permissions: settings.write)
1. **Coordonnées**: raison sociale, forme juridique, email, téléphone, adresse (2 lignes), code postal, ville, pays; **numéro tahiti** (validated `[A-Za-z]\d{5}` — `server/routes/setup.ts:24-31`), RCS, capital social.
2. **Fiscalité**: régime de TVA (standard/franchise), taux par défaut, liste de taux (CRUD via tax-rates endpoints: label, taux, is_default), mention légale des documents (legal_notes — franchise sentence auto-inserted for régime franchise).
3. **Documents**: mentions (terms), pied de page, modèle de numérotation (constant `{prefix}-{YYYY}-{####}` today; R2 option: editable pattern with `{prefix}{YYYY}{YY}{MM}{##..#####}` tokens per `server/lib/numbering.ts:formatPattern`), préfixe par document type.
4. **Localisation**: fuseau (Pacific/Tahiti — informational), devise (XPF — fixed primary), langue de l'interface (fr today; en from R2 per OQ-014; dictionary-driven so no hard-coded text).
5. **Sessions & sécurité**: durée d'inactivité (minutes, default 30 — `session_idle_minutes`), durée absolue (heures, default 12) — both enforced by the session loader.
6. **Import / Export** (R1): "Importer des données" (spec `11-specification-sheets/import-export.md`), "Exporter mes données" (bundle), runbook note for the administrator.
7. **Sauvegarde**: manual export + platform runbook (`data/platform-questions.md` PQ-4 pending).

## 3. Profile screen
- Identity: prénom, nom, email (validated, uniqueness enforced) — `PATCH /auth/profile`.
- Password change: current + new (policy-checked; other sessions revoked) — `POST /auth/change-password`.
- **2FA/MFA card**: setup → secret + otpauth deep link + manual code (grouped display), enable by typing the 6-digit code, recovery codes shown ONCE (10 codes, copy list), disable requires a valid code (TOTP or recovery) — `[EXECUTED]` full flow.
- **Sessions card**: list of active sessions (device/ip/last seen, current marked), revoke one or all others.

## 4. Rules (GIVEN/WHEN/THEN)
- GIVEN settings.read only WHEN save attempted THEN 403 `[EXECUTED role probes]`.
- GIVEN franchise régime WHEN documents render THEN the DICP sentence appears (R1 keeps it company-driven until OQ-004 status work ships).
- GIVEN session idle limit reached WHEN next request THEN forced re-login (sliding idle refreshed on activity — `server/services/session.ts`).
- GIVEN MFA enabled WHEN password login THEN 5-minute single-use challenge; disable needs a valid code `[EXECUTED]`.

## 5. Verdicts (per 05)
21 company fields + taxes + session policy: covers the owner-required core (`PARTIAL` vs the 274-key baseline — per-key map in pass 3 coverage); MFA `CONFORMING + RECOVERY-CODES ADDITION`; language switching `MISSING` (R2, OQ-014).
