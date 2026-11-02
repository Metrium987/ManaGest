import type { Permission } from '@shared/domain';

/**
 * Every authenticated screen, with the permission that opens it. `null` means
 * "any signed-in account" (the profile page).
 *
 * This file is the single source the router, the menu and the access tests read:
 * a screen cannot appear in the app without a line here, and the tests fail when
 * `App.tsx`, `AppShell.tsx` and this list drift apart.
 */
export interface ClientRoute {
  path: string;
  permission: Permission | null;
}

export const CLIENT_ROUTES: ClientRoute[] = [
  { path: '', permission: 'reports.read' },
  { path: 'clients', permission: 'clients.read' },
  { path: 'clients/:id', permission: 'clients.read' },
  { path: 'factures', permission: 'invoices.read' },
  { path: 'factures/nouvelle', permission: 'invoices.write' },
  { path: 'factures/:id', permission: 'invoices.read' },
  { path: 'factures/:id/modifier', permission: 'invoices.write' },
  { path: 'devis', permission: 'quotes.read' },
  { path: 'devis/nouveau', permission: 'quotes.write' },
  { path: 'devis/:id', permission: 'quotes.read' },
  { path: 'devis/:id/modifier', permission: 'quotes.write' },
  { path: 'paiements', permission: 'payments.read' },
  { path: 'avoirs', permission: 'credits.read' },
  { path: 'factures-recurrentes', permission: 'recurring.read' },
  { path: 'produits', permission: 'products.read' },
  { path: 'inventaire', permission: 'products.read' },
  { path: 'depenses', permission: 'expenses.read' },
  { path: 'fournisseurs', permission: 'vendors.read' },
  { path: 'bons-de-commande', permission: 'purchase_orders.read' },
  { path: 'projets', permission: 'projects.read' },
  { path: 'planification', permission: 'projects.read' },
  { path: 'taches', permission: 'tasks.read' },
  { path: 'banque', permission: 'bank.read' },
  { path: 'rapports', permission: 'reports.read' },
  { path: 'comptabilite', permission: 'accounting.read' },
  { path: 'approbations', permission: 'approvals.read' },
  { path: 'parametres', permission: 'settings.read' },
  { path: 'parametres/utilisateurs', permission: 'users.read' },
  { path: 'importer', permission: 'clients.write' },
  { path: 'journal', permission: 'activity.read' },
  { path: 'profil', permission: null },
];

/** Public screens: no session and no permission. */
export const PUBLIC_ROUTES = ['/connexion', '/installation', '/p/:token', '*'] as const;

/** True when a set of permissions opens the screen declared at `path`. */
export function canOpenPath(permissions: readonly string[], path: string): boolean {
  const route = CLIENT_ROUTES.find((entry) => entry.path === path.replace(/^\//, ''));
  if (!route) return false;
  return route.permission === null || permissions.includes(route.permission);
}
