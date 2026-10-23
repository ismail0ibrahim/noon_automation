import { test, expect } from '@playwright/test';
import { installPaymentStop } from './helpers/payment-stop';
import { removeExactProductFromWishlist, wishlistStateInPlace } from './helpers/wishlist';
import { fillDummyCardAtCheckout } from './helpers/checkout';
import { CleanupRegistry, withCleanup } from './helpers/cleanup';
import { login, product, secretFill } from './helpers/noon';
import { redact, redactChunks } from '../scripts/privacy-reporter';
import { filterNoonState } from '../scripts/session-state.cjs';
import { setFirstName } from './helpers/profile';

// No request in these tests may leave the browser, even if a regression changes
// a URL. Per-test routes are only used for fixture responses below.
test.beforeEach(async ({ context }) => {
  await context.setOffline(true);
  await context.route('**/*', route => route.abort('blockedbyclient'));
});

test('payment guard rejects unrecognized writes and alternate payment endpoints', async ({ context, page }) => {
  const reached: string[] = [];
  await context.route('https://shop.example.test/**', route => {
    reached.push(route.request().url());
    return route.fulfill({ contentType: 'text/html', body: '<h1>Offline fixture</h1>' });
  });
  await page.goto('https://shop.example.test/');
  const stop = await installPaymentStop(context);
  try {
    const results = await page.evaluate(async () => Promise.all([
      '/payments/charge', '/orders', '/card/tokenize', '/graphql', '/unknown-write',
    ].map(async url => {
      try { await fetch(url, { method: 'POST' }); return 'sent'; }
      catch { return 'blocked'; }
    })));
    expect(results).toEqual(Array(5).fill('blocked'));
    expect(reached).toHaveLength(1);
  } finally { await stop.dispose(); }
});

test('wishlist verification rejects a malformed success response', async ({ page }) => {
  await page.route('https://shop.example.test/**', route => route.fulfill({
    contentType: route.request().url().includes('v3/wishlist/state') ? 'application/json' : 'text/html',
    body: route.request().url().includes('v3/wishlist/state') ? '{}' : '<h1>Fixture</h1>',
  }));
  await page.goto('https://shop.example.test/');
  await expect(wishlistStateInPlace(page, 'N123')).rejects.toThrow();
});

test('wishlist membership matches an exact SKU rather than a substring', async ({ page }) => {
  await page.route('https://shop.example.test/**', route => route.fulfill({
    contentType: route.request().url().includes('v3/wishlist/state') ? 'application/json' : 'text/html',
    body: route.request().url().includes('v3/wishlist/state')
      ? JSON.stringify({ collections: [{ items: [{ sku: 'N1234', title: 'N123 accessory' }] }] })
      : '<h1>Fixture</h1>',
  }));
  await page.goto('https://shop.example.test/');
  expect((await wishlistStateInPlace(page, 'N123')).skuPresent).toBe(false);
});

test('wishlist uses current V3 membership when legacy V2 disagrees', async ({ page }) => {
  await page.route('https://shop.example.test/**', route => route.fulfill({
    contentType: 'application/json', body: route.request().url().includes('/v3/wishlist/state')
      ? JSON.stringify({ collections: [{ items: [{ sku: 'TARGET' }] }] })
      : JSON.stringify({ wishlists: [] }),
  }));
  await page.goto('https://shop.example.test/');
  expect((await wishlistStateInPlace(page, 'TARGET')).skuPresent).toBe(true);
});

