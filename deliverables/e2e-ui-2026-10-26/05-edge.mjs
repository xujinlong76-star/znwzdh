import { session, open, state, clickText, Recorder, assert, BASE, waitVisible } from './harness.mjs'

const R = new Recorder('异常与边界场景')
const s = await session()
const { page } = s

await R.run('未登录访问 /admin → 跳登录页且带 callbackUrl', async () => {
  await open(page, '/admin', { settle: 1500 })
  const u = new URL(page.url())
  assert(u.pathname === '/auth/signin', `未跳转登录页，实际=${u.pathname}`)
  const cb = u.searchParams.get('callbackUrl') || ''
  assert(/\/admin/.test(cb), `callbackUrl 未指向 /admin：${cb}`)
  await page.screenshot({ path: 'shots/05-admin-anon.png' })
  return `已跳转，callbackUrl=${cb.slice(0, 48)}`
})

await R.run('未登录访问 /me 与 /favorites → 空态而非报错', async () => {
  const out = []
  for (const p of ['/me', '/favorites', '/me/workspaces', '/preferences']) {
    s.logs.badResponses = []
    await open(page, p, { settle: 2000 })
    const txt = await page.locator('main').innerText().catch(() => '')
    out.push(`${p}: 空态/登录引导=${/登录|暂无|还没有|去添加/i.test(txt)} 4xx=${s.logs.badResponses.length}`)
  }
  await page.screenshot({ path: 'shots/05-anon-me.png' })
  return out.join(' ; ')
})

await R.run('错误密码登录 → 明确失败文案（不静默）', async () => {
  await open(page, '/auth/signin', { settle: 2200 })
  const user = page.locator('input[name*="user"], input[id*="username"], input[placeholder*="身份"]').first()
  if (await user.isVisible().catch(() => false)) await user.fill('admin')
  const pwd = page.locator('input[type="password"]').first()
  assert(await pwd.isVisible().catch(() => false), '未找到密码输入框')
  await pwd.fill('wrong-password-!!!')
  await clickText(page, /登\s*录|登录/, { timeout: 8000 })
  await page.waitForTimeout(3500)
  const txt = await page.locator('main').innerText().catch(() => '')
  await page.screenshot({ path: 'shots/05-signin-wrong.png' })
  const hinted = /密码|凭证|失败|不正确|错误|无效/i.test(txt)
  assert(hinted, '错误密码后没有任何提示文案')
  return `仍停留登录页=${page.url().includes('/auth/signin')} 提示=${JSON.stringify(txt.replace(/\s+/g, ' ').match(/[^。]*失败[^。]*|[^。]*密码[^。]*/)?.[0]?.slice(0, 60) || '见截图')}`
})

await R.run('不存在的路由 → 自定义 404 页可返回', async () => {
  await open(page, '/this-route-does-not-exist-20261026', { settle: 2000 })
  const txt = await page.locator('body').innerText().catch(() => '')
  const has404 = /404|不存在|找不到|Not Found/i.test(txt)
  const back = await clickText(page, /返回|回首页|首页|主页/, { timeout: 7000 })
  await page.waitForTimeout(2000)
  const url = page.url().replace(BASE, '')
  await page.screenshot({ path: 'shots/05-404.png' })
  assert(has404, '404 页面没有可见的错误说明')
  return `404 文案=${has404} 返回按钮=${back.clicked} 返回后=${url}`
})

await R.run('非法分类 slug → 友好空态而非 500', async () => {
  s.logs.badResponses = []
  await open(page, '/category/%%%-bogus-slug', { settle: 2200 })
  const txt = await page.locator('body').innerText().catch(() => '')
  await page.screenshot({ path: 'shots/05-bad-slug.png' })
  return `文案=${JSON.stringify(txt.replace(/\s+/g, ' ').slice(0, 80))} 4xx/5xx=${JSON.stringify([...new Set(s.logs.badResponses)].slice(0, 3))}`
})

