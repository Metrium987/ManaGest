import fs from 'node:fs';
import { chromium } from 'playwright';

/**
 * Q16 — visual check of the delivered screens.
 *
 * The API says a route answers; only a browser says the screen renders. This script
 * signs in, walks the screens that were built, and writes one PNG per screen into
 * `artifacts/`, so a broken layout or a blank tab is visible instead of assumed.
 *
 * Usage: BASE_URL=https://... node scripts/screenshots.mjs
 * Needs a Playwright Chromium build: `npx playwright install chromium`.
 */

const BASE = process.env.BASE_URL ?? 'https://site-c578992b6feb4d56ac337293d766de8a.freebuff.page';
const EMAIL = process.env.SCREENSHOT_EMAIL ?? 'admin@managest.pf';
const PASSWORD = process.env.SCREENSHOT_PASSWORD ?? EMAIL;

fs.mkdirSync('artifacts', { recursive: true });

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL ?? undefined,
  executablePath: process.env.PW_CHROME_PATH ?? undefined,
  // Containers without user namespaces need this; a desktop run keeps the sandbox.
  args: process.env.PW_NO_SANDBOX === '1'
    ? ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    : [],
});
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'fr-FR' });
const page = await context.newPage();
page.on('pageerror', (error) => console.log('page error:', String(error).slice(0, 160)));

async function shot(name) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: `artifacts/${name}.png` });
  console.log('shot:', name, page.url());
}

async function open(path, name, clicks = []) {
  try {
    await page.goto(BASE + path, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900);
    for (const label of clicks) {
      const target = page.getByRole('button', { name: label }).first();
      if (await target.count()) {
        await target.click();
        await page.waitForTimeout(1000);
      } else {
        console.log('no button:', label);
      }
    }
    await shot(name);
  } catch (error) {
    console.log('failed:', name, String(error).slice(0, 200));
  }
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await shot('01-connexion');

const email = page.locator('input[type=email]').first();
if (await email.count()) {
  await email.fill(EMAIL);
  await page.locator('input[type=password]').first().fill(PASSWORD);
  await page.locator('button[type=submit]').first().click();
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(1500);
}
console.log('after login:', page.url());
await shot('02-tableau-de-bord');

await open('/produits', '03-produits');
await open('/produits', '04-feuille-import', ['Feuille d’import']);
await open('/projets', '05-projets');
await open('/projets', '06-modeles-projet', ['Modèles de projet']);
await open('/devis', '07-devis');
await open('/parametres', '08-parametres');

await browser.close();
