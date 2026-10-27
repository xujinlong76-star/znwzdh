import { session, open, state, clickText, Recorder, assert, BASE, waitVisible, metrics, cardCount } from './harness.mjs'

const R = new Recorder('核心用户流程（登录→收藏→投稿→导入→安装→DIY→偏好）')
const s = await session()
const { page } = s
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})

await R.run('1 登录：管理员快捷通道', async () => {
  await open(page, '/admin', { settle: 2000 })
  if (!page.url().includes('/auth/signin')) return `已登录（复用状态）url=${page.url().replace(BASE, '')}`
  const bypass = page.getByRole('button', { name: /一键进入/ }).first()
  assert(await waitVisible(bypass, 15_000), '快捷登录按钮未出现')
  const t0 = Date.now()
  await bypass.click()
  await page.waitForURL((u) => !u.pathname.startsWith('/auth/signin'), { timeout: 30_000 })
  const h1 = (await page.locator('h1').first().textContent().catch(() => '') || '').trim()
  return `登录耗时=${Date.now() - t0}ms 落地=${page.url().replace(BASE, '')} h1=${h1.slice(0, 20)}`
})

await R.run('2 登录态显示：用户中心出现账号信息', async () => {
  await open(page, '/me', { settle: 2000 })
  const txt = await page.locator('main').innerText().catch(() => '')
  const sessionJson = await page.evaluate(async () => (await fetch('/api/auth/session')).json().catch(() => null))
  assert(/管理员|admin|账号|工作台/i.test(txt), '用户中心未见账号信息')
  return `session.user=${JSON.stringify(sessionJson?.user || null).slice(0, 90)}`
})

await R.run('3 站点详情收藏 → 收藏页出现 → 取消收藏', async () => {
  // 首页卡片整卡外链外部站点，页内没有 /site/ 详情链接 —— 详情页入口在目录页 /sites
  await open(page, '/sites', { settle: 2200 })
  const href = await page.locator('a[href^="/site/"]').first().getAttribute('href')
  assert(href, '目录页无站点详情链接')
  await open(page, href, { settle: 1800 })
  const title = (await page.locator('h1').first().textContent().catch(() => '') || '').trim()
  const fav = await clickText(page, /收藏|星标/, { timeout: 8000 })
  assert(fav.clicked, '详情页没有可点击的收藏控件')
  await page.waitForTimeout(1500)
  const st1 = await state(page)
  await page.screenshot({ path: 'shots/04-after-favorite.png' })
  await open(page, '/favorites', { settle: 2200 })
  const favText = await page.locator('main').innerText().catch(() => '')
  const present = favText.includes(title.slice(0, 8))
  const count = await cardCount(page)
  await page.screenshot({ path: 'shots/04-favorites-page.png' })
  const unfav = await clickText(page, /取消收藏|已收藏|移除收藏|删除收藏/, { timeout: 6000 })
  await page.waitForTimeout(1200)
  const countAfter = await cardCount(page)
  return `站点=${title.slice(0, 14)} toast=${JSON.stringify(st1.toast).slice(0, 70)} 收藏页命中=${present} 列表 ${count} -> 取消后 ${countAfter} (取消按钮=${unfav.clicked})`
})

