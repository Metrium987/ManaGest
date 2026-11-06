/* A-08: expenses and purchase orders carry their own currency and base amounts. */
export const STATEMENTS: string[] = [
  "ALTER TABLE expenses ADD COLUMN currency TEXT NOT NULL DEFAULT 'XPF'",
  "ALTER TABLE expenses ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1",
  "ALTER TABLE expenses ADD COLUMN amount_xpf INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE expenses ADD COLUMN tax_amount_xpf INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE purchase_orders ADD COLUMN exchange_rate REAL NOT NULL DEFAULT 1",
  "ALTER TABLE purchase_orders ADD COLUMN subtotal_xpf INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE purchase_orders ADD COLUMN tax_total_xpf INTEGER NOT NULL DEFAULT 0",
  "ALTER TABLE purchase_orders ADD COLUMN total_xpf INTEGER NOT NULL DEFAULT 0",
  "UPDATE expenses SET amount_xpf = amount, tax_amount_xpf = tax_amount WHERE amount_xpf = 0 AND amount <> 0",
  "UPDATE purchase_orders SET subtotal_xpf = subtotal, tax_total_xpf = tax_total, total_xpf = total WHERE total_xpf = 0 AND total <> 0"
];
