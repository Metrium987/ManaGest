import type { ReactNode } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { t } from '@/lib/i18n';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface lg:grid lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-ink-950 px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.55]"
          aria-hidden="true"
          style={{
            background:
              'radial-gradient(900px 500px at 10% 0%, rgba(14,124,134,0.55), transparent 65%), radial-gradient(700px 460px at 90% 100%, rgba(242,169,59,0.18), transparent 60%)',
          }}
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48 opacity-25"
          aria-hidden="true"
          style={{
            backgroundImage:
              'radial-gradient(circle at 20px 20px, rgba(255,255,255,0.35) 1px, transparent 1px)',
            backgroundSize: '40px 40px',
            maskImage: 'linear-gradient(to top, black, transparent)',
            WebkitMaskImage: 'linear-gradient(to top, black, transparent)',
          }}
        />

        <div className="relative">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/15">
              <svg viewBox="0 0 32 32" className="h-6 w-6" aria-hidden="true">
                <path d="M6 23V10l6 8 6-8v13" fill="none" stroke="#F5F1E6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 20c2-2 4-2 6 0" fill="none" stroke="#F2A93B" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-xl font-semibold tracking-tight">{t('app.name')}</p>
              <p className="text-[11px] uppercase tracking-[0.18em] text-white/45">{t('app.tagline')}</p>
            </div>
          </div>

          <h1 className="mt-16 max-w-md font-display text-4xl font-semibold leading-[1.15] tracking-tight">
            {t('auth.loginIntro')}
          </h1>
          <p className="mt-5 max-w-sm text-sm leading-relaxed text-white/65">{t('auth.loginSubtitle')}</p>

          <ul className="mt-10 space-y-3.5 text-sm text-white/75">
            {[t('auth.featureInvoice'), t('auth.featureTracking'), t('auth.featureExport')].map((feature) => (
              <li key={feature} className="flex items-start gap-2.5">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sand-400" aria-hidden="true" />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="relative flex items-center justify-between border-t border-white/10 pt-5 text-[11px] text-white/45">
          <span>{t('auth.localSignature')}</span>
          <span>Pacific/Tahiti · UTC−10</span>
        </div>
      </aside>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-950">
              <svg viewBox="0 0 32 32" className="h-5 w-5" aria-hidden="true">
                <path d="M6 23V10l6 8 6-8v13" fill="none" stroke="#F5F1E6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M20 20c2-2 4-2 6 0" fill="none" stroke="#F2A93B" strokeWidth="2.5" strokeLinecap="round" />
              </svg>
            </span>
            <div>
              <p className="font-display text-lg font-semibold text-ink-950">{t('app.name')}</p>
              <p className="text-[10px] uppercase tracking-[0.16em] text-muted">{t('app.tagline')}</p>
            </div>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