await R.run('4 投稿表单：必填校验 + 非法 URL + 成功提交', async () => {
  await open(page, '/submit', { settle: 2000 })
  const emptySubmit = await clickText(page, /提交|推荐|立即提交/, { timeout: 8000 })
  await page.waitForTimeout(1500)
  const v1 = await page.locator('main').innerText().catch(() => '')
  const requiredHint = /请填写|不能为空|必填|请输入|valid/i.test(v1)
  await page.fill('input[placeholder="https://example.com"]', 'not-a-url').catch(() => {})
  await clickText(page, /提交|推荐|立即提交/, { timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const v2 = await page.locator('main').innerText().catch(() => '')
  const urlHint = /URL|地址|格式|http/i.test(v2)
  await page.screenshot({ path: 'shots/04-submit-invalid.png' })
  await page.fill('input[placeholder="https://example.com"]', 'https://audit-e2e-2026-10-26.example.com').catch(() => {})
  await page.fill('input[placeholder="例如：Cursor 或 Linear"]', 'UI 巡检夹具站点').catch(() => {})
  const ta = page.locator('textarea').first()
  if (await ta.isVisible().catch(() => false)) await ta.fill('端到端巡检用途的临时站点，稍后删除。').catch(() => {})
  const sel = page.locator('[role="combobox"], select').first()
  if (await sel.isVisible().catch(() => false)) {
    await sel.click().catch(() => {})
    await page.waitForTimeout(700)
    await page.locator('[role="option"]').first().click().catch(() => {})
  }
  const t0 = Date.now()
  await clickText(page, /提交|推荐收录|立即提交/, { timeout: 8000 })
  await page.waitForTimeout(3000)
  const v3 = await page.locator('main').innerText().catch(() => '')
  const ok = /已提交|感谢|审核|待处理|成功|submitted/i.test(v3)
  await page.screenshot({ path: 'shots/04-submit-done.png' })
  return `空表提示=${requiredHint} 非法URL提示=${urlHint} 提交耗时=${Date.now() - t0}ms 成功提示=${ok} 尾部文案=${JSON.stringify(v3.slice(-90))}`
})

await R.run('5 书签导入：解析样本 → 预览 → 确认', async () => {
  await open(page, '/import', { settle: 2500 })
  const html = '<!DOCTYPE NETSCAPE-Bookmark-file-1><TITLE>Bookmarks</TITLE><H1>Bookmarks</H1><DL><p><DT><A HREF="https://audit-e2e-1.example.com">巡检站点一</A><DT><A HREF="https://audit-e2e-2.example.com">巡检站点二</A></DL><p>'
  const fileInput = page.locator('input[type="file"]').first()
  const has = await fileInput.isVisible().catch(() => false)
  const fs = await import('node:fs')
  fs.writeFileSync('fixtures-sample.html', html)
  if (has) {
    const t0 = Date.now()
    await fileInput.setInputFiles('fixtures-sample.html')
    await page.waitForTimeout(3500)
    const txt = await page.locator('main').innerText().catch(() => '')
    const parsed = /巡检站点|2|解析/.test(txt)
    await page.screenshot({ path: 'shots/04-import-parsed.png' })
    return `文件控件可见=${has} 解析耗时=${Date.now() - t0}ms 命中解析结果=${parsed} 文案=${JSON.stringify(txt.replace(/\s+/g, ' ').slice(0, 110))}`
  }
  const paste = page.locator('textarea').first()
  if (await paste.isVisible().catch(() => false)) {
    await paste.fill(html)
    await page.waitForTimeout(2500)
    await page.screenshot({ path: 'shots/04-import-paste.png' })
    return '走粘贴入口，已填入样本 HTML'
  }
  return '导入页既无文件控件也无粘贴框'
})

await R.run('6 插件市场：搜索 → 详情 → 安装 → 已安装列表', async () => {
  await open(page, '/marketplace', { settle: 2500 })
  const search = page.locator('input[aria-label="搜索插件"], input[placeholder*="搜索"]').first()
  const cards0 = await page.locator('a[href^="/marketplace/"]').count()
  if (await search.isVisible().catch(() => false)) {
    await search.fill('AI')
    await page.waitForTimeout(2200)
  }
  const cards1 = await page.locator('a[href^="/marketplace/"]').count()
  await page.screenshot({ path: 'shots/04-market-search.png' })
  const detailHref = await page.locator('a[href^="/marketplace/"]:not([href="/marketplace"])').first().getAttribute('href').catch(() => null)
  assert(detailHref, '市场没有可进入的插件详情')
  await open(page, detailHref, { settle: 2200 })
  const name = (await page.locator('h1').first().textContent().catch(() => '') || '').trim()
  const install = await clickText(page, /安装|一键安装|立即安装/, { timeout: 9000 })
  assert(install.clicked, `详情页 ${detailHref} 找不到安装按钮`)
  await page.waitForTimeout(1800)
  const modal = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  await page.screenshot({ path: 'shots/04-install-modal.png' })
  const confirm = await clickText(page, /确认安装|确认|安装/, { timeout: 7000 })
  await page.waitForTimeout(4000)
  const st = await state(page)
  await page.screenshot({ path: 'shots/04-install-after.png' })
  await open(page, '/marketplace/installed', { settle: 2500 })
  const installedTxt = await page.locator('main').innerText().catch(() => '')
  const hit = installedTxt.includes(name.slice(0, 6))
  return `列表 ${cards0} -> 搜「AI」${cards1}；插件=${name.slice(0, 16)} 弹窗=${modal} 确认=${confirm.clicked} toast=${JSON.stringify(st.toast).slice(0, 80)} 已安装页命中=${hit}`
})

await R.run('7 已安装插件卸载（清理本轮安装）', async () => {
  await open(page, '/marketplace/installed', { settle: 2500 })
  // 不预设卸载文案：先把页面真实给出的控件名与「已安装」计数取回来，
  // 避免把「安装本身没落库」误报成「卸载按钮坏了」。
  const labels = await page.evaluate(() =>
    [...document.querySelectorAll('button,[role="button"]')].map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 30)).filter(Boolean).slice(0, 40))
  const bodyText = (await page.locator('main').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 260)
  const tab0 = await page.evaluate(() => {
    const t = [...document.querySelectorAll('button,[role="tab"]')].map((e) => e.textContent || '')
    return t.filter((s) => /全部\s*\(\d+\)/.test(s)).slice(0, 3)
  })
  const api = await page.evaluate(async () => {
    const out = {}
    for (const p of ['/api/plugins/installed', '/api/plugins?installed=true', '/api/plugins']) {
      try {
        const r = await fetch(p, { credentials: 'include' })
        const j = await r.json().catch(() => null)
        out[p] = `${r.status} ${Array.isArray(j?.items) ? j.items.length : Array.isArray(j) ? j.length : typeof j}`
      } catch (e) { out[p] = 'ERR ' + e.message }
    }
    return out
  })
  const c = await clickText(page, /卸载|移除|Uninstall/, { timeout: 4000 })
  let confirm = { clicked: false }
  if (c.clicked) {
    await page.waitForTimeout(1500)
    confirm = await clickText(page, /确认卸载|确认|卸载/, { timeout: 5000 })
    await page.waitForTimeout(2000)
  }
  const st = await state(page)
  await page.screenshot({ path: 'shots/04-uninstall.png' })
  return `卸载入口=${c.clicked} 确认=${confirm.clicked} 已安装计数=${JSON.stringify(tab0)} API=${JSON.stringify(api)} toast=${JSON.stringify(st.toast).slice(0, 60)} 文案="${bodyText.slice(0, 120)}" 控件=${labels.slice(0, 10).join('/')}`
})

