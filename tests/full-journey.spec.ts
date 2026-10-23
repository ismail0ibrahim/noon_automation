import { test, expect } from './fixtures';
import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import { authenticated, login, search, product, visit, home } from './helpers/noon';
import { addExactProductToWishlist, removeExactProductFromWishlist, wishlistState } from './helpers/wishlist';
import { ensureProductInCart, fillDummyCardAtCheckout, removeOwnedCartItem } from './helpers/checkout';
import { installPaymentStop } from './helpers/payment-stop';
import { selectPublicCairoPoint } from './helpers/location';
import { setFirstName } from './helpers/profile';
import { withCleanup } from './helpers/cleanup';

const reuseSession = process.env.NOON_REUSE_SESSION === '1';
test.use({ storageState: reuseSession ? '.auth/state.json' : undefined });
test.skip(process.env.NOON_RUN_LIVE !== '1', 'Live account journey is opt-in; use npm run test:full.');
test.skip(process.env.NOON_LOGIN_MODE === 'disabled', 'Login explicitly disabled.');

test('Noon Egypt - eight flows with account recovery', async ({ page, cleanup }) => {
  test.setTimeout(900_000);
  // A private per-run journal never overwrites an earlier ownership manifest.
  const journalFile = path.resolve('.auth/runs', `${randomUUID()}.json`);
  const journal: Record<string, unknown> = { startedAt: new Date().toISOString(), authentication: reuseSession ? 'reused-session' : 'pending' };
  const persist = async () => {
    await fs.mkdir(path.dirname(journalFile), { recursive: true });
    await fs.writeFile(journalFile + '.tmp', JSON.stringify(journal, null, 2));
    await fs.rename(journalFile + '.tmp', journalFile);
  };
  let work = page;
  // Recovery can still use the authenticated context if the active tab closed.
  const recoveryPage = async () => {
    if (work.isClosed()) work = await page.context().newPage();
    return work;
  };
  let productPath = '';
  let sku = '';
  let removeWishlist: (() => Promise<void>) | undefined;

  const humanAssisted = process.env.NOON_LOGIN_MODE === 'manual' || process.env.NOON_MANUAL_AUTH === '1';
  await test.step(reuseSession ? 'Session - verify protected profile (automated login not tested)' : humanAssisted ? 'Flow 1 - Human-assisted sign in' : 'Flow 1 - Automatic sign in', async () => {
    if (reuseSession) await authenticated(work);
    else work = await login(work, test.info());
    journal.authentication = reuseSession ? 'reused-session' : process.env.NOON_LOGIN_MODE === 'manual' || process.env.NOON_MANUAL_AUTH === '1' ? 'human-assisted' : 'automatic';
    await persist();
  });

  await test.step('Flow 2 - Add exact product to wishlist', async () => {
    productPath = await product(work);
    const match = productPath.match(/\/([A-Za-z0-9_-]+)\/p\//);
    if (!match) throw new Error('Product URL does not contain a supported SKU.');
    sku = match[1];
    if ((await wishlistState(work, sku)).skuPresent)
      throw new Error('Product already wishlisted; choose a different NOON_PRODUCT_URL.');
    journal.wishlist = { productPath, sku, status: 'pending', absentBefore: true };
    await persist();
    removeWishlist = cleanup.add('owned wishlist item', async () => {
      const recovery = await recoveryPage();
      if ((await wishlistState(recovery, sku)).skuPresent)
        await removeExactProductFromWishlist(recovery, productPath, sku);
      journal.wishlist = { productPath, sku, status: 'removed', absentBefore: true };
      await persist();
    });
    await addExactProductToWishlist(work, productPath, sku);
    journal.wishlist = { productPath, sku, status: 'added', absentBefore: true };
    await persist();
  });

  await test.step('Flow 3 - Remove owned wishlist item', async () => {
    if (!removeWishlist) throw new Error('Wishlist ownership was not established.');
    await removeWishlist();
  });

  await test.step('Flow 4 - Inspect dummy card form without submitting', async () => {
    let removeCart: (() => Promise<void>) | undefined;
    await ensureProductInCart(work, productPath, sku, async ownership => {
      journal.cart = { sku, status: 'pending', ...ownership };
      await persist();
      removeCart = cleanup.add('owned cart item', async () => {
        await removeOwnedCartItem(await recoveryPage(), sku, ownership);
        journal.cart = { sku, status: 'removed', ...ownership };
        await persist();
      });
    });
    const stop = await installPaymentStop(work.context());
    // LIFO teardown removes the guard before account/cart recovery.
    const release = cleanup.add('payment stop', stop.dispose);
    await withCleanup(async () => {
      await fillDummyCardAtCheckout(work, sku);
      await test.info().attach('Checkout inspection', {
        body: JSON.stringify({ dummyFieldsVerified: true, confirmClicked: false, blockedRequests: stop.blockedCount() }),
        contentType: 'application/json',
      });
    }, async () => {
      // Leave checkout while the network guard is still active.
      await visit(work, `${home}cart/`);
      await release();
    });
    await removeCart?.();
  });

  await test.step('Flow 5 - Update profile and restore original', async () => {
    await authenticated(work);
    await expect.poll(async () => (await work.locator('input[name="firstName"]').inputValue()).trim().length > 0,
      { message: 'A nonempty original name is required before a reversible profile mutation' }).toBe(true);
    const original = await work.locator('input[name="firstName"]').inputValue();
    const restore = ['Noon QA', 'Noon QA Test'].includes(original) && process.env.NOON_PROFILE_RESTORE_NAME
      ? process.env.NOON_PROFILE_RESTORE_NAME : original;
    const updated = original === 'Noon QA' ? 'Noon QA Test' : 'Noon QA';
    journal.profile = { restore, status: 'pending' };
    await persist();
    const restoreProfile = cleanup.add('original profile name', async () => {
      await setFirstName(await recoveryPage(), restore);
      journal.profile = { status: 'restored' }; // discard private name after recovery
      await persist();
    });
    await withCleanup(() => setFirstName(work, updated), restoreProfile);
  });

  await test.step('Flow 6 - Inspect delivery form (saving opt-in)', async () => {
    const result = await selectPublicCairoPoint(work);
    await test.info().attach('Delivery outcome', { body: JSON.stringify(result), contentType: 'application/json' });
    if (process.env.NOON_SAVE_LOCATION === '1') expect(result.saved, result.reason).toBe(true);
    else expect(result.stoppedBeforeSave, result.reason).toBe(true);
  });

  await test.step('Flow 7 - Arabic product search', async () => {
    await search(work);
    await expect(work.locator('[data-qa="plp-product-box"]').first()).toBeVisible();
  });

  await test.step('Flow 8 - Genuine footer social link', async () => {
    await visit(work, home);
    const link = work.locator('a[href="https://www.facebook.com/noon/"]');
    await expect(link).toHaveCount(1);
    const popupPromise = work.waitForEvent('popup');
    await link.click({ noWaitAfter: true });
    const popup = await popupPromise;
    try {
      await popup.waitForURL(url => ['www.facebook.com', 'facebook.com'].includes(url.hostname), { waitUntil: 'commit' });
    } finally { await popup.close(); }
  });
  journal.finishedAt = new Date().toISOString();
  await persist();
});
