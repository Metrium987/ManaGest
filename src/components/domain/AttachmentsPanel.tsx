import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import { api, downloadFile, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { formatDate } from '@/lib/format';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/Layout';
import { useConfirm } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

export interface AttachmentRecord {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
  uploaded_by_name: string | null;
}

interface AttachmentLimits {
  max_bytes: number;
  max_mb: number;
  allowed_types: string[];
  storage: string;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} Mo`;
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
 * Receipts for one record (T-101). The list is readable by anyone who may read
 * the record; uploading and deleting need its write permission, and the server
 * re-checks both — the buttons only mirror what the API allows.
 */
export function AttachmentsPanel({
  entity,
  entityId,
  canWrite,
}: {
  entity: 'expense' | 'payment';
  entityId: string;
  canWrite: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { confirm } = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const limits = useQuery({
    queryKey: ['attachment-limits'],
    queryFn: () => api.get<AttachmentLimits>('/attachments/limits'),
    staleTime: 5 * 60_000,
  });
  const list = useQuery({
    queryKey: ['attachments', entity, entityId],
    queryFn: () => api.get<{ attachments: AttachmentRecord[] }>(`/attachments${toQuery({ entity, entity_id: entityId })}`),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['attachments', entity, entityId] });
    queryClient.invalidateQueries({ queryKey: ['activity'] });
  };

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const maxBytes = limits.data?.max_bytes ?? 10 * 1024 * 1024;
      if (file.size > maxBytes) throw new Error('FILE_TOO_LARGE');
      const content = await readAsBase64(file);
      return api.post('/attachments', {
        entity,
        entity_id: entityId,
        filename: file.name,
        mime_type: file.type,
        content_base64: content,
      });
    },
    onSuccess: () => {
      toast.success(t('attachments.added'));
      invalidate();
    },
    onError: (error: unknown) => {
      if (error instanceof Error && error.message === 'FILE_TOO_LARGE') {
        toast.error(t('attachments.tooLarge', { size: `${limits.data?.max_mb ?? 10} Mo` }));
        return;
      }
      if (error instanceof Error && error.message === 'READ_FAILED') {
        toast.error(t('attachments.unreadable'));
        return;
      }
      toast.error(errorMessage(error));
    },
    onSettled: () => setBusy(false),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/attachments/${id}`),
    onSuccess: () => {
      toast.success(t('attachments.removed'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    upload.mutate(file);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-4">
      {canWrite ? (
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={inputRef}
            type="file"
            className="sr-only"
            aria-label={t('attachments.add')}
            accept={(limits.data?.allowed_types ?? ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']).join(',')}
            onChange={(event) => void pickFile(event.target.files?.[0])}
          />
          <Button
            type="button"
            variant="secondary"
            loading={busy}
            onClick={() => inputRef.current?.click()}
            icon={<Upload className="h-4 w-4" aria-hidden="true" />}
          >
            {t('attachments.add')}
          </Button>
          <p className="text-xs text-muted">{t('attachments.maxSize', { size: `${limits.data?.max_mb ?? 10} Mo` })}</p>
        </div>
      ) : null}

      {list.isLoading ? (
        <p className="text-sm text-muted">{t('common.loading')}</p>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-danger-700">{errorMessage(list.error)}</p>
      ) : list.data?.attachments.length ? (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {list.data.attachments.map((attachment) => (
            <li key={attachment.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{attachment.filename}</p>
                <p className="text-xs text-muted">
                  {formatFileSize(attachment.size_bytes)} · {formatDate(attachment.created_at.slice(0, 10))}
                  {attachment.uploaded_by_name ? ` · ${t('attachments.uploadedBy', { name: attachment.uploaded_by_name })}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  className="rounded-lg p-1.5 text-muted hover:bg-surface hover:text-ink"
                  aria-label={`${t('attachments.download')} ${attachment.filename}`}
                  onClick={() => void downloadFile(`/attachments/${attachment.id}/download`, attachment.filename).catch((error) => toast.error(errorMessage(error)))}
                >
                  <Download className="h-4 w-4" aria-hidden="true" />
                </button>
                {canWrite ? (
                  <button
                    type="button"
                    className="rounded-lg p-1.5 text-muted hover:bg-danger-50 hover:text-danger-600"
                    aria-label={`${t('attachments.remove')} ${attachment.filename}`}
                    onClick={async () => {
                      const accepted = await confirm({
                        title: t('attachments.remove'),
                        description: t('attachments.removeConfirm'),
                        danger: true,
                        confirmLabel: t('common.delete'),
                      });
                      if (accepted) remove.mutate(attachment.id);
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
        <EmptyState icon={<Paperclip className="h-6 w-6" aria-hidden="true" />} title={t('attachments.empty')} />
      )}
    </div>
  );
}
