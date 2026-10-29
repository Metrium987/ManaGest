import { useId, type ComponentProps } from 'react';
import type { Permission } from '@shared/domain';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { Button } from './Button';

type ButtonProps = ComponentProps<typeof Button>;

/**
 * Button gating policy (T-203): an action the session cannot perform stays
 * **visible and disabled**, with the reason next to it, instead of disappearing.
 * A hidden button teaches nothing; a disabled one says which permission is
 * missing — and the server still refuses the call, this is only the explanation.
 */
export function GatedButton({
  permission,
  reason,
  ...props
}: ButtonProps & { permission: Permission; reason?: string }) {
  const { can } = useSession();
  const hintId = useId();
  const explanation = reason ?? t('gating.reason', { permission });

  if (can(permission)) return <Button {...props} />;

  return (
    <span className="inline-flex flex-col items-end gap-1">
      <Button {...props} disabled aria-describedby={hintId} title={explanation} />
      <span id={hintId} className="max-w-[16rem] text-right text-[11px] leading-tight text-muted">
        {explanation}
      </span>
    </span>
  );
}

/** The same reason, for a control that is not a Button. */
export function permissionReason(permission: Permission): string {
  return t('gating.reason', { permission });
}
