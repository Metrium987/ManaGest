import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Eye, Landmark, Link2, Plus, Upload, XCircle } from 'lucide-react';
import { toMinor } from '@shared/money';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import type { BankAccount, BankTransaction, InvoiceSummary, ListResponse } from '@/lib/types';

interface MatchSuggestion {
  invoice_id: string;
  number: string;
  client_name: string | null;
  balance: number;
  date: string;
  score: number;
  reasons: string[];
}

interface LedgerEntry {
  date: string;
  kind: 'invoice' | 'payment' | 'expense';
  reference: string;
  label: string;
  debit: number;
  credit: number;
  balance: number;
}
import { EmptyState, PageHeader, SectionCard, Skeleton, StatusBadge } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, FormGrid, Input, Select } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { showRecord } from '@/components/ui/RecordDrawer';
import { GatedButton } from '@/components/ui/GatedButton';
import { useToast } from '@/components/ui/Toast';

function parseCsv(raw: string): { date: string; label: string; amount: number; reference: string }[] {
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows: { date: string; label: string; amount: number; reference: string }[] = [];
  for (const line of lines) {
    const separator = line.includes(';') ? ';' : ',';
    const cells = line.split(separator).map((cell) => cell.trim().replace(/^"|"$/g, ''));
    if (cells.length < 3) continue;
    const [date, label, amountRaw, reference = ''] = cells;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const normalized = amountRaw.replace(/\s/g, '').replace(',', '.');
    const amount = Number(normalized);
    if (!Number.isFinite(amount)) continue;
    rows.push({ date, label, amount, reference });
  }
  return rows;
}

