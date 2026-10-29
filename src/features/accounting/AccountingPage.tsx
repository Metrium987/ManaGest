import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, RefreshCw } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { formatDate, formatMoney } from '@/lib/format';
import { EmptyState, PageHeader, SectionCard, Skeleton, Tabs } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Field, Input } from '@/components/ui/Form';
import { GatedButton } from '@/components/ui/GatedButton';
import { useToast } from '@/components/ui/Toast';

interface BalanceRow {
  account_code: string;
  label: string;
  type: string | null;
  debit: number;
  credit: number;
  balance: number;
}

interface TrialBalance {
  rows: BalanceRow[];
  total_debit: number;
  total_credit: number;
}

interface JournalEntry {
  id: string;
  date: string;
  journal: string;
  reference: string;
  label: string;
  source_type: string;
  event: string;
}

interface JournalLine {
  entry_id: string;
  account_code: string;
  label: string;
  debit: number;
  credit: number;
}

interface IncomeStatement {
  income: number;
  expense: number;
  result: number;
  rows: { account_code: string; label: string; type: string; amount: number }[];
}

interface AccountRow {
  code: string;
  label: string;
  type: string;
  is_active: number;
}

interface BalanceSheet {
  assets: BalanceRow[];
  liabilities: BalanceRow[];
  equity: BalanceRow[];
  result: number;
  total_assets: number;
  total_liabilities: number;
  total_equity: number;
  balanced: boolean;
}

interface OpeningRow {
  code: string;
  label: string;
  debit: string;
  credit: string;
}

const TABS = [
  { value: 'balance', label: 'accounting.trialBalance' },
  { value: 'bilan', label: 'accounting.balanceSheet' },
  { value: 'journal', label: 'accounting.journal' },
  { value: 'income', label: 'accounting.income' },
  { value: 'chart', label: 'accounting.chart' },
  { value: 'opening', label: 'accounting.opening' },
];

/**
 * Accounting reads (AUDIT §7 P0.2). The journal is derived from the documents by
 * an idempotent pass, so this screen never asks anyone to type an entry twice and
 * can never disagree with what was issued.
 */
