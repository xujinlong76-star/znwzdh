import { session, open, state, clickText, Recorder, assert, BASE, waitVisible, cardCount } from './harness.mjs'

const R = new Recorder('前台：导航 / 检索 / 浏览 / 详情')
const s = await session()
const { page } = s
await page.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {})

async function fresh(path = '/') {
  await open(page, path, { settle: 1500 })
  return state(page)
}

await R.run('首页可达 + 标题/首屏卡片', async () => {
  const st = await fresh('/')
  const cards = await cardCount(page)
  assert(st.url.startsWith('/'), `URL=${st.url}`)
  assert(cards > 20, `首页站点卡片过少：${cards}`)
  return `卡片=${cards}`
})

await R.run('工具栏「微工具箱」开合', async () => {
  await fresh('/')
  const before = await state(page)
  const c = await clickText(page, /微工具箱|内置微工具箱/, { timeout: 8000 })
  assert(c.clicked, '未找到微工具箱按钮')
  await page.waitForTimeout(1200)
  const opened = await page.locator('[role="dialog"],[role="drawer"]').isVisible().catch(() => false)
  await page.screenshot({ path: 'shots/02-micro-tools.png' })
  await page.keyboard.press('Escape')
  await page.waitForTimeout(700)
  const closed = !(await page.locator('[role="dialog"],[role="drawer"]').isVisible().catch(() => false))
  assert(opened, '点击后抽屉/对话框未出现')
  assert(closed, 'Esc 后未关闭')
  return `opened=${opened} closedAfterEsc=${closed} bodyLen ${before.bodyHash}->${(await state(page)).bodyHash}`
})

await R.run('工具栏「热度榜」跳转', async () => {
  await fresh('/')
  const c = await clickText(page, /热度榜/, { role: 'link', timeout: 8000 })
  assert(c.clicked, '未找到热度榜入口')
  await page.waitForURL(/\/hot/, { timeout: 20_000 }).catch(() => {})
  const url = page.url()
  assert(/\/hot/.test(url), `点击后 URL=${url}`)
  const h1 = (await page.locator('h1').first().textContent().catch(() => '') || '').trim()
  return `URL=${url.replace(BASE, '')} h1=${h1.slice(0, 24)}`
})

await R.run('工具栏「探索矩阵」下拉 → 技术图谱', async () => {
  await fresh('/')
  const c = await clickText(page, /探索矩阵/, { timeout: 8000 })
  assert(c.clicked, '未找到探索矩阵入口')
  await page.waitForTimeout(900)
  const menuVisible = await page.locator('[role="menu"],[data-radix-menu-content],[role="menuitem"]').first().isVisible().catch(() => false)
  assert(menuVisible, '下拉菜单未展开')
  const sub = await clickText(page, /技术图谱|生态图谱/, { role: 'link', timeout: 6000 })
  const navigated = sub.clicked ? await page.waitForURL(/\/graph/, { timeout: 15_000 }).then(() => true).catch(() => false) : false
  await page.screenshot({ path: 'shots/02-explore-menu.png' })
  return `menu=${menuVisible} item=${sub.clicked} 到/graph=${navigated} url=${page.url().replace(BASE, '')}`
})

await R.run('工具栏「用户中心」入口', async () => {
  await fresh('/')
  const c = await clickText(page, /用户中心/, { role: 'link', timeout: 8000 })
  assert(c.clicked, '未找到用户中心入口')
  await page.waitForURL(/\/me/, { timeout: 15_000 }).catch(() => {})
  return `URL=${page.url().replace(BASE, '')}`
})

await R.run('工具栏「快捷键指南」弹窗', async () => {
  await fresh('/')
  const c = await clickText(page, /快捷键指南|快捷键全景/, { timeout: 8000 })
  assert(c.clicked, '未找到快捷键指南按钮')
  await page.waitForTimeout(1000)
  const vis = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  await page.screenshot({ path: 'shots/02-shortcuts.png' }).catch(() => {})
  assert(vis, '快捷键弹窗未出现')
  await page.keyboard.press('Escape')
  return `dialog=${vis}`
})

