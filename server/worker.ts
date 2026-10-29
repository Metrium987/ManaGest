import { Hono } from 'hono';
import { ApiError } from './lib/errors';
import { csrfProtection, securityHeaders, withDatabase } from './middleware';
import { accountingRoutes } from './routes/accounting';
import { authRoutes } from './routes/auth';
import { bankRoutes } from './routes/bank';
import { attachmentRoutes } from './routes/attachments';
import { clientRoutes } from './routes/clients';
import { creditRoutes } from './routes/credits';
import { dashboardRoutes, reportRoutes, searchRoutes } from './routes/dashboard';
import { exportRoutes } from './routes/export';
import { filterRoutes } from './routes/filters';
import { emailRoutes } from './routes/email';
import { importRoutes } from './routes/import';
import { invoiceRoutes } from './routes/invoices';
import { roleRoutes } from './routes/roles';
import { runRoutes } from './routes/runs';
import {
  expenseRoutes, projectRoutes, purchaseOrderRoutes, taskRoutes, vendorRoutes,
} from './routes/operations';
import { paymentRoutes } from './routes/payments';
import { productRoutes } from './routes/products';
import { quoteRoutes } from './routes/quotes';
import { recurringRoutes } from './routes/recurring';
import { activityRoutes, settingsRoutes, taxRateRoutes, userRoutes } from './routes/settings';
import { publicDocumentRoutes, publicLinkRoutes } from './routes/public-links';
import { setupRoutes } from './routes/setup';
import type { AppEnv } from './types';

const app = new Hono<AppEnv>();

app.use('*', securityHeaders);
app.use('/api/*', withDatabase);
app.use('/api/*', csrfProtection);

app.get('/api/health', (c) => c.json({ status: 'ok' }));

/**
 * Public interface language (T-010). The sign-in and setup screens are shown
 * before a session exists, so the workspace language is readable without one.
 * It exposes nothing but the language code.
 */
app.get('/api/public/language', async (c) => {
  try {
    const row = await c.env.DB.prepare(`SELECT value FROM settings_extra WHERE key = 'ui_language'`).first<{ value: string }>();
    const value = row?.value === 'en' ? 'en' : 'fr';
    return c.json({ language: value }, 200, { 'Cache-Control': 'no-store' });
  } catch {
    return c.json({ language: 'fr' }, 200, { 'Cache-Control': 'no-store' });
  }
});

app.route('/api/setup', setupRoutes);
app.route('/api/auth', authRoutes);
app.route('/api/clients', clientRoutes);
app.route('/api/products', productRoutes);
app.route('/api/invoices', invoiceRoutes);
app.route('/api/payments', paymentRoutes);
app.route('/api/quotes', quoteRoutes);
app.route('/api/credits', creditRoutes);
app.route('/api/recurring-invoices', recurringRoutes);
app.route('/api/expenses', expenseRoutes);
app.route('/api/vendors', vendorRoutes);
app.route('/api/purchase-orders', purchaseOrderRoutes);
app.route('/api/projects', projectRoutes);
app.route('/api/tasks', taskRoutes);
app.route('/api/attachments', attachmentRoutes);
app.route('/api/bank', bankRoutes);
app.route('/api/dashboard', dashboardRoutes);
app.route('/api/reports', reportRoutes);
app.route('/api/export', exportRoutes);
app.route('/api/email', emailRoutes);
app.route('/api/import', importRoutes);
app.route('/api/search', searchRoutes);
app.route('/api/settings', settingsRoutes);
app.route('/api/tax-rates', taxRateRoutes);
app.route('/api/users', userRoutes);
app.route('/api/activity', activityRoutes);
app.route('/api/public-links', publicLinkRoutes);
app.route('/api/runs', runRoutes);
app.route('/api/roles', roleRoutes);
app.route('/api/filters', filterRoutes);
app.route('/api/accounting', accountingRoutes);
app.route('/api/public/documents', publicDocumentRoutes);

app.all('/api/*', (c) => c.json({ error: { code: 'NOT_FOUND' } }, 404));

app.get('*', async (c) => {
  if (!c.env.ASSETS) return c.text('Not found', 404);
  return c.env.ASSETS.fetch(c.req.raw);
});

app.onError((error, c) => {
  if (error instanceof ApiError) {
    return c.json(
      { error: { code: error.code, details: error.details ?? null } },
      error.status as 400 | 401 | 403 | 404 | 409 | 422 | 429 | 500,
    );
  }
  console.error('Unhandled API error', error);
  return c.json({ error: { code: 'INTERNAL_ERROR' } }, 500);
});

export default app;
