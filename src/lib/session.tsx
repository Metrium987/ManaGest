import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Permission } from '@shared/domain';
import { api, ApiError } from './api';
import { setFormatLocale, setFormatTimezone } from './format';
import type { Company, MeResponse, User } from './types';

interface SessionContextValue {
  user: User | null;
  company: Company | null;
  permissions: Permission[];
  isLoading: boolean;
  isAuthenticated: boolean;
  needsSetup: boolean;
  can: (permission: Permission) => boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const meQuery = useQuery<MeResponse>({
    queryKey: ['me'],
    queryFn: () => api.get<MeResponse>('/auth/me'),
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  // The company row carries the rendering settings: apply them as soon as they
  // load so every screen formats dates and amounts the way the business is set
  // up, not the way the code was written.
  const company = meQuery.data?.company ?? null;
  useEffect(() => {
    setFormatLocale(company?.locale);
    setFormatTimezone(company?.timezone);
  }, [company?.locale, company?.timezone]);

  const error = meQuery.error;
  const needsSetup = error instanceof ApiError && error.code === 'SETUP_REQUIRED';

  const can = useCallback(
    (permission: Permission) => (meQuery.data?.permissions ?? []).includes(permission),
    [meQuery.data],
  );

  const refetch = useCallback(async () => {
    await meQuery.refetch();
  }, [meQuery]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      queryClient.clear();
      window.location.assign('/connexion');
    }
  }, [queryClient]);

  const value = useMemo<SessionContextValue>(
    () => ({
      user: meQuery.data?.user ?? null,
      company: meQuery.data?.company ?? null,
      permissions: meQuery.data?.permissions ?? [],
      isLoading: meQuery.isLoading,
      isAuthenticated: Boolean(meQuery.data?.user),
      needsSetup,
      can,
      refetch,
      logout,
    }),
    [meQuery.data, meQuery.isLoading, needsSetup, can, refetch, logout],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside SessionProvider');
  return context;
}
