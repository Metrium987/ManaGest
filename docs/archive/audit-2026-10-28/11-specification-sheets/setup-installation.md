# Build spec — Installation wizard (« Installation »)

Behaviour target equals Invoice Ninja's `/setup` intent (settings→account→checks→finish) minus the database/mail manual steps that the owner's platform (Freebuff) removes.

## 1. Access
- Uninstalled app → any visit redirects to `/installation`; also reachable directly. Blocked when already installed (409 API + UI redirect). Setup endpoint has an open IDP-free throttle.

## 2. Wizard steps (all in French, in one page with sections)
1. **Entreprise**: nom (required 2-120), forme légale, email, téléphone, adresse (2 lignes), code postal, ville, taux TVA par défaut (5/13/16), régime (standard / franchise), délai de paiement, mention de bas de page (default legal text pre-filled), numéro tahiti (Tahiti-pattern validation, required-as-legal), RCS, capital.
2. **Administrateur**: prénom, nom, email (valid + uniqueness at install), password (policy validated server-side).
3. **Données de démonstration**: checkbox (clearly labelled; seeds realistic PF demo set).
4. **Terminer**: creates company + owner user + TVA rate rows + audit entry; redirect to login with success note; on validation error, field-level messages in French retained inputs.

## 3. Rules
- GIVEN second install attempt WHEN POST /setup/install THEN 409 ALREADY_CONFIGURED.
- GIVEN password ≠ policy THEN error listing the rule.
- GIVEN demo data ticked WHEN installation completes THEN dashboard shows the seeded dataset immediately.
- Baseline pre-flight checks (database / mail / pdf) are `EQUIVALENT-BY-PLATFORM`: managed DB + no outgoing mail; PDF test exists (any invoice preview).

## 4. Verdicts
`EQUIVALENT-BY-PLATFORM` (DB/mail steps), fields/in-flow validated `[EXECUTED]`.
