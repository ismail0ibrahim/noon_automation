import { expect, Page } from '@playwright/test';
import { home, visit, waitForReactHandler } from './noon';

export interface WishlistState {
  itemCount: number;
  skuPresent: boolean;
}

// Observed on the current storefront: the heart and wishlist page use V3.
// The legacy V2 endpoint can return a different membership snapshot.
export const WISHLIST_STATE_PATH = '/_vs/mp/mp-wishlist-api/v3/wishlist/state';

/**
 * Opens the wishlist page (visible for the demo) and reads membership with a
 * cache-busting fetch: the page's own GET response can be served stale from
 * the browser cache right after a mutation, which previously hid real adds.
 */
export async function wishlistState(page: Page, sku: string): Promise<WishlistState> {
  await visit(page, `${home}wishlist/`);
  return wishlistStateInPlace(page, sku);
}

/** Reads wishlist membership without navigating away from the current page. */
export async function wishlistStateInPlace(page: Page, sku: string): Promise<WishlistState> {
  const result = await page.evaluate(async (targetSku: string) => {
    const res = await fetch('/_vs/mp/mp-wishlist-api/v3/wishlist/state', { cache: 'no-store', credentials: 'include' });
    if (!res.ok) return { ok: false, itemCount: 0, skuPresent: false };
    const payload = await res.json().catch(() => null);
    if (!Array.isArray(payload?.collections) || payload.collections.some((w: any) => !w || !Array.isArray(w.items)))
      return { ok: false, itemCount: 0, skuPresent: false };
    const items = payload.collections.flatMap((w: { items: unknown[] }) => w.items);
    // Unknown schemas must fail rather than pretending the item is absent.
    if (items.some((item: any) => !item || typeof item.sku !== 'string'))
      return { ok: false, itemCount: 0, skuPresent: false };
    return { ok: true, itemCount: items.length, skuPresent: items.some((item: { sku: string }) => item.sku === targetSku) };
  }, sku);
  if (!result.ok) throw new Error('Wishlist API could not be read; cannot verify membership safely.');
  return result;
}

export async function addExactProductToWishlist(page: Page, productPath: string, sku: string): Promise<void> {
  const before = await wishlistState(page, sku);
  if (before.skuPresent) throw new Error('Test product is already wishlisted; choose a different NOON_PRODUCT_URL.');

  // A toggle is a mutation. Submit once: an eventually consistent read is
  // insufficient evidence that retrying would not undo a delayed addition.
  const stateReady = page.waitForResponse(response => response.request().method() === 'GET' &&
    new URL(response.url()).pathname === WISHLIST_STATE_PATH && response.ok(), { timeout: 20_000 })
    .then(async response => { await response.finished(); return true; }, () => false);
  await visit(page, new URL(productPath, home).href);
  // On the Arabic PDP the heart button's accessible name is "المفضلة"
  // (older probes saw the English name "wishlist"); accept either.
  const add = page.getByRole('button', { name: /المفضلة|wishlist/i }).filter({ visible: true }).first();
  await expect(add).toBeVisible();
  await waitForReactHandler(add, 'onClick');
  if (!await stateReady) throw new Error('Current wishlist state did not load before the product toggle; no click was made.');
  {
    const mutation = page.waitForResponse(
      r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/v3/wishlist/items'),
      { timeout: 8_000 },
    ).catch(() => undefined);
    await add.click();
    const accepted = await mutation;
    if (accepted) expect([200, 201, 204].includes(accepted.status()), 'Wishlist add request must succeed').toBe(true);
    const present = await expect.poll(async () => (await wishlistStateInPlace(page, sku)).skuPresent,
      { timeout: 30_000, message: 'Wait for exact wishlist membership' }).toBe(true).then(() => true, () => false);
    if (present) {
      // Final visible confirmation on the wishlist page itself.
      const confirmed = await wishlistState(page, sku);
      expect(confirmed.skuPresent, 'Exact product must be visible in the wishlist after adding').toBe(true);
      await expect(page.locator(`a[href*="/${sku}/p/"]`).first()).toBeVisible();
      return;
    }
  }
  throw new Error('Exact product was not present in the wishlist after adding.');
}

export async function removeExactProductFromWishlist(page: Page, _productPath: string, sku: string): Promise<void> {
  // Show the item in the wishlist first (this is also what the video shows).
  await visit(page, `${home}wishlist/`);
  const link = page.locator(`a[href*="/${sku}/p/"]`);
  // The wishlist app can render slowly; reload once if the item is not shown.
  await link.first().waitFor({ state: 'visible', timeout: 20_000 }).catch(async () => {
    await page.reload({ waitUntil: 'commit' }).catch(() => {});
    await link.first().waitFor({ state: 'visible', timeout: 20_000 });
  });
  const item = page.locator('[data-qa="plp-product-box"]').filter({ has: link });
  await expect(item).toHaveCount(1);

  // The card's ⋮ menu button is labelled "خيارات المنتج" (product options).
  // Scope it to this product's card: the nearest ancestor holding such a button.
  // V3 places each product and its options button inside one article. A div
  // ancestor can span the entire grid and select a different product's menu.
  const card = item.locator('xpath=ancestor::article[1]');
  await expect(card).toHaveCount(1);
  await item.scrollIntoViewIfNeeded();
  const mutation = page.waitForResponse(
    r => r.request().method() === 'POST' && new URL(r.url()).pathname.endsWith('/v3/wishlist/items/remove'),
    { timeout: 20_000 },
  ).catch(() => undefined);
  const options = card.getByRole('button', { name: 'خيارات المنتج', exact: true });
  await expect(options).toHaveCount(1);
  await waitForReactHandler(options, 'onClick');
  await options.click();
  // The menu action is labelled "امسح من المفضلة" (remove from wishlist).
  await page.getByText('امسح من المفضلة', { exact: true }).filter({ visible: true }).first().click();
  // A confirmation dialog may follow; give it a few seconds to appear.
  const confirmText = page.getByText('هل أنت متأكد من إزالة المنتج؟', { exact: true });
  const needsConfirm = await confirmText.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false);
  if (needsConfirm) await page.getByRole('button', { name: 'نعم', exact: true }).click();
  const removed = await mutation;
  if (removed) expect([200, 201, 204].includes(removed.status()), 'Wishlist remove request must succeed').toBe(true);

  // Final visible confirmation: the wishlist no longer contains the product.
  await expect.poll(async () => (await wishlistState(page, sku)).skuPresent,
    { message: 'Exact product must be absent from the wishlist after removal', timeout: 20_000 }).toBe(false);
  await expect(page.locator(`a[href*="/${sku}/p/"]`)).toHaveCount(0);
}
