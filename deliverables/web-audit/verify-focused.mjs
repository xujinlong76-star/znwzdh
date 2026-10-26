// 聚焦验证：针对摘要里争议/未定论的点，做精确当前态核验（与全量爬取并行，写到独立文件避免覆盖）。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'http://127.0.0.1:3000';
const OUT = 'deliverables/web-audit';
const out = { checks: [], consoleErrors: [], pageErrors: [], failed: [], bad: [] };

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server','--disable-dev-shm-usage','--no-sandbox','--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if(m.type()==='error') out.consoleErrors.push(`[${page.url()}] ${m.text()}`); });
page.on('pageerror', e => out.pageErrors.push(`[${page.url()}] ${e.message}`));
page.on('requestfailed', r => out.failed.push(`[${r.resourceType()}] ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', r => { if(r.status()>=400&&r.status()<600) out.bad.push(`${r.status()} ${r.url()}`); });

async function check(name, fn){ try{ const d=await fn(); out.checks.push({name, ok:true, ...d}); console.log(`✓ ${name}`, JSON.stringify(d)); }catch(e){ out.checks.push({name, ok:false, error:String(e.message||e).slice(0,300)}); console.log(`✗ ${name}`, String(e.message||e).slice(0,200)); } }

// 1) 首页搜索 UI 端到端：输入 -> 下拉建议是否渲染真实结果
await check('home-search-ui', async () => {
  await page.goto(BASE+'/', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  const sel = 'input[placeholder*="搜索"], input[type="search"], input[aria-label*="搜索"], input[role="searchbox"]';
  const box = await page.$(sel);
  if(!box) throw new Error('未找到搜索输入框');
  await box.click();
  await box.type('代码', { delay: 40 });
  // 等下拉出现（最多 4s）
  let suggCount = 0, suggTexts = [];
  for(let i=0;i<20;i++){
    await page.waitForTimeout(200);
    const items = await page.$$('[role="option"], li[role="option"], [data-suggestion], .suggestion, a[href*="/search"]');
    if(items.length){ suggCount=items.length; suggTexts = await Promise.all(items.slice(0,5).map(e=>e.innerText().catch(()=>''))); break; }
  }
  // 记录搜索接口返回
  const apiResp = await page.evaluate(async () => {
    try { const r = await fetch('/api/hub/search?q='+encodeURIComponent('代码')+'&limit=12'); const j=await r.json(); return {status:r.status, hits:(j.hits||[]).length}; } catch(e){ return {error:String(e)}; }
  });
  return { suggCount, suggSample: suggTexts.slice(0,3), apiResp };
});

// 2) 搜索接口（hub 代理路径）直接核验
await check('search-endpoint-hub', async () => {
  const r = await page.evaluate(async () => {
    const res = await fetch('/api/hub/search?q='+encodeURIComponent('AI')+'&limit=5');
    const j = await res.json().catch(()=>null);
    return { status: res.status, hits: j? (j.hits||[]).length : null };
  });
  return r;
});

// 3) /preferences 是否有匿名 401 噪声
await check('preferences-401', async () => {
  await page.goto(BASE+'/preferences', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(2000);
  const badForPref = out.bad.filter(b=>b.includes('/api/me/')||b.includes('401'));
  return { badResponses: badForPref, consoleErrors: out.consoleErrors.filter(c=>c.includes('preferences')||c.includes('401')) };
});

// 4) /me /favorites /me/workspaces 鉴权态
for(const r of ['/me','/favorites','/me/workspaces']){
  await check('auth-'+r, async () => {
    await page.goto(BASE+r, { waitUntil:'load', timeout:30000 });
    await page.waitForTimeout(1500);
    const u = page.url().replace(BASE,'');
    const isSignin = u.startsWith('/auth/signin') || (await page.$('input[type="password"], form[action*="signin"]'))!==null;
    const badForRoute = out.bad.filter(b=>b.includes(r)||b.includes('401'));
    return { finalUrl:u, hitSignin:isSignin, badResponses: badForRoute };
  });
}

// 5) /graph 控制台/水合
await check('graph-console', async () => {
  await page.goto(BASE+'/graph', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(2500);
  return { consoleErrors: out.consoleErrors.filter(c=>c.includes('graph')), pageErrors: out.pageErrors.filter(c=>c.includes('graph')) };
});

// 6) marketplace 详情加载是否超时（冷编译已过热，应能秒开）
await check('marketplace-detail-load', async () => {
  const t0=Date.now();
  const resp = await page.goto(BASE+'/marketplace/ai-agentic-coding', { waitUntil:'domcontentloaded', timeout:30000 });
  const dt=Date.now()-t0;
  await page.waitForTimeout(800);
  return { status: resp&&resp.status(), loadMs: dt, bad: out.bad.filter(b=>b.includes('marketplace/ai-agentic-coding')) };
});

// 7) /me/notifications 匿名态：不应发起 /api/me/notifications（否则 401），且应呈现空态
await check('notifications-anonymous', async () => {
  const before = out.bad.length;
  const hitReq = [];
  page.on('request', (r) => { if (r.url().includes('/api/me/notifications')) hitReq.push(r.url()); });
  await page.goto(BASE+'/me/notifications', { waitUntil:'load', timeout:60000 });
  await page.waitForTimeout(3500);
  const bodyText = await page.evaluate(() => document.body.innerText || '');
  const emptyHit = /还没有|暂无|没有通知|空空/.test(bodyText);
  const badNew = out.bad.slice(before).filter(b => b.includes('/api/me/') || b.includes('401'));
  return { meNotificationsRequests: hitReq.length, badNew, emptyStateShown: emptyHit };
});

fs.writeFileSync(path.join(OUT,'focused-results.json'), JSON.stringify(out, null, 2));
console.log('\n=== FOCUSED DONE ===');
await browser.close();
