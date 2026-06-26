import { test, expect } from '@playwright/test';

/**
 * End-to-end happy path with a MOCKED OpenAI Realtime WebSocket (no network, no
 * key needed). It verifies the full new pipeline in a real browser:
 *
 *   Start → mic capture → connect → session.update → a completed transcript
 *   arrives → local term extraction + retrieval → a documentation result renders.
 *
 * The fake WebSocket is injected before app code runs; it acknowledges the
 * session and then emits a transcript that mentions corpus terms ("Moonshine",
 * "WebGPU"), which must surface the matching doc from the sample corpus.
 */
const FAKE_WS = `
class FakeWebSocket {
  constructor(url, protocols) {
    this.url = url; this.protocols = protocols; this.readyState = 0;
    this.onopen = null; this.onmessage = null; this.onerror = null; this.onclose = null;
    setTimeout(() => { this.readyState = 1; this.onopen && this.onopen({}); }, 10);
  }
  send(data) {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.type === 'session.update') {
      setTimeout(() => this._emit({ type: 'session.updated' }), 5);
      setTimeout(() => this._emit({
        type: 'conversation.item.input_audio_transcription.completed',
        item_id: 'i1',
        transcript: 'tell me about Moonshine and WebGPU',
      }), 60);
    }
  }
  _emit(obj) { this.onmessage && this.onmessage({ data: JSON.stringify(obj) }); }
  close() { this.readyState = 3; this.onclose && this.onclose({}); }
}
FakeWebSocket.CONNECTING = 0; FakeWebSocket.OPEN = 1; FakeWebSocket.CLOSING = 2; FakeWebSocket.CLOSED = 3;
window.WebSocket = FakeWebSocket;
localStorage.setItem('live-search.openai-api-key', 'sk-test-key');
`;

test('transcript from OpenAI drives a local documentation result', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.addInitScript(FAKE_WS);
  await page.goto('/');

  await page.getByRole('button', { name: /start listening/i }).click();

  // Connection reaches "live" once the session is acknowledged.
  await expect(page.locator('.status-bar')).toContainText(/OpenAI: live/i, { timeout: 30_000 });

  // The committed transcript appears.
  await expect(page.locator('.transcript-line', { hasText: /Moonshine and WebGPU/i })).toBeVisible({ timeout: 30_000 });

  // And it surfaces the matching documentation chunk from the sample corpus.
  const card = page.locator('.result-card').first();
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText(/Moonshine|WebGPU|Speech Recognition/i);

  // The mic meter must show activity — proves capture frames are flowing
  // through the AudioWorklet to the app (Chromium's fake device emits a tone).
  await expect
    .poll(async () => {
      const w = await page.locator('.mic-meter-fill').evaluate((e) => parseFloat((e as HTMLElement).style.width) || 0);
      return w;
    }, { timeout: 10_000 })
    .toBeGreaterThan(0);

  // Wait past the 5 s audio watchdog: it only stays silent if real audio reached
  // the socket, so this guards the capture path end to end.
  await page.waitForTimeout(6000);
  const banner = (await page.locator('.error-banner').textContent())?.trim() ?? '';
  expect(banner, banner).not.toMatch(/no microphone audio/i);

  // No hard errors, and no model-file SPA-fallback JSON.parse regressions.
  const joined = errors.join('\n');
  expect(joined, joined).not.toMatch(/unexpected character|JSON\.parse/i);
});

test('refuses to start without an API key', async ({ page }) => {
  await page.goto('/');
  // No key injected this time.
  await page.evaluate(() => localStorage.removeItem('live-search.openai-api-key'));
  await page.getByRole('button', { name: /start listening/i }).click();
  await expect(page.locator('.error-banner')).toContainText(/API key/i);
});
