# Build spec — Bank (« Banque » / rapprochement)

## 1. Menu tree
Finance → **Banque** → accounts list → account detail (transactions, solde) → rapprochement.

## 2. Module contents
- **Accounts list**: columns nom, banque, IBAN (masked), devise, solde d'ouverture; row actions: voir, ajouter (write role).
- **Account form**: nom (required), banque, IBAN, devise (XPF default).
- **Account detail**: transaction table (date, libellé, montant, référence, statut: non rapproché / rapproché), running balance, "Importer un relevé" button.
- **Import**: paste or upload a simple CSV of the statement (date, libellé, montant, référence) → preview table → commit; duplicates (same date+reference+amount) skipped with a count in the result.
- **Rapprochement**: per unmatched transaction, actions "Rapprocher avec une facture" (pick a client open invoice sent/partial; creates an allocation of the transaction amount — same plumbing as `POST /bank/transactions/:id/match`, `01` MG-BANK), "Créer une dépense" (green-side transaction → expense pre-filled), "Marquer sans correspondance".
- **Balance**: solde courant = opening + Σ transactions.

## 3. Rules (GIVEN/WHEN/THEN)
- GIVEN imported transaction matched to an invoice WHEN confirmed THEN allocation is created, invoice status recomputed, transaction marked rapproché `[EXECUTED: bank match reduces invoice balance]`.
- GIVEN a matched transaction WHEN re-matching is attempted THEN refused (already matched).
- GIVEN a green (credit) transaction WHEN match with invoice attempted THEN proposed as an expense/deposit instead (direction-aware matching).
- GIVEN same statement re-imported WHEN duplicates detection THEN no double transactions.

## 4. Verdicts (per 05)
Core import + manual match: `CONFORMING`. Auto-matching rules: `MISSING` (R2, BK-014, optional scope). External bank feed: NOT DOCUMENTED on the platform (OQ-003-family); treat as R3+ only if the owner asks. Ledger view of all documents (company_ledger parity): `MISSING`.
