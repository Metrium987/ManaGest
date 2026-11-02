import type { ReactNode } from 'react';
import type { Permission } from '@shared/domain';
import { useSession } from '@/lib/session';
import { t } from '@/lib/i18n';
import { Spinner } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Layout';

/** Shown instead of the page when the account lacks its permission. */
export function DeniedScreen() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center p-6">
      <EmptyState title={t('settings.permissionDenied')} description={t('errors.FORBIDDEN')} />
    </div>
  );
}

/**
 * Client-side companion to `requirePermission`. The server already answers 403;
 * this stops a typed address from opening an empty page, and gives the access
 * tests something real to render for each role.
 */
export function RequirePermission({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { can, isLoading } = useSession();
  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (!can(permission)) return <DeniedScreen />;
  return <>{children}</>;
}