test('wishlist removal opens only the target product article menu', async ({ context, page }) => {
  let items = ['OTHER', 'TARGET'];
  const removed: string[] = [];
  await context.route('https://www.noon.com/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.endsWith('/v3/wishlist/state')) {
      await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ collections: [{ items: items.map(sku => ({ sku })) }] }) });
    } else if (pathname.endsWith('/v3/wishlist/items/remove')) {
      const sku = route.request().postDataJSON().sku;
      removed.push(sku);
      items = items.filter(item => item !== sku);
      await route.fulfill({ contentType: 'application/json', body: '{}' });
    } else if (pathname === '/egypt-ar/wishlist/') {
      await route.fulfill({ contentType: 'text/html', body: `<meta charset="utf-8"><div id="grid">${items.map(sku =>
        `<article><div><div data-qa="plp-product-box"><a href="/egypt-ar/item/${sku}/p/">Fixture product</a></div></div><button aria-label="خيارات المنتج" data-sku="${sku}">Options</button></article>`).join('')}</div>
        <button id="remove" hidden>امسح من المفضلة</button><section id="confirmation" hidden><p>هل أنت متأكد من إزالة المنتج؟</p><button id="yes">نعم</button></section>
        <script>
          let selected;
          document.querySelectorAll('[data-sku]').forEach(button => {
            button.onclick=()=>{selected=button.dataset.sku;document.querySelector('#remove').hidden=false};
            button.__reactProps$fixture={onClick:button.onclick};
          });
          document.querySelector('#remove').onclick=()=>{document.querySelector('#confirmation').hidden=false};
          document.querySelector('#yes').onclick=()=>fetch('/_vs/mp/mp-wishlist-api/v3/wishlist/items/remove',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sku:selected})
          });
        </script>` });
    } else await route.abort();
  });
  await removeExactProductFromWishlist(page, '/egypt-ar/item/TARGET/p/', 'TARGET');
  expect(removed).toEqual(['TARGET']);
  expect(items).toEqual(['OTHER']);
});

for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
  test(`payment guard blocks ${method} in a popup and iframe`, async ({ context, page }) => {
    await context.route('https://shop.example.test/**', route => route.fulfill({
      contentType: 'text/html', body: '<iframe src="/frame"></iframe>',
    }));
    const stop = await installPaymentStop(context);
    try {
      await page.goto('https://shop.example.test/');
      await page.frameLocator('iframe').locator('body').waitFor();
      const frame = page.frames().find(f => f !== page.mainFrame())!;
      expect(await frame.evaluate(async method => {
        try { await fetch('/opaque-endpoint', { method }); return 'sent'; } catch { return 'blocked'; }
      }, method)).toBe('blocked');
      const popup = await context.newPage();
      await popup.goto('https://shop.example.test/popup');
      expect(await popup.evaluate(async method => {
        try { await fetch('/third-party-token', { method }); return 'sent'; } catch { return 'blocked'; }
      }, method)).toBe('blocked');
      expect(stop.blockedCount()).toBe(2);
      await popup.close();
    } finally { await stop.dispose(); }
  });
}

test('guard blocks sensitive GET paths and encoded variants but allows static reads', async ({ context, page }) => {
  await context.route('https://shop.example.test/**', route => route.fulfill({ contentType: 'text/html', body: 'Fixture' }));
  await page.goto('https://shop.example.test/');
  const stop = await installPaymentStop(context);
  try {
    const results = await page.evaluate(async () => Promise.all(
      ['/orders', '/cards/save', '/payments/charge', '/%6frders/submit', '/checkout/confirm', '/assets/card-icon.svg'].map(async url => {
        try { await fetch(url); return 'sent'; } catch { return 'blocked'; }
      }),
    ));
    expect(results).toEqual(['blocked', 'blocked', 'blocked', 'blocked', 'blocked', 'sent']);
  } finally { await stop.dispose(); }
});

