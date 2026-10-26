// NavHub 登录态回归（真实会话，不伪造 cookie）
//
// 背景：本次审计的 7 项修复全部围绕「匿名态」，已登录路径按设计原样保留
// （只在匿名时拦截请求）。因此登录态必须单独回归，否则「修好了匿名」可能
// 掩盖「把登录态也拦掉了」。仓库没有 e2e 账号夹具，这里走产品自带的
// 凭证通道：`authorize()` 的快捷通道（bypass）只在
// `NAVHUB_ALLOW_DEFAULT_PASSWORD=1` 时于生产运行时开启——验证时用该开关
// 起一个临时实例（:3213），登出即销毁，不写库、不伪造签名。
//
// 断言：
//   1. 三个受保护接口在登录后返回 200：/api/me/llm-usage、/api/me/notifications、
//      /api/hub/workspaces/**/members；
//   2. 三个页面无 4xx/5xx、无 pageerror、无控制台 error；
//   3. 对照：同一构建上匿名访问 /me/notifications **零请求**（本次修复的口径没有被改回去）。
import { chromium } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.NAVHUB_AUDIT_BASE || 'http://127.0.0.1:3213';
const OUT = 'deliverables/web-audit';
const SHOTS = path.join(OUT, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const PAGES = ['/preferences', '/me/notifications', '/me/workspaces', '/me'];
const WATCH = [
  { key: 'llm-usage', re: /\/api\/me\/llm-usage/ },
  { key: 'notifications', re: /\/api\/me\/notifications/ },
  { key: 'workspace-members', re: /\/api\/hub\/workspaces\/[^/]+\/members/ },
];

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--no-proxy-server', '--disable-dev-shm-usage', '--no-sandbox', '--disable-gpu'],
});

const out = {
  base: BASE,
  login: { ok: false, user: null, error: null },
  pages: [],
  endpoints: Object.fromEntries(WATCH.map((w) => [w.key, []])),
  badResponses: [],
  consoleErrors: [],
  pageErrors: [],
  anonymousContrast: null,
};

// ---------- 1. 真实凭证登录（走 next-auth 自己的 callback） ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
try {
  const csrfRes = await ctx.request.get(`${BASE}/api/auth/csrf`, { timeout: 15000 });
  const { csrfToken } = await csrfRes.json();
  const loginRes = await ctx.request.post(`${BASE}/api/auth/callback/credentials`, {
    form: {
      csrfToken,
      username: 'audit-admin',
      password: 'admin123',
      bypass: 'true',
      callbackUrl: `${BASE}/`,
    },
    maxRedirects: 0,
    timeout: 20000,
  });
  const cookies = await ctx.cookies();
  const sessionRes = await ctx.request.get(`${BASE}/api/auth/session`, { timeout: 15000 });
  const session = await sessionRes.json();
  const hasSessionCookie = cookies.some((c) => /session-token/.test(c.name) && c.value.length > 20);
  out.login = {
    ok: Boolean(hasSessionCookie && session?.user?.id),
    status: loginRes.status(),
    hasSessionCookie,
    user: session?.user ?? null,
    error: null,
  };
} catch (error) {
  out.login.error = error instanceof Error ? error.message : String(error);
}

// ---------- 2. 登录态逐页检查 ----------
if (out.login.ok) {
  const page = await ctx.newPage();
  let currentUrl = '';
  page.on('console', (m) => {
    if (m.type() === 'error') out.consoleErrors.push(`[${currentUrl}] ${m.text()}`.slice(0, 300));
  });
  page.on('pageerror', (e) => out.pageErrors.push(`[${currentUrl}] ${e.message}`.slice(0, 300)));
  page.on('response', (res) => {
    const url = res.url();
    const status = res.status();
    for (const w of WATCH) {
      if (w.re.test(url)) out.endpoints[w.key].push({ page: currentUrl, status, url: url.replace(BASE, '') });
    }
    if (status >= 400 && url.startsWith(BASE + '/api/')) {
      out.badResponses.push({ page: currentUrl, status, url: url.replace(BASE, '') });
    }
  });

  for (const p of PAGES) {
    currentUrl = p;
    const rec = { url: p, status: null, shot: '', textLen: 0, bodyHint: '', error: null };
    try {
      const resp = await page.goto(BASE + p, { waitUntil: 'load', timeout: 30000 });
      rec.status = resp ? resp.status() : null;
      // 等受保护请求落地（客户端门控是「ready 之后才发」）
      await page.waitForTimeout(2500);
      rec.textLen = (await page.evaluate(() => document.body.innerText || '')).length;
      const shot = path.join(SHOTS, `auth-${p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      rec.shot = shot;
      rec.bodyHint = (await page.evaluate(() => (document.body.innerText || '').slice(0, 160).replace(/\s+/g, ' ')));
    } catch (error) {
      rec.error = error instanceof Error ? error.message : String(error);
    }
    out.pages.push(rec);
  }
  await page.close();
}
await ctx.close();

// ---------- 3. 匿名对照：同构建上不应发起受保护请求 ----------
{
  const anonCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const anon = await anonCtx.newPage();
  const hits = [];
  anon.on('request', (req) => {
    if (/\/api\/me\/notifications/.test(req.url())) hits.push(req.url().replace(BASE, ''));
  });
  await anon.goto(BASE + '/me/notifications', { waitUntil: 'load', timeout: 30000 });
  await anon.waitForTimeout(2500);
  out.anonymousContrast = { page: '/me/notifications', protectedRequests: hits.length, urls: hits };
  await anonCtx.close();
}

await browser.close();

// ---------- 4. 汇总 ----------
const summary = {
  loginOk: out.login.ok,
  user: out.login.user?.id ?? null,
  endpoints: Object.fromEntries(
    Object.entries(out.endpoints).map(([k, v]) => [k, { calls: v.length, statuses: [...new Set(v.map((x) => x.status))] }]),
  ),
  badResponses: out.badResponses.length,
  consoleErrors: out.consoleErrors.length,
  pageErrors: out.pageErrors.length,
  anonProtectedRequests: out.anonymousContrast?.protectedRequests ?? null,
};
out.summary = summary;
fs.writeFileSync(path.join(OUT, 'authenticated-results.json'), JSON.stringify(out, null, 2));

console.log(JSON.stringify(summary, null, 2));
if (out.badResponses.length) console.log('4xx/5xx:', JSON.stringify(out.badResponses, null, 2));
if (out.consoleErrors.length) console.log('console:', out.consoleErrors.slice(0, 5));
if (out.pageErrors.length) console.log('pageerror:', out.pageErrors.slice(0, 5));
