import { Hono } from 'hono';
import { z } from 'zod';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE, DEFAULT_TIMEZONE, TVA_RATES } from '../../shared/domain';
import { nowISO, one } from '../db';
import { hashPassword } from '../lib/crypto';
import { fail } from '../lib/errors';
import { logActivity } from '../lib/audit';
import { validatePassword } from '../lib/passwords';
import { parseInput } from '../lib/validation';
import { loadCompany } from '../middleware';
import { seedDemoData } from '../services/seed';
import type { AppEnv } from '../types';

const setupSchema = z.object({
  company: z.object({
    name: z.string().trim().min(2).max(120),
    legal_name: z.string().trim().max(160).optional().default(''),
    email: z.string().trim().email().max(190).optional().or(z.literal('')),
    phone: z.string().trim().max(40).optional().default(''),
    address1: z.string().trim().max(160).optional().default(''),
    address2: z.string().trim().max(160).optional().default(''),
    city: z.string().trim().max(80).optional().default(''),
    postal_code: z.string().trim().max(20).optional().default(''),
    tax_id: z
      .string()
      .trim()
      .max(20)
      .regex(/^[A-Za-z]\d{5}$/, 'invalid_tahiti_number')
      .optional()
      .or(z.literal('')),
    rcs: z.string().trim().max(40).optional().default(''),
    share_capital: z.string().trim().max(40).optional().default(''),
    vat_regime: z.enum(['standard', 'franchise']).default('standard'),
    default_tax_rate: z.coerce.number().int().min(0).max(100).default(16),
    payment_terms: z.coerce.number().int().min(0).max(365).default(30),
    invoice_terms: z.string().trim().max(1000).optional().default(''),
    invoice_footer: z.string().trim().max(500).optional().default(''),
  }),
  admin: z.object({
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    email: z.string().trim().toLowerCase().email().max(190),
    password: z.string().min(1).max(200),
  }),
  demo_data: z.boolean().default(false),
});

const DEFAULT_TERMS =
  'Paiement à réception de facture. Passé ce délai, une pénalité de retard de 10 % et une indemnité forfaitaire de recouvrement de 5 000 F CFP sont applicables.';
const DEFAULT_FOOTER = 'Merci de votre confiance.';
const FRANCHISE_NOTE = 'TVA non applicable, franchise en base.';

export const setupRoutes = new Hono<AppEnv>();

setupRoutes.get('/status', async (c) => {
  const company = await loadCompany(c.env.DB);
  if (!company) return c.json({ configured: false });
  return c.json({ configured: true, company_name: company.name, currency: company.currency });
});

setupRoutes.post('/install', async (c) => {
  const existing = await loadCompany(c.env.DB);
  if (existing) return fail(409, 'ALREADY_CONFIGURED');

  const body = parseInput(setupSchema, await c.req.json().catch(() => ({})));
  validatePassword({
    password: body.admin.password,
    email: body.admin.email,
    firstName: body.admin.first_name,
    lastName: body.admin.last_name,
  });

  const now = nowISO();
  const companyId = crypto.randomUUID();
  const userId = crypto.randomUUID();
  const currency = DEFAULT_CURRENCY;
  const passwordHash = await hashPassword(body.admin.password);

  const companyStatement = c.env.DB.prepare(
    `INSERT INTO company (id, name, legal_name, email, phone, address1, address2, city, postal_code, country,
      timezone, currency, locale, tax_id, rcs, share_capital, vat_regime, default_tax_rate, payment_terms,
      number_pattern, invoice_terms, invoice_footer, legal_notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Polynésie française', ?, ?, ?, ?, ?, ?, ?, ?, ?, '{prefix}-{YYYY}-{####}', ?, ?, ?, ?, ?)`,
  ).bind(
    companyId,
    body.company.name,
    body.company.legal_name || null,
    body.company.email || null,
    body.company.phone || null,
    body.company.address1 || null,
    body.company.address2 || null,
    body.company.city || null,
    body.company.postal_code || null,
    DEFAULT_TIMEZONE,
    currency,
    DEFAULT_LOCALE,
    body.company.tax_id || null,
    body.company.rcs || null,
    body.company.share_capital || null,
    body.company.vat_regime,
    body.company.default_tax_rate,
    body.company.payment_terms,
    body.company.invoice_terms || DEFAULT_TERMS,
    body.company.invoice_footer || DEFAULT_FOOTER,
    body.company.vat_regime === 'franchise' ? FRANCHISE_NOTE : null,
    now,
    now,
  );

  const userStatement = c.env.DB.prepare(
    `INSERT INTO users (id, email, password_hash, first_name, last_name, role, is_active, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'owner', 1, ?, ?)`,
  ).bind(userId, body.admin.email, passwordHash, body.admin.first_name, body.admin.last_name, now, now);

  await c.env.DB.batch([companyStatement, userStatement]);

  const taxStatements = TVA_RATES.filter((rate) => rate.rate > 0).map((rate) =>
    c.env.DB.prepare(
      `INSERT INTO tax_rates (id, name, rate, is_default, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      rate.label,
      rate.rate,
      rate.rate === body.company.default_tax_rate ? 1 : 0,
      now,
    ),
  );
  if (taxStatements.length) await c.env.DB.batch(taxStatements);

  await logActivity(c.env.DB, {
    userId,
    action: 'created',
    entityType: 'company',
    entityId: companyId,
    summary: 'activity.company_installed',
    meta: { name: body.company.name },
  });

  if (body.demo_data) {
    await seedDemoData({
      db: c.env.DB,
      companyId,
      userId,
      currency,
      timezone: DEFAULT_TIMEZONE,
      taxRate: body.company.default_tax_rate,
    });
  }

  await one(
    c.env.DB
      .prepare(
        `INSERT INTO app_meta (key, value) VALUES ('installed_at', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .bind(now),
  );

  return c.json({ configured: true }, 201);
});
