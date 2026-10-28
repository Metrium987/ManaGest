import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Eye, EyeOff, Lock, ShieldCheck } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { AuthLayout } from '@/components/layout/AuthLayout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';

export function LoginPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { needsSetup } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const showLoginError = (err: unknown) => {
    if (err instanceof ApiError) {
      setError(t(`errors.${err.code}`) === `errors.${err.code}` ? t('errors.generic') : t(`errors.${err.code}`, err.details ?? undefined));
    } else {
      setError(t('errors.generic'));
    }
  };

  const login = useMutation({
    mutationFn: () => api.post<{ mfa_required?: boolean; challenge?: string }>('/auth/login', { email, password }),
    onSuccess: async (result) => {
      if (result?.mfa_required && result.challenge) {
        setError(null);
        setChallenge(result.challenge);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
    onError: showLoginError,
  });

  const verifyMfa = useMutation({
    mutationFn: () => api.post('/auth/mfa/verify', { challenge, code }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    },
    onError: showLoginError,
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    setError(null);
    if (!email || !password) return;
    login.mutate();
  };

  const submitCode = (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (code.trim().length < 4) return;
    verifyMfa.mutate();
  };

  return (
    <AuthLayout>
      <div className="card p-6 sm:p-8">
        <div className="mb-6">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">{t('auth.secured')}</p>
          <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight text-ink-950">
            {challenge ? t('mfa.loginTitle') : t('auth.loginTitle')}
          </h1>
          <p className="mt-1.5 text-sm text-muted">
            {challenge ? t('mfa.loginHint') : t('auth.loginSubtitle')}
          </p>
        </div>

        {error ? (
          <div className="mb-5 rounded-xl border border-danger-200 bg-danger-50 px-4 py-3 text-sm font-medium text-danger-700" role="alert">
            {error}
          </div>
        ) : null}

        {challenge ? (
          <form onSubmit={submitCode} noValidate className="space-y-4">
            <Field label={t('mfa.loginLabel')} htmlFor="mfa_code" required hint={t('mfa.loginRecoveryHint')}>
              <Input
                id="mfa_code"
                name="one-time-code"
                autoComplete="one-time-code"
                inputMode="numeric"
                maxLength={10}
                autoFocus
                value={code}
                onChange={(event) => setCode(event.target.value)}
                placeholder="123456"
                required
              />
            </Field>
            <Button type="submit" loading={verifyMfa.isPending} className="w-full" icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}>
              {t('mfa.loginSubmit')}
            </Button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setCode('');
                setError(null);
              }}
              className="flex w-full items-center justify-center gap-1.5 text-sm text-muted hover:text-ink-800"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> {t('mfa.loginBack')}
            </button>
          </form>
        ) : (
        <form onSubmit={submit} noValidate className="space-y-4">
          <Field label={t('auth.email')} htmlFor="email" required error={touched && !email ? t('validation.required') : undefined}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={touched && !email ? true : undefined}
              placeholder="vous@entreprise.pf"
              required
            />
          </Field>

          <Field label={t('auth.password')} htmlFor="password" required error={touched && !password ? t('validation.required') : undefined}>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="pr-11"
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-lg p-2 text-muted hover:bg-surface hover:text-ink-800"
                aria-label={showPassword ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
                aria-pressed={showPassword}
              >
                {showPassword ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
              </button>
            </div>
          </Field>

          <Button type="submit" loading={login.isPending} className="w-full" icon={<Lock className="h-4 w-4" aria-hidden="true" />}>
            {login.isPending ? t('auth.signingIn') : t('auth.signIn')}
          </Button>
        </form>
        )}

        {!challenge ? (
        <div className="mt-5 flex items-start gap-2 rounded-xl bg-surface px-3.5 py-3 text-xs text-muted">
          <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <p>{t('auth.forgotHint')}</p>
        </div>
        ) : null}

        {needsSetup ? (
          <div className="mt-4 rounded-xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm">
            <Link to="/installation" className="font-semibold text-brand-700 underline underline-offset-2">
              {t('auth.demoHint')}
            </Link>
          </div>
        ) : null}
      </div>

      <p className="mt-6 text-center text-xs text-muted">
        © {new Date().getFullYear()} {t('app.name')} · {t('auth.localSignature')}
      </p>
    </AuthLayout>
  );
}
