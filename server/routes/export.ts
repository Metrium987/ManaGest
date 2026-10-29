import { Hono } from 'hono';
import { logActivity } from '../lib/audit';
import { fail } from '../lib/errors';
import { csvResponse, toCsv } from '../lib/csv';
import { INVOICE_COLUMNS } from '../lib/import-invoices';
import { safeLines } from '../services/documents';
import { requireAuth } from '../middleware';
import { hasPermission } from '../lib/permissions';
import type { Permission } from '../../shared/domain';
import type { AppEnv } from '../types';

/**
 * Data export endpoint (T-006 / BK-011 / OQ-016 owner decision): one route per
 * entity family, capped, filterable by the same `q` the lists use. Exports are
 * journaled (R-C: export is a sensitive action).
 */

interface EntitySpec {
  permission: string;
  sql: { from: string; select: string; search?: string[] };
  columns: { key: string; label: string }[];
  filename: string;
}

const SPECS: Record<string, EntitySpec> = {
  clients: {
    permission: 'clients.read',
    sql: {
      select: 'c.*',
      from: 'clients c',
      search: ['c.display_name', 'c.email', 'c.city', 'c.tax_id'],
    },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'display_name', label: 'nom' },
      { key: 'email', label: 'courriel' },
      { key: 'phone', label: 'téléphone' },
      { key: 'address1', label: 'adresse 1' },
      { key: 'address2', label: 'adresse 2' },
      { key: 'city', label: 'commune' },
      { key: 'postal_code', label: 'code postal' },
      { key: 'country', label: 'pays' },
      { key: 'tax_id', label: 'numéro tahiti' },
      { key: 'payment_terms', label: 'délai paiement' },
      { key: 'is_tax_exempt', label: 'exonéré' },
      { key: 'currency', label: 'devise' },
      { key: 'notes', label: 'notes' },
      { key: 'archived', label: 'archivé' },
    ],
    filename: 'clients.csv',
  },
  products: {
    permission: 'products.read',
    sql: {
      select: 'p.*',
      from: 'products p',
      search: ['p.name', 'p.product_key', 'p.description'],
    },
    columns: [
      { key: 'product_key', label: 'référence' },
      { key: 'name', label: 'nom' },
      { key: 'description', label: 'description' },
      { key: 'unit_price', label: 'prix unitaire' },
      { key: 'cost', label: 'coût' },
      { key: 'quantity_milli', label: 'stock (millièmes)' },
      { key: 'track_quantity', label: 'suivi stock' },
      { key: 'tax_rate', label: 'tva' },
    ],
    filename: 'produits.csv',
  },
  invoices: {
    permission: 'invoices.read',
    sql: {
      select: 'i.*, c.display_name AS client_name',
      from: 'invoices i JOIN clients c ON c.id = i.client_id',
      search: ['i.number', 'c.display_name', 'c.email'],
    },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'status', label: 'statut' },
      { key: 'date', label: 'date' },
      { key: 'due_date', label: 'échéance' },
      { key: 'client_name', label: 'client' },
      { key: 'subtotal', label: 'total ht' },
      { key: 'discount_total', label: 'remise' },
      { key: 'tax_total', label: 'tva' },
      { key: 'total', label: 'total ttc' },
      { key: 'paid_total', label: 'payé' },
      { key: 'balance', label: 'solde' },
      { key: 'currency', label: 'devise' },
      { key: 'line_items', label: 'lignes' },
      { key: 'notes', label: 'notes' },
      { key: 'terms', label: 'conditions' },
    ],
    filename: 'factures.csv',
  },
  quotes: {
    permission: 'quotes.read',
    sql: {
      select: 'q.*, c.display_name AS client_name',
      from: 'quotes q JOIN clients c ON c.id = q.client_id',
      search: ['q.number', 'c.display_name', 'c.email'],
    },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'status', label: 'statut' },
      { key: 'date', label: 'date' },
      { key: 'valid_until', label: "valable jusqu'à" },
      { key: 'client_name', label: 'client' },
      { key: 'subtotal', label: 'total ht' },
      { key: 'tax_total', label: 'tva' },
      { key: 'total', label: 'total ttc' },
      { key: 'currency', label: 'devise' },
      { key: 'line_items', label: 'lignes' },
    ],
    filename: 'devis.csv',
  },
  credits: {
    permission: 'credits.read',
    sql: {
      select: 'cr.*, c.display_name AS client_name',
      from: 'credits cr JOIN clients c ON c.id = cr.client_id',
      search: ['cr.number', 'c.display_name', 'c.email'],
    },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'status', label: 'statut' },
      { key: 'date', label: 'date' },
      { key: 'client_name', label: 'client' },
      { key: 'total', label: 'total' },
      { key: 'applied_total', label: 'appliqué' },
      { key: 'balance', label: 'solde' },
      { key: 'currency', label: 'devise' },
      { key: 'line_items', label: 'lignes' },
    ],
    filename: 'avoirs.csv',
  },
  payments: {
    permission: 'payments.read',
    sql: {
      select: 'p.*, c.display_name AS client_name',
      from: 'payments p JOIN clients c ON c.id = p.client_id',
      search: ['p.number', 'c.display_name', 'p.reference'],
    },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'date', label: 'date' },
      { key: 'client_name', label: 'client' },
      { key: 'amount', label: 'montant' },
      { key: 'method', label: 'mode' },
      { key: 'reference', label: 'référence' },
      { key: 'notes', label: 'notes' },
      { key: 'currency', label: 'devise' },
    ],
    filename: 'paiements.csv',
  },
  expenses: {
    permission: 'expenses.read',
    sql: {
      select: 'e.*, v.name AS vendor_name, c.display_name AS client_name',
      from: 'expenses e LEFT JOIN vendors v ON v.id = e.vendor_id LEFT JOIN clients c ON c.id = e.client_id',
      search: ['e.reference', 'e.notes', 'v.name', 'c.display_name'],
    },
    columns: [
      { key: 'date', label: 'date' },
      { key: 'category', label: 'catégorie' },
      { key: 'vendor_name', label: 'fournisseur' },
      { key: 'client_name', label: 'client facturable' },
      { key: 'amount', label: 'montant' },
      { key: 'tax_amount', label: 'tva' },
      { key: 'payment_method', label: 'mode' },
      { key: 'reference', label: 'référence' },
      { key: 'is_billable', label: 'facturable' },
      { key: 'notes', label: 'notes' },
    ],
    filename: 'depenses.csv',
  },
  vendors: {
    permission: 'vendors.read',
    sql: { select: 'v.*', from: 'vendors v', search: ['v.name', 'v.email'] },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'name', label: 'nom' },
      { key: 'email', label: 'courriel' },
      { key: 'phone', label: 'téléphone' },
      { key: 'address1', label: 'adresse' },
      { key: 'city', label: 'commune' },
      { key: 'tax_id', label: 'numéro tahiti' },
      { key: 'notes', label: 'notes' },
    ],
    filename: 'fournisseurs.csv',
  },
  purchase_orders: {
    permission: 'purchase_orders.read',
    sql: {
      select: 'po.*, v.name AS vendor_name',
      from: 'purchase_orders po JOIN vendors v ON v.id = po.vendor_id',
      search: ['po.number', 'v.name'],
    },
    columns: [
      { key: 'number', label: 'numéro' },
      { key: 'status', label: 'statut' },
      { key: 'date', label: 'date' },
      { key: 'expected_date', label: 'attendu le' },
      { key: 'vendor_name', label: 'fournisseur' },
      { key: 'total', label: 'total ttc' },
      { key: 'currency', label: 'devise' },
      { key: 'line_items', label: 'lignes' },
    ],
    filename: 'bons-de-commande.csv',
  },
};

