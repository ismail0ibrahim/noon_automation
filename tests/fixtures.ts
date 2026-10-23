import { test as base, expect } from '@playwright/test';
import { CleanupRegistry } from './helpers/cleanup';

export const test = base.extend<{ cleanup: CleanupRegistry }>({
  // A separate teardown budget allows cleanup even when the journey times out.
  // Depending on context keeps it open until account cleanup has finished.
  cleanup: [async ({ context }, use) => {
    const cleanup = new CleanupRegistry();
    try { await use(cleanup); }
    finally {
      if (context.browser()?.isConnected()) await cleanup.run();
      else throw new Error('Browser disconnected before cleanup; inspect the private recovery journal.');
    }
  }, { timeout: 90_000 }],
});
export { expect };
