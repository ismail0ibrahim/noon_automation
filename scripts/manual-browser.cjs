// Standalone manual sign-in window. No dotenv, credentials, screenshots,
// recording, tracing, automatic submission or sign-in countdown.
const { chromium } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
const readline = require('readline');
const { verifyNoonSession, saveNoonSession } = require('./session-state.cjs');

(async () => {
  const statusPath = path.resolve('private-artifacts/manual-browser-status.json');
  await fs.mkdir(path.dirname(statusPath), { recursive: true });
  const status = async stage => fs.writeFile(statusPath, JSON.stringify({ stage, recorded: false, automaticCredentials: false, signInDeadline: null }));
  await status('launching');
  let browser;
  try {
    browser = await chromium.launch({ headless: false, args: ['--start-maximized'] });
    console.log('Chromium launch completed successfully.');
    const context = await browser.newContext({ viewport: null, locale: 'ar-EG' });
    const page = await context.newPage();
    const searchEntry = process.argv.includes('--search');
    const response = await page.goto(searchEntry ? 'https://www.google.com/search?q=login.noon.com' : 'https://login.noon.com/egypt-ar/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!searchEntry) {
      await page.locator('input[name="email"]').waitFor({ state: 'visible' });
      await page.locator('input[name="password"]').waitFor({ state: 'visible' });
      await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).waitFor({ state: 'visible' });
    }
    await page.bringToFront();
    await status('page-ready-awaiting-desktop-visibility-confirmation');
    console.log(searchEntry
      ? `Google search opened (HTTP ${response?.status()}). Complete any verification manually, then open only the genuine login.noon.com result and sign in.`
      : `Login page ready (HTTP ${response?.status()}); both inputs and Sign in visible to Playwright.`);
    console.log('No sign-in timer is running. Leave this process open; close the browser when finished.');
    console.log('After signing in, type verify and press Enter here to verify and save the private session.');
    const commands = readline.createInterface({ input: process.stdin, terminal: false });
    let verifying = false;
    commands.on('line', async command => {
      if (command.trim() !== 'verify' || verifying) return;
      verifying = true;
      let proof;
      try {
        proof = await context.newPage();
        await verifyNoonSession(proof);
        await saveNoonSession(context);
        await status('authenticated-session-verified-and-saved-privately');
        console.log('Protected profile and logout verified. Private session saved; automated login is not marked passed.');
      } catch {
        console.log('Authenticated profile could not be verified. No session was saved; details withheld.');
      } finally {
        if (proof) await proof.close().catch(() => {});
        verifying = false;
      }
    });
    await new Promise(resolve => browser.once('disconnected', resolve));
    commands.close();
    await status('closed');
  } catch (error) {
    await status('failed');
    // This launcher never reads or enters credentials; errors contain launch/navigation details only.
    console.error(error instanceof Error ? error.message : 'Unknown browser launch failure');
    if (browser) await browser.close().catch(() => {});
    process.exitCode = 1;
  }
})();
