import { ApiError } from './api';
import { t } from './i18n';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    const key = `errors.${error.code}`;
    // Server details (like a locked period) are interpolated when present.
    const message = t(key, error.details ?? undefined);
    return message === key ? t('errors.generic') : message;
  }
  return t('errors.generic');
}

export function fieldErrors(error: unknown): Record<string, string> {
  if (error instanceof ApiError && error.details) {
    return Object.fromEntries(
      Object.entries(error.details).map(([field, code]) => {
        const key = `validation.${code}`;
        const message = t(key);
        return [field, message === key ? t('errors.validation') : message];
      }),
    );
  }
  return {};
}
