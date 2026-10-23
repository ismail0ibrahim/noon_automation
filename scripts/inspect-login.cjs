const { chromium } = require('@playwright/test');
(async()=>{
 const b=await chromium.launch({headless:false});
 try {
  const p=await b.newPage();
  await p.goto('https://login.noon.com/egypt-ar/');
  await p.locator('input[name=email]').waitFor();
  console.log(await p.locator('input,button,form').evaluateAll(es=>es.map(e=>({tag:e.tagName,name:e.getAttribute('name'),type:e.getAttribute('type'),keys:Object.keys(e)}))));
  console.log('Scripts:',await p.locator('script[src]').evaluateAll(es=>es.map(e=>new URL(e.src).pathname)));
  for (const [name,value] of [['email','qa-input-probe@example.invalid'],['password','DummyInputProbeOnly!']]) {
    const input=p.locator(`input[name="${name}"]`);
    await input.fill(value);
    const matches=()=>input.evaluate((e,expected)=>{
      const key=Object.keys(e).find(k=>k.startsWith('__reactEventHandlers$'));
      return {domMatches:e.value===expected,controlledMatches:key?e[key].value===expected:false};
    },value);
    console.log('Non-submitted dummy fill',name,await matches());
    await input.fill('');
    await input.pressSequentially(value);
    console.log('Non-submitted dummy keyboard entry',name,await matches());
  }
 }finally{await b.close()}
})().catch(e=>{ console.log('Dummy-input inspection stopped:', e.name); process.exitCode=1; });
