// Noon Egypt task, in order:
// login and save the session, close the browser, open it again,
// wishlist add then remove, fill checkout without paying,
// save a new profile name, change the delivery address (leave if verification appears),
// search سماعات, scroll to the bottom, open the Noon Facebook page.
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const HOME = 'https://www.noon.com/egypt-ar/';
const LOGIN = 'https://login.noon.com/egypt-ar/';
const PROFILE = 'https://account.noon.com/egypt-ar/profile/';
const AUTH = path.resolve('.auth/state.json');
const CARD = { number: '4242424242424242', month: '12', year: '30', cvv: '123', name: 'QA Test Card' };

function launch() {
  return chromium.launch({ headless: false, slowMo: 40 });
}

function browserOptions(extra = {}) {
  return { locale: 'ar-EG', viewport: { width: 1366, height: 768 }, ...extra };
}

function safeMessage(error) {
  let message = error instanceof Error ? error.message : String(error);
  for (const secret of [process.env.NOON_PASSWORD, process.env.NOON_EMAIL, process.env.NOON_TEST_PHONE]) {
    if (secret) message = message.split(secret).join('[private]');
  }
  return message;
}

async function saveSession(context) {
  const state = await context.storageState();
  const noonHost = host => host === 'noon.com' || host.endsWith('.noon.com');
  const filtered = {
    cookies: state.cookies.filter(cookie => noonHost(cookie.domain.replace(/^\./, ''))),
    origins: state.origins.filter(origin => {
      try { return noonHost(new URL(origin.origin).hostname); } catch { return false; }
    }),
  };
  fs.mkdirSync(path.dirname(AUTH), { recursive: true });
  fs.writeFileSync(AUTH, JSON.stringify(filtered));
}

async function reactReady(locator, event) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await locator.evaluate((el, name) => Object.keys(el).some(key => {
      if (!key.startsWith('__reactProps$') && !key.startsWith('__reactEventHandlers$')) return false;
      return typeof el[key][name] === 'function';
    }), event).catch(() => false);
    if (ready) return;
    await locator.page().waitForTimeout(200);
  }
}

async function typeInto(locator, value) {
  await locator.click();
  await locator.press('ControlOrMeta+A');
  await locator.press('Backspace');
  await locator.pressSequentially(value, { delay: 20 });
  if ((await locator.inputValue().catch(() => '')) !== value) await locator.fill(value);
}

