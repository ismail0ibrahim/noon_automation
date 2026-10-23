const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch({ headless: false });
  try {
    const page = await browser.newPage();
    await page.goto('https://www.noon.com/egypt-ar/');
    const search = page.locator('#search-input');
    await search.waitFor();
    console.log('Location control:', await page.getByText('القاهرة', { exact: true }).evaluateAll(es => es.map(e => e.outerHTML.slice(0, 1200))));
    console.log('Social links:', await page.locator('a[href*=facebook]').evaluateAll(es => es.map(e => e.outerHTML.slice(0, 800))));
    await search.fill('سماعات');
    await search.press('Enter');
    await page.waitForURL(/search/, { timeout: 20000 }).catch(() => {});
    console.log('Search route:', new URL(page.url()).pathname, 'query:', new URL(page.url()).searchParams.get('q'));
    await page.locator('a[href*="/p/"]').first().waitFor({ timeout: 20000 }).catch(() => {});
    console.log('Results:', await page.locator('a[href*="/p/"]').count());
    console.log((await page.locator('body').innerText()).slice(0, 5000));
    const product = page.locator('a[href*="/p/"]').first();
    if (await product.count()) {
      await product.click();
      await page.getByRole('button').first().waitFor();
      console.log('Product buttons:', await page.getByRole('button').allTextContents());
      console.log('Product controls:', await page.locator('[aria-label], [data-qa]').evaluateAll(es => es.map(e => ({tag:e.tagName, label:e.getAttribute('aria-label'), qa:e.getAttribute('data-qa')})).slice(0,60)));
    }
  } finally { await browser.close(); }
})().catch(() => { console.log('Inspection stopped before next observable state.'); process.exitCode = 1; });
