import { CSRF_COOKIE, CSRF_HEADER } from '@shared/domain';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, string> | null,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

function readCookie(name: string): string {
  // A browser may hold the same cookie twice (a partitioned copy of an earlier
  // deployment next to the current one); the newest one comes last, and the
  // server accepts any candidate that matches the session.
  const pattern = new RegExp(`(?:^|; )${name}=([^;]*)`, 'g');
  let value = '';
  for (const match of document.cookie.matchAll(pattern)) value = decodeURIComponent(match[1]);
  return value;
}

export async function apiRequest<T>(
  path: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {},
): Promise<T> {
  const method = options.method ?? 'GET';
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (method !== 'GET' && method !== 'HEAD') headers[CSRF_HEADER] = readCookie(CSRF_COOKIE);

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR');
  }

  if (response.status === 204) return undefined as T;

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    if (!response.ok) throw new ApiError(response.status, 'INTERNAL_ERROR');
    return (await response.text()) as T;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; details?: Record<string, string> } }).error;
    throw new ApiError(response.status, error?.code ?? 'INTERNAL_ERROR', error?.details ?? null);
  }
  return payload as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiRequest<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'POST', body }),
  patch: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'PUT', body }),
  delete: <T>(path: string, body?: unknown) => apiRequest<T>(path, { method: 'DELETE', body }),
};

export async function downloadFile(path: string, filename: string): Promise<void> {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin' });
  if (!response.ok) throw new ApiError(response.status, 'DOWNLOAD_FAILED');
  // The server names the file; its header wins over the caller's fallback so a
  // dated export keeps the name the API chose.
  const disposition = response.headers.get('content-disposition') ?? '';
  const named = /filename="([^"]+)"/.exec(disposition)?.[1];
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = named ?? filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** PDF downloads are the common case; the helper itself is format-agnostic. */
export const downloadPdf = downloadFile;

export function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}