async function loginAndSave() {
  const email = process.env.NOON_EMAIL?.trim();
  const password = process.env.NOON_PASSWORD;
  if (!email || !password) throw new Error('اكتب NOON_EMAIL و NOON_PASSWORD في ملف .env');

  const browser = await launch();
  try {
    const context = await browser.newContext(browserOptions());
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    try {
      await page.goto(LOGIN, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      const emailField = page.locator('input[name="email"]');
      const passwordField = page.locator('input[name="password"]');
      const submit = page.getByRole('button', { name: 'تسجيل الدخول', exact: true });
      await emailField.waitFor({ state: 'visible' });
      await reactReady(emailField, 'onChange');
      await reactReady(passwordField, 'onChange');
      await reactReady(submit, 'onClick');
      await emailField.fill(email);
      await passwordField.fill(password);
      await submit.click();
      await page.waitForURL(
        url => url.hostname === 'www.noon.com' && url.pathname.startsWith('/egypt-ar/'),
        { timeout: 25_000 },
      ).catch(() => {});
      const signedIn = new URL(page.url()).hostname === 'www.noon.com';
      console.log(signedIn ? 'تم تسجيل الدخول.' : 'تسجيل الدخول لم يكتمل، والجلسة الحالية ستُحفظ.');
    } catch (error) {
      console.log(`تعذر إكمال نموذج الدخول (${safeMessage(error)}). سيتم حفظ الجلسة الحالية.`);
    }
    await saveSession(context);
    console.log('تم حفظ الجلسة.');
  } finally {
    await browser.close();
    console.log('تم إغلاق المتصفح.');
  }
}

async function openAnyProduct(page) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const link = page.locator('a[href*="/egypt-ar/"][href*="/p/"]').filter({ visible: true }).first();
  await link.waitFor({ state: 'visible', timeout: 30_000 });
  await link.click();
  await page.waitForURL(/\/p\//, { timeout: 30_000 });
  const match = new URL(page.url()).pathname.match(/\/([A-Za-z0-9_-]+)\/p\//);
  if (!match) throw new Error('تعذر قراءة رقم المنتج من الرابط.');
  return match[1];
}

async function addToWishlist(page) {
  const add = page.getByRole('button', { name: /المفضلة|wishlist/i }).filter({ visible: true }).first();
  try {
    await add.waitFor({ state: 'visible', timeout: 30_000 });
  } catch {
    throw new Error('زر المفضلة غير ظاهر على صفحة المنتج.');
  }
  await reactReady(add, 'onClick');
  await add.click();
  await page.waitForTimeout(1500);
}

async function removeFromWishlist(page, sku) {
  await page.goto(`${HOME}wishlist/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const link = page.locator(`a[href*="/${sku}/p/"]`);
  const shown = await link.first().waitFor({ state: 'visible', timeout: 20_000 }).then(() => true).catch(() => false);
  if (!shown) {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await link.first().waitFor({ state: 'visible', timeout: 20_000 });
  }
  const item = page.locator('[data-qa="plp-product-box"]').filter({ has: link });
  const card = item.locator('xpath=ancestor::article[1]');
  await card.scrollIntoViewIfNeeded();
  await card.getByRole('button', { name: 'خيارات المنتج', exact: true }).click();
  await page.getByText('امسح من المفضلة', { exact: true }).filter({ visible: true }).first().click();
  const confirmText = page.getByText('هل أنت متأكد من إزالة المنتج؟', { exact: true });
  if (await confirmText.waitFor({ state: 'visible', timeout: 5_000 }).then(() => true).catch(() => false)) {
    await page.getByRole('button', { name: 'نعم', exact: true }).click();
  }
  await page.waitForTimeout(1500);
  if (await page.locator(`a[href*="/${sku}/p/"]`).count()) throw new Error('المنتج ما زال ظاهرًا في المفضلة.');
}

async function fillCheckoutWithoutPaying(page) {
  await openAnyProduct(page);
  const qty = page.locator('[class*="_qtyWrapper_"]').filter({ visible: true });
  const addToCart = page.getByRole('button', { name: 'أضف للعربة' }).filter({ visible: true });
  const deadline = Date.now() + 30_000;
  let mode = '';
  while (Date.now() < deadline && !mode) {
    if (await qty.count()) mode = 'qty';
    else if (await addToCart.count()) mode = 'add';
    else await page.waitForTimeout(300);
  }
  if (!mode) throw new Error('زر إضافة المنتج للعربة غير ظاهر.');
  if (mode === 'add') {
    await addToCart.first().click();
    await page.waitForTimeout(2000);
  }

  await page.goto(`${HOME}cart/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const proceed = page.getByRole('button', { name: /صفحة الدفع|Checkout/i }).filter({ visible: true });
  if (await proceed.count()) {
    await proceed.first().click().catch(() => {});
    await page.waitForTimeout(2000);
  }
  if (!page.url().includes('/checkout')) {
    await page.goto(`${HOME}checkout/`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }

  const addCard = page.getByRole('button', { name: /إضافة البطاقة|Add (a |new )?card/i }).filter({ visible: true });
  if ((await addCard.count()) === 0) {
    const continueToCard = page.getByRole('button', { name: /تابع للدفع الآمن|تابع للدفع/ }).filter({ visible: true });
    if (await continueToCard.count()) {
      await continueToCard.first().click().catch(() => {});
      await page.waitForTimeout(2000);
    }
  }
  await addCard.last().click({ timeout: 30_000 });

  const number = page.locator('input[name="ccNumber"]');
  const month = page.locator('input[name="cardExpiryMonth"]');
  const year = page.locator('input[name="cardExpiryYear"]');
  const cvv = page.locator('input[name="cvv"]');
  const nickname = page.locator('input[name="cardNickname"]');
  await number.waitFor({ state: 'visible', timeout: 20_000 });
  const remember = page.locator('input[name="rememberCard"]');
  if (await remember.count()) await remember.setChecked(false, { force: true }).catch(() => {});
  await number.fill(CARD.number);
  await month.fill(CARD.month);
  await year.fill(CARD.year);
  await cvv.fill(CARD.cvv);
  if (await nickname.count()) await nickname.fill(CARD.name);
  console.log('تم ملء بيانات الدفع. لن يتم الضغط على تأكيد أو الدفع.');
}

async function changeProfileName(page) {
  await page.goto(PROFILE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const name = page.locator('input[name="firstName"]');
  await name.waitFor({ state: 'visible', timeout: 30_000 });
  const next = (await name.inputValue()).trim() === 'Noon QA' ? 'Noon QA 2' : 'Noon QA';
  await reactReady(name, 'onChange');
  await typeInto(name, next);
  const save = page.getByRole('button', { name: /تحديث حسابك/ });
  if (!(await save.isEnabled())) throw new Error('زر حفظ الاسم غير مفعّل.');
  await save.click();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await name.waitFor({ state: 'visible' });
  if ((await name.inputValue()).trim() !== next) throw new Error('لم يتم حفظ الاسم.');
  console.log('تم حفظ الاسم الجديد.');
}

async function leaveIfVerification(page) {
  const prompt = page.getByText(/رمز التحقق|أدخل الرمز|verification code|تحقق من رقم|OTP/i).first();
  const asked = /otp|verify|verification/i.test(page.url()) || await prompt.isVisible().catch(() => false);
  if (!asked) return false;
  console.log('طُلب تحقق. سيتم الخروج بدون إكماله.');
  const close = page.getByRole('button', { name: /إغلاق|إلغاء|الغاء|تخطي|رجوع/ }).filter({ visible: true }).first();
  if (await close.isVisible().catch(() => false)) await close.click().catch(() => {});
  else await page.keyboard.press('Escape');
  return true;
}

async function changeDeliveryAddress(page) {
  await page.goto(PROFILE, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const tab = page.getByRole('link', { name: /توصيل|Delivery|العناوين/i })
    .or(page.getByRole('tab', { name: /توصيل|Delivery|العناوين/i }))
    .or(page.getByRole('button', { name: /توصيل|Delivery|العناوين/i }))
    .filter({ visible: true })
    .first();
  if (await tab.isVisible().catch(() => false)) await tab.click();

  let addNew = page.getByRole('button', { name: /إضافة عنوان جديد/ }).filter({ visible: true }).first();
  if (!(await addNew.isVisible().catch(() => false))) {
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const pin = page.getByRole('button').filter({ has: page.locator('img[alt="location pin"]') }).filter({ visible: true });
    await pin.first().click();
    addNew = page.getByRole('button', { name: /إضافة عنوان جديد/ }).filter({ visible: true }).first();
  }
  await addNew.click();

  const mapInput = page.getByPlaceholder('حدد عنوانك، رقم المبنى..', { exact: true }).filter({ visible: true }).first();
  await mapInput.waitFor({ state: 'visible', timeout: 20_000 });
  await mapInput.fill('');
  await mapInput.pressSequentially('ميدان التحرير القاهرة', { delay: 20 });
  const place = page.locator('.pac-container .pac-item')
    .filter({ hasText: /التحرير|Tahrir/i })
    .filter({ hasText: /القاهرة|Cairo/i })
    .filter({ visible: true });
  await place.first().click({ timeout: 20_000 });
  await page.locator('button').filter({ hasText: 'تأكيد الموقع' }).filter({ visible: true }).first().click();

  const street = page.locator('input[name="street-name"]');
  await street.waitFor({ state: 'visible', timeout: 20_000 });
  await typeInto(page.locator('input[name="building-name"]'), 'QA Test Building');
  await typeInto(street, 'Tahrir Square Area');
  await typeInto(page.locator('input[name="room-no"]'), '1');
  await typeInto(page.locator('input[name="directions"]'), 'Near square');
  const otherLabel = page.locator('button').filter({ hasText: 'آخر' }).filter({ visible: true });
  if (await otherLabel.count()) await otherLabel.first().click().catch(() => {});
  const nickname = page.locator('input[name="nickname"]').filter({ visible: true });
  if (await nickname.count()) await typeInto(nickname.first(), 'QA Location');
  const phone = page.locator('input[type="number"]').filter({ visible: true }).last();
  if (await phone.count()) await typeInto(phone, process.env.NOON_TEST_PHONE || '01000000000');

  if (await leaveIfVerification(page)) return;
  const saveAddress = page.getByRole('button', { name: /حفظ العنوان/ }).filter({ visible: true }).first();
  await saveAddress.click({ timeout: 15_000 });
  await page.waitForTimeout(2000);
  if (await leaveIfVerification(page)) return;
  console.log('تم تغيير عنوان التوصيل.');
}

async function searchHeadphones(page) {
  await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  const input = page.locator('#search-input');
  await input.waitFor({ state: 'visible' });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const ready = await input.evaluate(el => Object.keys(el).some(key => {
      if (!key.startsWith('__reactProps$')) return false;
      const props = el[key];
      return typeof props.onChange === 'function' && typeof props.onKeyDown === 'function';
    })).catch(() => false);
    if (ready) break;
    await page.waitForTimeout(200);
  }
  await input.fill('سماعات');
  const reactValue = () => input.evaluate(el => {
    const key = Object.keys(el).find(name => name.startsWith('__reactProps$'));
    return key ? el[key].value : undefined;
  });
  if (await reactValue() !== 'سماعات') {
    await input.fill('');
    await input.pressSequentially('سماعات', { delay: 30 });
  }
  await input.press('Enter');
  await page.waitForURL(/\/egypt-ar\/search\//, { timeout: 30_000 });
}

async function scrollToEnd(page) {
  for (let i = 0; i < 40; i += 1) {
    const done = await page.evaluate(() => {
      const root = document.scrollingElement || document.documentElement;
      window.scrollBy(0, Math.round(window.innerHeight * 0.85));
      return window.scrollY + window.innerHeight >= root.scrollHeight - 4;
    });
    if (done) return;
    await page.waitForTimeout(250);
  }
}

async function openFacebook(page) {
  const link = page.locator('a[href*="facebook.com/noon"]').filter({ visible: true }).first();
  await link.scrollIntoViewIfNeeded();
  const popupPromise = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
  await link.click();
  const popup = await popupPromise;
  const target = popup || page;
  await target.waitForURL(url => url.hostname.includes('facebook.com'), { timeout: 30_000 });
  console.log('تم فتح صفحة فيسبوك.');
  await target.waitForTimeout(3000);
}

async function runWithSession() {
  if (!fs.existsSync(AUTH)) throw new Error('لا توجد جلسة محفوظة.');
  const browser = await launch();
  try {
    const context = await browser.newContext(browserOptions({ storageState: AUTH }));
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto(HOME, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    if (new URL(page.url()).hostname === 'login.noon.com') {
      throw new Error('الجلسة المحفوظة غير مسجّلة الدخول، وباقي الخطوات تحتاج الحساب.');
    }

    console.log('إضافة منتج إلى المفضلة.');
    const sku = await openAnyProduct(page);
    await addToWishlist(page);
    console.log('حذف المنتج من المفضلة.');
    await removeFromWishlist(page, sku);
    console.log('فتح منتج والذهاب إلى الدفع بدون إتمام الدفع.');
    await fillCheckoutWithoutPaying(page);
    console.log('تغيير الاسم في البروفايل.');
    await changeProfileName(page);
    console.log('تغيير عنوان التوصيل.');
    await changeDeliveryAddress(page);
    console.log('البحث عن سماعات.');
    await searchHeadphones(page);
    console.log('التمرير لآخر الصفحة.');
    await scrollToEnd(page);
    console.log('فتح فيسبوك.');
    await openFacebook(page);
  } finally {
    await browser.close();
  }
}

(async () => {
  console.log('فتح تسجيل الدخول.');
  await loginAndSave();
  console.log('فتح المتصفح من جديد بالجلسة المحفوظة.');
  await runWithSession();
  console.log('انتهت المهمة.');
})().catch(error => {
  console.error(safeMessage(error));
  process.exitCode = 1;
});
