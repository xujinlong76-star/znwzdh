// NavHub 核心交互真实浏览器验证脚本
// 在已预热的真实 Chrome 中执行真实输入/点击/滚动/拖拽，并记录控制台与网络异常。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3000';
const OUT = 'deliverables/web-audit';
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const log = [];
const consoleErr = [];
const consoleWarn = [];
const pageErrors = [];
const failedReq = [];
const badResp = [];

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-proxy-server','--disable-dev-shm-usage','--no-sandbox','--disable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
const page = await ctx.newPage();
page.on('console', m => { if(m.type()==='error') consoleErr.push(`[${page.url()}] ${m.text()}`); if(m.type()==='warning') consoleWarn.push(`[${page.url()}] ${m.text()}`); });
page.on('pageerror', e => pageErrors.push(`[${page.url()}] ${e.message}`));
page.on('requestfailed', r => failedReq.push(`[${r.resourceType()}] ${r.url()} :: ${r.failure()?.errorText}`));
page.on('response', r => { if(r.status()>=400&&r.status()<600) badResp.push(`${r.status()} ${r.url()}`); });

function step(name, detail='') { log.push({ name, ok: true, detail }); console.log(`✓ ${name} :: ${detail}`); }
function fail(name, detail='') { log.push({ name, ok: false, detail }); console.log(`✗ ${name} :: ${detail}`); }

async function safe(fn, name) { try { await fn(); } catch(e) { fail(name, String(e.message||e).slice(0,200)); } }