export function AccountingPage() {
  const { company } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const currency = company?.currency ?? 'XPF';
  const [tab, setTab] = useState('balance');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const range = toQuery({ from, to });

  const balance = useQuery({
    queryKey: ['accounting', 'balance', from, to],
    queryFn: () => api.get<TrialBalance>(`/accounting/trial-balance${range}`),
  });
  const journal = useQuery({
    queryKey: ['accounting', 'journal', from, to],
    queryFn: () => api.get<{ entries: JournalEntry[]; lines: JournalLine[] }>(`/accounting/journal${range}`),
    enabled: tab === 'journal',
  });
  const income = useQuery({
    queryKey: ['accounting', 'income', from, to],
    queryFn: () => api.get<IncomeStatement>(`/accounting/income-statement${range}`),
    enabled: tab === 'income',
  });
  const accounts = useQuery({
    queryKey: ['accounting', 'accounts'],
    queryFn: () => api.get<{ data: AccountRow[] }>('/accounting/accounts'),
    enabled: tab === 'chart',
  });
  const sheet = useQuery({
    queryKey: ['accounting', 'balance-sheet', from, to],
    queryFn: () => api.get<BalanceSheet>(`/accounting/balance-sheet${range}`),
    enabled: tab === 'bilan',
  });
  const opening = useQuery({
    queryKey: ['accounting', 'opening'],
    queryFn: () => api.get<{ date: string | null; rows: { code: string; label: string; debit: number; credit: number }[] }>(
      '/accounting/opening-balances',
    ),
    enabled: tab === 'opening',
  });

  const [openingDate, setOpeningDate] = useState('');
  const [openingRows, setOpeningRows] = useState<OpeningRow[]>([]);

  useEffect(() => {
    if (!opening.data) return;
    setOpeningDate(opening.data.date ?? '');
    setOpeningRows(opening.data.rows.map((row) => ({
      code: row.code,
      label: row.label,
      debit: row.debit ? String(row.debit) : '',
      credit: row.credit ? String(row.credit) : '',
    })));
  }, [opening.data]);

  const updateRow = (index: number, patch: Partial<OpeningRow>) => {
    setOpeningRows((rows) => rows.map((row, position) => (position === index ? { ...row, ...patch } : row)));
  };

  const saveOpening = useMutation({
    mutationFn: () => api.put<{ lines: number; difference: number }>('/accounting/opening-balances', {
      date: openingDate,
      rows: openingRows
        .filter((row) => row.code.trim())
        .map((row) => ({
          code: row.code.trim(),
          label: row.label.trim() || undefined,
          debit: Number(row.debit || 0),
          credit: Number(row.credit || 0),
        })),
    }),
    onSuccess: (result) => {
      toast.success(t('accounting.openingSaved', {
        count: result.lines,
        difference: formatMoney(result.difference, currency),
      }));
      queryClient.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const sheetRows = sheet.data
    ? [
        ...sheet.data.assets.map((row) => ({ ...row, section: t('accounting.assets') })),
        ...sheet.data.liabilities.map((row) => ({ ...row, section: t('accounting.liabilities') })),
        ...sheet.data.equity.map((row) => ({ ...row, section: t('accounting.equityTotal') })),
      ]
    : [];

  const sync = useMutation({
    mutationFn: () => api.post<{ created: number }>('/accounting/sync'),
    onSuccess: (result) => {
      toast.success(t('accounting.synced', { count: result.created }));
      queryClient.invalidateQueries({ queryKey: ['accounting'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const linesFor = (entryId: string) => (journal.data?.lines ?? []).filter((line) => line.entry_id === entryId);

  return (
    <>
      <PageHeader
        title={t('accounting.title')}
        subtitle={t('accounting.subtitle')}
        actions={
          <>
            <GatedButton
              permission="accounting.write"
              variant="secondary"
              loading={sync.isPending}
              onClick={() => sync.mutate()}
              icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            >
              {t('accounting.sync')}
            </GatedButton>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Tabs items={TABS.map((item) => ({ value: item.value, label: t(item.label) }))} value={tab} onChange={setTab} />
        <div className="ml-auto flex items-end gap-2">
          <Field label={t('accounting.from')} htmlFor="accounting_from">
            <Input id="accounting_from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} className="w-40" />
          </Field>
          <Field label={t('accounting.to')} htmlFor="accounting_to">
            <Input id="accounting_to" type="date" value={to} onChange={(event) => setTo(event.target.value)} className="w-40" />
          </Field>
          {from || to ? (
            <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo(''); }}>{t('common.none')}</Button>
          ) : null}
        </div>
      </div>

      {tab === 'balance' ? (
        <SectionCard
          title={t('accounting.trialBalance')}
          subtitle={balance.data ? `${t('accounting.total')} : ${formatMoney(balance.data.total_debit, currency)}` : undefined}
          bodyClassName="table-wrap"
        >
          {balance.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : balance.data?.rows.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col">{t('accounting.label')}</th>
                  <th scope="col" className="text-right">{t('accounting.debit')}</th>
                  <th scope="col" className="text-right">{t('accounting.credit')}</th>
                  <th scope="col" className="text-right">{t('accounting.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {balance.data.rows.map((row) => (
                  <tr key={row.account_code}>
                    <td className="font-mono text-xs">{row.account_code}</td>
                    <td className="font-medium">{row.label}</td>
                    <td className="text-right tabular-nums">{formatMoney(row.debit, currency)}</td>
                    <td className="text-right tabular-nums">{formatMoney(row.credit, currency)}</td>
                    <td className="text-right font-medium tabular-nums">{formatMoney(row.balance, currency)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line-strong">
                  <td colSpan={2} className="font-semibold">{t('accounting.total')}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(balance.data.total_debit, currency)}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(balance.data.total_credit, currency)}</td>
                  <td className="text-right font-semibold tabular-nums">
                    {formatMoney(balance.data.total_debit - balance.data.total_credit, currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<BookOpen className="h-6 w-6" aria-hidden="true" />} title={t('accounting.empty')} />
          )}
        </SectionCard>
      ) : null}

      {tab === 'journal' ? (
        <SectionCard title={t('accounting.journal')} bodyClassName="table-wrap">
          {journal.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : journal.data?.entries.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('common.date')}</th>
                  <th scope="col">{t('accounting.journalCode')}</th>
                  <th scope="col">{t('accounting.reference')}</th>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col" className="text-right">{t('accounting.debit')}</th>
                  <th scope="col" className="text-right">{t('accounting.credit')}</th>
                </tr>
              </thead>
              <tbody>
                {journal.data.entries.map((entry) => (
                  linesFor(entry.id).map((line, index) => (
                    <tr key={`${entry.id}-${line.account_code}-${index}`}>
                      <td className="text-muted">{index === 0 ? formatDate(entry.date) : ''}</td>
                      <td className="text-muted">{index === 0 ? entry.journal : ''}</td>
                      <td className="font-medium">{index === 0 ? entry.reference : ''}</td>
                      <td>
                        <span className="font-mono text-xs text-muted">{line.account_code}</span>
                        <span className="ml-2 text-xs">{line.label}</span>
                      </td>
                      <td className="text-right tabular-nums">{line.debit ? formatMoney(line.debit, currency) : '—'}</td>
                      <td className="text-right tabular-nums">{line.credit ? formatMoney(line.credit, currency) : '—'}</td>
                    </tr>
                  ))
                ))}
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<BookOpen className="h-6 w-6" aria-hidden="true" />} title={t('accounting.empty')} />
          )}
        </SectionCard>
      ) : null}

      {tab === 'income' ? (
        <SectionCard title={t('accounting.income')} bodyClassName="table-wrap">
          {income.isLoading ? (
            <Skeleton className="m-4 h-32" />
          ) : income.data ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col">{t('accounting.label')}</th>
                  <th scope="col" className="text-right">{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {income.data.rows.map((row) => (
                  <tr key={row.account_code}>
                    <td className="font-mono text-xs">{row.account_code}</td>
                    <td>{row.label}</td>
                    <td className="text-right tabular-nums">{formatMoney(row.amount, currency)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line-strong">
                  <td colSpan={2} className="font-semibold">{t('accounting.result')}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(income.data.result, currency)}</td>
                </tr>
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<BookOpen className="h-6 w-6" aria-hidden="true" />} title={t('accounting.empty')} />
          )}
        </SectionCard>
      ) : null}

      {tab === 'bilan' ? (
        <SectionCard
          title={t('accounting.balanceSheet')}
          subtitle={sheet.data ? (sheet.data.balanced ? t('accounting.balanced') : t('accounting.unbalanced')) : undefined}
          bodyClassName="table-wrap"
        >
          {sheet.isLoading ? (
            <Skeleton className="m-4 h-40" />
          ) : sheet.data && sheetRows.length ? (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col">{t('accounting.label')}</th>
                  <th scope="col" className="text-right">{t('common.amount')}</th>
                </tr>
              </thead>
              <tbody>
                {sheetRows.map((row) => (
                  <tr key={row.account_code}>
                    <td className="font-mono text-xs">{row.account_code}</td>
                    <td>
                      <span className="text-muted">{row.section}</span>
                      <span className="ml-2 font-medium">{row.label}</span>
                    </td>
                    <td className="text-right tabular-nums">{formatMoney(row.balance, currency)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-line-strong">
                  <td colSpan={2} className="font-semibold">{t('accounting.result')}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(sheet.data.result, currency)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="font-semibold">{t('accounting.assets')}</td>
                  <td className="text-right font-semibold tabular-nums">{formatMoney(sheet.data.total_assets, currency)}</td>
                </tr>
                <tr>
                  <td colSpan={2} className="font-semibold">{t('accounting.liabilities')} + {t('accounting.equityTotal')}</td>
                  <td className="text-right font-semibold tabular-nums">
                    {formatMoney(sheet.data.total_liabilities + sheet.data.total_equity, currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          ) : (
            <EmptyState icon={<BookOpen className="h-6 w-6" aria-hidden="true" />} title={t('accounting.openingEmpty')} />
          )}
        </SectionCard>
      ) : null}

      {tab === 'opening' ? (
        <SectionCard title={t('accounting.opening')} subtitle={t('accounting.openingHint')}>
          <div className="space-y-3 p-4">
            <Field label={t('accounting.openingDate')} htmlFor="opening_date">
              <Input
                id="opening_date"
                type="date"
                value={openingDate}
                onChange={(event) => setOpeningDate(event.target.value)}
                className="w-44"
              />
            </Field>
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('accounting.code')}</th>
                    <th scope="col">{t('accounting.label')}</th>
                    <th scope="col" className="text-right">{t('accounting.debit')}</th>
                    <th scope="col" className="text-right">{t('accounting.credit')}</th>
                    <th scope="col"><span className="sr-only">{t('accounting.remove')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {openingRows.map((row, index) => (
                    <tr key={index}>
                      <td>
                        <Input
                          value={row.code}
                          onChange={(event) => updateRow(index, { code: event.target.value })}
                          className="w-24 font-mono"
                          aria-label={`${t('accounting.code')} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <Input
                          value={row.label}
                          onChange={(event) => updateRow(index, { label: event.target.value })}
                          aria-label={`${t('accounting.label')} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <Input
                          inputMode="numeric"
                          value={row.debit}
                          onChange={(event) => updateRow(index, { debit: event.target.value })}
                          className="w-32 text-right"
                          aria-label={`${t('accounting.debit')} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <Input
                          inputMode="numeric"
                          value={row.credit}
                          onChange={(event) => updateRow(index, { credit: event.target.value })}
                          className="w-32 text-right"
                          aria-label={`${t('accounting.credit')} ${index + 1}`}
                        />
                      </td>
                      <td>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setOpeningRows((rows) => rows.filter((_, position) => position !== index))}
                        >
                          {t('accounting.remove')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setOpeningRows((rows) => [...rows, { code: '', label: '', debit: '', credit: '' }])}
              >
                {t('accounting.openingAdd')}
              </Button>
              <GatedButton
                permission="accounting.write"
                loading={saveOpening.isPending}
                onClick={() => saveOpening.mutate()}
              >
                {t('accounting.openingSave')}
              </GatedButton>
              {openingRows.length === 0 ? (
                <span className="text-sm text-muted">{t('accounting.openingEmpty')}</span>
              ) : null}
            </div>
          </div>
        </SectionCard>
      ) : null}

      {tab === 'chart' ? (
        <SectionCard title={t('accounting.chart')} bodyClassName="table-wrap">
          {accounts.isLoading ? (
            <Skeleton className="m-4 h-32" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">{t('accounting.account')}</th>
                  <th scope="col">{t('accounting.label')}</th>
                  <th scope="col">{t('accounting.type')}</th>
                </tr>
              </thead>
              <tbody>
                {(accounts.data?.data ?? []).map((account) => (
                  <tr key={account.code}>
                    <td className="font-mono text-xs">{account.code}</td>
                    <td className="font-medium">{account.label}</td>
                    <td className="text-muted">{t(`accounting.types.${account.type}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      ) : null}
    </>
  );
}
