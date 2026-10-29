/**
 * 品牌资产生命周期收尾项：后台侧栏 logo 跟随站点设置。
 *
 * 隔离栈：web 127.0.0.1:3420 → hub 127.0.0.1:8920（空库）。
 * 判据来自真实浏览器的 DOM（img src）与真实 /api/site 写入，不做源码断言。
 * 从仓库根目录运行：node deliverables/brand-admin-logo-2026-10-30/browser.mjs
 *
 * 刷新用「有界收敛」而非单次断言：Next 16 的 Data Cache 标签失效在 dev 下
 * 依赖标签清单落盘刷新，写后首个请求偶尔仍读到旧值（站点设置写已改成
 * expire:0 立即过期，首刷通常就是新值）。这里记录实际尝试次数与耗时。
 */
import { chromium } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:3420'
const OUT = join(process.cwd(), 'deliverables/brand-admin-logo-2026-10-30')
mkdirSync(OUT, { recursive: true })
const LOGO = '/icons/icon-192.png'
const FALLBACK = '/assets/images/alogo.webp'
const evidence = { startedAt: new Date().toISOString(), assertions: [], errors: [] }

function assert(name, ok, detail) {
  evidence.assertions.push({ name, ok: Boolean(ok), detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + JSON.stringify(detail) : ''))
  if (!ok) evidence.errors.push({ name, detail })
}

async function logoState(page) {
  await page.waitForSelector('img[alt="Logo"]', { state: 'attached', timeout: 60_000 })
  return page.locator('img[alt="Logo"]').evaluateAll((els) =>
    els.map((el) => ({ src: el.getAttribute('src'), visible: Boolean(el.offsetWidth || el.offsetHeight) })),
  )
}

/** 重新加载直到所有 logo 指向 expected（最多 8 次，间隔 500ms），返回尝试次数 */
async function reloadUntil(page, expected) {
  const startedAt = Date.now()
  for (let attempt = 1; attempt <= 8; attempt++) {
    if (attempt > 1) await page.waitForTimeout(500)
    const resp = await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
    const state = await logoState(page)
    if (resp.status() === 200 && state.length >= 2 && state.every((s) => s.src === expected)) {
      return { state, attempts: attempt, elapsedMs: Date.now() - startedAt }
    }
  }
  return { state: await logoState(page), attempts: 8, elapsedMs: Date.now() - startedAt }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
const page = await context.newPage()
const pageErrors = []
page.on('pageerror', (err) => pageErrors.push(err.message))

try {
  const csrf = await (await context.request.get(BASE + '/api/auth/csrf')).json()
  const login = await context.request.post(BASE + '/api/auth/callback/credentials', {
    form: { csrfToken: csrf.csrfToken, username: 'admin', password: 'sk-ai6-admin', callbackUrl: BASE + '/admin' },
  })
  assert('凭证登录成功（管理端会话可用）', login.status() === 200 || login.status() === 302, { status: login.status() })
  const session = await (await context.request.get(BASE + '/api/auth/session')).json()
  assert('会话里确有 admin 用户', Boolean(session?.user), { user: session?.user?.name ?? null })

  // 1) 配置品牌 logo
  const save = await context.request.post(BASE + '/api/site', { data: { appearance: { logo: LOGO } } })
  assert('写入站点设置 logo 成功', save.status() === 200, { status: save.status(), body: (await save.text()).slice(0, 160) })
  const saved = await (await context.request.get(BASE + '/api/site')).json()
  assert('回读站点设置已是新 logo', saved?.settings?.appearance?.logo === LOGO, {
    logo: saved?.settings?.appearance?.logo,
  })

  // 2) 后台侧栏使用该图。
  // 1440 桌面视口下 DOM 里有两处 Logo（移动端顶栏 + 桌面侧栏），移动端抽屉内容未展开时惰性挂载。
  // 用 attached 而非 visible 等待：第一处是隐藏的移动端顶栏，等它 visible 会永远超时。
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 180_000 })
  const custom = await reloadUntil(page, LOGO)
  evidence.customLogo = custom
  assert(
    '保存后刷新收敛到站点设置里的 logo（DOM 内全部匹配）',
    custom.state.length >= 2 && custom.state.every((s) => s.src === LOGO),
    custom,
  )
  assert('至少一处后台 logo 实际可见', custom.state.some((s) => s.visible), { state: custom.state })
  await page.screenshot({ path: join(OUT, 'shot-admin-logo-custom.png') })

  // 3) 清空后回退内置图
  const clear = await context.request.post(BASE + '/api/site', { data: { appearance: { logo: '' } } })
  assert('清空 logo 成功', clear.status() === 200, { status: clear.status() })
  const cleared = await (await context.request.get(BASE + '/api/site')).json()
  assert('回读站点设置 logo 已清空', cleared?.settings?.appearance?.logo === '', {
    logo: cleared?.settings?.appearance?.logo,
  })
  const fallback = await reloadUntil(page, FALLBACK)
  evidence.fallbackLogo = fallback
  assert(
    '清空后刷新收敛到内置图而不是空 src',
    fallback.state.length >= 2 && fallback.state.every((s) => s.src === FALLBACK),
    fallback,
  )
  await page.screenshot({ path: join(OUT, 'shot-admin-logo-fallback.png') })

  assert('页面无未捕获异常', pageErrors.length === 0, { pageErrors })
} finally {
  await browser.close()
  evidence.finishedAt = new Date().toISOString()
  evidence.ok = evidence.errors.length === 0
  writeFileSync(join(OUT, 'evidence.json'), JSON.stringify(evidence, null, 2))
  console.log('evidence ok=' + evidence.ok + ', failures=' + evidence.errors.length)
  if (!evidence.ok) process.exitCode = 1
}
