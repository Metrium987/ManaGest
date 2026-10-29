import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { t } from '@/lib/i18n';

/**
 * T-103: the page a client opens from a public link. It is deliberately outside
 * the authenticated shell: no navigation, no workspace data, only the document
 * the token points to. Everything it needs comes from `/api/public/documents`.
 */

interface SharedLine {
  id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  tax_rate: number;
  tax_status?: 'taxable' | 'exempt';
}

interface SharedPayload {
  document: {
    kind: 'invoice' | 'quote' | 'credit';
    status: string;
    number: string | null;
    date: string;
    secondary_label: string | null;
    secondary: string | null;
    currency: string;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    paid_total: number;
    balance: number;
    line_items: SharedLine[];
    notes: string | null;
    terms: string | null;
    client: { name: string; address1: string | null; address2: string | null; city: string | null; postal_code: string | null; country: string | null; tax_id: string | null };
    can_accept: boolean;
  };
  company: {
    name: string;
    legal_name: string | null;
    address1: string | null;
    city: string | null;
    postal_code: string | null;
    email: string | null;
    phone: string | null;
    tax_id: string | null;
    rcs: string | null;
    legal_notes: string | null;
    bank_name: string | null;
    bank_iban: string | null;
    bank_bic: string | null;
  };
  expires_at: string;
}

