import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, KeyRound } from 'lucide-react';
import { ApiError, api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';

/** Public screen: consumes the single-use link from the reset e-mail. */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = useMutation({
    mutationFn: () => api.post('/auth/reset-password', { token, password }),
    onSuccess: () => {
      setError(null);
      setDone(true);
    },
    onError: (failure) => {
      setError(failure instanceof ApiError && failure.code === 'INVALID_RESET_TOKEN'
        ? t('auth.resetExpired')
        : errorMessage(failure));
    },
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError(t('auth.resetMismatch'));
      return;
    }
    if (password.length < 12) {
      setError(t('errors.validation'));
      return;
    }
    reset.mutate();
  };

  return (
    <AuthLayout>
      <div className="card p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{t('auth.secured')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-950">
            {done ? t('auth.resetDoneTitle') : t('auth.resetTitle')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {done ? t('auth.resetDoneBody') : t('auth.resetSubtitle')}
          </p>
        </div>

        {error ? (
          <div className="mb-5 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700" role="alert">
            {error}
          </div>
        ) : null}

        {!token ? (
          <p className="rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700" role="alert">
            {t('auth.resetMissingToken')}
          </p>
        ) : done ? (
          <Link to="/connexion" className="btn btn-primary w-full">
            {t('auth.resetGoLogin')}
          </Link>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label={t('auth.resetPassword')} htmlFor="reset_password" hint={t('auth.passwordHint')} required>
              <Input
                id="reset_password"
                type="password"
                autoComplete="new-password"
                autoFocus
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            <Field label={t('auth.resetConfirm')} htmlFor="reset_confirmation" required>
              <Input
                id="reset_confirmation"
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" loading={reset.isPending} className="w-full" icon={<KeyRound className="h-4 w-4" aria-hidden="true" />}>
              {t('auth.resetSubmit')}
            </Button>
          </form>
        )}

        <Link to="/connexion" className="mt-5 flex items-center justify-center gap-1.5 text-sm text-muted hover:text-ink-800">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('auth.forgotBack')}
        </Link>
      </div>
    </AuthLayout>
  );
}
