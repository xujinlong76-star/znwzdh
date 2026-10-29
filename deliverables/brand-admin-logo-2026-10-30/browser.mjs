/**
 * 品牌资产生命周期收尾项：后台侧栏 logo 跟随站点设置。
 *
 * 隔离栈：web 127.0.0.1:3420 → hub 127.0.0.1:8920（空库）。
 * 判据来自真实浏览器的 DOM（img src）与真实 /api/site 写入，不做源码断言。
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
  assert('写入站点设置 logo 成功', save.status() === 200, { status: save.status(), body: await save.text().then((t) => t.slice(0, 200)) })

  // 2) 后台侧栏使用该图
  await page.goto(BASE + '/admin', { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('img[alt="Logo"]', { timeout: 180_000 })
  const srcs = await page.locator('img[alt="Logo"]').evaluateAll((els) =>
    els.map((el) => ({ src: el.getAttribute('src'), visible: Boolean(el.offsetWidth || el.offsetHeight) })),
  )
  assert(
    '后台三处 logo 全部换成站点设置里的图',
    srcs.length === 3 && srcs.every((s) => s.src === LOGO),
    { srcs },
  )
  assert('至少一处后台 logo 实际可见', srcs.some((s) => s.visible), { srcs })
  await page.screenshot({ path: join(OUT, 'shot-admin-logo-custom.png') })

  // 3) 清空后回退内置图
  const clear = await context.request.post(BASE + '/api/site', { data: { appearance: { logo: '' } } })
  assert('清空 logo 成功', clear.status() === 200, { status: clear.status() })
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 })
  await page.waitForSelector('img[alt="Logo"]', { timeout: 120_000 })
  const fallbackSrcs = await page.locator('img[alt="Logo"]').evaluateAll((els) =>
    els.map((el) => el.getAttribute('src')),
  )
  assert(
    '未配置 logo 时回退内置图而不是空 src',
    fallbackSrcs.length === 3 && fallbackSrcs.every((s) => s === FALLBACK),
    { fallbackSrcs },
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