function money(value: number, currency: string): string {
  return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(value)} ${currency}`;
}

export function PublicDocumentPage() {
  const { token = '' } = useParams();
  const [payload, setPayload] = useState<SharedPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/public/documents/${encodeURIComponent(token)}`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (cancelled) return;
        if (!response.ok) {
          setError((body as { error?: { code?: string } }).error?.code ?? 'LINK_NOT_FOUND');
          return;
        }
        setPayload(body as SharedPayload);
      })
      .catch(() => {
        if (!cancelled) setError('errors.network');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const title = useMemo(() => {
    if (!payload) return t('app.name');
    const kind = payload.document.kind;
    return `${t(`publicDoc.${kind}`)} ${payload.document.number ?? ''}`.trim();
  }, [payload]);

  const accept = async () => {
    setAccepting(true);
    try {
      const response = await fetch(`/api/public/documents/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ name: name.trim() || null }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: { code?: string } };
        setError(body.error?.code ?? 'errors.generic');
        return;
      }
      setAccepted(true);
      setPayload((current) =>
        current ? { ...current, document: { ...current.document, status: 'approved', can_accept: false } } : current,
      );
    } catch {
      setError('errors.network');
    } finally {
      setAccepting(false);
    }
  };

  if (loading) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted">{t('publicDoc.loading')}</main>;
  }

  if (error || !payload) {
    const message =
      error === 'LINK_EXPIRED'
        ? t('publicDoc.linkExpired')
        : error === 'LINK_REVOKED'
          ? t('publicDoc.linkRevoked')
          : t('publicDoc.linkInvalid');
    return (
      <main className="mx-auto max-w-3xl p-8">
        <div className="card p-8 text-center">
          <h1 className="text-lg font-semibold">{t('publicDoc.linkInvalid')}</h1>
          <p className="mt-2 text-sm text-muted">{message}</p>
        </div>
      </main>
    );
  }

  const doc = payload.document;
  const company = payload.company;

  return (
    <main className="mx-auto max-w-4xl space-y-4 p-4 sm:p-8">
      <header className="card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{company.name}</p>
            <h1 className="mt-1 text-xl font-semibold">{title}</h1>
            <p className="mt-1 text-sm text-muted">
              {t('publicDoc.date')} {doc.date}
              {doc.secondary ? ` · ${doc.secondary_label}: ${doc.secondary}` : ''}
            </p>
          </div>
          <a className="btn btn-secondary" href={`/api/public/documents/${encodeURIComponent(token)}/pdf`}>
            <Download className="h-4 w-4" aria-hidden="true" />
            {t('publicDoc.download')}
          </a>
        </div>
      </header>

      <section className="card p-5 sm:p-6">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('publicDoc.from')}</p>
            <p className="mt-1 text-sm font-medium">{company.name}</p>
            {[company.address1, [company.postal_code, company.city].filter(Boolean).join(' '), company.tax_id ? `TAHITI ${company.tax_id}` : null, company.email]
              .filter(Boolean)
              .map((value) => (
                <p key={String(value)} className="text-sm text-muted">{value}</p>
              ))}
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('publicDoc.to')}</p>
            <p className="mt-1 text-sm font-medium">{doc.client.name}</p>
            {[doc.client.address1, doc.client.address2, [doc.client.postal_code, doc.client.city].filter(Boolean).join(' '), doc.client.tax_id ? `TAHITI ${doc.client.tax_id}` : null]
              .filter(Boolean)
              .map((value) => (
                <p key={String(value)} className="text-sm text-muted">{value}</p>
              ))}
          </div>
        </div>

        <div className="table-wrap mt-6">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">{t('publicDoc.description')}</th>
                <th scope="col" className="text-right">{t('publicDoc.qty')}</th>
                <th scope="col" className="text-right">{t('publicDoc.unit')}</th>
                <th scope="col" className="text-right">{t('publicDoc.vat')}</th>
                <th scope="col" className="text-right">{t('publicDoc.lineTotal')}</th>
              </tr>
            </thead>
            <tbody>
              {doc.line_items.map((line, index) => (
                <tr key={line.id ?? index}>
                  <td>{line.description}</td>
                  <td className="text-right tabular-nums">{line.quantity}</td>
                  <td className="text-right tabular-nums">{money(line.unit_price, doc.currency)}</td>
                  <td className="text-right tabular-nums">{line.tax_status === 'exempt' ? t('invoices.taxExempt') : `${line.tax_rate} %`}</td>
                  <td className="text-right tabular-nums">{money(Math.round(line.unit_price * line.quantity), doc.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <dl className="ml-auto mt-4 max-w-xs space-y-1 text-sm">
          <div className="flex justify-between"><dt className="text-muted">{t('publicDoc.subtotal')}</dt><dd className="tabular-nums">{money(doc.subtotal, doc.currency)}</dd></div>
          {doc.discount_total > 0 ? (
            <div className="flex justify-between"><dt className="text-muted">{t('publicDoc.discount')}</dt><dd className="tabular-nums">- {money(doc.discount_total, doc.currency)}</dd></div>
          ) : null}
          <div className="flex justify-between"><dt className="text-muted">{t('common.tax')}</dt><dd className="tabular-nums">{money(doc.tax_total, doc.currency)}</dd></div>
          <div className="flex justify-between border-t border-line pt-1 font-semibold"><dt>{t('publicDoc.total')}</dt><dd className="tabular-nums">{money(doc.total, doc.currency)}</dd></div>
          {doc.paid_total > 0 ? (
            <>
              <div className="flex justify-between"><dt className="text-muted">{t('publicDoc.paid')}</dt><dd className="tabular-nums">{money(doc.paid_total, doc.currency)}</dd></div>
              <div className="flex justify-between font-medium"><dt>{t('publicDoc.balance')}</dt><dd className="tabular-nums">{money(doc.balance, doc.currency)}</dd></div>
            </>
          ) : null}
        </dl>

        {doc.notes ? (
          <div className="mt-6">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('publicDoc.notes')}</p>
            <p className="mt-1 whitespace-pre-line text-sm">{doc.notes}</p>
          </div>
        ) : null}
        {doc.terms ? (
          <div className="mt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('publicDoc.termsLabel')}</p>
            <p className="mt-1 whitespace-pre-line text-sm text-muted">{doc.terms}</p>
          </div>
        ) : null}

        {company.legal_notes ? <p className="mt-4 text-xs text-muted">{company.legal_notes}</p> : null}
        {company.bank_iban ? (
          <p className="mt-2 text-xs text-muted">{t('settings.bankIban')} {company.bank_iban}{company.bank_bic ? ` · BIC ${company.bank_bic}` : ''}</p>
        ) : null}
      </section>

      {doc.kind === 'quote' ? (
        <section className="card p-5 sm:p-6">
          {accepted || doc.status === 'approved' ? (
            <p className="text-sm font-medium text-success-700">{accepted ? t('publicDoc.accepted') : t('publicDoc.acceptedBanner')}</p>
          ) : doc.can_accept ? (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex-1 text-sm">
                <span className="mb-1 block font-medium">{t('publicDoc.acceptName')}</span>
                <input
                  className="input w-full"
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              </label>
              <button type="button" className="btn btn-primary" disabled={accepting} onClick={accept}>
                {accepting ? t('publicDoc.accepting') : t('publicDoc.accept')}
              </button>
            </div>
          ) : (
            <p className="text-sm text-muted">{t('publicDoc.notAcceptable')}</p>
          )}
        </section>
      ) : null}

      <footer className="pb-6 text-center text-xs text-muted">{t('publicDoc.poweredBy')}</footer>
    </main>
  );
}
