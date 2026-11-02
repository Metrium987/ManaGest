import { missingConfigMessage, previewConfig } from './preview-config.mjs';

const config = previewConfig();
if (!config.ok) {
  console.error(missingConfigMessage(config));
  // Exit 2 (not 1) keeps "misconfigured" distinct from "a check failed".
  process.exit(2);
}
console.log(`Contrôles hébergés : ${config.url} (${config.email})`);
