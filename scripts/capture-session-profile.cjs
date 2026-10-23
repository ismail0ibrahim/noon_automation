// Fallback: close debug Chrome before using its dedicated project profile.
const { chromium } = require('@playwright/test');
const { verifyNoonSession, saveNoonSession } = require('./session-state.cjs');
(async () => {
  let context;
  try {
    context = await chromium.launchPersistentContext('.auth/chrome-profile', { channel: 'chrome', headless: false, serviceWorkers: 'block' });
    const page = context.pages()[0] || await context.newPage();
    await verifyNoonSession(page);
    await saveNoonSession(context);
    console.log('Protected Noon session verified and saved privately; automated login was not tested.');
  } catch {
    console.error('Profile capture failed. Close any Chrome using .auth/chrome-profile and verify manual sign-in. Details withheld.');
    process.exitCode = 1;
  } finally { await context?.close().catch(() => {}); }
})();