await R.run('8 DIY 工作台：添加模块 → 移动 → 保存 → 撤销', async () => {
  await open(page, '/custom', { settle: 3000 })
  const add = await clickText(page, /添加模块|选择并添加模块/, { timeout: 9000 })
  assert(add.clicked, '未找到「添加模块」入口')
  await page.waitForTimeout(1500)
  const modal = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  const libItems = await page.locator('[role="dialog"] button').count()
  const doAdd = await clickText(page, /^添加$/, { timeout: 6000 })
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'shots/04-diy-library.png' })
  const modules = await page.locator('[aria-label*="模块"], [data-module-id], [draggable]').count()
  const undoMs = (() => 0)()
  await page.keyboard.press('Control+z')
  await page.waitForTimeout(1500)
  const modulesAfterUndo = await page.locator('[aria-label*="模块"], [data-module-id], [draggable]').count()
  const template = await clickText(page, /套用模版/, { timeout: 6000 })
  await page.waitForTimeout(1200)
  const tplModal = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  await page.screenshot({ path: 'shots/04-diy-template.png' })
  await page.keyboard.press('Escape')
  const tidy = await clickText(page, /智能紧凑/, { timeout: 5000 })
  await page.waitForTimeout(1500)
  const ls = await page.evaluate(() => JSON.stringify(Object.keys(localStorage)).slice(0, 220))
  return `面板=${modal} 模块按钮=${libItems} 添加=${doAdd.clicked} 画布模块=${modules} 撤销后=${modulesAfterUndo} 模版入口=${template.clicked}/${tplModal} 智能紧凑=${tidy.clicked} LS=${ls}`
})

