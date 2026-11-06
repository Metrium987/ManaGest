/* A-11: the indexes the audit queries need, and the number uniqueness. */
export const STATEMENTS: string[] = [
  `CREATE INDEX IF NOT EXISTS idx_activities_entity ON activities(entity_type, entity_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stock_movements_reference ON stock_movements(reference, reason)`,
  `CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at)`,
  `CREATE INDEX IF NOT EXISTS idx_products_deleted ON products(deleted_at)`,
  `CREATE INDEX IF NOT EXISTS idx_invoices_client_active ON invoices(client_id, date) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_payments_client_active ON payments(client_id, date) WHERE deleted_at IS NULL`,
  `CREATE INDEX IF NOT EXISTS idx_credits_client_active ON credits(client_id, date) WHERE deleted_at IS NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_number ON payments(number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_purchase_orders_number ON purchase_orders(number)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_recurring_number ON recurring_invoices(number)`,
];
