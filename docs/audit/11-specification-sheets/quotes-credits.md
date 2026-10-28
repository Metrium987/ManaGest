# Build spec — Quotes (« Devis ») & Credit notes (« Avoirs »)

Same structure as the invoices sheet (lines editor, totals panel, numbering); only the deltas listed.

## Quotes
- Statuses: brouillon → envoyée → approuvée → convertie; refusée/annulée; expirée computed from valid_until.
- Actions: envoyer, approuver, refuser, convertir en facture (creates DRAFT invoice; both docs get numbers), dupliquer, annuler, PDF, supprimer.
- Rules: GIVEN approved quote WHEN convert THEN new draft invoice with same lines; GIVEN quote WHEN valid_until passed THEN expirée shown.

## Credit notes
- Statuses: brouillon → envoyée → appliquée (partielle when partially applied).
- Apply flow: select an open invoice of same client, amount ≤ min(credit balance, invoice balance); updates both; PDF with negative total labelled avoir.

## Verdicts (per 05)
Quotes core `CONFORMING`; client-side approval & expiry automation `PARTIAL`/`PLATFORM-DEPENDENT`. Credits apply `CONFORMING [EXECUTED]`; convert-invoice→credit `MISSING`.
