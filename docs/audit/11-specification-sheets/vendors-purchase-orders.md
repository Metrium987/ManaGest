# Build spec — Suppliers (« Fournisseurs ») & Purchase orders (« Bons de commande »)

## Vendors
### Menu tree
Opérations → **Fournisseurs** (list) → vendor detail. Quick-add "+" → Supplier.

### Contents
- **List**: columns n°, nom, email, téléphone, ville; search; row actions: voir, modifier (write roles), supprimer (owner/admin).
- **Form**: nom (required), email, téléphone, adresse (1–2 lines), code postal, ville, pays (default Polynésie française), notes. (Contacts + portal: baseline has vendor contacts feeding a vendor portal; per OQ-001 the client-side portal is replaced by per-document public links — the vendor portal is therefore NOT in scope unless the owner asks; flagged in 09.)
- **Vendor detail**: purchase orders and expenses of this vendor (filtered lists), totals.

### Rules
- GIVEN vendor with documents WHEN delete THEN blocked while documents reference it.
- GIVEN duplicate name WHEN created THEN warning suggestion (info-level, not a block).

## Purchase orders
### Menu tree
Opérations → **Bons de commande** (list) → create/edit/detail. Quick-add "+" → Purchase order.

### Contents (lines editor shared with invoices: description, quantity, unit price HT, TVA rate)
- **List**: columns n° BC, fournisseur, date, statut (brouillon/envoyée/acceptée/reçue/annulée), total; filters (fournisseur/statut/période); row actions: voir, PDF, supprimer (owner/admin).
- **Form**: fournisseur (required), date, date attendue, line items, notes.
- **Detail**: status progression buttons — Envoyer (draft→sent), Accepter (sent→accepted, user-entered confirmation), Recevoir (accepted→received), Annuler; totals panel; activity trail.

### Rules (GIVEN/WHEN/THEN)
- GIVEN draft WHEN send THEN sent stamped; second send refused.
- GIVEN a PO WHEN an attempt to skip status backwards is made THEN refused (forward-only transition + cancel from draft per server status service).
- GIVEN received PO WHEN convert to expense is chosen (R2) THEN a pre-filled expense is proposed (baseline parity PAR-PO-001; today MISSING, in backlog).
- GIVEN period closed WHEN PO dated inside THEN refused (same period guard as invoices/expenses; re-verify in UI pass).

### Verdicts (per 05)
Vendor CRUD `CONFORMING`; vendor contacts/portal `DEFERRED (owner decision)` R4 (vendor portal piggybacks on the client-portal extension points — OQ-001 update 2026-10-28). PO CRUD + status `CONFORMING [EXECUTED]`; convert-to-expense `MISSING` (R2); payments against POs `NOT-APPLICABLE` (OQ-008).
