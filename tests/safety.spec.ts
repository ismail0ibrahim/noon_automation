import {test,expect} from '@playwright/test';
import {installPaymentStop} from './helpers/payment-stop';

test('Safety - checkout cannot submit card data or place an order',async({context,page})=>{
  await context.setOffline(true);
  let requestsPastGuard=0;
  await context.route('https://checkout.example.test/**',async route=>{
    requestsPastGuard++;
    await route.fulfill({status:200,contentType:'text/html',body:'<h1>Offline checkout safety fixture</h1><form action="/preview"><button>Fixture submit</button></form>'});
  });
  const guard=await installPaymentStop(context);
  await page.goto('https://checkout.example.test/preview');
  expect(requestsPastGuard).toBe(1);
  const results=await page.evaluate(async()=>{
    const requests:[string,string][]=[['/cards/save','POST'],['/orders/submit','POST'],['/orders/submit','GET']];
    return Promise.all(requests.map(async([url,method])=>{try{await fetch(url,{method});return 'sent';}catch{return 'blocked';}}));
  });
  expect(results).toEqual(['blocked','blocked','blocked']);
  expect(requestsPastGuard).toBe(1);
  expect(guard.blockedCount()).toBe(3);
  await page.getByRole('button',{name:'Fixture submit',exact:true}).click();
  expect(requestsPastGuard).toBe(1);
});
