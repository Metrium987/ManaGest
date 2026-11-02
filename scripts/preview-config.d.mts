export const REQUIRED_PREVIEW_VARIABLES: readonly string[];
export interface PreviewConfig {
  ok: boolean;
  url: string;
  email: string;
  password: string;
  missing: string[];
  invalidUrl: string | null;
}
export function previewConfig(env?: Record<string, string | undefined>): PreviewConfig;
export function missingConfigMessage(config: PreviewConfig): string;