test('disposing the guard restores normal forms and writes across later navigation', async ({ context, page }) => {
  await context.route('https://shop.example.test/**', route => route.fulfill({ contentType: 'text/html',
    body: '<form><button>Save profile</button></form><script>window.saved=0;document.querySelector("form").addEventListener("submit",e=>{e.preventDefault();window.saved++})</script>' }));
  await page.goto('https://shop.example.test/');
  const stop = await installPaymentStop(context);
  await page.getByRole('button').click();
  expect(await page.evaluate(() => (window as any).saved)).toBe(0);
  await stop.dispose();
  await stop.dispose(); // idempotent teardown
  await page.getByRole('button').click();
  expect(await page.evaluate(() => (window as any).saved)).toBe(1);
  await page.goto('https://shop.example.test/profile');
  await page.getByRole('button').click();
  expect(await page.evaluate(() => (window as any).saved)).toBe(1);
  expect(await page.evaluate(async () => (await fetch('/profile/update', { method: 'POST' })).ok)).toBe(true);
});

test('card population refuses to run without an active payment guard', async ({ page }) => {
  await expect(fillDummyCardAtCheckout(page)).rejects.toThrow('Install the payment stop');
  expect(page.url()).toBe('about:blank');
});

for (const payload of ['null', 'not json', '{"collections":[{}]}', '{"collections":[{"items":[{}]}]}']) {
  test(`wishlist rejects incomplete API schema: ${payload}`, async ({ page }) => {
    await page.route('https://shop.example.test/**', route => route.fulfill({
      contentType: 'application/json', body: route.request().url().includes('v3/wishlist/state') ? payload : '{}',
    }));
    await page.goto('https://shop.example.test/');
    await expect(wishlistStateInPlace(page, 'N123')).rejects.toThrow('cannot verify');
  });
}

for (const items of [[], [{ sku: 'N123' }]]) {
  test(`wishlist accepts a valid ${items.length ? 'exact match' : 'empty list'}`, async ({ page }) => {
    await page.route('https://shop.example.test/**', route => route.fulfill({
      contentType: 'application/json', body: JSON.stringify({ collections: [{ items }] }),
    }));
    await page.goto('https://shop.example.test/');
    const result = await wishlistStateInPlace(page, 'N123');
    expect(result.skuPresent).toBe(items.length > 0);
    expect(result.itemCount).toBe(items.length);
  });
}

test('cleanup runs in reverse order and continues after a failure', async () => {
  const cleanup = new CleanupRegistry();
  const calls: string[] = [];
  const done = cleanup.add('cart', async () => { calls.push('cart'); });
  cleanup.add('profile', async () => { calls.push('profile'); throw new Error('private detail must not escape'); });
  cleanup.add('guard', async () => { calls.push('guard'); });
  await expect(cleanup.run()).rejects.toThrow('Account cleanup incomplete');
  expect(calls).toEqual(['guard', 'profile', 'cart']);
  await done();
  expect(calls).toHaveLength(3);
});

test('operation and recovery failures are both preserved', async () => {
  const primary = new Error('Synthetic operation failure');
  const recovery = new Error('Synthetic recovery failure');
  const result = await withCleanup(async () => { throw primary; }, async () => { throw recovery; }).catch(e => e);
  expect(result).toBeInstanceOf(AggregateError);
  expect(result.errors).toEqual([primary, recovery]);
});

for (const accepted of [true, false]) {
  test(`profile update ${accepted ? 'waits for acknowledgment and restores after reload' : 'reports a rejected save without resubmission'}`, async ({ context, page }) => {
    let stored = 'Original fixture name';
    let updates = 0;
    await context.route('https://www.noon.com/egypt-ar/account/profile/', route => route.fulfill({
      contentType: 'text/html', body: '<script>location.replace("https://account.noon.com/egypt-ar/profile/")</script>',
    }));
    await context.route('https://account.noon.com/**', async route => {
      if (route.request().method() === 'POST') {
        updates++;
        await new Promise(resolve => setTimeout(resolve, 100));
        if (accepted) stored = route.request().postDataJSON().firstName;
        await route.fulfill({ status: accepted ? 200 : 503, contentType: 'application/json', body: '{}' });
        return;
      }
      await route.fulfill({ contentType: 'text/html', body: `
        <meta charset="utf-8">
        <input name="firstName"><button id="save" disabled>تحديث حسابك</button><button>تسجيل الخروج</button>
        <script>
          const field=document.querySelector('input');
          field.value=${JSON.stringify(stored)};
          field.__reactProps$fixture={onChange(){}};
          const save=document.querySelector('#save');
          field.addEventListener('input',()=>{save.disabled=false});
          save.addEventListener('click',()=>fetch('/_vs/mp/mp-identity-api/customer/update',{
            method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({firstName:field.value})
          }));
        </script>` });
    });
    if (accepted) {
      await setFirstName(page, 'Noon QA');
      expect(stored).toBe('Noon QA');
      await setFirstName(page, 'Original fixture name');
      expect(stored).toBe('Original fixture name');
      expect(updates).toBe(2);
    } else {
      await expect(setFirstName(page, 'Noon QA')).rejects.toThrow('not acknowledged');
      expect(stored).toBe('Original fixture name');
      expect(updates).toBe(1);
    }
  });
}