await R.run('中枢接口 500 → 前端降级提示 + 不白屏', async () => {
  await page.route('**/api/hub/**', (r) => r.abort()).catch(() => {})
  await page.route('**/api/sites**', (route) =>
    route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }))
  await open(page, '/', { settle: 3000 })
  const txt = await page.locator('body').innerText().catch(() => '')
  const degraded = /重试|降级|暂时|加载失败|不可用|稍后再试|网络/i.test(txt)
  await page.screenshot({ path: 'shots/05-api-500.png' })
  const blank = (await page.locator('main').innerText().catch(() => '')).length < 30
  await page.unroute('**/api/hub/**').catch(() => {})
  await page.unroute('**/api/sites**').catch(() => {})
  assert(!blank, '接口 500 后主内容区接近空白')
  return `降级提示=${degraded} 文案=${JSON.stringify(txt.replace(/\s+/g, ' ').slice(0, 70))}`
})

await R.run('接口 401（会话失效）→ 给出登录引导', async () => {
  await page.route('**/api/me/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"Unauthorized"}' }))
  await open(page, '/me', { settle: 2800 })
  const txt = await page.locator('main').innerText().catch(() => '')
  await page.screenshot({ path: 'shots/05-me-401.png' })
  await page.unroute('**/api/me/**').catch(() => {})
  return `登录引导=${/登录|重新登录|未登录|账号/i.test(txt)} 崩溃=${s.logs.pageErrors.length}`
})

await R.run('离线（断网）→ 离线提示 / /offline 可用', async () => {
  await open(page, '/', { settle: 2000 })
  await page.context().setOffline(true)
  await page.waitForTimeout(600)
  await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'shots/05-offline-home.png' })
  const banner = await page.locator('body').innerText().catch(() => '')
  const mentions = /离线|网络|连接|no ?internet|offline/i.test(banner)
  await page.goto(BASE + '/offline', { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(2000)
  const offlineTxt = await page.locator('body').innerText().catch(() => '')
  await page.screenshot({ path: 'shots/05-offline-page.png' })
  await page.context().setOffline(false)
  return `断网后横幅提示=${mentions} /offline 页文案=${JSON.stringify(offlineTxt.replace(/\s+/g, ' ').slice(0, 70))}`
})

await R.run('搜索接口超时 → 不卡死、有兜底', async () => {
  await page.route('**/api/search**', async (route) => {
    await new Promise((r) => setTimeout(r, 12_000))
    return route.abort()
  })
  await open(page, '/', { settle: 2000 })
  await page.keyboard.press('/')
  await page.waitForTimeout(900)
  const box = page.locator('[role="dialog"] input').first()
  const ok = await waitVisible(box, 8000)
  let res = '面板未唤出'
  if (ok) {
    const t0 = Date.now()
    await box.fill('hey')
    await page.waitForTimeout(3000)
    const txt = await page.locator('[role="dialog"]').first().innerText().catch(() => '')
    res = `等待=${Date.now() - t0}ms 兜底文案=${JSON.stringify(txt.replace(/\s+/g, ' ').slice(0, 70))}`
    await page.keyboard.press('Escape')
  }
  await page.unroute('**/api/search**').catch(() => {})
  await page.screenshot({ path: 'shots/05-search-timeout.png' })
  return res
})

await R.run('投稿重复提交 → 限流/重复提示', async () => {
  await open(page, '/submit', { settle: 2000 })
  const urlBox = page.locator('input[placeholder="https://example.com"]').first()
  const nameBox = page.locator('input[placeholder="例如：Cursor 或 Linear"]').first()
  assert(await urlBox.isVisible().catch(() => false), '投稿表单字段未渲染')
  for (let i = 0; i < 3; i++) {
    await urlBox.fill(`https://audit-dup-${i}.example.com`)
    if (await nameBox.isVisible().catch(() => false)) await nameBox.fill(`重复提交夹具 ${i}`)
    await clickText(page, /提交|推荐收录|立即提交/, { timeout: 6000 }).catch(() => {})
    await page.waitForTimeout(2000)
  }
  const txt = await page.locator('main').innerText().catch(() => '')
  await page.screenshot({ path: 'shots/05-submit-throttle.png' })
  return `出现限流/重复提示=${/频繁|稍后|太多|限流|重复|已存在|等待/i.test(txt)} 尾部=${JSON.stringify(txt.replace(/\s+/g, ' ').slice(-100))}`
})

