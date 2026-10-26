import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:3000';
const pages=['/graph','/me/workspaces','/site/ded3eb04-e888-40de-bef1-6b76e8fc8268'];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server','--no-sandbox','--disable-gpu']});
const ctx=await browser.newContext({viewport:{width:1366,height:900}});
for(const p of pages){
  const page=await ctx.newPage();
  const errs=[];
  page.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
  page.on('pageerror',e=>errs.push('PAGEERR: '+e.message));
  try{ await page.goto(BASE+p,{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(2500); }catch(e){ errs.push('GOTO: '+e.message); }
  console.log('\n===== '+p+' =====');
  errs.forEach(e=>console.log(' - '+e.slice(0,400)));
  await page.close();
}
await browser.close();
