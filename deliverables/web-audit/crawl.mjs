// NavHub 真实浏览器爬取（受控版）：已知路由清单 + 限量链接发现，去掉重型截图以提速。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3000';
const OUT = 'deliverables/web-audit';
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

// 已知路由（含动态真实参数）
const KNOWN = [
 '/','/admin','/admin/ai','/admin/audit','/admin/categories','/admin/collections','/admin/data','/admin/data/restore','/admin/facets','/admin/jobs','/admin/navigation','/admin/plugin-health','/admin/plugins','/admin/resources','/admin/resources/download','/admin/site','/admin/sitelist','/admin/stats','/admin/submissions','/admin/tags','/admin/taxonomy','/admin/tokens','/admin/trash','/admin/videos',
 '/algorithms','/auth/error','/auth/signin','/category','/collections','/custom','/favorites','/graph','/hot','/import','/marketplace','/marketplace/import','/marketplace/installed','/marketplace/mine','/marketplace/publish',
 '/me','/me/account','/me/data','/me/history','/me/notifications','/me/plugins','/me/settings','/me/vault','/me/workspaces','/offline','/preferences','/sites','/submit','/tags','/videos','/videos/player',
 '/category/ai-tools','/category/ai-tools/p/2','/category/chat-assistants',
 '/tags/'+encodeURIComponent('开源'),'/tags/'+encodeURIComponent('国产'),
 '/collections/agentic-ai','/collections/ai-coding','/collections/frontend-starter',
 '/site/0035b857-030f-46f9-b074-c0502fbc2497','/site/00901f83-1a59-4015-85c2-d77e0d6861df','/site/011c975b-9306-4090-85ae-6c11b875776a',
 '/marketplace/ai-agentic-coding','/marketplace/ai-agentic-coding/preview',
 '/admin/navigation/b78fd44d-f935-48b3-9a32-15142a113e58','/admin/navigation/b78fd44d-f935-48b3-9a32-15142a113e58/categories','/admin/navigation/b78fd44d-f935-48b3-9a32-15142a113e58/items',
];

const consoleErrors = new Map();
const consoleWarnings = new Map();
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
const results = [];
const visited = new Set();

const EMPTY_MARKERS = ['暂无','空空如也','没有数据','No data','暂无数据','什么都没有','还没有','无内容','数据为空','Empty','暂无内容','未收录','没有收录'];

function norm(href) {
  if (!href) return null;
  let h = href;
  if (h.startsWith('//')) h = 'http:' + h;
  if (h.startsWith('http')) { if (!h.startsWith(BASE)) return null; }
  else if (h.startsWith('/')) h = BASE + h;
  else return null;
  try { const u = new URL(h); u.hash=''; return u.toString(); } catch { return null; }
}

const browser = await chromium.launch({ channel:'chrome', headless:true, args:['--no-proxy-server','--disable-dev-shm-usage','--no-sandbox','--disable-gpu'] });
const ctx = await browser.newContext({ viewport:{width:1366,height:900} });
const page = await ctx.newPage();
page.on('console', m => { if(m.type()==='error'||m.type()==='warning'){ const cur=page.url(); const b=m.type()==='error'?consoleErrors:consoleWarnings; if(!b.has(cur))b.set(cur,[]); b.get(cur).push(m.text()); }});
page.on('pageerror', e => pageErrors.push({url:page.url(),message:e.message,stack:(e.stack||'').split('\n').slice(0,2).join(' | ')}));
page.on('requestfailed', r => failedRequests.push({url:r.url(),method:r.method(),error:r.failure()?.errorText,type:r.resourceType()}));
page.on('response', r => { const s=r.status(); if(s>=400&&s<600) badResponses.push({url:r.url(),status:s,from:page.url(),type:r.request().resourceType()}); });

let count=0;
const queue = KNOWN.map((p) => BASE + p);
while (queue.length && visited.size < 140) {
  const url = queue.shift();
  if (visited.has(url)) continue;
  visited.add(url); count++;
  const rec = { n:count, url, status:null, title:'', consoleErr:0, consoleWarn:0, pageErr:false, failedReq:0, badResp:0, overflow:false, scrollW:0, innerW:1366, empty:false, error:null };
  try {
    const resp = await page.goto(url, { waitUntil:'domcontentloaded', timeout:30000 });
    rec.status = resp ? resp.status() : null;
    await page.waitForTimeout(700);
    rec.title = (await page.title()).slice(0,100);
    const m = await page.evaluate(() => {
      const de=document.documentElement; const sw=Math.max(de.scrollWidth,document.body.scrollWidth||0); const iw=window.innerWidth;
      const txt=(document.body&&document.body.innerText)||'';
      return { sw, iw, sample: txt.slice(0,3500) };
    });
    rec.scrollW=m.sw; rec.innerW=m.iw; rec.overflow=m.sw>m.iw+2;
    for (const mk of EMPTY_MARKERS){ if(m.sample.includes(mk)){ rec.empty=true; rec.emptyMarker=mk; break; } }
    // 限量发现内部链接（每个页面最多采 12 条，去重），避免 /site/ 爆炸
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).map(a=>a.getAttribute('href')));
    let added=0;
    for (const l of links){ const n=norm(l); if(n && !visited.has(n) && !queue.includes(n) && added<12){ queue.push(n); added++; } }
  } catch(e){ rec.error=String(e.message||e).slice(0,250); }
  if(consoleErrors.has(url)) rec.consoleErr=consoleErrors.get(url).length;
  if(consoleWarnings.has(url)) rec.consoleWarn=consoleWarnings.get(url).length;
  results.push(rec);
  if(count%15===0) console.log(`[crawl] ${count} pages, queue=${queue.length}`);
}
const summary = {
  total: results.length,
  statusDist: results.reduce((a,r)=>{a[r.status||'err']=(a[r.status||'err']||0)+1;return a;},{}),
  consoleErrPages: results.filter(r=>r.consoleErr>0).length,
  consoleWarnPages: results.filter(r=>r.consoleWarn>0).length,
  pageErrors: pageErrors.length,
  failedRequests: failedRequests.length,
  badResponses: badResponses.length,
  overflowPages: results.filter(r=>r.overflow).map(r=>({url:r.url,sw:r.scrollW,iw:r.innerW})),
  emptyPages: results.filter(r=>r.empty).map(r=>({url:r.url,marker:r.emptyMarker})),
  notFound: results.filter(r=>r.status===404).map(r=>r.url),
  errorPages: results.filter(r=>r.error).map(r=>({url:r.url,error:r.error})),
};
fs.writeFileSync(path.join(OUT,'crawl-results.json'), JSON.stringify({summary,results,pageErrors,failedRequests,badResponses},null,2));
console.log('\n=== CRAWL SUMMARY ===');
console.log(JSON.stringify(summary,null,2));
await browser.close();
