import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkPlus, X } from 'lucide-react';
import { api, toQuery } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { t } from '@/lib/i18n';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Form';
import { useToast } from '@/components/ui/Toast';

export interface SavedFilter {
  id: string;
  list_key: string;
  name: string;
  query: string;
}

/**
 * Saved filters (T-206). A filter stores the query string a list already uses, so
 * a screen only has to pass its current query and accept one back: nothing about
 * how a list filters changes, and a filter can never widen what the server returns.
 */
export function SavedFilterBar({
  list,
  query,
  onApply,
}: {
  list: string;
  query: string;
  onApply: (query: string) => void;
}) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');

  const filters = useQuery({
    queryKey: ['saved-filters', list],
    queryFn: () => api.get<{ data: SavedFilter[] }>(`/filters${toQuery({ list })}`),
  });

  const save = useMutation({
    mutationFn: () => api.post('/filters', { list, name: name.trim(), query }),
    onSuccess: (result) => {
      toast.success(t('filters.saved'));
      setName('');
      onApply((result as SavedFilter).query ?? query);
      queryClient.invalidateQueries({ queryKey: ['saved-filters', list] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/filters/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['saved-filters', list] }),
    onError: (error) => toast.error(errorMessage(error)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted">
        <Bookmark className="h-3.5 w-3.5" aria-hidden="true" />
        {t('filters.title')}
      </span>
      {(filters.data?.data ?? []).map((filter) => (
        <span key={filter.id} className="inline-flex items-center overflow-hidden rounded-full border border-line bg-surface">
          <button
            type="button"
            onClick={() => onApply(filter.query)}
            className="px-3 py-1 text-xs font-medium text-ink-800 hover:bg-white"
            title={filter.query || t('filters.hint')}
          >
            {filter.name}
          </button>
          <button
            type="button"
            onClick={() => remove.mutate(filter.id)}
            className="px-1.5 py-1 text-muted hover:text-danger-600"
            aria-label={`${t('common.delete')} ${filter.name}`}
          >
            <X className="h-3 w-3" aria-hidden="true" />
          </button>
        </span>
      ))}
      {!(filters.data?.data ?? []).length ? <span className="text-xs text-muted">{t('filters.empty')}</span> : null}
      <form
        className="ml-auto flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) save.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={t('filters.name')}
          aria-label={t('filters.name')}
          className="h-8 w-40 py-0 text-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="ghost"
          disabled={!name.trim()}
          loading={save.isPending}
          icon={<BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />}
        >
          {t('filters.save')}
        </Button>
      </form>
    </div>
  );
}
