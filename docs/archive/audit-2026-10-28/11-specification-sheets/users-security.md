# Build spec — Users (« Utilisateurs ») & security

## 1. Menu tree
Administration → **Utilisateurs** (list) → user edit. (Profile/TOTP screens live in the settings sheet.)

## 2. Module contents (permissions: users.read / users.write — owner & admin roles only; `shared/domain.ts` matrix)
- **List**: columns nom, email, rôle, 2FA activée, dernière connexion, actif; row actions: voir, modifier, réinitialiser le mot de passe, désactiver (owner/admin).
- **Create form**: prénom, nom, email (unique, validated), rôle (one of: Propriétaire / Administrateur / Comptable / Commercial / Lecture seule), mot de passe initial (policy-checked), send-reset option once email exists (R2 email).
- **Edit**: same fields; rôle change rules:
  - last active owner cannot be demoted or deactivated;
  - owner/admin may assign any rôle; accountant cannot manage users (403 proven in e2e);
- **Reset password**: generates a one-time set value; other sessions revoked; user must change at first login (flow step documented for R1 manual dispatch until email exists).
- **Deactivate**: soft-flag is_active=0; login refused; sessions revoked; user hidden from lists but activity history intact (audit trail never rewritten).

## 3. Roles — what each can do (permission matrix, `[EXECUTED]` in the 127-check audit)
- **Propriétaire / Administrateur**: everything incl. users, settings, periods, deletion.
- **Comptable**: all operations modules incl. finance writes; closes/reopens accounting periods; reads the audit journal; cannot manage users; cannot write settings.
- **Commercial**: clients + income documents (quotes, invoices, payments by criteria, recurrences) + products/projects/tasks reads; no users/settings/journal/periods; cannot read expenses (revenue isolation).
- **Lecture seule**: operational reads only; no users/access/period reading, no writes anywhere.

## 4. Security behaviours (server-verified)
- Password policy at every change (complexity + identity terms; `server/lib/passwords.ts`).
- TOTP MFA: setup/enable/verify/disable + 10 recovery codes, hashed at rest `[EXECUTED]`.
- Login rate limit 8/15 min per email; timing-equalized unknown-email path.
- CSRF double-token + Origin check on every unsafe call; foreign origin 403 `[EXECUTED]`.
- Session idle + absolute expiry; revoke-other-sessions on password change.
- Every state change lands in the hash-chained activity journal (`BR-AUD-001`); integrity endpoint exposes tampering.

## 5. Rules (GIVEN/WHEN/THEN)
- GIVEN last owner WHEN demote/deactivate THEN refused with a French explanation.
- GIVEN accountant user WHEN manage users THEN 403.
- GIVEN deactivated user WHEN login THEN invalid-credentials (no account disclosure).
- GIVEN wrong-MFA attempts when the challenge flow WHEN exhausted THEN 429 like password failures.

## 6. Verdicts (per 05)
CRUD + roles + resets: `CONFORMING` (5 roles vs baseline's custom categories: `EQUIVALENT-BY-PLATFORM`, documented). SSO/OIDC/passkeys: `MISSING` (revisit trigger documented in `10`). API tokens for integrations: NOT DOCUMENTED (`NOT-APPLICABLE` while no external API consumers are specified; would be R3 if asked).