export const exportRoutes = new Hono<AppEnv>();
exportRoutes.use('*', requireAuth);

exportRoutes.get('/:entity', async (c) => {
  const entity = c.req.param('entity');
  const spec = SPECS[entity];
  if (!spec) return fail(404, 'NOT_FOUND');
  const user = c.get('user');
  if (!user) return fail(401, 'UNAUTHENTICATED');
  if (!hasPermission(user.role, spec.permission as Permission)) return fail(403, 'FORBIDDEN');

  const q = (c.req.query('q') ?? '').trim();
  let sql = `SELECT ${spec.sql.select} FROM ${spec.sql.from}`;
  const bindings: string[] = [];
  if (q && spec.sql.search) {
    const clauses = spec.sql.search.map((column) => `${column} LIKE ?`);
    sql += ` WHERE (${clauses.join(' OR ')})`;
    bindings.push(`%${q}%`);
  }
  sql += ' LIMIT 5000';
  const rows = (await c.env.DB.prepare(sql).bind(...bindings).all()).results ?? [];

  await logActivity(c.env.DB, {
    userId: user.id,
    action: 'exported',
    entityType: entity,
    entityId: null,
    summary: 'activity.data_exported',
    meta: { rows: rows.length, entity },
  });

  // Invoices export one row per line item, mirroring the import template so a
  // file can leave and come back unchanged (OQ-015 round-trip).
  if (entity === 'invoices') {
    const expanded: Record<string, unknown>[] = [];
    for (const invoice of rows as Record<string, unknown>[]) {
      for (const line of safeLines(invoice.line_items)) {
        expanded.push({
          number: invoice.number,
          client: invoice.client_name,
          date: invoice.date,
          due_date: invoice.due_date,
          description: line.description,
          quantity: line.quantity,
          unit_price: line.unit_price,
          tax_rate: line.tax_rate,
          tax_status: line.tax_status === 'exempt' ? 'exonéré' : 'taxable',
          notes: invoice.notes,
        });
      }
    }
    return csvResponse(
      toCsv(INVOICE_COLUMNS.map(({ key, label }) => ({ key, label })), expanded),
      spec.filename,
    );
  }

  return csvResponse(toCsv(spec.columns, rows as Record<string, unknown>[]), spec.filename);
});
