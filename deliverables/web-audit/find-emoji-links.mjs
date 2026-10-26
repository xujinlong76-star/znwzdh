import { chromium } from '@playwright/test';
const BASE='http://127.0.0.1:3000';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server','--no-sandbox','--disable-gpu']});
const ctx=await browser.newContext({viewport:{width:1366,height:900}});
const page=await ctx.newPage();
await page.goto(BASE+'/marketplace',{waitUntil:'networkidle',timeout:40000}).catch(()=>{});
await page.waitForTimeout(2500);
const links=await page.evaluate(()=>Array.from(document.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')).filter(h=>h&&h.startsWith('/marketplace/')));
const bad=links.filter(h=>!/^[\x00-\x7F]*$/.test(h));
console.log('total marketplace links:',links.length);
console.log('NON-ASCII links:',bad.length);
[...new Set(bad)].forEach(b=>console.log('  ',decodeURIComponent(b)));
// 找到这些链接对应的 DOM 文本/附近结构
const info=await page.evaluate(()=>{
  const out=[];
  document.querySelectorAll('a[href]').forEach(a=>{
    const h=a.getAttribute('href')||'';
    if(h.startsWith('/marketplace/') && !/^[\x00-\x7F]*$/.test(h)){
      const parent=a.parentElement;
      out.push({href:h, text:a.textContent.trim().slice(0,40), parentClass:parent?parent.className.toString().slice(0,60):'', grandClass:parent&&parent.parentElement?parent.parentElement.className.toString().slice(0,60):''});
    }
  });
  return out.slice(0,15);
});
console.log('--- DOM context ---');
info.forEach(i=>console.log(JSON.stringify(i)));
await browser.close();