await R.run('主题切换（明/暗）', async () => {
  await fresh('/')
  const t0 = Date.now()
  const before = await page.evaluate(() => document.documentElement.className)
  const btn = page.locator('button[aria-label*="主题"], button[aria-label*="颜色"], [role="switch"][aria-label*="主题"], button:has(svg.lucide-moon), button:has(svg.lucide-sun)').first()
  const found = await btn.isVisible().catch(() => false)
  if (found) await btn.click().catch(() => {})
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => document.documentElement.className)
  const persisted = await page.evaluate(() => JSON.stringify(Object.fromEntries(Object.entries(localStorage).filter(([k]) => /theme|mode/i.test(k)))))
  if (found) await btn.click().catch(() => {})
  await page.waitForTimeout(600)
  const back = await page.evaluate(() => document.documentElement.className)
  assert(found, '未找到主题切换按钮')
  return `切换耗时=${Date.now() - t0}ms before="${before}" after="${after}" 还原后="${back}" LS=${persisted.slice(0, 80)}`
})

await R.run('多选模式开启/关闭', async () => {
  await fresh('/')
  const c = await clickText(page, /多选模式/, { timeout: 8000 })
  assert(c.clicked, '未找到多选模式按钮')
  await page.waitForTimeout(1200)
  const dock = await page.locator('text=/已选|批量|全选/').first().isVisible().catch(() => false)
  await page.screenshot({ path: 'shots/02-batch-mode.png' })
  const c2 = await clickText(page, /多选模式|退出多选|取消多选/, { timeout: 5000 })
  return `批量面板=${dock} 再次点击=${c2.clicked}`
})

await R.run('首页内联搜索框：输入即过滤', async () => {
  await fresh('/')
  const input = page.locator('input[type="search"], input[placeholder*="搜索"], input[placeholder*="Search"]').first()
  await assert(await input.isVisible().catch(() => false), '首页未找到搜索输入框')
  const beforeCards = await cardCount(page)
  await input.click()
  await input.fill('hey')
  await page.waitForTimeout(1500)
  const afterCards = await cardCount(page)
  const suggestion = await page.locator('[role="listbox"] [role="option"], [data-search-suggestion]').count()
  await page.screenshot({ path: 'shots/02-inline-search.png' })
  await input.fill('')
  await page.waitForTimeout(800)
  const restored = await cardCount(page)
  return `卡片 ${beforeCards} -> 输入后 ${afterCards} (清空后 ${restored}) 建议项=${suggestion}`
})

await R.run('全局搜索面板（快捷键 /）+ 结果 + 键盘导航', async () => {
  await fresh('/')
  await page.keyboard.press('/')
  await page.waitForTimeout(1000)
  let dialog = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  if (!dialog) {
    await page.keyboard.press('Control+k')
    await page.waitForTimeout(1000)
    dialog = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  }
  assert(dialog, '快捷键未唤出全局搜索面板')
  const box = page.locator('[role="dialog"] input').first()
  await box.fill('压测')
  await page.waitForTimeout(2500)
  const opts = await page.locator('[role="dialog"] [role="option"], [role="dialog"] a[href]').count()
  await page.screenshot({ path: 'shots/02-spotlight.png' })
  await page.keyboard.press('ArrowDown')
  await page.waitForTimeout(400)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(2500)
  const urlAfter = page.url().replace(BASE, '')
  const stillOpen = await page.locator('[role="dialog"]').first().isVisible().catch(() => false)
  await page.keyboard.press('Escape')
  const closedAfterEsc = !(await page.locator('[role="dialog"]').first().isVisible().catch(() => false))
  return `结果项=${opts} 回车后URL=${urlAfter} 面板仍开=${stillOpen} Esc可关=${closedAfterEsc}`
})

