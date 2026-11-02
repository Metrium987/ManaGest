import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileCheck2, Trash2, Upload } from 'lucide-react';
import {
  CLIENT_DOCUMENT_LABELS,
  type ClientDocumentType,
  type RequiredClientDocument,
} from '@shared/client-profile';
import { api, downloadFile } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import type { ClientDocument } from '@/lib/types';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Form';
import { EmptyState } from '@/components/ui/Layout';
import { useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { formatFileSize } from '@/components/domain/AttachmentsPanel';

interface DocumentsResponse {
  documents: ClientDocument[];
  checklist: RequiredClientDocument[];
  uploaded: string[];
  missing: ClientDocumentType[];
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('READ_FAILED'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      if (comma < 0) reject(new Error('READ_FAILED'));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

/**
 * Section 5 — official verification documents. The server decides which types
 * the category accepts and moves the account status as files arrive; this panel
 * only lists, uploads and downloads.
 */
export function ClientDocumentsPanel({
  clientId,
  canWrite,
}: {
  clientId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [docType, setDocType] = useState<string>('');

  const list = useQuery({
    queryKey: ['client-documents', clientId],
    queryFn: () => api.get<DocumentsResponse>(`/clients/${clientId}/documents`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['client-documents', clientId] });
    queryClient.invalidateQueries({ queryKey: ['client', clientId] });
    queryClient.invalidateQueries({ queryKey: ['clients'] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (file.size > 10 * 1024 * 1024) throw new Error('FILE_TOO_LARGE');
      const content = await readAsBase64(file);
      return api.post(`/clients/${clientId}/documents`, {
        doc_type: docType,
        filename: file.name,
        mime_type: file.type,
        content_base64: content,
      });
    },
    onSuccess: () => {
      toast.success(t('clientProfile.documentAdded'));
      invalidate();
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
        toast.error(t('attachments.tooLarge', { size: '10 Mo' }));
        return;
      }
      if (error instanceof Error && error.message === 'READ_FAILED') {
        toast.error(t('attachments.unreadable'));
        return;
      }
      toast.error(errorMessage(error));
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/clients/documents/${id}`),
    onSuccess: () => {
      toast.success(t('clientProfile.documentDeleted'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!docType) {
      toast.error(t('common.requiredFields'));
      return;
    }
    upload.mutate(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  const checklist = list.data?.checklist ?? [];
  const missing = list.data?.missing ?? [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t('clientProfile.documentsHint')}</p>

      {missing.length ? (
        <p role="status" className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-700">
          {t('clientProfile.missingDocuments', {
            list: missing.map((type) => CLIENT_DOCUMENT_LABELS[type]).join(', '),
          })}
        </p>
      ) : list.data ? (
        <p role="status" className="rounded-xl bg-success-50 px-3 py-2 text-sm text-success-700">
          {t('clientProfile.status.UNDER_REVIEW')}
        </p>
      ) : null}

      {canWrite ? (
        <div className="flex flex-wrap items-end gap-3">
          <Field label={t('clientProfile.documentType')} htmlFor="doc_type" className="min-w-56 flex-1">
            <Select id="doc_type" value={docType} onChange={(event) => setDocType(event.target.value)}>
              <option value="">—</option>
              {checklist.map((entry) => (
                <option key={entry.type} value={entry.type}>
                  {CLIENT_DOCUMENT_LABELS[entry.type]}
                  {entry.required ? ' *' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            aria-label={t('clientProfile.documentAdd')}
            accept="application/pdf,image/jpeg,image/png,image/webp"
            onChange={(event) => pickFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="secondary"
            loading={upload.isPending}
            disabled={!docType}
            onClick={() => inputRef.current?.click()}
            icon={<Upload className="h-4 w-4" aria-hidden="true" />}
          >
            {t('clientProfile.documentAdd')}
          </Button>
        </div>
      ) : null}

      {list.isLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger-700">{errorMessage(list.error)}</p>
      ) : list.data?.documents.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {list.data.documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{CLIENT_DOCUMENT_LABELS[document.doc_type]}</p>
                <p className="truncate text-xs text-muted">
                  {document.filename} · {formatFileSize(document.size_bytes)} · {formatDate(document.created_at.slice(0, 10))}
                  {document.uploaded_by_name ? ` · ${t('attachments.uploadedBy', { name: document.uploaded_by_name })}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                  aria-label={`${t('common.download')} ${document.filename}`}
                  onClick={() => void downloadFile(`/clients/documents/${document.id}/download`, document.filename)
                    .catch((error) => toast.error(errorMessage(error)))}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                    aria-label={`${t('common.delete')} ${document.filename}`}
                    onClick={async () => {
                      const accepted = await confirm({
                        title: t('common.delete'),
                        description: t('clientProfile.deleteDocumentConfirm'),
                        danger: true,
                        confirmLabel: t('common.delete'),
                      });
                      if (accepted) remove.mutate(document.id);
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState icon={<FileCheck2 className="h-6 w-6" aria-hidden="true" />} title={t('clientProfile.noDocuments')} />
      )}

      {checklist.length ? (
        <ul className="grid gap-1 text-xs text-muted sm:grid-cols-2">
          {checklist.map((entry) => (
            <li key={entry.type} className="flex items-center gap-1.5">
              <span aria-hidden="true">{list.data?.uploaded.includes(entry.type) ? '✓' : '○'}</span>
              {CLIENT_DOCUMENT_LABELS[entry.type]}
              <span className="text-[11px] uppercase tracking-wide">
                {entry.required ? t('clientProfile.requiredDocument') : t('clientProfile.optionalDocument')}
              </span>
              {entry.conditional ? <span className="italic">({entry.conditional})</span> : null}
            </li>
          ))}
        </ul>
      ) : null}

    </div>
  );
}
