import { alertDigest, stockAlertRows, type AlertProduct, type StockAlertRow } from '../lib/stock-alerting';
import { dispatchMail, readMailConfig, type MailSecrets } from './email';

/**
 * Reads the alerts from the catalogue. The threshold is the article's own, so
 * the alert cannot drift from what the buyer sees on the sheet.
 */
export async function loadStockAlerts(database: D1Database): Promise<StockAlertRow[]> {
  const rows = await database
    .prepare(
      `SELECT p.id, p.name, p.quantity_milli, p.track_quantity, p.reorder_point_milli,
              p.safety_stock_milli, p.max_stock_milli, p.moq_milli, p.order_multiple_milli,
              v.name AS supplier_name
       FROM products p
       LEFT JOIN vendors v ON v.id = p.supplier_id AND v.deleted_at IS NULL
       WHERE p.deleted_at IS NULL AND p.item_type <> 'service' AND p.track_quantity = 1`,
    )
    .all<AlertProduct>();
  return stockAlertRows(rows.results ?? []);
}

const LAST_SENT_KEY = 'stock_alert_last_sent';

export interface DigestOutcome {
  sent: boolean;
  reason?: 'ALREADY_SENT' | 'NO_ALERT' | 'NO_RECIPIENT' | 'MAIL_NOT_CONFIGURED';
}

/**
 * Sends the daily digest at most once per day.
 *
 * The guard is a stored day rather than a cron-only timer: the manual pass and
 * the scheduled pass share it, so pressing the button after the scheduler ran
 * does not send the same mail twice. A missing mail configuration is a normal
 * outcome, not an error — the alert still exists in the dashboard.
 */
export async function maybeSendStockDigest(
  database: D1Database,
  secrets: MailSecrets,
  options: { day: string; companyName: string; recipient: string | null },
): Promise<DigestOutcome> {
  const last = await database
    .prepare(`SELECT value FROM app_meta WHERE key = ?`)
    .bind(LAST_SENT_KEY)
    .first<{ value: string }>();
  if (last?.value === options.day) return { sent: false, reason: 'ALREADY_SENT' };

  const alerts = await loadStockAlerts(database);
  const digest = alertDigest(alerts, options.companyName);
  if (!digest) return { sent: false, reason: 'NO_ALERT' };
  if (!options.recipient) return { sent: false, reason: 'NO_RECIPIENT' };

  const config = await readMailConfig(database);
  if (config.provider === 'manual') return { sent: false, reason: 'MAIL_NOT_CONFIGURED' };

  await dispatchMail(config, { to: options.recipient, subject: digest.subject, text: digest.text }, secrets);
  await database
    .prepare(`INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(LAST_SENT_KEY, options.day)
    .run();
  return { sent: true };
}
