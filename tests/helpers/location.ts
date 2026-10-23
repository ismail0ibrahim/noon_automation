import { expect, Page, TestInfo } from '@playwright/test';
import { home, visit } from './noon';

export const QA_LOCATION_LABEL = 'QA Location';

/**
 * Updates the delivery location through the header location picker:
 * opens "add new address", moves the public Cairo map pin, confirms the
 * location and fills test-only address details. Saving is opt-in only
 * (NOON_SAVE_LOCATION=1); by default it stops before save with the form
 * complete and saveable. Never uses "use my current location" and never
 * edits an existing saved address. Test contact data comes from the
 * environment (dummy defaults are used so no real phone number is typed).
 */
export interface LocationOutcome {
  saved: boolean;
  /** True when the form was completed and saveable, but saving was deliberately not performed. */
  stoppedBeforeSave?: boolean;
  reason: string;
}

export async function selectPublicCairoPoint(page: Page, _info?: TestInfo): Promise<LocationOutcome> {
  if (process.env.NOON_SAVE_LOCATION === '1' &&
      (!process.env.NOON_TEST_PHONE || !/^01[0125]\d{8}$/.test(process.env.NOON_TEST_PHONE)))
    throw new Error('Saving requires an explicit valid NOON_TEST_PHONE; preview dummy data must not be persisted.');
  await visit(page, home);

  // Open the location picker (header renders duplicate desktop/mobile buttons).
  const addNew = page.getByRole('button', { name: /إضافة عنوان جديد/ }).filter({ visible: true });
  for (let attempt = 0; attempt < 3 && (await addNew.count()) === 0; attempt++) {
    await page.getByRole('button', { name: /المنزل|تسليم|توصيل/ }).filter({ visible: true }).first().click().catch(() => {});
    await addNew.first().waitFor({ state: 'visible', timeout: 8_000 }).catch(() => {});
  }
  await expect(addNew.first(), 'Location picker must offer adding a new address').toBeVisible();
  await addNew.first().click();

  // Pixel dragging from an unknown initial map center cannot prove a Cairo
  // location. Select a named Cairo result and fail if it is unavailable.
  const mapInput = page.getByPlaceholder('حدد عنوانك، رقم المبنى..', { exact: true }).filter({ visible: true });
  await expect(mapInput.first()).toBeVisible({ timeout: 20_000 });
  await mapInput.first().fill('');
  await mapInput.first().pressSequentially('ميدان التحرير القاهرة');
  const place = page.locator('.pac-container .pac-item').filter({ hasText: /التحرير|Tahrir/i })
    .filter({ hasText: /القاهرة|Cairo/i }).filter({ visible: true });
  await expect(place, 'A unique named Tahrir Square result in Cairo must be offered').toHaveCount(1);
  await place.click();

  const confirm = page.locator('button').filter({ hasText: 'تأكيد الموقع' }).filter({ visible: true });
  await expect(confirm.first()).toBeVisible();
  await confirm.first().click();

  // Address details form (test-only values; receiver name stays as prefilled).
  // Fields must be typed with real key events: fill() leaves the form's React
  // state empty and the save button stays disabled (verified live).
  const street = page.locator('input[name="street-name"]');
  await expect(street).toBeVisible({ timeout: 20_000 });
  const typeInto = async (locator: import('@playwright/test').Locator, value: string) => {
    await locator.click();
    await locator.press('ControlOrMeta+A');
    await locator.pressSequentially(value, { delay: 15 });
  };
  await typeInto(page.locator('input[name="building-name"]'), 'QA Test Building');
  await typeInto(street, 'Tahrir Square Area');
  await typeInto(page.locator('input[name="room-no"]'), '1');
  await typeInto(page.locator('input[name="directions"]'), 'Near square');
  const otherLabel = page.locator('button').filter({ hasText: 'آخر' }).filter({ visible: true });
  if ((await otherLabel.count()) > 0) await otherLabel.first().click().catch(() => {});
  const nickname = page.locator('input[name="nickname"]');
  if ((await nickname.count()) > 0 && (await nickname.first().isVisible().catch(() => false))) {
    await typeInto(nickname.first(), QA_LOCATION_LABEL);
  }
  // Phone is the unnamed number field at the end of the form.
  const phone = page.locator('input[type="number"]').filter({ visible: true }).last();
  if ((await phone.count()) > 0 && (process.env.NOON_TEST_PHONE || !(await phone.inputValue().catch(() => '')))) {
    await typeInto(phone, process.env.NOON_TEST_PHONE || '01000000');
  }

  const saveAddress = page.getByRole('button', { name: /حفظ العنوان/ }).filter({ visible: true }).first();
  await expect(saveAddress, 'Address form must be complete enough to save').toBeEnabled({ timeout: 15_000 });

  // Saving writes a real address to the account, so it is opt-in only.
  // Default (and the verified-demo configuration chosen by the account owner):
  // prove the form is complete and saveable, then stop BEFORE clicking save.
  // Set NOON_SAVE_LOCATION=1 locally only with explicit approval to persist it.
  if (process.env.NOON_SAVE_LOCATION !== '1') {
    return {
      saved: false,
      stoppedBeforeSave: true,
      reason: 'Delivery form completed for a public Cairo map point and Save was enabled; saving was deliberately not performed (NOON_SAVE_LOCATION is not 1), so no address was added or changed.',
    };
  }
  await saveAddress.click();

  // Verify: the saved QA location is now offered/selected in the picker.
  await visit(page, home);
  const headerLocation = page.getByRole('button', { name: /المنزل|تسليم|توصيل|QA Location/ }).filter({ visible: true }).first();
  await expect(headerLocation).toBeVisible();
  await headerLocation.click().catch(() => {});
  const savedEntry = page.getByText(QA_LOCATION_LABEL, { exact: false }).filter({ visible: true });
  const persisted = (await savedEntry.count()) > 0 || /QA Location/.test(await headerLocation.innerText().catch(() => ''));
  return persisted
    ? { saved: true, reason: 'Public Cairo map location saved and verified as QA Location.' }
    : { saved: false, reason: 'Saved location could not be verified in the picker after saving.' };
}
