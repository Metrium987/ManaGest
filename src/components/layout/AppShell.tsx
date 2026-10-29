import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Activity, BarChart3, Briefcase, Building2, Calculator, ChevronDown, ClipboardCheck, CreditCard, FileText, FolderKanban,
  Landmark, LayoutDashboard, ListChecks, LogOut, Menu, Package, Plus, Receipt, RefreshCw,
  Search, Settings, ShieldCheck, ShoppingCart, Upload, Users, Wallet, X,
} from 'lucide-react';
import type { Permission } from '@shared/domain';
import { api, toQuery } from '@/lib/api';
import { t } from '@/lib/i18n';
import { initials } from '@/lib/format';
import { useSession } from '@/lib/session';
import { Avatar } from '@/components/ui/Layout';
import { RecordDrawerHost } from '@/components/ui/RecordDrawer';

interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false' }>;
  permission: Permission;
  end?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const NAV: NavSection[] = [
  {
    title: 'nav.main',
    items: [
      { to: '/', label: 'nav.dashboard', icon: LayoutDashboard, permission: 'reports.read', end: true },
      { to: '/rapports', label: 'nav.reports', icon: BarChart3, permission: 'reports.read' },
    ],
  },
  {
    title: 'nav.sales',
    items: [
      { to: '/clients', label: 'nav.clients', icon: Users, permission: 'clients.read' },
      { to: '/devis', label: 'nav.quotes', icon: FileText, permission: 'quotes.read' },
      { to: '/factures', label: 'nav.invoices', icon: Receipt, permission: 'invoices.read' },
      { to: '/factures-recurrentes', label: 'nav.recurring', icon: RefreshCw, permission: 'recurring.read' },
      { to: '/avoirs', label: 'nav.credits', icon: CreditCard, permission: 'credits.read' },
      { to: '/paiements', label: 'nav.payments', icon: Wallet, permission: 'payments.read' },
    ],
  },
  {
    title: 'nav.operations',
    items: [
      { to: '/produits', label: 'nav.products', icon: Package, permission: 'products.read' },
      { to: '/depenses', label: 'nav.expenses', icon: ShoppingCart, permission: 'expenses.read' },
      { to: '/fournisseurs', label: 'nav.vendors', icon: Building2, permission: 'vendors.read' },
      { to: '/bons-de-commande', label: 'nav.purchaseOrders', icon: Briefcase, permission: 'purchase_orders.read' },
      { to: '/projets', label: 'nav.projects', icon: FolderKanban, permission: 'projects.read' },
      { to: '/taches', label: 'nav.tasks', icon: ListChecks, permission: 'tasks.read' },
    ],
  },
  {
    title: 'nav.finance',
    items: [
      { to: '/banque', label: 'nav.bank', icon: Landmark, permission: 'bank.read' },
      { to: '/comptabilite', label: 'nav.accounting', icon: Calculator, permission: 'accounting.read' },
      { to: '/approbations', label: 'nav.approvals', icon: ClipboardCheck, permission: 'approvals.read' },
    ],
  },
  {
    title: 'nav.admin',
    items: [
      { to: '/parametres', label: 'nav.settings', icon: Settings, permission: 'settings.read' },
      { to: '/parametres/utilisateurs', label: 'nav.users', icon: ShieldCheck, permission: 'users.read' },
      { to: '/journal', label: 'nav.activity', icon: Activity, permission: 'activity.read' },
      { to: '/importer', label: 'nav.import', icon: Upload, permission: 'clients.write' },
    ],
  },
];

function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link to="/" className="flex items-center gap-2.5 rounded-lg" aria-label={t('app.name')}>
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/15">
        <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
          <path d="M6 23V10l6 8 6-8v13" fill="none" stroke="#F5F1E6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M20 20c2-2 4-2 6 0" fill="none" stroke="#F2A93B" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      </span>
      {!compact ? (
        <span>
          <span className="block font-display text-base font-semibold tracking-tight text-white">{t('app.name')}</span>
          <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-white/45">{t('app.tagline')}</span>
        </span>
      ) : null}
    </Link>
  );
}

