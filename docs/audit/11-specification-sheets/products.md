# Build spec — Products & stock (« Produits »)

## 1. Menu tree
Opérations → **Produits** (list) → product detail. Quick-add "+" → Produit.

## 2. Module contents
- **List**: columns référence (product key), nom, prix de vente (HT), TVA, coût, stock (if tracked); search; row actions: voir, modifier (write), supprimer (owner/admin), ajuster le stock.
- **Form**: nom (required), référence (free text, unique-ish info level), description (prefills invoice line when picked), prix de vente HT (required ≥0), coût (optional), taux de TVA (one of the company rate list), suivre le stock (yes/no), stock de départ.
- **Adjust-stock dialog**: quantité (signed ±), motif (achat/inventaire/retour/autre) → appended into quantity_milli evidence trail via activity log (`09` MG-PRD-001 note).
- **Detail**: usage (which documents reference the product), margin (price − cost) shown when cost filled.

## 3. Rules (GIVEN/WHEN/THEN)
- GIVEN tracked product WHEN invoice line whose product is chosen AND qty set THEN server decrements stock in thousandths (`quantity_milli`), activity logs the movement.
- GIVEN tracked product WHEN a correct-adjustment entered THEN new stock = old ± delta; untracked products show no stock column.
- GIVEN product deleted WHEN referenced by past documents THEN soft-delete only, documents keep the line copy unchanged (documents freeze their line items).

## 4. Verdicts (per 05/04)
CRUD + tracked stock: `CONFORMING` (`01` MG-PRD-001); stock tracking itself is an `ADDITION` vs baseline (documented owner-requested feature). Rundown: no per-product default tax-name override ("Override/STO" parity covered by BK-001 status work in R1).
