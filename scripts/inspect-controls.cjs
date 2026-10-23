const { chromium } = require('@playwright/test');
(async () => {
 const b = await chromium.launch({headless:false});
 try {
  const p = await b.newPage();
  await p.goto('https://www.noon.com/egypt-ar/');
  const s=p.locator('#search-input');
  await s.waitFor();
  await p.waitForFunction(() => {
    const e=document.querySelector('#search-input');
    return e && Object.keys(e).some(k=>k.startsWith('__reactProps$'));
  });
  console.log('Search handlers', await s.evaluate(e=>Object.keys(e).filter(k=>k.startsWith('__reactProps$')).map(k=>Object.keys(e[k]).filter(x=>x.startsWith('on')))));
  await s.fill('سماعات');
  await s.press('Enter');
  await p.waitForURL(/search/, {timeout:15000}).catch(()=>{});
  console.log('Search pathname',new URL(p.url()).pathname,'query',new URL(p.url()).searchParams.get('q'));
  console.log('Input length',await s.inputValue().then(v=>v.length).catch(()=>-1));
  console.log('Product count',await p.locator('a[href*="/p/"]').count());
  await p.goto('https://www.noon.com/egypt-ar/');
  await p.getByRole('button',{name:/آخرالقاهرة|آخر القاهرة/}).click();
  console.log('Location UI', (await p.locator('body').innerText()).slice(-3500));
 } finally {await b.close();}
})().catch(e=>{console.log('Inspection stopped',e.name);process.exitCode=1});
