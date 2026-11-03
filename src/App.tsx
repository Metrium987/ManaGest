import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { CLIENT_ROUTES } from '@/lib/access';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n';
import { AppShell } from '@/components/layout/AppShell';
import { RequirePermission } from '@/components/layout/RouteGuard';
import { Spinner } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Layout';
import { LoginPage } from '@/features/auth/LoginPage';
import { SetupPage } from '@/features/auth/SetupPage';
import { ForgotPasswordPage } from '@/features/auth/ForgotPasswordPage';
import { ResetPasswordPage } from '@/features/auth/ResetPasswordPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { ClientsPage } from '@/features/clients/ClientsPage';
import { ClientDetailPage } from '@/features/clients/ClientDetailPage';
import { InvoicesPage } from '@/features/invoices/InvoicesPage';
import { InvoiceFormPage } from '@/features/invoices/InvoiceFormPage';
import { InvoiceDetailPage } from '@/features/invoices/InvoiceDetailPage';
import { QuotesPage } from '@/features/quotes/QuotesPage';
import { QuoteFormPage } from '@/features/quotes/QuoteFormPage';
import { QuoteDetailPage } from '@/features/quotes/QuoteDetailPage';
import { PaymentsPage } from '@/features/payments/PaymentsPage';
import { CreditsPage } from '@/features/credits/CreditsPage';
import { RecurringPage } from '@/features/recurring/RecurringPage';
import { ProductsPage } from '@/features/products/ProductsPage';
import { CountingPage } from '@/features/inventory/CountingPage';
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { VendorsPage } from '@/features/vendors/VendorsPage';
import { PurchaseOrdersPage } from '@/features/purchaseOrders/PurchaseOrdersPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { PlanningPage } from '@/features/planning/PlanningPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { BankPage } from '@/features/bank/BankPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { AccountingPage } from '@/features/accounting/AccountingPage';
import { ApprovalsPage } from '@/features/approvals/ApprovalsPage';
import { ImportPage } from '@/features/import/ImportPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsersPage } from '@/features/settings/UsersPage';
import { ActivityPage } from '@/features/settings/ActivityPage';
import { ProfilePage } from '@/features/settings/ProfilePage';
import { PublicDocumentPage } from '@/features/public/PublicDocumentPage';

function ProtectedShell() {
  const { isAuthenticated, isLoading, needsSetup } = useSession();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (needsSetup) return <Navigate to="/installation" replace />;
  if (!isAuthenticated) return <Navigate to="/connexion" replace state={{ from: location.pathname }} />;
  return <AppShell />;
}

function PublicOnly({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading } = useSession();
  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (isAuthenticated) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/**
 * One element per screen. Keys are exactly the paths declared in
 * `CLIENT_ROUTES`; the access test fails when the two lists drift apart, so a
 * new page cannot be routed without also declaring its permission.
 */
const PAGE_ELEMENTS: Record<string, ReactNode> = {
  '': <DashboardPage />,
  'clients': <ClientsPage />,
  'clients/:id': <ClientDetailPage />,
  'factures': <InvoicesPage />,
  'factures/nouvelle': <InvoiceFormPage />,
  'factures/:id': <InvoiceDetailPage />,
  'factures/:id/modifier': <InvoiceFormPage />,
  'devis': <QuotesPage />,
  'devis/nouveau': <QuoteFormPage />,
  'devis/:id': <QuoteDetailPage />,
  'devis/:id/modifier': <QuoteFormPage />,
  'paiements': <PaymentsPage />,
  'avoirs': <CreditsPage />,
  'factures-recurrentes': <RecurringPage />,
  'produits': <ProductsPage />,
  'inventaire': <CountingPage />,
  'depenses': <ExpensesPage />,
  'fournisseurs': <VendorsPage />,
  'bons-de-commande': <PurchaseOrdersPage />,
  'projets': <ProjectsPage />,
  'planification': <PlanningPage />,
  'taches': <TasksPage />,
  'banque': <BankPage />,
  'rapports': <ReportsPage />,
  'comptabilite': <AccountingPage />,
  'approbations': <ApprovalsPage />,
  'parametres': <SettingsPage />,
  'parametres/utilisateurs': <UsersPage />,
  'importer': <ImportPage />,
  'journal': <ActivityPage />,
  'profil': <ProfilePage />,
};

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/mot-de-passe-oublie" element={<PublicOnly><ForgotPasswordPage /></PublicOnly>} />
      {/* The link arrives by e-mail; no session is needed to consume it. */}
      <Route path="/reinitialiser-mot-de-passe" element={<PublicOnly><ResetPasswordPage /></PublicOnly>} />
      <Route path="/installation" element={<SetupPage />} />
      {/* T-103: a client opens this page from a public link; no session needed. */}
      <Route path="/p/:token" element={<PublicDocumentPage />} />

      <Route element={<ProtectedShell />}>
        {CLIENT_ROUTES.map((route) => {
          const page = PAGE_ELEMENTS[route.path];
          const element = route.permission
            ? <RequirePermission permission={route.permission}>{page}</RequirePermission>
            : page;
          return route.path === ''
            ? <Route key="index" index element={element} />
            : <Route key={route.path} path={route.path} element={element} />;
        })}
      </Route>

      <Route
        path="*"
        element={
          <div className="flex min-h-screen items-center justify-center p-6">
            <EmptyState
              title="Page introuvable"
              description={t('errors.NOT_FOUND')}
              action={<a href="/" className="btn btn-primary">{t('nav.dashboard')}</a>}
            />
          </div>
        }
      />
    </Routes>
  );
}
