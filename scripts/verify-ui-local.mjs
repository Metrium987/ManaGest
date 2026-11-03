/**
 * Browser smoke check for the delivered screens (npm run test:ui).
 * Drives the real UI on a local instance: sign-in, CSV export, import
 * export/re-import, unknown column, product price history and purchasing
 * settings. Needs the API on :8787 and `npx playwright install chromium`; a
 * container without user namespaces can set PW_SINGLE_PROCESS=1.
 */
import fs from 'node:fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
const EMAIL = process.env.PREVIEW_EMAIL ?? 'admin@managest.pf';
const PASSWORD = process.env.PREVIEW_PASSWORD ?? 'ManaGest-Demo-2026!';
const OUT = '/tmp/verify';
const SHOTS = 'artifacts/ui-verification';
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const failures = [];
const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  if (!ok) failures.push(name);
}
const header = (file) => fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0];

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME_PATH || undefined,
  // A container without user namespaces may need one process; a desktop run
  // keeps the normal multi-process browser.
  args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    ...(process.env.PW_SINGLE_PROCESS === '1' ? ['--single-process'] : []),
  ],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR', acceptDownloads: true });
const page = await context.newPage();
const consoleErrors = [];
page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${String(error).slice(0, 200)}`));
page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`console: ${message.text().slice(0, 200)}`); });

try {
  // --- sign in -------------------------------------------------------------
  await page.goto(`${BASE}/connexion`);
  await page.fill('#email', EMAIL);
  await page.fill('#password', PASSWORD);
  await page.getByRole('button', { name: /Se connecter/ }).click();
  await page.waitForURL(`${BASE}/`, { timeout: 15000 });
  check('connexion', true, page.url());

  // The list export uses the same download helper; it must download too.
  await page.goto(`${BASE}/clients`);
  const [listExport] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('button', { name: 'Exporter en CSV' }).first().click(),
  ]);
  check('export de liste téléchargé', listExport.suggestedFilename().endsWith('.csv'), listExport.suggestedFilename());

  // --- 1. import screen ----------------------------------------------------
  const openImport = async () => {
    await page.goto(`${BASE}/importer`);
    await page.getByRole('button', { name: 'Suivant' }).click();
    await page.locator('#import-file').waitFor({ timeout: 10000 });
  };
  await page.goto(`${BASE}/importer`);
  const [templateDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#import-template'),
  ]);
  const templatePath = `${OUT}/template-clients.csv`;
  await templateDownload.saveAs(templatePath);

  const [exportDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#import-export'),
  ]);
  const exportPath = `${OUT}/export-clients.csv`;
  await exportDownload.saveAs(exportPath);
  await page.screenshot({ path: `${SHOTS}/01-import-export.png`, fullPage: true });

  const templateHeader = header(templatePath);
  const exportHeader = header(exportPath);
  check('export = en-têtes du modèle', templateHeader === exportHeader,
    `modèle "${templateHeader.slice(0, 60)}…" / export "${exportHeader.slice(0, 60)}…"`);

  // Re-import the exported file through the normal wizard.
  await openImport();
  await page.setInputFiles('#import-file', exportPath);
  await page.getByText(/fichier chargé/).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: 'Analyser le fichier' }).click();
  await page.getByText('3. Vérifier l’aperçu').waitFor({ timeout: 15000 });
  const previewText = await page.locator('section.card').filter({ hasText: '3. Vérifier l’aperçu' }).innerText();
  check('réimport : 0 ligne en erreur', /0 ligne\(s\) en erreur/.test(previewText), previewText.split('\n')[1]);
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await page.getByText('4. Résultat de l’importation').waitFor({ timeout: 20000 });
  const resultText = await page.locator('section.card').filter({ hasText: '4. Résultat de l’importation' }).innerText();
  check('réimport : résultat affiché', /\d+ créé\(s\), \d+ mis à jour/.test(resultText), resultText.split('\n')[1]);

  // Unknown column: extra header must be reported, not guessed.
  const templateLines = fs.readFileSync(templatePath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/).filter(Boolean);
  const templateLabels = templateLines[0].split(';');
  const cells = (templateLines[2] ?? templateLines[1]).split(';');
  const emailIndex = templateLabels.indexOf('courriel');
  const unknownEmail = `verif.colonne.${Date.now()}@example.pf`;
  cells[emailIndex] = unknownEmail;
  const unknownCsv = `${templateLabels.join(';')};code_interne\r\n${cells.join(';')};X-42\r\n`;

  await openImport();
  await page.fill('#import-text', unknownCsv);
  await page.getByRole('button', { name: 'Analyser le fichier' }).click();
  await page.getByText('3. Vérifier l’aperçu').waitFor({ timeout: 15000 });
  const unknownText = await page.locator('section.card').filter({ hasText: '3. Vérifier l’aperçu' }).innerText();
  check('colonne inconnue signalée', /Colonnes ignorées/.test(unknownText) && /code_interne/.test(unknownText));
  check('colonne inconnue non bloquante', /0 ligne\(s\) en erreur/.test(unknownText));
  await page.getByRole('button', { name: 'Importer', exact: true }).click();
  await page.getByText('4. Résultat de l’importation').waitFor({ timeout: 20000 });
  const createdText = await page.locator('section.card').filter({ hasText: '4. Résultat de l’importation' }).innerText();
  check('colonne inconnue importée', new RegExp(`créé`).test(createdText), createdText.split('\n')[1]);

  // --- data for the product history, through the app's own endpoints -------
  const csrf = (await context.cookies()).find((cookie) => cookie.name === 'mg_csrf')?.value;
  const mutating = { 'x-csrf-token': csrf ?? '' };
  const readJson = async (response) => {
    const text = await response.text();
    try { return { status: response.status(), body: JSON.parse(text) }; }
    catch { return { status: response.status(), body: { raw: text.slice(0, 300) } }; }
  };
  const products = await readJson(await page.request.get(`${BASE}/api/products?per_page=50`));
  const product = products.body.data.find((row) => row.name === 'Fournitures de bureau') ?? products.body.data[0];
  const spare = products.body.data.find((row) => row.id !== product.id && row.item_type !== 'service');

  let vendors = await readJson(await page.request.get(`${BASE}/api/vendors?per_page=5`));
  let vendor = vendors.body.data?.[0];
  if (!vendor) {
    const createdVendor = await readJson(await page.request.post(`${BASE}/api/vendors`, {
      headers: mutating, data: { name: 'Fournisseur Vérification', country: 'Polynésie française' },
    }));
    vendor = { id: createdVendor.body.id, name: 'Fournisseur Vérification' };
  }

  const link = (price) => page.request.post(`${BASE}/api/products/${product.id}/vendors`, {
    headers: mutating,
    data: { vendor_id: vendor.id, price, moq: 0, lead_time_days: 7, vendor_ref: 'REF-VERIF', is_preferred: false },
  });
  const linkOne = await readJson(await link(10_000));
  const linkTwo = await readJson(await link(12_000));
  check('liaison fournisseur créée', linkOne.status === 200 || linkOne.status === 201, `status ${linkOne.status}/${linkTwo.status}`);

  const today = new Date().toISOString().slice(0, 10);
  const order = await readJson(await page.request.post(`${BASE}/api/purchase-orders`, {
    headers: mutating,
    data: {
      vendor_id: vendor.id,
      date: today,
      expected_date: null,
      line_items: [{
        id: 'line-1', product_id: product.id, description: product.name,
        quantity: 2, unit_price: 15_000, tax_rate: 0,
      }],
      discount_type: 'percent', discount_value: 0, notes: 'Vérification navigateur',
    },
  }));
  check('bon de commande créé', order.status === 201, `status ${order.status} ${JSON.stringify(order.body).slice(0, 120)}`);
  const orderId = order.body.id;
  const received = orderId
    ? await readJson(await page.request.post(`${BASE}/api/purchase-orders/${orderId}/receive`, {
      headers: mutating, data: { lines: [{ line_id: 'line-1', quantity: 2 }] },
    }))
    : { status: 0, body: {} };
  check('réception enregistrée', received.status === 200, `status ${received.status} ${JSON.stringify(received.body).slice(0, 160)}`);

  // --- 2. product sheet: price history -------------------------------------
  await page.goto(`${BASE}/produits`);
  await page.getByRole('button', { name: `Fournisseurs ${product.name}` }).first().click();
  const historyHeading = page.getByText('Historique des prix d’achat').first();
  await historyHeading.waitFor({ timeout: 10000 });
  const panel = historyHeading.locator('xpath=../..');
  let panelText = await panel.innerText();
  check('panneau historique affiché', panelText.includes('Historique des prix d’achat'));
  check('valeurs par défaut 36/90', /Conservation 36 mois/.test(panelText) && /référence sur 90 jours/.test(panelText), panelText.split('\n').slice(0, 3).join(' | '));
  check('badge de hausse', /Hausse de 25\.0 % \(seuil 10 %\)/.test(panelText), (panelText.match(/Hausse[^\n]*/) ?? ['absent'])[0]);
  check('événement réception avec bon', /payé sur réception BC-/.test(panelText), (panelText.match(/payé sur réception[^\n]*/) ?? ['absent'])[0]);
  check('fournisseur et prix moyen', panelText.includes(vendor.name) && /Prix moyen sur 90 jours/.test(panelText));
  await page.screenshot({ path: `${SHOTS}/02-product-price-history.png`, fullPage: true });

  // Empty state on a product with no history.
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  if (spare) {
    await page.getByRole('button', { name: `Fournisseurs ${spare.name}` }).first().click();
    await page.getByText('Historique des prix d’achat').first().waitFor({ timeout: 10000 });
    const emptyText = await page.getByText('Historique des prix d’achat').first().locator('xpath=../..').innerText();
    check('état vide explicite', /Aucun prix enregistré sur la période/.test(emptyText), emptyText.replace(/\n/g, ' | ').slice(0, 220));
    check('état vide sans NaN', !/NaN/.test(emptyText));
    await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  }

  // --- 3. settings: purchasing --------------------------------------------
  await page.goto(`${BASE}/parametres`);
  await page.getByRole('tab', { name: 'Taxes' }).click();
  const purchasingSection = page.locator('section.card').filter({ hasText: 'Achats et prix d’achat' });
  await purchasingSection.first().waitFor({ timeout: 10000 });
  await purchasingSection.scrollIntoViewIfNeeded();
  const values = async () => ({
    months: await page.inputValue('#price_history_months'),
    percent: await page.inputValue('#price_alert_percent'),
    days: await page.inputValue('#price_alert_days'),
  });
  const defaults = await values();
  check('réglages par défaut affichés', defaults.months === '36' && defaults.percent === '10' && defaults.days === '90', JSON.stringify(defaults));

  await page.fill('#price_history_months', '24');
  await page.fill('#price_alert_percent', '30');
  await page.fill('#price_alert_days', '60');
  await purchasingSection.getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Paramètres enregistrés.').first().waitFor({ timeout: 10000 });

  await page.reload();
  await page.getByRole('tab', { name: 'Taxes' }).click();
  await page.locator('section.card').filter({ hasText: 'Achats et prix d’achat' }).first().waitFor({ timeout: 10000 });
  const persisted = await values();
  check('réglages persistés après rechargement', persisted.months === '24' && persisted.percent === '30' && persisted.days === '60', JSON.stringify(persisted));

  // Invalid value must produce a readable message, not a silent failure.
  await page.fill('#price_alert_percent', '5000');
  await page.locator('section.card').filter({ hasText: 'Achats et prix d’achat' }).getByRole('button', { name: 'Enregistrer' }).click();
  const toast = page.getByRole('status').getByText(/invalide|erreur|Valide/i).first();
  let toastText = 'aucun message';
  try {
    await toast.waitFor({ timeout: 8000 });
    toastText = (await page.getByRole('status').innerText()).replace(/\n/g, ' | ');
    check('valeur hors bornes refusée avec message', true, toastText);
    check('message nommant le champ refusé', /Seuil d’alerte de hausse \(%\) : valeur invalide/.test(toastText), toastText);
  } catch {
    check('valeur hors bornes refusée avec message', false, 'aucun toast observé');
  }
  await page.screenshot({ path: `${SHOTS}/03-settings-purchasing.png`, fullPage: true });
  await page.reload();
  await page.getByRole('tab', { name: 'Taxes' }).click();
  await page.locator('#price_history_months').waitFor({ timeout: 10000 });
  const afterInvalid = await values();
  check('valeur refusée non enregistrée', afterInvalid.percent === '30', JSON.stringify(afterInvalid));

  // --- the sheet reflects the new threshold without an inconsistent reload --
  await page.goto(`${BASE}/produits`);
  await page.getByRole('button', { name: `Fournisseurs ${product.name}` }).first().click();
  const headingAgain = page.getByText('Historique des prix d’achat').first();
  await headingAgain.waitFor({ timeout: 10000 });
  panelText = await headingAgain.locator('xpath=../..').innerText();
  check('fiche : nouveaux seuils affichés', /Conservation 24 mois/.test(panelText) && /référence sur 60 jours/.test(panelText), panelText.split('\n').slice(0, 3).join(' | '));
  check('fiche : badge retiré au seuil 30 %', !/Hausse de/.test(panelText), (panelText.match(/Hausse[^\n]*/) ?? ['aucun badge'])[0]);
  check('fiche : réception toujours listée', /payé sur réception BC-/.test(panelText));
  await page.screenshot({ path: `${SHOTS}/04-product-after-threshold.png`, fullPage: true });
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();

  // Restore documented defaults for the workspace.
  await page.goto(`${BASE}/parametres`);
  await page.getByRole('tab', { name: 'Taxes' }).click();
  await page.locator('section.card').filter({ hasText: 'Achats et prix d’achat' }).first().waitFor({ timeout: 10000 });
  await page.fill('#price_history_months', '36');
  await page.fill('#price_alert_percent', '10');
  await page.fill('#price_alert_days', '90');
  await page.locator('section.card').filter({ hasText: 'Achats et prix d’achat' }).getByRole('button', { name: 'Enregistrer' }).click();
  await page.getByText('Paramètres enregistrés.').first().waitFor({ timeout: 10000 });

  // Two 4xx are expected: the pre-login `/me` probe (401) and the deliberately
  // invalid threshold (422). Anything else — especially a page error — is a defect.
  const unexpected = consoleErrors.filter((message) =>
    !/401 \(Unauthorized\)/.test(message) && !/422 \(Unprocessable Entity\)/.test(message));
  check('aucune erreur console inattendue', unexpected.length === 0, unexpected.slice(0, 3).join(' / '));
} catch (error) {
  console.log('ABORT', String(error).slice(0, 500));
  failures.push('parcours interrompu');
  await page.screenshot({ path: `${SHOTS}/99-failure.png`, fullPage: true }).catch(() => {});
} finally {
  await browser.close();
}

console.log('\n=== RÉSUMÉ ===');
for (const check of checks) console.log(`${check.ok ? 'OK  ' : 'KO  '} ${check.name}${check.detail ? ` — ${check.detail}` : ''}`);
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify({ checks, failures, consoleErrors }, null, 2));
console.log(`\n${checks.filter((c) => c.ok).length}/${checks.length} contrôles verts`);
process.exit(failures.length > 0 ? 1 : 0);
