import { addDays, todayIn } from '../lib/dates';
import { roundMinor } from '../lib/money';
import { nextNumber } from '../lib/numbering';
import { computeTotals, type LineItem } from '../lib/tax';
import { syncInvoiceTaxLines } from './documents';

interface SeedContext {
  db: D1Database;
  companyId: string;
  userId: string;
  currency: string;
  timezone: string;
  taxRate: number;
}

const nowISO = () => new Date().toISOString();

function line(description: string, quantity: number, unitPrice: number, taxRate: number): LineItem {
  return { id: crypto.randomUUID(), description, quantity, unit_price: unitPrice, tax_rate: taxRate };
}

/**
 * Seeds a coherent demo dataset: recurring revenue, overdue receivables and
 * enough history for charts. Numbers come from the real sequence service so a
 * demo installation never collides with future documents.
 */
export async function seedDemoData(ctx: SeedContext): Promise<void> {
  const { db, companyId, userId, currency, timezone, taxRate } = ctx;
  const today = todayIn(timezone);
  const createdAt = nowISO();

  const clients = [
    { name: 'Hôtel Manava Tahiti', city: 'Papeete', email: 'compta@manava-tahiti.pf', phone: '+689 40 86 12 00', terms: 30, exempt: 0 },
    { name: 'Perlerie Teva Moorea', city: 'Moorea', email: 'contact@teva-moorea.pf', phone: '+689 40 56 33 10', terms: 15, exempt: 0 },
    { name: 'SARL Punaauia BTP', city: 'Punaauia', email: 'facturation@punaauia-btp.pf', phone: '+689 40 42 78 90', terms: 30, exempt: 0 },
    { name: 'Clinique Vairaumati', city: 'Papeete', email: 'achats@vairaumati.pf', phone: '+689 40 46 00 00', terms: 45, exempt: 1 },
    { name: 'Association Fenua Sport', city: 'Faaa', email: 'contact@fenua-sport.pf', phone: '+689 40 82 45 11', terms: 30, exempt: 0 },
  ];

  const clientIds: string[] = [];
  for (const [index, client] of clients.entries()) {
    const id = crypto.randomUUID();
    clientIds.push(id);
    await db
      .prepare(
        `INSERT INTO clients (id, number, display_name, email, phone, city, country, payment_terms, is_tax_exempt, currency, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'Polynésie française', ?, ?, ?, ?, ?)`,
      )
      .bind(id, `CLI-${String(index + 1).padStart(4, '0')}`, client.name, client.email, client.phone, client.city, client.terms, client.exempt, currency, createdAt, createdAt)
      .run();
  }

  const products = [
    { key: 'CONS-J', name: 'Journée de conseil', price: 85_000, cost: 45_000, tax: taxRate, track: 0, qty: 0 },
    { key: 'LOC-BATEAU', name: 'Location de bateau (journée)', price: 145_000, cost: 70_000, tax: taxRate, track: 0, qty: 0 },
    { key: 'PERLE', name: 'Perle de culture de Tahiti', price: 32_000, cost: 18_000, tax: taxRate, track: 1, qty: 42 },
    { key: 'MAINT-INFO', name: 'Maintenance informatique mensuelle', price: 55_000, cost: 25_000, tax: taxRate, track: 0, qty: 0 },
    { key: 'PLONGEE', name: 'Sortie plongée (2 personnes)', price: 28_000, cost: 12_000, tax: 5, track: 0, qty: 0 },
    { key: 'FOURNITURE', name: 'Fournitures de bureau', price: 4_500, cost: 2_800, tax: taxRate, track: 1, qty: 120 },
  ];

  for (const product of products) {
    await db
      .prepare(
        `INSERT INTO products (id, product_key, name, unit_price, cost, quantity_milli, track_quantity, tax_rate, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), product.key, product.name, product.price, product.cost, product.qty * 1000, product.track, product.tax, createdAt, createdAt)
      .run();
  }

  interface DemoInvoice {
    clientIndex: number;
    offsetDays: number;
    dueOffsetDays: number;
    status: 'draft' | 'sent' | 'partial' | 'paid';
    items: LineItem[];
    withPayment?: number;
  }

  const invoices: DemoInvoice[] = [
    { clientIndex: 0, offsetDays: -108, dueOffsetDays: -78, status: 'paid', items: [line('Maintenance informatique — trimestre', 3, 55_000, taxRate)] },
    { clientIndex: 2, offsetDays: -92, dueOffsetDays: -62, status: 'paid', items: [line('Journée de conseil — audit chantier', 4, 85_000, taxRate), line('Fournitures de bureau', 12, 4_500, taxRate)] },
    { clientIndex: 1, offsetDays: -74, dueOffsetDays: -59, status: 'paid', items: [line('Perles de culture de Tahiti', 18, 32_000, taxRate)] },
    { clientIndex: 0, offsetDays: -48, dueOffsetDays: -18, status: 'sent', items: [line('Location de bateau (journée)', 2, 145_000, taxRate)] },
    { clientIndex: 3, offsetDays: -35, dueOffsetDays: 10, status: 'partial', items: [line('Maintenance informatique mensuelle', 2, 55_000, 0)], withPayment: 60_000 },
    { clientIndex: 4, offsetDays: -20, dueOffsetDays: 10, status: 'sent', items: [line('Sortie plongée (2 personnes)', 6, 28_000, 5)] },
    { clientIndex: 2, offsetDays: -4, dueOffsetDays: 26, status: 'draft', items: [line('Journée de conseil — planification', 2, 85_000, taxRate)] },
  ];

  for (const invoice of invoices) {
    const date = addDays(today, invoice.offsetDays);
    const dueDate = addDays(today, invoice.dueOffsetDays);
    const totals = computeTotals(invoice.items, { discount_type: 'percent', discount_value: 0 }, clients[invoice.clientIndex].exempt === 1);
    const id = crypto.randomUUID();
    const number = await nextNumber(db, 'invoice', 'FAC', '{prefix}-{YYYY}-{####}', date);
    const paidTotal = invoice.status === 'paid' ? totals.total : (invoice.withPayment ?? 0);
    const balance = Math.max(0, totals.total - paidTotal);

    await db
      .prepare(
        `INSERT INTO invoices (id, client_id, number, status, date, due_date, currency, subtotal, discount_type, discount_value,
          discount_total, tax_total, total, paid_total, balance, tax_exempt, line_items, notes, created_by, created_at, updated_at, sent_at, paid_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'percent', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id, clientIds[invoice.clientIndex], number, invoice.status, date, dueDate, currency,
        totals.subtotal, totals.discount_total, totals.tax_total, totals.total, paidTotal, balance,
        clients[invoice.clientIndex].exempt, JSON.stringify(invoice.items), null, userId, createdAt, createdAt,
        invoice.status === 'draft' ? null : createdAt,
        invoice.status === 'paid' ? createdAt : null,
      )
      .run();

    await syncInvoiceTaxLines(db, id, totals.tax_buckets);

    if (paidTotal > 0) {
      const paymentId = crypto.randomUUID();
      const paymentNumber = await nextNumber(db, 'payment', 'REG', '{prefix}-{YYYY}-{####}', date);
      await db
        .prepare(
          `INSERT INTO payments (id, client_id, number, date, amount, method, reference, status, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'transfer', ?, 'completed', ?, ?, ?)`,
        )
        .bind(paymentId, clientIds[invoice.clientIndex], paymentNumber, date, paidTotal, 'Virement bancaire', userId, createdAt, createdAt)
        .run();
      await db
        .prepare(`INSERT INTO payment_allocations (id, payment_id, invoice_id, amount, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(crypto.randomUUID(), paymentId, id, paidTotal, createdAt)
        .run();
    }
  }

  const quoteItems = [line('Location de bateau (journée)', 3, 145_000, taxRate), line('Sortie plongée (2 personnes)', 4, 28_000, 5)];
  const quoteTotals = computeTotals(quoteItems, { discount_type: 'percent', discount_value: 500 }, false);
  const quoteNumber = await nextNumber(db, 'quote', 'DEV', '{prefix}-{YYYY}-{####}', today);
  await db
    .prepare(
      `INSERT INTO quotes (id, client_id, number, status, date, valid_until, currency, subtotal, discount_type, discount_value,
        discount_total, tax_total, total, tax_exempt, line_items, notes, created_by, created_at, updated_at, sent_at)
       VALUES (?, ?, ?, 'sent', ?, ?, ?, ?, 'percent', 500, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(), clientIds[0], quoteNumber, today, addDays(today, 30), currency,
      quoteTotals.subtotal, quoteTotals.discount_total, quoteTotals.tax_total, quoteTotals.total,
      JSON.stringify(quoteItems), 'Offre valable 30 jours.', userId, createdAt, createdAt, createdAt,
    )
    .run();

  const vendorId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO vendors (id, number, name, email, phone, city, country, created_at, updated_at)
       VALUES (?, 'FOU-0001', ?, ?, ?, ?, 'Polynésie française', ?, ?)`,
    )
    .bind(vendorId, 'Pacifique Fournitures', 'commandes@pacifique-fournitures.pf', '+689 40 43 22 11', 'Papeete', createdAt, createdAt)
    .run();

  const expenses = [
    { category: 'rent', amount: 180_000, tax: 0, days: -60, reference: 'Loyer local commercial' },
    { category: 'utilities', amount: 42_500, tax: 6_800, days: -45, reference: 'Électricité EDT' },
    { category: 'transport', amount: 18_000, tax: 0, days: -22, reference: 'Carburant' },
    { category: 'supplies', amount: 64_000, tax: 10_240, days: -12, reference: 'Fournitures atelier' },
    { category: 'services', amount: 95_000, tax: 15_200, days: -5, reference: 'Honoraires comptable' },
  ];

  for (const expense of expenses) {
    await db
      .prepare(
        `INSERT INTO expenses (id, vendor_id, category, date, amount, tax_amount, payment_method, reference, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 'transfer', ?, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), vendorId, expense.category, addDays(today, expense.days), expense.amount, expense.tax, expense.reference, userId, createdAt, createdAt)
      .run();
  }

  const projectId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO projects (id, client_id, name, description, status, budget, start_date, deadline, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      projectId, clientIds[2], 'Rénovation ponton Punaauia',
      'Réaménagement du ponton et des accès nautiques.',
      1_450_000, addDays(today, -40), addDays(today, 35), userId, createdAt, createdAt,
    )
    .run();

  const tasks = [
    { title: 'Relevé des dimensions', status: 'done', minutes: 240, rate: 8_500 },
    { title: 'Chiffrage des matériaux', status: 'in_progress', minutes: 180, rate: 8_500 },
    { title: 'Préparation du devis client', status: 'todo', minutes: 0, rate: 8_500 },
  ];
  for (const task of tasks) {
    await db
      .prepare(
        `INSERT INTO tasks (id, project_id, client_id, title, status, minutes, hourly_rate, billable, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      )
      .bind(crypto.randomUUID(), projectId, clientIds[2], task.title, task.status, task.minutes, task.rate, userId, createdAt, createdAt)
      .run();
  }

  const recurringItems = [line('Maintenance informatique mensuelle', 1, 55_000, taxRate)];
  await db
    .prepare(
      `INSERT INTO recurring_invoices (id, client_id, number, status, frequency, interval_count, next_run_date, remaining_cycles,
        auto_send, currency, discount_type, discount_value, tax_exempt, line_items, notes, created_by, created_at, updated_at)
       VALUES (?, ?, 'ABO-0001', 'active', 'monthly', 1, ?, NULL, 1, ?, 'percent', 0, 0, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), clientIds[0], addDays(today, 12), currency, JSON.stringify(recurringItems), 'Contrat de maintenance mensuel.', userId, createdAt, createdAt)
    .run();

  await db
    .prepare(
      `INSERT INTO bank_accounts (id, name, bank_name, iban, currency, opening_balance, created_at, updated_at)
       VALUES (?, 'Compte courant professionnel', 'Banque de Polynésie', 'PF00 1234 5678 9012 3456 7890 123', ?, 1_250_000, ?, ?)`,
    )
    .bind(crypto.randomUUID(), currency, createdAt, createdAt)
    .run();

  const projectTotal = roundMinor(1_450_000 * 0.15);
  await db
    .prepare(
      `INSERT INTO activities (id, user_id, action, entity_type, entity_id, summary, meta, created_at)
       VALUES (?, ?, 'seed', 'company', ?, 'activity.demo_seeded', ?, ?)`,
    )
    .bind(crypto.randomUUID(), userId, companyId, JSON.stringify({ project_budget: projectTotal }), createdAt)
    .run();
}
