import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n';
import { AppShell } from '@/components/layout/AppShell';
import { Spinner } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Layout';
import { LoginPage } from '@/features/auth/LoginPage';
import { SetupPage } from '@/features/auth/SetupPage';
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
import { ExpensesPage } from '@/features/expenses/ExpensesPage';
import { VendorsPage } from '@/features/vendors/VendorsPage';
import { PurchaseOrdersPage } from '@/features/purchaseOrders/PurchaseOrdersPage';
import { ProjectsPage } from '@/features/projects/ProjectsPage';
import { TasksPage } from '@/features/tasks/TasksPage';
import { BankPage } from '@/features/bank/BankPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { UsersPage } from '@/features/settings/UsersPage';
import { ActivityPage } from '@/features/settings/ActivityPage';
import { ProfilePage } from '@/features/settings/ProfilePage';

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

function PublicOnly({ children }: { children: React.ReactNode }) {
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

export default function App() {
  return (
    <Routes>
      <Route path="/connexion" element={<PublicOnly><LoginPage /></PublicOnly>} />
      <Route path="/installation" element={<SetupPage />} />

      <Route element={<ProtectedShell />}>
        <Route index element={<DashboardPage />} />
        <Route path="clients" element={<ClientsPage />} />
        <Route path="clients/:id" element={<ClientDetailPage />} />
        <Route path="factures" element={<InvoicesPage />} />
        <Route path="factures/nouvelle" element={<InvoiceFormPage />} />
        <Route path="factures/:id" element={<InvoiceDetailPage />} />
        <Route path="factures/:id/modifier" element={<InvoiceFormPage />} />
        <Route path="devis" element={<QuotesPage />} />
        <Route path="devis/nouveau" element={<QuoteFormPage />} />
        <Route path="devis/:id" element={<QuoteDetailPage />} />
        <Route path="devis/:id/modifier" element={<QuoteFormPage />} />
        <Route path="paiements" element={<PaymentsPage />} />
        <Route path="avoirs" element={<CreditsPage />} />
        <Route path="factures-recurrentes" element={<RecurringPage />} />
        <Route path="produits" element={<ProductsPage />} />
        <Route path="depenses" element={<ExpensesPage />} />
        <Route path="fournisseurs" element={<VendorsPage />} />
        <Route path="bons-de-commande" element={<PurchaseOrdersPage />} />
        <Route path="projets" element={<ProjectsPage />} />
        <Route path="taches" element={<TasksPage />} />
        <Route path="banque" element={<BankPage />} />
        <Route path="rapports" element={<ReportsPage />} />
        <Route path="parametres" element={<SettingsPage />} />
        <Route path="parametres/utilisateurs" element={<UsersPage />} />
        <Route path="journal" element={<ActivityPage />} />
        <Route path="profil" element={<ProfilePage />} />
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
