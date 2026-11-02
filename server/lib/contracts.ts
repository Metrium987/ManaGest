import { RENEWAL_MODES, type RenewalMode } from '../../shared/service';

export interface ContractService {
  id: string;
  name: string;
  item_type: string;
  unit_price: number;
  tax_rate: number;
  billing_frequency: string | null;
  renewal_mode: string | null;
  notice_days: number | null;
  service_type: string | null;
  price_revision_index: string | null;
}

export { RENEWAL_MODES } from '../../shared/service';
export type { RenewalMode } from '../../shared/service';

export interface ContractDraft {
  frequency: string;
  renewal_mode: RenewalMode;
  notice_days: number;
  contract_start: string;
  revision_index: string | null;
  line: {
    product_id: string;
    description: string;
    quantity: number;
    unit_price: number;
    tax_rate: number;
  };
}

/**
 * E1: a recurring invoice is born from the service sheet, not retyped.
 *
 * The frequency, the notice period and the renewal mode are properties of the
 * offer, so copying them from the sheet is what keeps a contract honest: a
 * maintenance plan sold with 30 days' notice must not silently bill with none.
 */
export function contractDraft(service: ContractService, startDate: string): ContractDraft {
  if (service.item_type !== 'service') {
    throw new Error('NOT_A_SERVICE');
  }
  const frequency = service.billing_frequency ?? 'monthly';
  const renewal = (service.renewal_mode ?? 'tacit') as RenewalMode;
  return {
    frequency,
    renewal_mode: (RENEWAL_MODES as readonly string[]).includes(renewal) ? renewal : 'tacit',
    notice_days: Math.max(0, Number(service.notice_days ?? 0)),
    contract_start: startDate,
    revision_index: service.price_revision_index ?? null,
    line: {
      product_id: service.id,
      description: service.name,
      quantity: 1,
      unit_price: Math.max(0, Math.round(Number(service.unit_price ?? 0))),
      tax_rate: Number(service.tax_rate ?? 0),
    },
  };
}

/**
 * The date a tacit contract stops being renewable without notice: the end date
 * minus the notice period. A contract with no end date renews indefinitely, so
 * there is nothing to warn about.
 */
export interface NoticeContract {
  id: string;
  client_name: string;
  end_date: string | null;
  notice_days: number | null;
  renewal_mode: string | null;
  status: string;
}

export interface NoticeRow {
  id: string;
  client_name: string;
  end_date: string;
  notice_deadline: string;
  days_left: number;
  overdue: boolean;
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = Date.parse(`${fromIso.slice(0, 10)}T00:00:00Z`);
  const to = Date.parse(`${toIso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return 0;
  return Math.round((to - from) / 86_400_000);
}

/**
 * E4: contracts whose notice period is running out, or already missed.
 *
 * Only tacit renewals are watched — an express contract simply ends, and warning
 * about a notice it does not have would train people to ignore the alert. A
 * contract without an end date renews indefinitely, so there is no deadline.
 */
export function contractNotices(contracts: NoticeContract[], today: string, leadDays = 30): NoticeRow[] {
  const rows: NoticeRow[] = [];
  for (const contract of contracts) {
    if ((contract.renewal_mode ?? 'tacit') !== 'tacit') continue;
    if (contract.status === 'paused') continue;
    if (!contract.end_date) continue;
    const deadline = noticeDeadline(contract.end_date, contract.notice_days);
    if (!deadline) continue;
    if (contract.end_date < today) continue;
    const daysLeft = daysBetween(today, deadline);
    if (daysLeft > leadDays) continue;
    rows.push({
      id: contract.id,
      client_name: contract.client_name,
      end_date: contract.end_date,
      notice_deadline: deadline,
      days_left: daysLeft,
      overdue: daysLeft < 0,
    });
  }
  return rows.sort((a, b) => a.notice_deadline.localeCompare(b.notice_deadline));
}

export function noticeDeadline(endDate: string | null | undefined, noticeDays: number | null | undefined): string | null {
  if (!endDate) return null;
  const date = new Date(`${endDate.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() - Math.max(0, Number(noticeDays ?? 0)));
  return date.toISOString().slice(0, 10);
}
