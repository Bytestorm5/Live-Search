/**
 * One-off observation harness (not a test): loads the built app from the
 * SPA-fallback static server, clicks Start, and dumps the error banner + every
 * network request so we can see exactly which URL returns HTML.
 */
import { chromium } from '@playwright/test';
import { startStaticServer } from './static-server.mjs';

const EXECUTABLE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const { server, url } = await startStaticServer('dist');
console.log('serving dist at', url);

const browser = await chromium.launch({
  executablePath: EXECUTABLE,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--no-sandbox'],
});
const context = await browser.newContext({ permissions: ['microphone'] });
const page = await context.newPage();

const requests = [];
page.on('response', async (res) => {
  const u = res.url();
  const ct = res.headers()['content-type'] ?? '';
  requests.push({ url: u, status: res.status(), ct });
  if (/huggingface\.co|hf\.co/.test(u)) console.log('[HF]', res.status(), ct.split(';')[0], u.slice(0, 130));
});
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));

// Keep it light: block only the big model weights, allow all JSON/config.
await page.route('**', (route) => {
  const u = route.request().url();
  if (/huggingface\.co|hf\.co/.test(u) && /\.(onnx|onnx_data|bin)(\?|$)/.test(u)) {
    return route.abort();
  }
  return route.continue();
});

await page.goto(url, { waitUntil: 'domcontentloaded' });
console.log('crossOriginIsolated =', await page.evaluate(() => globalThis.crossOriginIsolated));

await page.getByRole('button', { name: /start listening/i }).click();
for (let i = 0; i < 9; i++) {
  await page.waitForTimeout(5000);
  const status = await page.locator('.status-bar').textContent().catch(() => '');
  const banner = await page.locator('.error-banner').textContent().catch(() => '');
  console.log(`[t+${(i + 1) * 5}s] status="${(status ?? '').trim().slice(0, 120)}" banner="${(banner ?? '').trim().slice(0, 160)}"`);
  if ((banner ?? '').trim()) break;
}

const banner = await page.locator('.error-banner').textContent().catch(() => '(none)');
console.log('\n=== ERROR BANNER ===\n', banner);

console.log('\n=== SAME-ORIGIN /models/ requests (should be NONE after fix) ===');
for (const r of requests) {
  if (r.url.startsWith(url) && r.url.includes('/models/')) console.log(' ', r.status, r.ct, r.url);
}
console.log('\n=== requests returning text/html (potential JSON.parse traps) ===');
for (const r of requests) {
  if (r.ct.includes('text/html') && !r.url.endsWith('/') && !r.url.endsWith('index.html') && r.url !== url + '/') {
    console.log(' ', r.status, r.url);
  }
}
console.log('\n=== all model-ish requests ===');
for (const r of requests) {
  if (/models|huggingface|hf\.co|\.onnx|\.wasm|resolve/.test(r.url)) console.log(' ', r.status, r.ct.split(';')[0], r.url.slice(0, 120));
}

await browser.close();
server.close();
