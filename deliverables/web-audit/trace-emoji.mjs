import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:3000';
const pagesToVisit=['/marketplace','/marketplace/ai-agentic-coding','/marketplace/nordic-glacier','/marketplace/ai-power-bundle'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server','--no-sandbox','--disable-gpu']});
const ctx=await browser.newContext({viewport:{width:1366,height:900}});
const page=await ctx.newPage();
const hits=[];
page.on('response',r=>{
  const u=r.url();
  if(u.startsWith(BASE+'/marketplace/') && !/^[\x00-\x7F]*$/.test(u.slice(BASE.length))){
    hits.push({page:page.url().replace(BASE,''), status:r.status(), url:u.replace(BASE,'')});
  }
});
for(const p of pagesToVisit){
  await page.goto(BASE+p,{waitUntil:'domcontentloaded',timeout:30000}).catch(()=>{});
  await page.waitForTimeout(3000);
}
console.log('captured:',hits.length);
const byPage={};hits.forEach(h=>{byPage[h.page]=(byPage[h.page]||0)+1;});
Object.entries(byPage).forEach(([k,v])=>console.log('  page',k,'->',v));
[...new Set(hits.map(h=>h.url))].slice(0,30).forEach(u=>console.log('   ',decodeURIComponent(u),'status',hits.find(h=>h.url===u).status));
await browser.close();
