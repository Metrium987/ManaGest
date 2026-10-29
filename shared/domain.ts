/**
 * Domain constants shared by the API and the web client.
 * All identifiers and enum-like values live here so behaviour stays consistent.
 */

export const APP_NAME = 'ManaGest';

export const ROLES = ['owner', 'admin', 'accountant', 'sales', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Propriétaire',
  admin: 'Administrateur',
  accountant: 'Comptable',
  sales: 'Commercial',
  viewer: 'Lecture seule',
};

export const PERMISSIONS = [
  'clients.read', 'clients.write', 'clients.delete',
  'invoices.read', 'invoices.write', 'invoices.delete',
  'quotes.read', 'quotes.write', 'quotes.delete',
  'payments.read', 'payments.write', 'payments.delete',
  'credits.read', 'credits.write', 'credits.delete',
  'recurring.read', 'recurring.write', 'recurring.delete',
  'products.read', 'products.write', 'products.delete',
  'expenses.read', 'expenses.write', 'expenses.delete',
  'vendors.read', 'vendors.write', 'vendors.delete',
  'purchase_orders.read', 'purchase_orders.write', 'purchase_orders.delete',
  'projects.read', 'projects.write', 'projects.delete',
  'tasks.read', 'tasks.write', 'tasks.delete',
  'bank.read', 'bank.write',
  'reports.read',
  'settings.read', 'settings.write',
  'periods.read', 'periods.write',
  'users.read', 'users.write',
  'activity.read',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/**
 * Read access to operational data. The user directory and the audit journal are
 * deliberately excluded: they expose personal data and control evidence, so they
 * are reserved for roles that administer the account (owner, admin, accountant).
 * Period closure is likewise excluded from read-only and sales roles: freezing
 * an accounting period is a control action, not a daily one.
 */
const OPERATIONAL_READ: Permission[] = PERMISSIONS.filter(
  (p) => p.endsWith('.read') && p !== 'users.read' && p !== 'activity.read' && p !== 'periods.read',
);

const FINANCE_WRITE: Permission[] = [
  'invoices.write',
  'quotes.write',
  'payments.write',
  'credits.write',
  'recurring.write',
  'expenses.write',
  'vendors.write',
  'purchase_orders.write',
  'bank.write',
];

const SALES_WRITE: Permission[] = [
  'clients.write',
  'quotes.write',
  'invoices.write',
  'payments.write',
  'recurring.write',
];

const SALES_READ: Permission[] = [
  'clients.read',
  'quotes.read',
  'invoices.read',
  'payments.read',
  'credits.read',
  'recurring.read',
  'products.read',
  'projects.read',
  'tasks.read',
  'reports.read',
];

/**
 * Permission matrix. Owner and admin hold the same permission set; the extra
 * guarantees for an owner (last-owner protection, owner/admin role assignment)
 * are enforced in the user-management routes, which see the actor's role.
 * Deletion is restricted to owner and admin on purpose: removing financial
 * records is an administrative act, not a day-to-day sales action.
 */
export const ROLE_PERMISSIONS: Record<Role, Permission[]> = {
  owner: [...PERMISSIONS],
  admin: [...PERMISSIONS],
  // The accountant closes and reopens periods: that is their core control.
  accountant: [...OPERATIONAL_READ, 'activity.read', 'periods.read', 'periods.write', ...FINANCE_WRITE],
  sales: [...SALES_READ, ...SALES_WRITE],
  viewer: [...OPERATIONAL_READ],
};

export const DOCUMENT_STATUSES = ['draft', 'sent', 'partial', 'paid', 'cancelled'] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const QUOTE_STATUSES = ['draft', 'sent', 'approved', 'rejected', 'converted', 'expired'] as const;
export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

export const CREDIT_STATUSES = ['draft', 'sent', 'partial', 'applied'] as const;

export const RECURRING_STATUSES = ['draft', 'active', 'paused', 'completed'] as const;

export const FREQUENCIES = ['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly'] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const PAYMENT_METHODS = [
  'transfer', 'cash', 'cheque', 'card', 'direct_debit', 'credit', 'other',
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PROJECT_STATUSES = ['active', 'completed', 'archived'] as const;
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;

/** Local TVA rates in French Polynesia (percent). */
export const TVA_RATES = [
  { rate: 16, label: 'TVA 16 % (taux normal)' },
  { rate: 13, label: 'TVA 13 % (taux intermédiaire)' },
  { rate: 5, label: 'TVA 5 % (taux réduit)' },
  { rate: 0, label: 'Exonéré' },
] as const;

export const VAT_REGIMES = ['standard', 'franchise'] as const;

export const LINE_TAX_STATUSES = ['taxable', 'exempt'] as const;
export type LineTaxStatusDomain = (typeof LINE_TAX_STATUSES)[number];
export const LINE_TAX_STATUS_LABELS: Record<LineTaxStatusDomain, string> = {
  taxable: 'TVA applicable',
  exempt: 'Exonéré de TVA',
};

export const COUNTRIES = ['Polynésie française', 'France', 'Nouvelle-Calédonie', 'Autre'] as const;

export const CURRENCIES = ['XPF', 'EUR', 'USD', 'NZD', 'AUD', 'JPY', 'GBP', 'CHF', 'CAD'] as const;

export const UI_LANGUAGES = ['fr', 'en'] as const;
export type UiLanguage = (typeof UI_LANGUAGES)[number];

/** Currencies with zero decimal places, as used in the Pacific franc zone. */
export const ZERO_DECIMAL_CURRENCIES = ['XPF', 'JPY'] as const;

export const DEFAULT_TIMEZONE = 'Pacific/Tahiti';
export const DEFAULT_CURRENCY = 'XPF';
export const DEFAULT_LOCALE = 'fr-FR';

export const SESSION_COOKIE = 'mg_session';
export const CSRF_COOKIE = 'mg_csrf';
export const CSRF_HEADER = 'x-csrf-token';
