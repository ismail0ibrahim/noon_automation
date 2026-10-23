import { expect, Page } from '@playwright/test';
import { home, visit, waitForReactHandler } from './noon';
import { requirePaymentStop } from './payment-stop';

// Dummy test data only. This card is never saved, confirmed or submitted.
export const DUMMY_CARD = {
  number: '4242424242424242',
  expiryMonth: '12',
  expiryYear: '30', // The live field keeps a two-digit year.
  cvv: '123',
  nickname: 'QA Test Card',
} as const;

export interface CartOwnership {
  wasAlreadyInCart: boolean;
}

/** Adds the product to the cart only if it is not already there. Reports ownership for cleanup. */
export async function ensureProductInCart(page: Page, productPath: string, sku: string,
  beforeAdd?: (ownership: CartOwnership) => Promise<void>): Promise<CartOwnership> {
  await visit(page, `${home}cart/`);
  const cartLink = page.locator(`a[href*="/${sku}/"]`);
  await cartLink.first().waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  if ((await cartLink.count()) > 0) return { wasAlreadyInCart: true };

  await visit(page, new URL(productPath, home).href);
  // The buy box renders slowly, and if the item is already in the cart the
  // PDP shows a quantity stepper INSTEAD of the add button. Wait for either
  // to appear before deciding — an instant check misses both.
  const qty = page.locator('[class*="_qtyWrapper_"]').filter({ visible: true });
  const addToCart = page.getByRole('button', { name: 'أضف للعربة' }).filter({ visible: true });
  await expect.poll(
    async () => (await qty.count()) > 0 || (await addToCart.count()) > 0,
    { message: 'PDP buy box (add button or quantity stepper) must appear', timeout: 30_000 },
  ).toBe(true);
  if ((await qty.count()) > 0) return { wasAlreadyInCart: true };
  // Register recovery before dispatching a mutation: a failed click/navigation
  // may still have reached the server.
  await beforeAdd?.({ wasAlreadyInCart: false });
  await addToCart.first().click();
  await visit(page, `${home}cart/`);
  await expect(page.locator(`a[href*="/${sku}/p/"]`).first()).toBeVisible();
  return { wasAlreadyInCart: false };
}

/**
 * Proceeds cart -> checkout -> "add card" and fills dummy card details.
 * HARD STOP: never ticks "remember card", never clicks the confirm button,
 * never saves the card and never places an order. Callers must install the
 * payment stop guard before invoking this.
 */
export async function fillDummyCardAtCheckout(page: Page, sku?: string): Promise<void> {
  requirePaymentStop(page.context());
  // Show the cart first (visible in the demo video), then open checkout.
  // Live observation: the "صفحة الدفع" button is enabled but its click often
  // does not navigate; opening /checkout/ directly reaches the same flow.
  await visit(page, `${home}cart/`);
  if (sku) await expect(page.locator(`a[href*="/${sku}/"]`).first()).toBeVisible({ timeout: 20_000 });
  const proceed = page.getByRole('button', { name: /صفحة الدفع|Checkout|Secure checkout/i }).filter({ visible: true });
  if ((await proceed.count()) > 0) {
    await waitForReactHandler(proceed.first(), 'onClick').catch(() => {});
    await proceed.first().click().catch(() => {});
    await page.waitForTimeout(3000);
  }
  if (!new URL(page.url()).pathname.includes('/checkout')) {
    await visit(page, `${home}checkout/`);
  }
  await expect.poll(() => new URL(page.url()).pathname, { message: 'Checkout page must load' }).toContain('/checkout');

  // Checkout often starts with an address step ("تابع للدفع الآمن").
  // Select an existing saved address if the payment (add-card) UI is not yet up.
  const addCard = page.getByRole('button', { name: /إضافة البطاقة|Add (a |new )?card/i }).filter({ visible: true });
  if ((await addCard.count()) === 0) {
    const saved = page.getByText(/QA Location|Qa location|العناوين المحفوظة/i).filter({ visible: true });
    if ((await saved.count()) > 0) await saved.first().click().catch(() => {});
    // Prefer a clearly saved address card; fall back to the continue button.
    const continuePay = page.getByRole('button', { name: /تابع للدفع|متابعة|Continue|Secure/i }).filter({ visible: true });
    if ((await continuePay.count()) > 0) {
      await continuePay.first().click().catch(() => {});
      await page.waitForTimeout(3000);
    }
  }
  await expect(addCard.last()).toBeVisible({ timeout: 30_000 });
  await addCard.last().click();

  const number = page.locator('input[name="ccNumber"]');
  const month = page.locator('input[name="cardExpiryMonth"]');
  const year = page.locator('input[name="cardExpiryYear"]');
  const cvv = page.locator('input[name="cvv"]');
  const nickname = page.locator('input[name="cardNickname"]');
  await expect(number).toBeVisible();
  // Disable remembering before entering any card field.
  const remember = page.locator('input[name="rememberCard"]');
  await expect(remember).toHaveCount(1);
  await remember.setChecked(false, { force: true });
  await expect(remember).not.toBeChecked();
  await number.fill(DUMMY_CARD.number);
  await month.fill(DUMMY_CARD.expiryMonth);
  await year.fill(DUMMY_CARD.expiryYear);
  await cvv.fill(DUMMY_CARD.cvv);
  await nickname.fill(DUMMY_CARD.nickname);

  // Verify the form really holds the dummy details before stopping.
  await expect.poll(async () => (await number.inputValue()).replace(/\D/g, '')).toBe(DUMMY_CARD.number);
  await expect(month).toHaveValue(DUMMY_CARD.expiryMonth);
  await expect(year).toHaveValue(DUMMY_CARD.expiryYear);
  await expect(cvv).toHaveValue(DUMMY_CARD.cvv);
  await expect(nickname).toHaveValue(DUMMY_CARD.nickname);

  // Noon ticks "remember card" by default: untick it so nothing could be
  // saved even accidentally, then verify. The confirm control must remain
  // untouched (we assert it exists to prove we stopped one click before it).
  await expect(remember).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'تأكيد', exact: true }).filter({ visible: true }).first()).toBeVisible();
}

/** Removes a cart item only when the test itself added it. */
export async function removeOwnedCartItem(page: Page, sku: string, ownership: CartOwnership): Promise<void> {
  if (ownership.wasAlreadyInCart) return;
  await visit(page, `${home}cart/`);
  const link = page.locator(`a[href*="/${sku}/p/"]`);
  await expect(link.first(), 'Owned cart item must be located before cleanup').toBeVisible();
  const row = link.first().locator('xpath=ancestor::*[.//button[contains(.,"إزالة") or @aria-label="Remove item"]][1]');
  const remove = row.getByRole('button', { name: /إزالة|Remove item/ }).filter({ visible: true });
  await expect(remove, 'Owned cart item must have one removal action').toHaveCount(1);
  await remove.click();
  await expect(page.locator(`a[href*="/${sku}/p/"]`)).toHaveCount(0, { timeout: 20_000 });
}
