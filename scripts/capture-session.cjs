// Connect only to the user's explicitly opened local debug Chrome.
// Proof uses the protected account origin and logout control. Saved state is
// restricted to Noon domains; unrelated browser cookies are excluded.
const { chromium } = require('@playwright/test');
const { verifyNoonSession, saveNoonSession } = require('./session-state.cjs');
(async () => {
  let browser;
  let proof;
  try {
    browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
    const context = browser.contexts()[0];
    if (!context) throw new Error('No context');
    proof = await context.newPage();
    await verifyNoonSession(proof);
    await saveNoonSession(context);
    console.log('Protected Noon session verified and saved privately; automated login was not tested.');
  } catch {
    console.error('Session capture failed. Open local debug Chrome on port 9222 and sign in manually first. Details withheld.');
    process.exitCode = 1;
  } finally {
    await proof?.close().catch(() => {});
    // Connected browsers disconnect here; do not terminate the user's Chrome.
    await browser?.close().catch(() => {});
  }
})();
