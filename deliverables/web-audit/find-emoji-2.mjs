import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:3000';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server','--no-sandbox','--disable-gpu']});
const ctx=await browser.newContext({viewport:{width:1366,height:900}});
for(const path of ['/','/marketplace/ai-agentic-coding','/me','/preferences','/custom']){
  const page=await ctx.newPage();
  await page.goto(BASE+path,{waitUntil:'networkidle',timeout:40000}).catch(()=>{});
  await page.waitForTimeout(2000);
  const bad=await page.evaluate(()=>{
    const out=[];
    document.querySelectorAll('a[href]').forEach(a=>{
      const h=a.getAttribute('href')||'';
      if(h.startsWith('/marketplace/') && !/^[\x00-\x7F]*$/.test(h)){
        out.push({href:h, text:a.textContent.trim().slice(0,40), cls:(a.className||'').toString().slice(0,50)});
      }
    });
    return out;
  });
  console.log(`\n== ${path} == non-ascii marketplace links: ${bad.length}`);
  [...new Set(bad.map(b=>b.href))].slice(0,20).forEach(b=>console.log('  ',decodeURIComponent(b)));
  await page.close();
}
await browser.close();
