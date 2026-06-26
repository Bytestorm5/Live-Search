import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

/**
 * E2E config. The web server is our SPA-fallback static server pointed at the
 * production build (`dist/`), which reproduces a real static host — including the
 * index.html fallback that turned a missing model file into an HTML response and
 * caused the `JSON.parse: unexpected character` failure.
 *
 * Chromium: prefer $PLAYWRIGHT_CHROMIUM_PATH, then the pre-installed browser in
 * this environment, otherwise let Playwright resolve its managed browser
 * (`npx playwright install chromium`).
 */
const CANDIDATE_CHROMIUM = [
  process.env.PLAYWRIGHT_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
].filter((p): p is string => !!p);
const executablePath = CANDIDATE_CHROMIUM.find((p) => existsSync(p));

export default defineConfig({
  testDir: 'e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:4178',
    permissions: ['microphone'],
    launchOptions: {
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--no-sandbox',
      ],
    },
  },
  webServer: {
    command: 'node e2e/static-server.mjs dist',
    url: 'http://localhost:4178',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
    env: { PORT: '4178' },
  },
});
