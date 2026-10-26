// NavHub 移动端适配检测脚本（真实 Chrome，390x844 视口）
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3000';
const OUT='deliverables/web-audit';
const SHOTS=path.join(OUT,'shots');
fs.mkdirSync(SHOTS,{recursive:true});

// 移动端重点页面子集
const pages=[
 '/','/category/ai-tools','/category/ai-tools/p/2','/tags/'+encodeURIComponent('开源'),
 '/collections/agentic-ai','/marketplace','/marketplace/ai-agentic-coding',
 '/custom','/preferences','/submit','/graph','/algorithms','/hot','/videos','/import',
 '/site/0035b857-030f-46f9-b074-c0502fbc2497','/sites','/favorites','/me','/auth/signin'
];

const consoleErr=[],pageErr=[],results=[];
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--no-proxy-server','--disable-dev-shm-usage','--no-sandbox','--disable-gpu']});
const ctx=await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true, deviceScaleFactor:2 });
const page=await ctx.newPage();
page.on('console',m=>{if(m.type()==='error')consoleErr.push(`[${page.url()}] ${m.text()}`);});
page.on('pageerror',e=>pageErr.push(`[${page.url()}] ${e.message}`));

for(const p of pages){
  const rec={url:p,status:null,overflow:false,scrollW:0,innerW:390,consoleErr:0,touchIssues:[],error:null,shot:''};
  try{
    const resp=await page.goto(BASE+p,{waitUntil:'load',timeout:30000});
    rec.status=resp?resp.status():null;
    await page.waitForTimeout(1400);
    const m=await page.evaluate(()=>{
      const de=document.documentElement;
      const sw=Math.max(de.scrollWidth,document.body.scrollWidth||0);
      // 检测溢出元素
      const vw=window.innerWidth;const bad=[];
      document.querySelectorAll('*').forEach(el=>{
        const r=el.getBoundingClientRect();
        if(r.width>0 && r.right>vw+1 && r.left<vw){ const t=(el.tagName+'.'+(el.className&&el.className.toString().slice(0,30))); if(bad.length<5) bad.push(t+' x='+Math.round(r.right)); }
      });
      return {sw, vw, bad};
    });
    rec.scrollW=m.sw; rec.innerW=m.vw; rec.overflow=m.sw>m.vw+2; rec.touchIssues=m.bad;
    const fname='m_'+encodeURIComponent(p.replace(/\//g,'_')||'home')+'.png';
    await page.screenshot({path:path.join(SHOTS,fname),fullPage:false}).catch(()=>{});
    rec.shot=fname;
  }catch(e){ rec.error=String(e.message||e).slice(0,200); }
  if(consoleErr.length){ /* per url not tracked separately; count at end */ }
  results.push(rec);
  console.log(`[m] ${p} status=${rec.status} overflow=${rec.overflow} sw=${rec.scrollW} bad=${rec.touchIssues.length}`);
}
const report={results, consoleErrors:consoleErr.slice(0,50), pageErrors:pageErr.slice(0,30), overflowPages:results.filter(r=>r.overflow).map(r=>r.url)};
fs.writeFileSync(path.join(OUT,'mobile-results.json'),JSON.stringify(report,null,2));
console.log(`\n=== MOBILE: pages=${results.length} overflow=${results.filter(r=>r.overflow).length} consoleErr=${consoleErr.length} pageErr=${pageErr.length} ===`);
await browser.close();
