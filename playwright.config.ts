import 'dotenv/config';
import { defineConfig, devices } from '@playwright/test';

// Playwright 1.64's automatic error-context snapshots include password values.
// Disable them in workers as well as raw traces/screenshots/video.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = '1';

export default defineConfig({
  testDir: './tests',
  testMatch: ['**/full-journey.spec.ts', '**/safety.spec.ts', '**/audit-regression.spec.ts', '**/public.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0, // Never automatically resubmit credentials or repeat account mutations.
  timeout: process.env.NOON_MANUAL_AUTH === '1' || process.env.NOON_LOGIN_MODE === 'manual' ? 360_000 : 60_000,
  expect: { timeout: 15_000 },
  reporter: [['./scripts/privacy-reporter.ts']],
  use: {
    baseURL: 'https://www.noon.com/egypt-ar/',
    locale: 'ar-EG',
    headless: process.env.NOON_HEADED !== '1',
    serviceWorkers: 'block',
    launchOptions: { args: process.env.NOON_DISABLE_HTTP2 === '1' ? ['--disable-http2'] : [] },
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'off',
    screenshot: 'off',
    video: 'off', // Auth/account/payment content must never enter raw recordings.
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