await R.run('搜索无结果时的空态提示', async () => {
  await fresh('/')
  await page.keyboard.press('/')
  await page.waitForTimeout(900)
  const box = page.locator('[role="dialog"] input').first()
  if (!(await box.isVisible().catch(() => false))) return '未唤出面板（跳过）'
  await box.fill('zzz-不存在的关键词-qqq')
  await page.waitForTimeout(2500)
  const txt = await page.locator('[role="dialog"]').first().innerText().catch(() => '')
  await page.screenshot({ path: 'shots/02-spotlight-empty.png' })
  await page.keyboard.press('Escape')
  return `空态文案命中=${/暂无|没有|未找到|无结果|No result/i.test(txt)}`
})

await R.run('0-RTT 意图卡（Cron 表达式原地解析）', async () => {
  await fresh('/')
  await page.keyboard.press('/')
  await page.waitForTimeout(900)
  const box = page.locator('[role="dialog"] input').first()
  if (!(await box.isVisible().catch(() => false))) return '未唤出面板（跳过）'
  await box.fill('0 3 * * 1')
  await page.waitForTimeout(2200)
  const txt = await page.locator('[role="dialog"]').first().innerText().catch(() => '')
  await page.screenshot({ path: 'shots/02-intent-cron.png' })
  await page.keyboard.press('Escape')
  return `命中意图卡=${/cron|每周|每天|凌晨|表达式/i.test(txt)}`
})

