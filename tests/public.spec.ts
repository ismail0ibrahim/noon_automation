import { test, expect } from '@playwright/test';
import { home, visit, search } from './helpers/noon';

test('Public - Arabic search returns products', async ({ page }) => {
  await search(page);
  await expect(page.locator('[data-qa="plp-product-box"]').first()).toBeVisible();
});

test('Public - footer opens the genuine Facebook host', async ({ page }) => {
  await visit(page, home);
  const link = page.locator('a[href="https://www.facebook.com/noon/"]');
  await expect(link).toHaveCount(1);
  const popupPromise = page.waitForEvent('popup');
  await link.click({ noWaitAfter: true });
  const popup = await popupPromise;
  try {
    await popup.waitForURL(url => ['facebook.com', 'www.facebook.com'].includes(url.hostname), { waitUntil: 'commit' });
  } finally { await popup.close(); }
});