await R.run('超长/特殊字符输入 → 截断或拒绝，不产生乱码', async () => {
  await open(page, '/submit', { settle: 2000 })
  const urlBox = page.locator('input[placeholder="https://example.com"]').first()
  if (!(await urlBox.isVisible().catch(() => false))) return '表单不可用'
  await urlBox.fill('https://example.com/' + 'a'.repeat(3000) + '<script>alert(1)</script>')
  const nameBox = page.locator('input[placeholder="例如：Cursor 或 Linear"]').first()
  if (await nameBox.isVisible().catch(() => false)) await nameBox.fill('👍'.repeat(300) + '"><img src=x onerror=alert(1)>')
  await clickText(page, /提交|立即提交/, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(3000)
  const txt = await page.locator('main').innerText().catch(() => '')
  await page.screenshot({ path: 'shots/05-submit-overflow.png' })
  const injected = await page.evaluate(() => !!document.querySelector('script:not([src]) , img[src="x"]'))
  return `长度/格式提示=${/过长|超长|太多|无效|格式|字符/i.test(txt)} 页面出现注入痕迹=${injected}`
})

await R.run('非管理员身份访问后台 → 明确拒绝而非空白后台', async () => {
  const anon = await session()
  await anon.page.goto(BASE + '/auth/signin?error=AccessDenied', { waitUntil: 'load' }).catch(() => {})
  await anon.page.waitForTimeout(2500)
  const txt = await anon.page.locator('body').innerText().catch(() => '')
  await anon.page.screenshot({ path: 'shots/05-access-denied.png' })
  await anon.browser.close()
  return `AccessDenied 文案命中=${/拒绝|无权|权限|AccessDenied|不允许/i.test(txt)}`
})

await R.run('键盘可达性：Tab 焦点可见 + Esc 关闭模态', async () => {
  await open(page, '/', { settle: 2500 })
  const focusTrail = []
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const info = await page.evaluate(() => {
      const a = document.activeElement
      const cs = a ? getComputedStyle(a) : null
      return a ? `${a.tagName}:${(a.getAttribute('aria-label') || a.textContent || '').trim().slice(0, 14)}:${cs && cs.outlineStyle !== 'none' && cs.outlineWidth !== '0px' ? 'ring' : cs && (cs.boxShadow || '').length > 12 ? 'shadow' : 'none'}` : 'none'
    })
    focusTrail.push(info)
  }
  await page.keyboard.press('/')
  await page.waitForTimeout(900)
  const opened = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const closed = !(await page.locator('[role="dialog"]').first().isVisible().catch(() => false))
  await page.screenshot({ path: 'shots/05-keyboard.png' })
  const noRing = focusTrail.filter((f) => f.endsWith(':none')).length
  return `12 次 Tab 焦点轨迹=${JSON.stringify(focusTrail.slice(0, 6))}… 无焦点样式=${noRing}/12 面板开=${opened} Esc 关=${closed}`
})

await R.run('后台接口未就绪时的加载失败重试（admin load-error-notice）', async () => {
  await page.route('**/api/admin/**', (route) => route.fulfill({ status: 503, body: '{"error":"unavailable"}', contentType: 'application/json' }))
  const a = await session({ auth: true })
  await open(a.page, '/admin/stats', { settle: 3000 })
  const txt = await a.page.locator('main').innerText().catch(() => '')
  await a.page.screenshot({ path: 'shots/05-admin-503.png' })
  const retry = await clickText(a.page, /重试|重新加载|刷新/, { timeout: 6000 })
  await a.browser.close()
  await page.unroute('**/api/admin/**').catch(() => {})
  return `失败提示=${/失败|不可用|重试|稍后|错误/i.test(txt)} 重试按钮=${retry.clicked}`
})

await R.save('05-edge', s.logs)
await s.browser.close()