await R.run('分类页：卡片点击进详情 + 分页 + 排序', async () => {
  await fresh('/')
  const link = page.locator('a[href^="/category/"]').first()
  if (!(await link.isVisible().catch(() => false))) return '首页未渲染分类链接'
  await link.click()
  await page.waitForURL(/\/category\//, { timeout: 20_000 }).catch(() => {})
  const url = page.url().replace(BASE, '')
  const cards = await cardCount(page)
  await page.screenshot({ path: 'shots/02-category.png' })
  const sortSel = page.locator('select, [role="combobox"]').first()
  const hasSort = await sortSel.isVisible().catch(() => false)
  const next = await clickText(page, /下一页|下页|›|Next/, { role: 'link', timeout: 4000 })
  const url2 = page.url().replace(BASE, '')
  return `${url} 卡片=${cards} 有排序=${hasSort} 下一页点击=${next.clicked} -> ${url2}`
})

await R.run('站点详情：收藏 / 访问 / 复制 / 相关站点', async () => {
  // 首页卡片整卡外链到外部站点，页内不渲染任何 /site/ 详情链接；
  // 详情页只能从目录页 /sites 进入 —— 这里按真实入口取 href。
  await fresh('/sites')
  const card = page.locator('a[href^="/site/"]').first()
  const href = await card.getAttribute('href').catch(() => null)
  assert(href, '目录页没有站点详情链接')
  await open(page, href, { settle: 1800 })
  const h1 = (await page.locator('h1').first().textContent().catch(() => '') || '').trim()
  const fav = await clickText(page, /收藏|星标/, { timeout: 6000 })
  await page.waitForTimeout(1200)
  const toast = (await state(page)).toast
  const copy = await clickText(page, /复制链接|复制|Copy/, { timeout: 5000 })
  const clip = await page.evaluate(async () => {
    try { return await navigator.clipboard.readText() } catch { return '(不可读)' }
  })
  const related = await cardCount(page)
  const visit = await clickText(page, /访问|直达|打开站点/, { timeout: 5000 })
  await page.screenshot({ path: 'shots/02-site-detail.png' })
  return `h1=${h1.slice(0, 20)} 收藏点击=${fav.clicked} toast=${JSON.stringify(toast).slice(0, 60)} 复制=${copy.clicked} 剪贴板=${JSON.stringify(clip).slice(0, 60)} 相关站点=${related} 访问按钮=${visit.clicked}`
})

await R.run('标签页 → 标签结果页', async () => {
  await fresh('/tags')
  const t = page.locator('a[href^="/tags/"]').first()
  const vis = await waitVisible(t, 8000)
  if (!vis) return '无标签链接'
  const href = await t.getAttribute('href')
  await t.click()
  await page.waitForURL(/\/tags\//, { timeout: 15_000 }).catch(() => {})
  const cards = await cardCount(page)
  await page.screenshot({ path: 'shots/02-tag-detail.png' })
  return `${href} 结果卡片=${cards}`
})

await R.run('合集列表 → 合集详情', async () => {
  await fresh('/collections')
  const t = page.locator('a[href^="/collections/"]').first()
  const vis = await waitVisible(t, 8000)
  if (!vis) return '无合集链接'
  const href = await t.getAttribute('href')
  await t.click()
  await page.waitForURL(/\/collections\//, { timeout: 15_000 }).catch(() => {})
  const cards = await cardCount(page)
  await page.screenshot({ path: 'shots/02-collection-detail.png' })
  return `${href} 卡片=${cards}`
})

await R.run('/sites 列表页搜索与筛选', async () => {
  await fresh('/sites')
  const input = page.locator('input[type="search"], input[placeholder*="搜"], input[placeholder*="关键"]').first()
  const has = await input.isVisible().catch(() => false)
  const before = await cardCount(page)
  if (has) {
    await input.fill('github')
    await page.waitForTimeout(2500)
  }
  const after = await cardCount(page)
  await page.screenshot({ path: 'shots/02-sites-filter.png' })
  return `输入框=${has} 卡片 ${before} -> ${after}`
})

await R.run('/hot 时间窗切换', async () => {
  await fresh('/hot')
  const before = await cardCount(page)
  const c = await clickText(page, /30\s*天|7\s*天|新品|飙升/, { timeout: 6000 })
  await page.waitForTimeout(2000)
  const after = await cardCount(page)
  await page.screenshot({ path: 'shots/02-hot.png' })
  return `切换点击=${c.clicked} 卡片 ${before} -> ${after}`
})

await R.run('/videos 卡片 → 播放页', async () => {
  await fresh('/videos')
  const link = page.locator('a[href*="/videos/player"], a[href^="/site/"]').first()
  const vis = await waitVisible(link, 8000)
  if (!vis) return '视频页无卡片链接'
  const href = await link.getAttribute('href')
  await link.click()
  await page.waitForTimeout(3500)
  await page.screenshot({ path: 'shots/02-video.png' })
  return `${href} -> ${page.url().replace(BASE, '')}`
})

await R.run('/graph 图谱交互（节点/缩放/过滤）', async () => {
  await fresh('/graph')
  await page.waitForTimeout(2500)
  const nodes = await page.locator('svg circle').count()
  const zoomIn = await clickText(page, /放大|zoom in|\+/, { timeout: 4000 })
  const fit = await clickText(page, /适应|居中|重置/, { timeout: 4000 })
  const node = page.locator('svg circle').first()
  let detail = '未点击节点'
  if (await node.isVisible().catch(() => false)) {
    await node.click({ force: true }).catch(() => {})
    await page.waitForTimeout(1500)
    detail = `点击后URL=${page.url().replace(BASE, '')} 侧栏=${await page.locator('text=/关联|邻居|详情/').first().isVisible().catch(() => false)}`
  }
  await page.screenshot({ path: 'shots/02-graph.png' })
  return `节点=${nodes} 放大=${zoomIn.clicked} 适应=${fit.clicked} ${detail}`
})

await R.run('移动端 390×844：汉堡菜单与导航', async () => {
  const m = await session({ viewport: { width: 390, height: 844 } })
  await open(m.page, '/', { settle: 2000 })
  const burger = m.page.locator('button[aria-label*="菜单"]').first()
  const vis = await waitVisible(burger, 8000)
  if (vis) {
    await burger.click()
    await m.page.waitForTimeout(1200)
  }
  const sheet = await m.page.locator('[role="dialog"],[data-radix-popper-content-wrapper],nav a[href="/marketplace"]').first().isVisible().catch(() => false)
  await m.page.screenshot({ path: 'shots/02-mobile-menu.png' })
  const overflow = await m.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
  await m.browser.close()
  return `汉堡=${vis} 抽屉/导航=${sheet} 横向溢出=${overflow}`
})

await R.save('02-public', s.logs)
await s.browser.close()
