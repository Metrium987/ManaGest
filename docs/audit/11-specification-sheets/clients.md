# Build spec — Clients (« Clients »)

## 1. Menu tree
Ventes → **Clients** (list) → Client detail. Global quick-add "+" → Client.

## 2. Module contents
- **List**: columns n°, nom, email, ville, statut actif; search; per-row: voir, modifier, supprimer (owner/admin only); bulk delete where allowed.
- **Create/Edit form**: nom affiché (required, unique per search), email (validated), téléphone, addresses (2 lines, postal code, city), pays (defaults Polynésie française), numéro Tahiti/RCS when the client is a registered business, délai de paiement (default = company setting), client TVA exonéré flag (see BK-001 tax-status spec), notes internes.
- **Client detail**: contact people (add/remove; prénom, nom, email, téléphone), documents of this client (factures/devis/avoirs/paiements lists, filtered), solde, relevé (statement: chronological credits/debits with running balance), activity history.
- **Statement** (from `POST /clients/:id/statement` evidence `01` MG-CLI-001): per-document rows with date, type, HT/TVA/TTC, paid, balance; printable.

## 3. Rules (GIVEN/WHEN/THEN)
- GIVEN a client with documents WHEN delete THEN blocked while documents exist (cancel/credit-note per OQ-005 once R1 ships).
- GIVEN client TVA exonéré WHEN document created THEN TVA zero overall + explicit exempt status (R1).
- GIVEN same email twice WHEN created THEN duplicate warning (not hard block — merge/notice levels to be decided at build).

## 4. Verdicts (per 05/04)
Core CRUD + contacts + statement: `CONFORMING` (statement EXECUTED [OBSERVED]). Missing: groups (NOT-APPLICABLE OQ-011-family?), per-client number pattern; tags R2 (OQ-011 simple tags); attachments R2; portal access references R2 public links only.
