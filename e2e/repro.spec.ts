import { test, expect } from '@playwright/test';

/**
 * Regression test for the reported failure:
 *
 *   "Index load failed: SyntaxError: JSON.parse: unexpected character at line 1
 *    column 1 of the JSON data"
 *
 * Cause: when local model loading was enabled, Transformers.js fetched model
 * files from the SAME origin (e.g. /models/<repo>/config.json). On a static host
 * the SPA fallback returns index.html (HTTP 200) for that missing path, and
 * JSON.parse('<!doctype html>…') throws "unexpected character at line 1 column
 * 1". This test serves the built app from a server WITH that SPA fallback and
 * asserts the failure can no longer happen.
 *
 * Hugging Face requests are intercepted so the test is fast and offline:
 *  - *.json model files are answered with valid JSON,
 *  - model weights (.onnx) are aborted.
 * The app must therefore degrade to lexical-only retrieval without ever throwing
 * the JSON.parse error or probing a same-origin /models/ path.
 */
test('starting the pipeline never JSON.parses an HTML SPA fallback', async ({ page, baseURL }) => {
  const base = baseURL!;
  const sameOriginModelRequests: string[] = [];
  const errorTexts: string[] = [];

  // Capture errors AND warnings — the graceful fallback reports the underlying
  // cause as a warning, so a JSON.parse failure would surface there too.
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errorTexts.push(m.text());
  });
  page.on('pageerror', (e) => errorTexts.push(String(e)));

  // Record any same-origin request for a model file — the SPA-fallback trap.
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(base) && /\/models\//.test(u)) sameOriginModelRequests.push(u);
  });

  // Make model loading deterministic/offline.
  await page.route('**', (route) => {
    const u = route.request().url();
    if (/huggingface\.co|hf\.co/.test(u)) {
      if (/\.(onnx|onnx_data|bin)(\?|$)/.test(u)) return route.abort();
      if (/\.json(\?|$)/.test(u)) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      }
      return route.abort();
    }
    return route.continue();
  });

  await page.goto('/');
  expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true);

  await page.getByRole('button', { name: /start listening/i }).click();

  // Wait for retrieval to actually finish initializing. The "ready" chip carries
  // the `ok` class (a still-loading chip is `loading`), so this only matches once
  // the retrieval worker has completed its model attempt — by which point any
  // same-origin /models/ probe would already have happened.
  await expect(page.locator('.chip.ok', { hasText: /lexical search|hybrid search/i })).toBeVisible({
    timeout: 60_000,
  });

  // The exact reported error must never appear (in errors, warnings, or banner).
  const banner = (await page.locator('.error-banner').textContent())?.trim() ?? '';
  const allErrors = [...errorTexts, banner].join('\n');
  expect(allErrors, `errors seen:\n${allErrors}`).not.toMatch(/unexpected character|JSON\.parse/i);

  // And we must never have probed a same-origin model path (the root cause).
  expect(
    sameOriginModelRequests,
    `unexpected same-origin /models/ requests:\n${sameOriginModelRequests.join('\n')}`,
  ).toHaveLength(0);
});
