// Records a replay of sanitized status cards, never the live account browser.
const { chromium } = require('@playwright/test');
const fs = require('fs/promises');
const path = require('path');
(async () => {
  const dir = path.resolve(__dirname, '../private-artifacts/demo');
  const manifest = JSON.parse(await fs.readFile(path.join(dir, 'manifest.json'), 'utf8'));
  if (!manifest.runId || !Array.isArray(manifest.tests) || (process.env.NOON_DEMO_RUN_ID && manifest.runId !== process.env.NOON_DEMO_RUN_ID))
    throw new Error('Current sanitized execution report required.');
  let browser;
  let context;
  try {
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({ viewport: { width: 1280, height: 720 },
      recordVideo: { dir: path.join(dir, 'raw-viewer'), size: { width: 1280, height: 720 } }, serviceWorkers: 'block' });
    await context.route('**/*', route => route.abort());
    const page = await context.newPage();
    const video = page.video();
    await page.setContent('<meta charset="utf-8"><style>body{margin:60px;background:#111827;color:#fff;font:24px Arial}h1{color:#ffe500}p{line-height:1.7}</style><h1>Noon execution status replay</h1><p>Offline status cards. No live browser video or UI evidence.</p><h2 id="title"></h2><p id="status"></p><p id="note"></p>');
    for (let flow = 1; flow <= 8; flow++) {
      const entry = manifest.flows.find(item => item.flow === flow);
      await page.locator('#title').evaluate((el, text) => { el.textContent = text; }, entry?.title || `Flow ${flow}`);
      await page.locator('#status').evaluate((el, text) => { el.textContent = text; }, entry?.status?.toUpperCase() || 'NOT EXECUTED');
      await page.locator('#note').evaluate((el, text) => { el.textContent = text; },
        flow === 1 && manifest.authenticationMode === 'reused-session'
          ? 'Saved session used. Automatic sign-in was not tested.'
          : flow === 6 ? 'Delivery preview stops before saving unless explicitly configured otherwise.' : 'See the current execution report for details.');
      await page.waitForTimeout(1800); // Presentation dwell only.
    }
    await context.close();
    context = undefined;
    const file = path.join(dir, `noon-status-replay-${Date.now()}.webm`);
    await video.saveAs(file);
    await video.delete();
    await fs.writeFile(path.join(dir, 'latest-video.json'), JSON.stringify({ file, runId: manifest.runId, kind: 'Offline status-card replay', liveUiVerified: false }, null, 2));
    console.log('Sanitized status replay saved privately; this is not a live journey recording.');
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
})().catch(() => { console.error('Status replay failed; no live UI verification is claimed.'); process.exitCode = 1; });