test('login disabled means no navigation or credential submission', async ({ page }, info) => {
  const previous = process.env.NOON_LOGIN_MODE;
  process.env.NOON_LOGIN_MODE = 'disabled';
  try { await expect(login(page, info)).rejects.toThrow('Login is disabled'); }
  finally { if (previous === undefined) delete process.env.NOON_LOGIN_MODE; else process.env.NOON_LOGIN_MODE = previous; }
  expect(page.url()).toBe('about:blank');
});

for (const [index, url] of ['http://www.noon.com/egypt-ar/test/N123/p/', 'https://www.noon.com.evil.test/egypt-ar/test/N123/p/', 'https://user:password@www.noon.com/egypt-ar/test/N123/p/', 'https://www.noon.com/uae-ar/test/N123/p/'].entries()) {
  test(`rejects unsafe product URL case ${index + 1}`, async ({ page }) => {
    const previous = process.env.NOON_PRODUCT_URL;
    process.env.NOON_PRODUCT_URL = url;
    try { await expect(product(page)).rejects.toThrow('Egypt Arabic Noon product URL'); }
    finally { if (previous === undefined) delete process.env.NOON_PRODUCT_URL; else process.env.NOON_PRODUCT_URL = previous; }
    expect(page.url()).toBe('about:blank');
  });
}

test('credential redaction handles literal, JSON-escaped and URL-encoded forms', async () => {
  const secret = 'Fake"pass&word';
  const text = [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret)].join('|');
  expect(redact(text, [secret])).toBe('[private]|[private]|[private]');
});

test('report output redacts secrets split across UTF-8 chunks', () => {
  const secret = 'اختبار-سرّي';
  const bytes = Buffer.from(secret);
  expect(redactChunks([bytes.subarray(0, 3), bytes.subarray(3, 8), bytes.subarray(8)], [secret])).toBe('[private]');
});

test('captured sessions exclude unrelated sites and deceptive Noon domains', () => {
  const cookie = { name: 'fixture', value: 'synthetic', domain: '.noon.com', path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' as const };
  const state = filterNoonState({
    cookies: ['.noon.com', 'account.noon.com', 'notnoon.com', '.google.com'].map(domain => ({ ...cookie, domain })),
    origins: ['https://www.noon.com', 'https://account.noon.com', 'https://noon.com.evil.test', 'https://google.com'].map(origin => ({ origin, localStorage: [] })),
  });
  expect(state.cookies.map(c => c.domain)).toEqual(['.noon.com', 'account.noon.com']);
  expect(state.origins.map(o => o.origin)).toEqual(['https://www.noon.com', 'https://account.noon.com']);
});

test('secret field failures expose only a static diagnostic', async ({ page }) => {
  await page.setContent('<input disabled>');
  const message = await secretFill(page.locator('input'), 'SyntheticSecret', 'Password').then(() => '', e => e.message);
  expect(message).toBe('Password: field population could not be verified (details suppressed).');
});
