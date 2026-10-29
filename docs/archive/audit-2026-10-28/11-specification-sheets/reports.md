# Build spec — Reports (« Rapports ») & dashboard

## 1. Menu tree
- Principal → **Tableau de bord** (screen 1). Principal → **Rapports** → report picker.

## 2. Dashboard (dashboard screen)
- KPI cards: chiffre du mois (CA HT), impayés clients (encours), encaissements du mois, dépenses du mois.
- Revenue chart (12 mois, HT/Mois; data source: `/api/dashboard` — `server/routes/dashboard.ts` mg-UI-001 [OBSERVED]), series by status of open invoices (envoyée/partielle) and chart of expenses by category.
- Alerts panel: invoices late (due date past), recurrences due, period lock state.

## 3. Reports (picker), each with period filter (month/quarter/year/custom), client filter where relevant, "Exporter" (CSV — R1)
1. **Chiffre d'affaires** (revenue): by month × client; per TVA bucket HT/TVA/TTC, [EXECUTED endpoints in `01` MG-REP-001].
2. **Relevé de clients** (client-sales): top clients by period, balance + aging.
3. **Aging des créances**: outstanding per client bucketed 0-30/31-60/61-90/90+ days.
4. **Perte et bénéfice** (profit-loss): revenue − expenses per period.
5. **TVA** (tax): per rate row: base HT, TVA, from the invoice_tax_lines mirror, reconciliation rule BR-TAX-020, [EXECUTED].
6. **Dépenses**: by category × month.
(Per OQ/baseline parity PAR-REP-001 in income/expense/P&L; product sales & task reports are R2/Could — backlog not yet listed, flagged for the owner.)

## 4. Rules (GIVEN/WHEN/THEN)
- GIVEN a locked+unlocked period set WHEN the report runs THEN locked-months display a padlock icon: figures adjustable; unlocked months figures adjust with data changes (warning is informational).
- GIVEN period WHEN CSV export (R1) THEN numbers use raw minor-unit values with a display-string companion column (per round-trip).

## 5. Verdicts (per 05)
6 report types: `CONFORMING` core; CSV export `MISSING` (R1); scheduled/subscription CSV export `NOT DOCUMENTED` platform; product/task sales reports `MISSING` (Could).
