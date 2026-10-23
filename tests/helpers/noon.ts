import { expect, Page, Locator, TestInfo, type ConsoleMessage, type Response } from '@playwright/test';
import fs from 'fs/promises';
import { saveNoonSession } from '../../scripts/session-state.cjs';

export const home = 'https://www.noon.com/egypt-ar/';
export const authFile = '.auth/state.json';
export async function visit(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit' });
}
export async function waitForReactHandler(field: Locator, handler: string) {
  await expect.poll(()=>field.evaluate((el,event)=>Object.keys(el).some(key=>{
    if(!key.startsWith('__reactProps$')&&!key.startsWith('__reactEventHandlers$'))return false;
    return typeof (el as any)[key][event]==='function';
  }),handler),{message:`Wait for ${handler} to be attached before interaction`}).toBe(true);
}
export async function safeDemoFrame(info: TestInfo, region: Locator, label: string, mask: Locator[] = []) {
  if (process.env.NOON_SAFE_DEMO !== '1') return;
  // Call only for a reviewed public/test-only region, never a whole account page.
  const file = info.outputPath(`safe-demo-${label.replace(/[^a-z0-9-]/gi, '-')}.png`);
  await region.screenshot({ path: file, mask, animations: 'disabled' });
  await info.attach(`safe-demo:${label}`, { path: file, contentType: 'image/png' });
}

// Deliberately do not attach a raw Playwright error/cause: fill errors can contain values.
export async function secretFill(field: Locator, value: string, description: string) {
  try {
    await expect(field).toHaveCount(1);
    await expect(field).toBeVisible();
    await expect(field).toBeEnabled();
    await field.fill(value);
    if (await field.inputValue() === value) return;
  } catch { /* Emit only a static diagnostic. */ }
  throw new Error(`${description}: field population could not be verified (details suppressed).`);
}

export async function uniqueVisible(locator: Locator): Promise<Locator | undefined> {
  const visible: Locator[] = [];
  for (const candidate of await locator.all()) if (await candidate.isVisible()) visible.push(candidate);
  return visible.length === 1 ? visible[0] : undefined;
}

