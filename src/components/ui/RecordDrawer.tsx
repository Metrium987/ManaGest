import { useEffect, useState, type ReactNode } from 'react';
import { t } from '@/lib/i18n';
import { Modal } from './Modal';
import { StatusBadge } from './Layout';

/**
 * Read-only record detail (T-201a/b/c). The same drawer serves every list: a
 * screen only hands over the labelled fields it already holds, so there is one
 * detail experience to review instead of nine bespoke screens that drift.
 *
 * It is imperative on purpose: adding a « Voir » action to a list means calling
 * `showRecord(...)`, without a state, a query or a JSX slot per page.
 */
export interface RecordField {
  label: string;
  value: ReactNode;
  wide?: boolean;
}

export interface RecordSection {
  title: string;
  fields: RecordField[];
}

export interface RecordDetail {
  title: string;
  subtitle?: string;
  status?: string;
  fields: RecordField[];
  sections?: RecordSection[];
}

type Listener = (detail: RecordDetail | null) => void;
let current: RecordDetail | null = null;
const listeners = new Set<Listener>();

function emit(detail: RecordDetail | null): void {
  current = detail;
  for (const listener of listeners) listener(detail);
}

export function showRecord(detail: RecordDetail): void {
  emit(detail);
}

export function closeRecord(): void {
  emit(null);
}

function FieldList({ fields }: { fields: RecordField[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label} className={field.wide ? 'sm:col-span-2' : ''}>
          <dt className="text-xs font-medium uppercase tracking-wide text-muted">{field.label}</dt>
          <dd className="mt-0.5 break-words text-sm text-ink-900">
            {field.value === '' || field.value === null || field.value === undefined
              ? t('records.empty')
              : field.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function RecordDrawerHost() {
  const [detail, setDetail] = useState<RecordDetail | null>(current);

  useEffect(() => {
    listeners.add(setDetail);
    return () => {
      listeners.delete(setDetail);
    };
  }, []);

  return (
    <Modal
      open={Boolean(detail)}
      onClose={closeRecord}
      title={detail?.title ?? t('records.title')}
      description={detail?.subtitle}
      size="lg"
      footer={<span className="text-xs text-muted">{t('records.readOnly')}</span>}
    >
      {detail ? (
        <div className="space-y-5">
          {detail.status ? <StatusBadge status={detail.status} /> : null}
          <FieldList fields={detail.fields} />
          {(detail.sections ?? []).map((section) => (
            <section key={section.title} className="rounded-xl border border-line p-4">
              <h3 className="mb-3 text-sm font-semibold text-ink-900">{section.title}</h3>
              <FieldList fields={section.fields} />
            </section>
          ))}
        </div>
      ) : null}
    </Modal>
  );
}
