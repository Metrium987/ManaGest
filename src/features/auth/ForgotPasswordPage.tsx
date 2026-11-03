import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowLeft, Mail, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';

/** Public screen: requests a one-hour reset link, without revealing accounts. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const request = useMutation({
    mutationFn: () => api.post('/auth/forgot-password', { email }),
    onSuccess: () => {
      setError(null);
      setSent(true);
    },
    onError: (failure) => setError(errorMessage(failure)),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    request.mutate();
  };

  return (
    <AuthLayout>
      <div className="card p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{t('auth.secured')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-950">{t('auth.forgotTitle')}</h1>
          <p className="mt-1.5 text-sm text-muted">{t('auth.forgotSubtitle')}</p>
        </div>

        {error ? (
          <div className="mb-5 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700" role="alert">
            {error}
          </div>
        ) : null}

        {sent ? (
          <p className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-800" role="status">
            {t('auth.forgotSent')}
          </p>
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field label={t('auth.email')} htmlFor="forgot_email" required>
              <Input
                id="forgot_email"
                type="email"
                autoComplete="email"
                autoFocus
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            <Button type="submit" loading={request.isPending} className="w-full" icon={<Send className="h-4 w-4" aria-hidden="true" />}>
              {t('auth.forgotSubmit')}
            </Button>
          </form>
        )}

        <Link to="/connexion" className="mt-5 flex items-center justify-center gap-1.5 text-sm text-muted hover:text-ink-800">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('auth.forgotBack')}
        </Link>

        <p className="mt-4 text-center text-xs text-muted">
          <Mail className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
          {t('auth.noTestWithoutClick')}
        </p>
      </div>
    </AuthLayout>
  );
}