function GlobalSearch() {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const query = value.trim();

  const results = useQuery({
    queryKey: ['search', query],
    queryFn: () =>
      api.get<{
        clients: { id: string; display_name: string; email: string | null }[];
        invoices: { id: string; number: string; total: number; status: string }[];
        quotes: { id: string; number: string; total: number; status: string }[];
      }>(`/search${toQuery({ q: query })}`),
    enabled: query.length >= 2,
    staleTime: 5_000,
  });

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const hasResults = Boolean(
    results.data &&
      (results.data.clients.length || results.data.invoices.length || results.data.quotes.length),
  );

  const go = (path: string) => {
    setOpen(false);
    setValue('');
    navigate(path);
  };

  return (
    <div className="relative hidden w-full max-w-md lg:block" ref={containerRef}>
      <label htmlFor="global-search" className="sr-only">{t('nav.search')}</label>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" aria-hidden="true" />
      <input
        id="global-search"
        type="search"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('nav.searchPlaceholder')}
        className="input h-10 bg-surface/70 pl-9"
        autoComplete="off"
        aria-controls="global-search-results"
        aria-expanded={open && query.length >= 2}
      />
      {open && query.length >= 2 ? (
        <div
          id="global-search-results"
          className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-xl border border-line bg-white shadow-[var(--shadow-pop)]"
        >
          {results.isFetching ? (
            <p className="px-4 py-3 text-sm text-muted">{t('common.loading')}</p>
          ) : hasResults ? (
            <ul className="max-h-80 overflow-y-auto py-1 text-sm">
              {results.data!.clients.map((client) => (
                <li key={`c-${client.id}`}>
                  <button type="button" onClick={() => go(`/clients/${client.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface">
                    <Users className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span className="flex-1 truncate">{client.display_name}</span>
                    <span className="text-xs text-muted">Client</span>
                  </button>
                </li>
              ))}
              {results.data!.invoices.map((invoice) => (
                <li key={`i-${invoice.id}`}>
                  <button type="button" onClick={() => go(`/factures/${invoice.id}`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface">
                    <Receipt className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span className="flex-1 truncate">{invoice.number}</span>
                    <span className="text-xs text-muted">Facture</span>
                  </button>
                </li>
              ))}
              {results.data!.quotes.map((quote) => (
                <li key={`q-${quote.id}`}>
                  <button type="button" onClick={() => go(`/devis`)} className="flex w-full items-center gap-3 px-4 py-2 text-left hover:bg-surface">
                    <FileText className="h-4 w-4 text-muted" aria-hidden="true" />
                    <span className="flex-1 truncate">{quote.number}</span>
                    <span className="text-xs text-muted">Devis</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-muted">{t('common.noResults')}</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Global quick-add, mirroring Invoice Ninja's "+" in the navigation: one entry
 * point for creating a record from anywhere, gated by the same permissions the
 * server enforces. Records whose creation dialog lives on a list page are
 * reached through the `?nouveau=1` flag.
 */
function QuickAdd({ can }: { can: (permission: Permission) => boolean }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const items = [
    { to: '/factures/nouvelle', label: t('invoices.new'), icon: Receipt, permission: 'invoices.write' as Permission },
    { to: '/devis/nouveau', label: t('quotes.new'), icon: FileText, permission: 'quotes.write' as Permission },
    { to: '/clients?nouveau=1', label: t('clients.new'), icon: Users, permission: 'clients.write' as Permission },
    { to: '/paiements?nouveau=1', label: t('payments.new'), icon: Wallet, permission: 'payments.write' as Permission },
    { to: '/depenses?nouveau=1', label: t('expenses.new'), icon: ShoppingCart, permission: 'expenses.write' as Permission },
    { to: '/produits?nouveau=1', label: t('products.new'), icon: Package, permission: 'products.write' as Permission },
  ].filter((item) => can(item.permission));

  useEffect(() => setOpen(false), [location.pathname]);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (!items.length) return null;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="btn btn-primary btn-sm"
        aria-label={t('quickAdd.hint')}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
        <span className="hidden sm:inline">{t('quickAdd.title')}</span>
      </button>
      {open ? (
        <div
          className="absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-xl border border-line bg-white py-1 shadow-[var(--shadow-pop)]"
          role="menu"
          aria-label={t('quickAdd.title')}
        >
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <Link key={item.to} to={item.to} role="menuitem" className="flex items-center gap-3 px-3.5 py-2.5 text-sm text-ink-800 hover:bg-surface">
                <Icon className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function AppShell() {
  const { user, company, can, logout } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    setMobileOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  const sections = useMemo(
    () =>
      NAV.map((section) => ({
        ...section,
        items: section.items.filter((item) => can(item.permission)),
      })).filter((section) => section.items.length > 0),
    [can],
  );

  const sidebar = (
    <div className="flex h-full flex-col bg-ink-950">
      <div className="flex h-16 items-center justify-between px-4">
        <Brand />
        <button
          type="button"
          onClick={() => setMobileOpen(false)}
          className="rounded-lg p-2 text-white/60 hover:bg-white/10 hover:text-white lg:hidden"
          aria-label={t('nav.closeMenu')}
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 pb-6 pt-2" aria-label={t('nav.main')}>
        {sections.map((section) => (
          <div key={section.title}>
            <p className="section-title">{t(section.title)}</p>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <NavLink to={item.to} end={item.end} className="nav-link">
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span>{t(item.label)}</span>
                    </NavLink>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="border-t border-white/10 p-3">
        <div className="flex items-center gap-2.5 rounded-xl bg-white/5 p-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-sand-400/90 text-xs font-bold text-ink-950">
            {initials(user?.first_name, user?.last_name)}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold text-white">{user?.first_name} {user?.last_name}</p>
            <p className="truncate text-[11px] text-white/50">{company?.name}</p>
          </div>
          <button
            type="button"
            onClick={logout}
            className="rounded-lg p-1.5 text-white/50 transition hover:bg-white/10 hover:text-white"
            aria-label={t('nav.logout')}
            title={t('nav.logout')}
          >
            <LogOut className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      <a href="#contenu" data-skip-link>{t('app.skip')}</a>
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 lg:block">{sidebar}</aside>

      {mobileOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50" onClick={() => setMobileOpen(false)} aria-hidden="true" />
          <aside className="relative h-full w-72 max-w-[85%] shadow-2xl">{sidebar}</aside>
        </div>
      ) : null}

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-white/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="rounded-lg p-2 text-ink-700 hover:bg-surface lg:hidden"
            aria-label={t('nav.openMenu')}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
          <div className="hidden min-w-0 flex-1 sm:block">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted">{company?.name}</p>
          </div>
          <div className="flex flex-1 justify-end gap-2 lg:flex-none lg:basis-1/2">
            <GlobalSearch />
          </div>
          <QuickAdd can={can} />
          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((value) => !value)}
              className="flex items-center gap-2 rounded-lg p-1 hover:bg-surface"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
            >
              <Avatar initials={initials(user?.first_name, user?.last_name)} size="sm" />
              <ChevronDown className="hidden h-4 w-4 text-muted sm:block" aria-hidden="true" />
              <span className="sr-only">{t('nav.profile')}</span>
            </button>
            {menuOpen ? (
              <div className="absolute right-0 top-11 z-30 w-56 overflow-hidden rounded-xl border border-line bg-white shadow-[var(--shadow-pop)]" role="menu">
                <div className="border-b border-line px-3 py-2.5">
                  <p className="text-sm font-semibold text-ink-900">{user?.first_name} {user?.last_name}</p>
                  <p className="truncate text-xs text-muted">{user?.email}</p>
                </div>
                <Link to="/profil" className="block px-3 py-2 text-sm hover:bg-surface" role="menuitem">
                  {t('nav.profile')}
                </Link>
                <Link to="/parametres" className="block px-3 py-2 text-sm hover:bg-surface" role="menuitem">
                  {t('nav.settings')}
                </Link>
                <button
                  type="button"
                  onClick={logout}
                  className="block w-full px-3 py-2 text-left text-sm text-danger-600 hover:bg-danger-50"
                  role="menuitem"
                >
                  {t('nav.logout')}
                </button>
              </div>
            ) : null}
          </div>
        </header>

        <main id="contenu" className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8">
          <Outlet />
        </main>
      </div>
      {/* One detail drawer for every list (T-201a/b/c). */}
      <RecordDrawerHost />
    </div>
  );
}