// ---------- A. 首页搜索 ----------
await safe(async () => {
  await page.goto(BASE+'/', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  const sel = 'input[placeholder*="搜索"], input[type="search"], input[aria-label*="搜索"]';
  const box = await page.$(sel);
  if(!box) throw new Error('未找到搜索输入框');
  await box.click();
  await box.type('代码', { delay: 30 });
  await page.waitForTimeout(900);
  // 是否有建议下拉
  const sugg = await page.$$('[role="option"], .suggestion, li[role="option"], [data-suggestion]');
  step('首页搜索-输入', `输入"代码"后建议项数量=${sugg.length}`);
  if(sugg.length){ await sugg[0].click().catch(()=>{}); await page.waitForTimeout(800); }
  else { await box.press('Enter'); await page.waitForTimeout(800); }
  step('首页搜索-触发', `当前URL=${page.url().replace(BASE,'')}`);
  await page.screenshot({ path: path.join(SHOTS,'ix_search.png') });
}, '搜索交互');

// ---------- B. 分类页 + 站点详情打开 + 分页 ----------
await safe(async () => {
  await page.goto(BASE+'/category/ai-tools', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  // 站点卡片：链接到 /site/ 的 a
  const card = await page.$('a[href^="/site/"]');
  if(!card) throw new Error('分类页未找到站点卡片链接');
  const href = await card.getAttribute('href');
  await card.click();
  await page.waitForTimeout(1500);
  step('分类页-打开站点详情', `点击卡片跳转 ${href} -> ${page.url().replace(BASE,'')}`);
  await page.screenshot({ path: path.join(SHOTS,'ix_site_detail.png') });
  // 返回分类页测试分页
  await page.goto(BASE+'/category/ai-tools/p/2', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1200);
  step('分类页-分页', `访问第2页 URL=${page.url().replace(BASE,'')}`);
}, '分类与分页');

// ---------- C. 偏好设置：主题/开关切换 ----------
await safe(async () => {
  await page.goto(BASE+'/preferences', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  const before = await page.evaluate(()=>document.documentElement.className + ' | ' + (localStorage.getItem('navhub-theme')||''));
  // 点击任意 button/switch/toggle
  const toggles = await page.$$('button[role="switch"], input[type="checkbox"], button[aria-pressed], [data-toggle]');
  let clicked=0;
  for(const t of toggles.slice(0,6)){ try{ await t.click({force:true}); clicked++; await page.waitForTimeout(300);}catch{} }
  step('偏好设置-切换控件', `点击开关/按钮数量=${clicked}`);
  await page.waitForTimeout(500);
  const after = await page.evaluate(()=>document.documentElement.className + ' | ' + (localStorage.getItem('navhub-theme')||''));
  step('偏好设置-状态变化', `before="${before}" after="${after}"`);
  await page.screenshot({ path: path.join(SHOTS,'ix_preferences.png') });
}, '偏好设置');

// ---------- D. 提交表单（校验） ----------
await safe(async () => {
  await page.goto(BASE+'/submit', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  const inputs = await page.$$('input, textarea');
  if(inputs.length){
    // 尝试填一个并清空以触发校验
    for(const inp of inputs.slice(0,4)){ try{ await inp.click({force:true}); await inp.fill('测试站点'); await page.waitForTimeout(200);}catch{} }
    const btn = await page.$('button[type="submit"], button:has-text("提交"), button:has-text("发布"), button:has-text("Submit")');
    if(btn){ try{ await btn.click({force:true}); await page.waitForTimeout(800);}catch(e){} }
    step('提交表单-填写与提交', `输入框数量=${inputs.length}`);
  } else { step('提交表单', '未发现表单输入框'); }
  await page.screenshot({ path: path.join(SHOTS,'ix_submit.png') });
}, '提交表单');

// ---------- E. 市场安装（鉴权处理） ----------
await safe(async () => {
  await page.goto(BASE+'/marketplace/ai-agentic-coding', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  const btns = await page.$$('button');
  let installClicked=false;
  for(const b of btns){ const t=(await b.innerText().catch(()=>''))||''; if(/安装|install|添加到|获取/i.test(t)){ try{ await b.click({force:true}); installClicked=true; await page.waitForTimeout(1000); break;}catch{} } }
  step('市场详情-安装按钮', `找到并点击安装类按钮=${installClicked}; 点击后URL=${page.url().replace(BASE,'')}`);
  await page.screenshot({ path: path.join(SHOTS,'ix_marketplace_install.png') });
}, '市场安装');

// ---------- F. 自定义工作台（编辑模式 + 拖拽） ----------
await safe(async () => {
  await page.goto(BASE+'/custom', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1500);
  const editBtn = await page.$('button:has-text("编辑"), button[aria-label*="编辑"], button:has-text("排版"), button:has-text("DIY")');
  if(editBtn){ await editBtn.click({force:true}).catch(()=>{}); await page.waitForTimeout(800); step('自定义-进入编辑模式','已点击编辑/排版按钮'); }
  else step('自定义-编辑按钮','未找到编辑模式按钮');
  // 尝试拖拽第一张可拖卡片
  const drag = await page.$('[draggable="true"], .draggable, [data-drag]');
  if(drag){ const b=await drag.boundingBox(); if(b){ await page.mouse.move(b.x+b.width/2,b.y+b.height/2); await page.mouse.down(); await page.mouse.move(b.x+120,b.y+80,{steps:8}); await page.mouse.up(); await page.waitForTimeout(600); step('自定义-拖拽卡片','执行了一次拖拽'); } }
  else step('自定义-拖拽','未找到可拖拽卡片');
  await page.screenshot({ path: path.join(SHOTS,'ix_custom.png') });
}, '自定义工作台');

// ---------- G. 鉴权重定向（me/favorites/admin） ----------
for(const r of ['/me','/favorites','/admin']) {
  await safe(async () => {
    await page.goto(BASE+r, { waitUntil:'load', timeout:30000 });
    await page.waitForTimeout(1500);
    const u = page.url().replace(BASE,'');
    const isSignin = u.startsWith('/auth/signin') || (await page.$('input[type="password"], form[action*="signin"]'))!==null;
    step(`鉴权重定向-${r}`, `到达URL=${u}; 命中登录页=${isSignin}`);
  }, `鉴权-${r}`);
}

// ---------- H. 弹窗/对话框（全局扫描任一 modal） ----------
await safe(async () => {
  await page.goto(BASE+'/', { waitUntil:'load', timeout:30000 });
  await page.waitForTimeout(1200);
  // 寻找可触发弹窗的按钮（含"设置/更多/菜单/分享"）
  const triggers = await page.$$('button');
  let modalOpened=false;
  for(const b of triggers){ const t=(await b.innerText().catch(()=>''))||''; if(/设置|分享|更多|菜单|关于|帮助|反馈/i.test(t)){ try{ await b.click({force:true}); await page.waitForTimeout(500); const m=await page.$('[role="dialog"], .modal, dialog'); if(m){ modalOpened=true; step('弹窗触发', `通过按钮"${t.trim().slice(0,12)}"打开弹窗`); await page.keyboard.press('Escape').catch(()=>{}); break; } }catch{} } }
  if(!modalOpened) step('弹窗扫描','未发现明显可触发弹窗的按钮');
}, '弹窗扫描');

const report = { steps: log, consoleErrors: consoleErr, consoleWarnings: consoleWarn.slice(0,40), pageErrors, failedRequests: failedReq.slice(0,40), badResponses: badResp.slice(0,40) };
fs.writeFileSync(path.join(OUT,'interactions.json'), JSON.stringify(report, null, 2));
const okCount = log.filter(l=>l.ok).length;
console.log(`\n=== INTERACTIONS: ${okCount}/${log.length} steps ok; consoleErr=${consoleErr.length} pageErr=${pageErrors.length} badResp=${badResp.length} ===`);
await browser.close();