export function BankPage() {
  const { company, can } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const currency = company?.currency ?? 'XPF';
  const [accountId, setAccountId] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [importError, setImportError] = useState('');
  const [matchTx, setMatchTx] = useState<BankTransaction | null>(null);
  const [invoiceId, setInvoiceId] = useState('');
  const [newAccount, setNewAccount] = useState({ name: '', bank_name: '', iban: '', opening_balance: 0 });

  const accounts = useQuery({ queryKey: ['bank-accounts'], queryFn: () => api.get<{ data: BankAccount[] }>('/bank/accounts') });
  const selectedAccount = accountId || accounts.data?.data[0]?.id || '';

  const transactions = useQuery({
    queryKey: ['bank-transactions', selectedAccount],
    queryFn: () => api.get<{ data: BankTransaction[] }>(`/bank/transactions${toQuery({ account_id: selectedAccount })}`),
    enabled: Boolean(selectedAccount),
  });
  const invoices = useQuery({
    queryKey: ['invoices', 'open'],
    queryFn: () => api.get<ListResponse<InvoiceSummary>>('/invoices?per_page=100'),
    enabled: Boolean(matchTx),
  });

  // T-204: the rules propose, the user decides. Nothing is matched automatically.
  const suggestions = useQuery({
    queryKey: ['bank-suggestions', selectedAccount],
    queryFn: () => api.get<{ data: { transaction_id: string; suggestions: MatchSuggestion[] }[] }>(
      `/bank/suggestions${toQuery({ account_id: selectedAccount })}`,
    ),
    enabled: Boolean(selectedAccount),
  });
  const ledger = useQuery({
    queryKey: ['bank-ledger', selectedAccount],
    queryFn: () => api.get<{ data: LedgerEntry[]; opening_balance: number }>(
      `/bank/ledger${toQuery({ account_id: selectedAccount })}`,
    ),
    enabled: Boolean(selectedAccount),
  });
  const suggestionsFor = (id: string) =>
    suggestions.data?.data.find((entry) => entry.transaction_id === id)?.suggestions ?? [];
  const ledgerRows = ledger.data?.data ?? [];
  // One translation for a rule reason, used by the row hint and the dialog.
  const reasonLabel = (reason: string) => {
    const key =
      reason === 'amount_exact' ? 'AmountExact'
        : reason === 'amount_partial' ? 'AmountPartial'
          : reason === 'number_in_label' ? 'Number'
            : 'Client';
    return t(`bankMatch.reason${key}`);
  };

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['bank-accounts'] });
    queryClient.invalidateQueries({ queryKey: ['bank-transactions'] });
    queryClient.invalidateQueries({ queryKey: ['invoices'] });
  };

  const createAccount = useMutation({
    mutationFn: () => api.post('/bank/accounts', { ...newAccount, opening_balance: toMinor(newAccount.opening_balance, currency), currency }),
    onSuccess: () => {
      toast.success(t('bank.newAccount'));
      setAccountOpen(false);
      setNewAccount({ name: '', bank_name: '', iban: '', opening_balance: 0 });
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const importStatement = useMutation({
    mutationFn: () => {
      const rows = parseCsv(csv);
      if (!rows.length) throw new Error('empty');
      return api.post('/bank/transactions/import', {
        account_id: selectedAccount,
        transactions: rows.map((row) => ({ ...row, amount: toMinor(row.amount, currency) })),
      });
    },
    onSuccess: (result) => {
      toast.success(t('bank.importSuccess', { count: (result as { imported: number }).imported }));
      setImportOpen(false);
      setCsv('');
      setImportError('');
      refresh();
    },
    onError: (error) => setImportError(error instanceof Error && error.message === 'empty' ? t('validation.required') : errorMessage(error)),
  });

  const match = useMutation({
    mutationFn: () => api.post(`/bank/transactions/${matchTx?.id}/match`, { invoice_id: invoiceId }),
    onSuccess: () => {
      toast.success(t('bank.matched'));
      setMatchTx(null);
      setInvoiceId('');
      refresh();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const ignore = useMutation({
    mutationFn: (id: string) => api.patch(`/bank/transactions/${id}`, { status: 'ignored' }),
    onSuccess: refresh,
    onError: (error) => toast.error(errorMessage(error)),
  });

  const submitImport = (event: FormEvent) => {
    event.preventDefault();
    importStatement.mutate();
  };

  return (
    <>
      <PageHeader
        title={t('bank.title')}
        subtitle={t('bank.subtitle')}
        actions={
          <>
            <GatedButton permission="bank.write" variant="secondary" onClick={() => setAccountOpen(true)} icon={<Plus className="h-4 w-4" aria-hidden="true" />}>{t('bank.newAccount')}</GatedButton>
            <GatedButton permission="bank.write" onClick={() => setImportOpen(true)} disabled={!selectedAccount} icon={<Upload className="h-4 w-4" aria-hidden="true" />}>{t('bank.import')}</GatedButton>
          </>
        }
      />

      {accounts.isLoading ? <Skeleton className="h-28" /> : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {(accounts.data?.data ?? []).map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => setAccountId(account.id)}
              className={`card p-5 text-left transition ${selectedAccount === account.id ? 'border-brand-400 ring-2 ring-brand-100' : 'hover:border-line-strong'}`}
              aria-pressed={selectedAccount === account.id}
            >
              <div className="flex items-center justify-between">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Landmark className="h-4 w-4" aria-hidden="true" /></span>
                {account.unmatched_count > 0 ? <span className="badge border-warning-200 bg-warning-50 text-warning-700">{account.unmatched_count} {t('bank.unmatched')}</span> : null}
              </div>
              <p className="mt-3 font-medium text-ink-900">{account.name}</p>
              <p className="text-xs text-muted">{account.bank_name ?? '—'}</p>
              <p className="mt-3 font-display text-xl font-semibold tabular-nums">{formatMoney(account.current_balance, currency)}</p>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4">
        <SectionCard title={t('bank.transactions')} bodyClassName="table-wrap">
          {!selectedAccount ? (
            <EmptyState icon={<Landmark className="h-6 w-6" aria-hidden="true" />} title={t('bank.empty')} />
          ) : transactions.isLoading ? (
            <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          ) : transactions.data?.data.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('common.date')}</th>
                  <th scope="col">{t('common.description')}</th>
                  <th scope="col" className="text-right">{t('common.amount')}</th>
                  <th scope="col">{t('common.status')}</th>
                  <th scope="col"><span className="sr-only">{t('common.actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {transactions.data.data.map((tx) => (
                  <tr key={tx.id}>
                    <td className="text-muted">{formatDate(tx.date)}</td>
                    <td>
                      <button
                        type="button"
                        className="text-left font-medium hover:text-brand-700"
                        onClick={() => showRecord({
                          title: tx.label,
                          subtitle: tx.reference ?? undefined,
                          status: tx.status,
                          fields: [
                            { label: t('common.date'), value: formatDate(tx.date) },
                            { label: t('common.amount'), value: formatMoney(tx.amount, currency) },
                            { label: t('common.reference'), value: tx.reference },
                            { label: t('common.status'), value: <StatusBadge status={tx.status} /> },
                          ],
                        })}
                      >
                        {tx.label}
                      </button>
                      {tx.reference ? <p className="text-xs text-muted">{tx.reference}</p> : null}
                      {tx.status === 'unmatched' && suggestionsFor(tx.id).length ? (
                        <p className="text-[11px] text-brand-700">
                          {suggestionsFor(tx.id)[0].number} · {suggestionsFor(tx.id)[0].reasons.map(reasonLabel).join(' · ')}
                        </p>
                      ) : null}
                    </td>
                    <td className={`text-right font-medium tabular-nums ${tx.amount < 0 ? 'text-danger-600' : 'text-success-700'}`}>
                      {formatMoney(tx.amount, currency)}
                    </td>
                    <td><StatusBadge status={tx.status} /></td>
                    <td>
                      {tx.status === 'unmatched' && can('bank.write') ? (
                        <div className="flex justify-end gap-1">
                          <button type="button" className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink" aria-label={`${t('records.view')} ${tx.label}`} onClick={() => showRecord({
                            title: tx.label,
                            subtitle: tx.reference ?? undefined,
                            status: tx.status,
                            fields: [
                              { label: t('common.date'), value: formatDate(tx.date) },
                              { label: t('common.amount'), value: formatMoney(tx.amount, currency) },
                              { label: t('common.reference'), value: tx.reference },
                              { label: t('common.status'), value: <StatusBadge status={tx.status} /> },
                            ],
                          })}>
                            <Eye className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <Button size="sm" variant="secondary" disabled={tx.amount <= 0} onClick={() => setMatchTx(tx)} icon={<Link2 className="h-3.5 w-3.5" aria-hidden="true" />}>{t('bank.match')}</Button>
                          <Button size="sm" variant="ghost" onClick={() => ignore.mutate(tx.id)} icon={<XCircle className="h-3.5 w-3.5" aria-hidden="true" />}>{t('bank.ignore')}</Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<Landmark className="h-6 w-6" aria-hidden="true" />} title={t('bank.empty')} />
          )}
        </SectionCard>
      </div>

      <Modal
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        title={t('bank.newAccount')}
        footer={<><Button variant="secondary" onClick={() => setAccountOpen(false)}>{t('common.cancel')}</Button><Button loading={createAccount.isPending} onClick={() => createAccount.mutate()}>{t('common.save')}</Button></>}
      >
        <div className="space-y-4">
          <Field label={t('common.name')} htmlFor="account_name" required>
            <Input id="account_name" value={newAccount.name} onChange={(event) => setNewAccount({ ...newAccount, name: event.target.value })} />
          </Field>
          <FormGrid>
            <Field label={t('settings.bankName')} htmlFor="account_bank">
              <Input id="account_bank" value={newAccount.bank_name} onChange={(event) => setNewAccount({ ...newAccount, bank_name: event.target.value })} />
            </Field>
            <Field label={t('settings.bankIban')} htmlFor="account_iban">
              <Input id="account_iban" value={newAccount.iban} onChange={(event) => setNewAccount({ ...newAccount, iban: event.target.value })} />
            </Field>
          </FormGrid>
          <Field label={t('bank.openingBalance')} htmlFor="account_balance">
            <Input id="account_balance" type="number" value={newAccount.opening_balance || ''} onChange={(event) => setNewAccount({ ...newAccount, opening_balance: Number(event.target.value) })} />
          </Field>
        </div>
      </Modal>

      <Modal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        title={t('bank.import')}
        description={t('bank.importHint')}
        size="lg"
        footer={<><Button variant="secondary" onClick={() => setImportOpen(false)}>{t('common.cancel')}</Button><Button loading={importStatement.isPending} onClick={() => importStatement.mutate()}>{t('common.save')}</Button></>}
      >
        <form onSubmit={submitImport} className="space-y-3">
          {importError ? <p className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700" role="alert">{importError}</p> : null}
          <Field label={`${t('bank.transactions')} (CSV)`} htmlFor="csv">
            <textarea
              id="csv"
              className="textarea min-h-[220px] font-mono text-xs"
              value={csv}
              onChange={(event) => setCsv(event.target.value)}
              placeholder={'2026-01-15;Virement client;250000;FAC-2026-0001\n2026-01-16;Frais bancaires;-1500;'}
            />
          </Field>
        </form>
      </Modal>

      <div className="mt-4">
        <SectionCard
          title={t('bankMatch.ledger')}
          subtitle={ledger.data ? `${t('bankMatch.openingBalance')} : ${formatMoney(ledger.data.opening_balance, currency)}` : undefined}
          bodyClassName="table-wrap"
          actions={<BookOpen className="h-4 w-4 text-muted" aria-hidden="true" />}
        >
          {!ledgerRows.length ? (
            <p className="px-5 py-6 text-sm text-muted">{t('bank.empty')}</p>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('common.date')}</th>
                  <th scope="col">{t('common.reference')}</th>
                  <th scope="col">{t('common.description')}</th>
                  <th scope="col" className="text-right">{t('common.amount')}</th>
                  <th scope="col" className="text-right">{t('bankMatch.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.map((entry, index) => (
                  <tr key={`${entry.reference}-${index}`}>
                    <td className="text-muted">{formatDate(entry.date)}</td>
                    <td className="font-medium">
                      {entry.reference}
                      <span className="ml-2 text-[11px] text-muted">
                        {t(`bankMatch.${entry.kind}`)}
                      </span>
                    </td>
                    <td className="text-muted">{entry.label || '—'}</td>
                    <td className={`text-right tabular-nums ${entry.credit ? 'text-danger-600' : 'text-success-700'}`}>
                      {formatMoney(entry.credit || entry.debit, currency)}
                    </td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(entry.balance, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      <Modal
        open={Boolean(matchTx)}
        onClose={() => setMatchTx(null)}
        title={t('bank.matchTitle')}
        description={matchTx ? `${matchTx.label} · ${formatMoney(matchTx.amount, currency)}` : undefined}
        footer={<><Button variant="secondary" onClick={() => setMatchTx(null)}>{t('common.cancel')}</Button><Button loading={match.isPending} onClick={() => match.mutate()}>{t('common.confirm')}</Button></>}
      >
        {matchTx && suggestionsFor(matchTx.id).length ? (
          <div className="mb-4 rounded-xl border border-brand-200 bg-brand-50/60 p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-700">{t('bankMatch.title')}</p>
            <ul className="space-y-1.5">
              {suggestionsFor(matchTx.id).map((suggestion) => (
                <li key={suggestion.invoice_id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span>
                    <span className="font-medium">{suggestion.number}</span>
                    {' — '}{suggestion.client_name ?? '—'}{' — '}{formatMoney(suggestion.balance, currency)}
                    <span className="ml-2 text-muted">{suggestion.reasons.map(reasonLabel).join(' · ')}</span>
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => setInvoiceId(suggestion.invoice_id)}>{t('bankMatch.use')}</Button>
                </li>
              ))}
            </ul>
          </div>
        ) : matchTx ? (
          <p className="mb-4 rounded-xl bg-surface px-3 py-2 text-xs text-muted">{t('bankMatch.none')}</p>
        ) : null}
        <Field label={t('bank.selectInvoice')} htmlFor="match_invoice">
          <Select id="match_invoice" value={invoiceId} onChange={(event) => setInvoiceId(event.target.value)}>
            <option value="">{t('common.none')}</option>
            {(invoices.data?.data ?? []).filter((invoice) => invoice.balance > 0).map((invoice) => (
              <option key={invoice.id} value={invoice.id}>{invoice.number} — {invoice.client_name} — {formatMoney(invoice.balance, currency)}</option>
            ))}
          </Select>
        </Field>
      </Modal>
    </>
  );
}
