import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Download, Upload } from 'lucide-react';
import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import type { ImportColumn, ImportPreview, ImportResult } from '@/lib/types';
import { PageHeader, SectionCard } from '@/components/ui/Layout';
import { Button } from '@/components/ui/Button';
import { Checkbox, Field, Input, Select } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';
import { ActivityTrail } from '@/components/domain/ActivityTrail';

/**
 * Five-step import wizard (T-102b / OQ-015): pick the entity and download the
 * template, load the file, review every row with its issues, confirm explicitly,
 * then read the result report. Nothing is written before the confirm step.
 */
export function ImportPage() {
  const toast = useToast();
  const { can } = useSession();
  const [entity, setEntity] = useState<'clients' | 'products' | 'invoices'>('clients');
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [columns, setColumns] = useState<ImportColumn[]>([]);

  const allowed = entity === 'clients'
    ? can('clients.write')
    : entity === 'products' ? can('products.write') : can('invoices.write');

  // The screen must know the accepted fields to offer a mapping, and the mapping
  // is per file: changing the entity starts from automatic detection again.
  useEffect(() => {
    let alive = true;
    setMapping({});
    api.get<{ columns: ImportColumn[] }>(`/import/columns/${entity}`)
      .then((data) => { if (alive) setColumns(data.columns); })
      .catch(() => { if (alive) setColumns([]); });
    return () => { alive = false; };
  }, [entity]);

  const headers = useMemo(() => {
    const first = text.replace(/^\uFEFF/, '').split(/\r?\n/, 1)[0] ?? '';
    const delimiter = (first.match(/;/g) ?? []).length >= (first.match(/,/g) ?? []).length ? ';' : ',';
    return first.split(delimiter).map((header) => header.trim()).filter(Boolean);
  }, [text]);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) {
      toast.error(t('import.csvOnly'));
      return;
    }
    setFileName(file.name);
    setText(await file.text());
  };

  const runPreview = async () => {
    setBusy(true);
    try {
      const data = await api.post<ImportPreview>(`/import/preview/${entity}`, { text, mapping });
      setPreview(data);
      setSkipInvalid(false);
      setStep(3);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const runCommit = async () => {
    setBusy(true);
    try {
      const data = await api.post<ImportResult>(`/import/commit/${entity}`, { text, skip_invalid: skipInvalid, mapping });
      setResult(data);
      setStep(4);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const restart = () => {
    setStep(1);
    setText('');
    setFileName('');
    setPreview(null);
    setResult(null);
    setSkipInvalid(false);
  };

  return (
    <>
      <PageHeader
        title={t('import.title')}
        subtitle={t('import.subtitle')}
        breadcrumb={<Link to="/parametres" className="hover:text-brand-700">{t('nav.settings')}</Link>}
      />

      <div className="space-y-4">
        <SectionCard title={t('import.step1')} bodyClassName="space-y-4 p-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('import.entity')} htmlFor="import-entity">
              <Select
                id="import-entity"
                value={entity}
                onChange={(event) => setEntity(event.target.value as 'clients' | 'products' | 'invoices')}
                disabled={step !== 1}
              >
                <option value="clients">{t('import.clients')}</option>
                <option value="products">{t('import.products')}</option>
                <option value="invoices">{t('import.invoices')}</option>
              </Select>
            </Field>
            <Field label={t('import.template')} htmlFor="import-template">
              <a
                id="import-template"
                href={`/api/import/template/${entity}`}
                className="btn btn-secondary inline-flex w-full justify-center gap-2"
              >
                <Download className="h-4 w-4" aria-hidden="true" /> {t('import.downloadTemplate')}
              </a>
            </Field>
          </div>
          {!allowed ? <p className="text-sm text-danger-600">{t('import.permissionDenied')}</p> : null}
          {step === 1 ? (
            <Button onClick={() => setStep(2)} disabled={!allowed}>{t('common.next')}</Button>
          ) : null}
        </SectionCard>

        {/* H4 / owner decision 2026-11-02: ManaGest ships its own template and
            does not chase a particular legacy application. Whoever has an export
            from another tool loads it as-is — headers are detected or mapped by
            hand, unknown columns are reported — and whoever has nothing starts
            from the template. The export link closes the loop: what leaves the
            application re-enters with the same headers. */}
        <SectionCard title={t('import.genericTitle')} bodyClassName="space-y-3 p-5">
          <p className="text-sm text-muted">{t('import.genericHint')}</p>
          <a
            href={`/api/export/${entity}`}
            className="btn btn-secondary inline-flex w-fit items-center gap-2"
          >
            <Download className="h-4 w-4" aria-hidden="true" /> {t('import.exportCurrent')}
          </a>
          <p className="text-xs text-muted">{t('import.exportHint')}</p>
          <p className="text-xs text-muted">{t('import.templateNote')}</p>
        </SectionCard>

        {step >= 2 ? (
          <SectionCard title={t('import.step2')} bodyClassName="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('import.file')} htmlFor="import-file" hint={t('import.csvOnly')}>
                <Input
                  id="import-file"
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                  disabled={step !== 2}
                />
              </Field>
              <p className="text-sm text-muted">
                {fileName ? `${fileName} — ${t('import.loaded')}` : t('import.orPaste')}
              </p>
            </div>
            <Field label={t('import.paste')} htmlFor="import-text">
              <textarea
                id="import-text"
                className="input min-h-[140px] font-mono text-xs"
                value={text}
                onChange={(event) => setText(event.target.value)}
                disabled={step !== 2}
                placeholder="nom;courriel;commune"
              />
            </Field>
            {step === 2 && columns.length > 0 && headers.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-line bg-surface-50 p-3">
                <p className="text-sm font-medium">{t('import.mapping')}</p>
                <p className="text-xs text-muted">{t('import.mappingHint')}</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {columns.map((column) => (
                    <Field
                      key={column.key}
                      label={`${column.label}${column.required ? ' *' : ''}`}
                      htmlFor={`import-map-${column.key}`}
                    >
                      <Select
                        id={`import-map-${column.key}`}
                        value={mapping[column.key] ?? ''}
                        onChange={(event) => setMapping((previous) => {
                          const next = { ...previous };
                          if (event.target.value) next[column.key] = event.target.value;
                          else delete next[column.key];
                          return next;
                        })}
                      >
                        <option value="">{t('import.mappingAuto')}</option>
                        {headers.map((header) => <option key={header} value={header}>{header}</option>)}
                      </Select>
                    </Field>
                  ))}
                </div>
              </div>
            ) : null}
            {step === 2 ? (
              <Button onClick={runPreview} loading={busy} disabled={!text.trim()} icon={<Upload className="h-4 w-4" aria-hidden="true" />}>
                {t('import.preview')}
              </Button>
            ) : null}
          </SectionCard>
        ) : null}

        {step >= 3 && preview ? (
          <SectionCard
            title={t('import.step3')}
            subtitle={`${t('import.detected')} « ${preview.delimiter} » · ${preview.valid_count} ${t('import.validRows')} · ${preview.invalid_count} ${t('import.invalidRows')}`}
            bodyClassName="p-5"
          >
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col">{t('import.row')}</th>
                    <th scope="col">{t('import.content')}</th>
                    <th scope="col">{t('import.action')}</th>
                    <th scope="col">{t('import.issues')}</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row) => (
                    <tr key={row.row} className={row.valid ? undefined : 'bg-danger-50/40'}>
                      <td className="tabular-nums text-muted">{row.row}</td>
                      <td className="text-sm">
                        {Object.entries(row.values).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(' · ')}
                      </td>
                      <td>
                        <span className="text-xs font-medium text-ink-900">
                          {row.action === 'update' ? t('import.willUpdate') : t('import.willCreate')}
                        </span>
                      </td>
                      <td className="text-xs text-danger-600">
                        {row.issues.length === 0 ? '—' : row.issues.map((issue) => `${issue.field} : ${t(`import.issue.${issue.code}`)}`).join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {preview.mapping && Object.keys(preview.mapping).length > 0 ? (
              <p className="mt-3 text-xs text-muted">
                {t('import.detectedMapping')} {Object.entries(preview.mapping)
                  .map(([field, header]) => `${field} ← ${header}`).join(' · ')}
              </p>
            ) : null}
            {preview.unknown_columns && preview.unknown_columns.length > 0 ? (
              <p className="mt-1 text-xs text-warning-700">
                {t('import.unknownColumns')} {preview.unknown_columns.join(' · ')}
              </p>
            ) : null}

            {step === 3 ? (
              <div className="mt-4 space-y-3">
                {preview.invalid_count > 0 ? (
                  <div className="flex items-start gap-2 rounded-lg bg-warning-50 px-3 py-2 text-sm text-warning-700">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <div>
                      <p>{t('import.blockedHint', { count: preview.invalid_count })}</p>
                      <Checkbox
                        id="skip-invalid"
                        checked={skipInvalid}
                        onChange={(event) => setSkipInvalid(event.target.checked)}
                        label={t('import.excludeInvalid')}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => setStep(2)}>{t('common.back')}</Button>
                  <Button
                    onClick={runCommit}
                    loading={busy}
                    disabled={preview.invalid_count > 0 && !skipInvalid}
                    icon={<CheckCircle2 className="h-4 w-4" aria-hidden="true" />}
                  >
                    {t('import.confirm')}
                  </Button>
                </div>
              </div>
            ) : null}
          </SectionCard>
        ) : null}

        {step === 4 && result ? (
          <SectionCard title={t('import.step4')} bodyClassName="space-y-3 p-5">
            <p className="text-sm">
              {t('import.resultLine', { created: result.created, updated: result.updated, skipped: result.skipped })}
            </p>
            {result.identifiers.length > 0 ? (
              <p className="text-xs text-muted">{result.identifiers.join(' · ')}</p>
            ) : null}
            <ActivityTrail entityType="import_run" entityId={result.import_id} />
            <div className="flex flex-wrap gap-2">
              <Link to={entity === 'clients' ? '/clients' : entity === 'products' ? '/produits' : '/factures'} className="btn btn-primary">
                {entity === 'clients' ? t('import.seeClients') : entity === 'products' ? t('import.seeProducts') : t('import.seeInvoices')}
              </Link>
              <Button variant="secondary" onClick={restart}>{t('import.restart')}</Button>
            </div>
          </SectionCard>
        ) : null}

        <p className="text-xs text-muted">{columns.length === 0 ? t('import.help') : null}</p>
      </div>
    </>
  );
}
