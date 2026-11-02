/**
 * H5 — configuration of the hosted checks.
 *
 * The account and its password live in the CI secret store, never in the
 * repository. This module only decides whether the environment is complete
 * enough to run, so the failure is a clear sentence instead of a stack trace
 * from the first HTTP call.
 */

export const REQUIRED_PREVIEW_VARIABLES = ['PREVIEW_URL', 'PREVIEW_EMAIL', 'PREVIEW_PASSWORD'];

export function previewConfig(env = process.env) {
  const value = (key) => (env[key] ?? '').trim();
  const url = value('PREVIEW_URL').replace(/\/+$/, '');
  const missing = REQUIRED_PREVIEW_VARIABLES.filter((key) => value(key) === '');
  const invalidUrl = url !== '' && !/^https?:\/\/[^/\s]+/.test(url)
    ? 'PREVIEW_URL doit être une origine http(s), par exemple https://preview.exemple.pf'
    : null;
  return {
    ok: missing.length === 0 && !invalidUrl,
    url,
    email: value('PREVIEW_EMAIL'),
    password: value('PREVIEW_PASSWORD'),
    missing,
    invalidUrl,
  };
}

export function missingConfigMessage(config) {
  if (config.invalidUrl) return config.invalidUrl;
  if (config.missing.length === 0) return '';
  return `Contrôles hébergés non configurés — variables manquantes : ${config.missing.join(', ')}.`
    + ' Créez-les dans le dépôt GitHub → Settings → Secrets and variables → Actions'
    + ' (PREVIEW_URL, PREVIEW_EMAIL, PREVIEW_PASSWORD), puis lancez le workflow « Hosted preview checks ».';
}
