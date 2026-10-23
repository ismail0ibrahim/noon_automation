import { expect, type Page } from '@playwright/test';
import { authenticated, secretFill, waitForReactHandler } from './noon';

export async function setFirstName(page: Page, value: string): Promise<void> {
  await authenticated(page);
  const name = page.locator('input[name="firstName"]');
  if (await name.inputValue() === value) return;
  await waitForReactHandler(name, 'onChange');
  // Preserve keyboard events used by the controlled account form. Suppress
  // raw action errors because they may contain the account holder's name.
  try {
    await name.click();
    await name.press('ControlOrMeta+A');
    await name.press('Backspace');
    await name.pressSequentially(value, { delay: 30 });
  } catch { throw new Error('Profile field entry failed; private value withheld.'); }
  if (await name.inputValue() !== value) await secretFill(name, value, 'Profile');
  const save = page.getByRole('button', { name: /تحديث حسابك/ });
  await expect(save).toBeEnabled();
  const saved = page.waitForResponse(
    r => r.request().method() !== 'GET' && new URL(r.url()).hostname.endsWith('.noon.com') &&
      new URL(r.url()).pathname.includes('mp-identity-api/customer/update'),
    { timeout: 15_000 },
  ).then(response => response.ok(), () => false);
  await save.click();
  if (!await saved) throw new Error('Profile update was not acknowledged; restoration remains scheduled.');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(name).toBeVisible();
  // Report a boolean to keep the account holder's name out of assertion errors.
  await expect.poll(async () => await name.inputValue() === value,
    { message: 'Profile value must persist after reload' }).toBe(true);
}