export async function search(page: Page) {
  await visit(page, home);
  const input = page.locator('#search-input'); // Inspected live on 2026-10-22.
  await expect(input).toBeVisible();
  // The SSR input is visible before React attaches onKeyDown/onChange. Observed
  // live: Enter before hydration does nothing. Wait for those real handlers.
  await expect.poll(() => input.evaluate(el => Object.keys(el).some(key => {
    if (!key.startsWith('__reactProps$')) return false;
    const props = (el as unknown as Record<string, Record<string, unknown>>)[key];
    return typeof props.onChange === 'function' && typeof props.onKeyDown === 'function';
  })), { message: 'Wait for the observed Noon search handlers to attach' }).toBe(true);
  await input.fill('سماعات');
  const state = () => input.evaluate(el => {
    const key = Object.keys(el).find(k => k.startsWith('__reactProps$'));
    return key ? (el as unknown as Record<string, { value?: string }>)[key].value : undefined;
  });
  // The live component sometimes keeps an empty controlled value after fill().
  // Emit keyboard/input events, then verify React state before submitting.
  if (await state() !== 'سماعات') {
    await input.fill('');
    await input.pressSequentially('سماعات');
  }
  await expect.poll(state, { message: 'Wait for controlled search state to contain the Arabic term' }).toBe('سماعات');
  await input.press('Enter');
  await expect(page).toHaveURL(/\/egypt-ar\/search\//);
  await expect.poll(()=>new URL(page.url()).searchParams.get('q'),{message:'Arabic term must survive URL encoding'}).toBe('سماعات');
  await expect(page.locator('a[href*="/p/"]').first()).toBeVisible();
}

export async function product(page: Page) {
  if (process.env.NOON_PRODUCT_URL) {
    const url = new URL(process.env.NOON_PRODUCT_URL);
    if (url.protocol !== 'https:' || url.host !== 'www.noon.com' || url.username || url.password ||
        !/^\/egypt-ar\/.+\/[A-Za-z0-9_-]+\/p\//.test(url.pathname))
      throw new Error('NOON_PRODUCT_URL must be an Egypt Arabic Noon product URL.');
    await visit(page, url.href);
  } else {
    await search(page);
    await page.locator('a[href*="/p/"]').first().click();
  }
  await expect(page).toHaveURL(/\/p\//);
  const actual = new URL(page.url());
  if (actual.protocol !== 'https:' || actual.host !== 'www.noon.com' || !actual.pathname.startsWith('/egypt-ar/'))
    throw new Error('Product navigation left the expected Noon Egypt origin.');
  return new URL(page.url()).pathname;
}

export async function authenticated(page: Page) {
  await visit(page, `${home}account/profile/`);
  // Inspected live: storefront redirects to the separate account app, which
  // hydrates after its search header. Wait for protected content, not that header.
  await expect.poll(()=>{const url=new URL(page.url());return url.hostname==='account.noon.com'&&url.pathname==='/egypt-ar/profile/';},{message:'Protected account route must load'}).toBe(true);
  await expect(page.locator('input[name="firstName"]'), 'Protected editable profile must load').toBeVisible();
  await expect(page.getByRole('button', { name: /تسجيل الخروج/ }).first()).toBeVisible();
}

export async function safeEvidence(page: Page, info: TestInfo, status: string) {
  // Render a separate, offline status card: no live DOM, credentials, address or card data.
  const evidence = await page.context().newPage();
  try {
    await evidence.setContent('<main style="font:24px sans-serif;padding:48px"><h1>Noon automation</h1><p id="status"></p><p>Private page content omitted.</p></main>');
    await evidence.locator('#status').evaluate((el, text) => { el.textContent = text; }, status);
    const file = info.outputPath('safe-status.png');
    await evidence.screenshot({ path: file });
    await info.attach('Sanitized status card (not a live-page screenshot)', { path: file, contentType: 'image/png' });
  } finally { await evidence.close(); }
}

/** Signs in and returns the page the journey must continue on (search entry opens a new tab). */
export async function login(page: Page, info: TestInfo): Promise<Page> {
  if (!['automatic', 'manual', 'disabled'].includes(process.env.NOON_LOGIN_MODE ?? 'automatic'))
    throw new Error('NOON_LOGIN_MODE must be automatic, manual or disabled.');
  if (!['direct', 'root', 'search'].includes(process.env.NOON_LOGIN_ENTRY ?? 'direct'))
    throw new Error('NOON_LOGIN_ENTRY must be direct, root or search.');
  if (process.env.NOON_LOGIN_MODE === 'disabled') throw new Error('Login is disabled by configuration.');
  await fs.mkdir('.auth', { recursive: true });
  // Preserve a verified manual session if an independent automatic attempt fails.
  // The login test always starts in a fresh context and never uses this state.
  const email = process.env.NOON_EMAIL?.trim();
  const password = process.env.NOON_PASSWORD;
  const manual = process.env.NOON_LOGIN_MODE === 'manual';
  if (!manual && (!email || !password)) throw new Error('Set NOON_EMAIL and NOON_PASSWORD in local .env.');
  const statuses: { status: number; category: string }[] = [];
  const requestStructures: { fields: string[]; otherFieldCount: number; credentialsMatch: boolean }[] = [];
  const responseSummaries: { status: number; code?: string; message?: string }[] = [];
  const pendingDiagnostics: Promise<void>[] = [];
  const removeListeners: (() => void)[] = [];
  let consoleErrors = 0;
  const watch = (watched: Page) => {
  const onConsole = (msg: ConsoleMessage) => { if (msg.type() === 'error') consoleErrors++; };
  const onResponse = (response: Response) => {
    const url = new URL(response.url());
    if (url.hostname.endsWith('.noon.com') && response.request().method() === 'POST') {
      statuses.push({ status: response.status(), category: /login|auth|signin/.test(url.pathname) ? 'authentication' : 'other POST' });
      if (/login|auth|signin/.test(url.pathname)) {
        // Inspect structure only. Never retain header values, request values or body text.
        try {
          const payload = response.request().postDataJSON();
          const keys = payload && typeof payload === 'object' ? Object.keys(payload) : [];
          const fields = keys.filter(key => ['email', 'password', 'username', 'rememberMe', 'recaptchaToken', 'captcha', 'country', 'locale'].includes(key));
          requestStructures.push({ fields, otherFieldCount: keys.length - fields.length, credentialsMatch: payload.email === email && payload.password === password });
        } catch { /* Non-JSON bodies are not collected. */ }
        if (response.status() >= 400) pendingDiagnostics.push((async () => {
          try {
            const data = await response.json();
            const code = data?.code ?? data?.error_code ?? data?.error?.code;
            const message = data?.message ?? data?.error?.message ?? data?.error_message ?? (typeof data?.error === 'string' ? data.error : undefined);
            const safeCodes = ['INVALID_PASSWORD', 'PASSWORD_INVALID', 'INVALID_CREDENTIALS', 'INVALID_REQUEST', 'BAD_REQUEST', 'CAPTCHA_REQUIRED', 'OTP_REQUIRED', 'RATE_LIMITED'];
            const safeMessages = ['Invalid password', 'Password is invalid', 'كلمة السر غير صالحة', 'Invalid email or password', 'Invalid credentials', 'Something went wrong', 'Captcha required', 'Too many requests'];
            const knownCode = safeCodes.find(value => typeof code === 'string' && value.toLowerCase() === code.toLowerCase());
            const knownMessage = safeMessages.find(value => typeof message === 'string' && value.toLowerCase() === message.toLowerCase());
            responseSummaries.push({ status: response.status(), code: knownCode ?? 'Unrecognized code withheld', message: knownMessage ?? 'Unrecognized message withheld' });
          } catch { responseSummaries.push({ status: response.status(), message: 'Non-JSON response withheld' }); }
        })());
      }
    }
  };
  watched.on('console', onConsole);
  watched.on('response', onResponse);
  removeListeners.push(() => { watched.off('console', onConsole); watched.off('response', onResponse); });
  };
  watch(page);
  let stage = 'navigation';
  try {
    if((process.env.NOON_LOGIN_ENTRY??'direct')==='search'){
      await visit(page,'https://www.google.com/search?q=login.noon.com');
      console.log('Complete any Google CAPTCHA manually. Recording is off; search wait is limited to five minutes.');
      info.annotations.push({type:'manual-verification',description:'Any search CAPTCHA must be completed by the human; automated credential entry follows only on the genuine Noon login page.'});
      const result=page.locator('a[href^="https://login.noon.com/"]').first();
      const ready=await Promise.any([
        page.waitForURL(url=>url.hostname==='login.noon.com',{timeout:300_000,waitUntil:'commit'}).then(()=> 'login'),
        result.waitFor({state:'visible',timeout:300_000}).then(()=> 'results'),
      ]);
      if(ready==='results'){
        // Account owner's verified route: after the search (and any manual
        // CAPTCHA), open the genuine login page in a NEW TAB in this same
        // browser context, close the search tab, and continue there.
        const loginPage=await page.context().newPage();
        watch(loginPage);
        await loginPage.goto('https://login.noon.com/egypt-ar/',{waitUntil:'domcontentloaded'});
        const searchPage=page;
        page=loginPage;
        await searchPage.close().catch(()=>{});
      }
      await page.waitForURL(url=>url.hostname==='login.noon.com',{timeout:30_000,waitUntil:'commit'});
    }else await page.goto(process.env.NOON_LOGIN_ENTRY === 'root' ? 'https://login.noon.com/' : 'https://login.noon.com/egypt-ar/', { waitUntil: 'domcontentloaded' });
    if (!manual) {
      stage = 'field population';
      await waitForReactHandler(page.locator('input[name="email"]'),'onChange');
      await waitForReactHandler(page.locator('input[name="password"]'),'onChange');
      await waitForReactHandler(page.getByRole('button',{name:'تسجيل الدخول',exact:true}),'onClick');
      await secretFill(page.locator('input[name="email"]'), email!, 'Email');
      await secretFill(page.locator('input[name="password"][type="password"]'), password!, 'Password');
      stage = 'submission/authentication';
      await page.getByRole('button', { name: 'تسجيل الدخول', exact: true }).click({noWaitAfter:true});
    } else stage = 'manual authentication';
    // Submit exactly once. Manual mode leaves the browser visible; do not print OTPs.
    if (process.env.NOON_MANUAL_AUTH === '1' || manual)
      console.log('Complete any visible CAPTCHA/OTP manually in the browser. Recording is disabled.');
    await page.waitForURL(url => url.hostname === 'www.noon.com' && url.pathname.startsWith('/egypt-ar/'),
      { timeout: process.env.NOON_MANUAL_AUTH === '1' || manual ? 300_000 : 25_000, waitUntil:'commit' });
    stage = 'post-login verification';
    await authenticated(page);
    await saveNoonSession(page.context(), authFile);
    return page;
  } catch {
    await Promise.race([Promise.allSettled(pendingDiagnostics), new Promise(resolve => {
      const timeout = setTimeout(resolve, 3_000);
      timeout.unref();
    })]);
    // Only specific known public error messages are retained; never dump response bodies or DOM.
    const knownErrors = ['كلمة السر غير صالحة', 'حدث خطأ', 'البريد الإلكتروني أو كلمة المرور غير صحيحة', 'Invalid email or password', 'Something went wrong', 'Access Denied'];
    const visibleErrors: string[] = [];
    for (const text of knownErrors) if (await page.getByText(text, { exact: false }).first().isVisible().catch(() => false)) visibleErrors.push(text);
    const diagnostic = info.outputPath('login-diagnostics.json');
    let host = 'browser-closed';
    if (!page.isClosed()) { try { host = new URL(page.url()).hostname; } catch { host = 'unknown'; } }
    await fs.writeFile(diagnostic, JSON.stringify({ stage, host, statuses, requestStructures, responseSummaries, consoleErrors, visibleErrors }, null, 2));
    await info.attach('Sanitized login diagnostics', { path: diagnostic, contentType: 'application/json' });
    // If the browser was closed mid-login, evidence capture must not mask that.
    if (!page.isClosed()) await safeEvidence(page, info, `Login stopped at ${stage}`).catch(() => {});
    throw new Error(`Login failed at ${stage}. See sanitized diagnostics. No automatic credential retry.`);
  } finally { for (const remove of removeListeners) remove(); }
}