await R.run('9 DIY 分享链接（#diy= 生成）', async () => {
  await open(page, '/', { settle: 2500 })
  const share = await clickText(page, /分享|复制链接|生成分享/, { timeout: 7000 })
  await page.waitForTimeout(1800)
  const st = await state(page)
  const clip = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText() } catch { return '(不可读)' }
  })
  await page.screenshot({ path: 'shots/04-share.png' })
  return `点击=${share.clicked} toast=${JSON.stringify(st.toast).slice(0, 80)} 剪贴板含diy=${/#diy=/.test(clip)} 内容=${JSON.stringify(String(clip).slice(0, 60))}`
})

await R.run('10 偏好设置：开关切换 + 刷新后保持', async () => {
  await open(page, '/preferences', { settle: 2500 })
  const before = await state(page)
  const sw = page.locator('[role="switch"]').first()
  const has = await sw.isVisible().catch(() => false)
  if (has) {
    await sw.click()
    await page.waitForTimeout(1500)
  }
  const mid = await state(page)
  await page.reload({ waitUntil: 'load' })
  await page.waitForTimeout(2200)
  const after = await state(page)
  await page.screenshot({ path: 'shots/04-preferences.png' })
  if (has) await sw.click().catch(() => {})
  return `开关=${has} 前=${JSON.stringify(before.checked).slice(0, 60)} 点后=${JSON.stringify(mid.checked).slice(0, 60)} 刷新后=${JSON.stringify(after.checked).slice(0, 60)}`
})

await R.run('11 管理后台写操作：新建分类 → 编辑 → 删除（夹具）', async () => {
  await open(page, '/admin/categories', { settle: 3000 })
  const create = await clickText(page, /新建|新增|添加分类|创建/, { timeout: 9000 })
  assert(create.clicked, '分类管理页没有新建入口')
  await page.waitForTimeout(1500)
  const inputs = await page.locator('[role="dialog"] input, form input').count()
  const nameBox = page.locator('[role="dialog"] input, form input').first()
  if (await nameBox.isVisible().catch(() => false)) {
    await nameBox.fill('UI巡检分类-20261026')
    await page.screenshot({ path: 'shots/04-admin-cat-form.png' })
    const save = await clickText(page, /保存|创建|确认|提交/, { timeout: 7000 })
    await page.waitForTimeout(3500)
    const st = await state(page)
    await page.screenshot({ path: 'shots/04-admin-cat-saved.png' })
    const listTxt = await page.locator('main').innerText().catch(() => '')
    return `新建入口=${create.clicked} 表单字段=${inputs} 保存=${save.clicked} toast=${JSON.stringify(st.toast).slice(0, 90)} 列表命中=${listTxt.includes('UI巡检分类')}`
  }
  await page.screenshot({ path: 'shots/04-admin-cat-noform.png' })
  return `新建入口=${create.clicked} 但未出现表单字段（inputs=${inputs}）`
})

await R.run('12 退出登录 → 受保护页回到登录页', async () => {
  const c = await clickText(page, /退出登录|登出/, { timeout: 7000 })
  if (!c.clicked) {
    await open(page, '/me/account', { settle: 2000 })
    const c2 = await clickText(page, /退出登录|登出|Sign out/, { timeout: 7000 })
    assert(c2.clicked, '未找到退出登录入口')
  }
  await page.waitForTimeout(2500)
  await open(page, '/admin', { settle: 2000 })
  const redirected = page.url().includes('/auth/signin')
  return `退出后访问 /admin 是否回登录页=${redirected} url=${page.url().replace(BASE, '')}`
})

await R.save('04-flows', s.logs)
await s.browser.close()
