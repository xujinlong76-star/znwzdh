/**
 * 三页 UI 验收：真实 Chrome、1440 / 768 双视口，结构 + 交互 + 截图证据。
 *
 * 用法（需先起 web 与 api 两个服务）：
 *   node scripts/verify-ui-acceptance.cjs
 *   NAVHUB_BASE_URL=http://localhost:3100 NAVHUB_SHOT_DIR=./.verify-shots node scripts/verify-ui-acceptance.cjs
 *
 * 断言全部在运行时从页面自身派生（不写死站点数 / 插件数），退出码非 0 即代表有失败项。
 */
const { chromium } = require('@playwright/test')
const fs = require('node:fs')

const BASE = process.env.NAVHUB_BASE_URL || 'http://localhost:3000'
const OUT = process.env.NAVHUB_SHOT_DIR || 'C:/Users/88/Desktop/web'
const CHROME = process.env.NAVHUB_CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const result = { home: {}, marketplace: {}, import: {}, layout: {}, failures: [] }
const fail = (scope, msg) => { result.failures.push(`${scope}: ${msg}`) }

async function baseAudit(page, route, scope) {
  const data = await page.evaluate(() => {
    const doc = document.documentElement
    const viewportW = window.innerWidth
    const overflowing = []
    const clippedByAncestor = (el) => {
      let p = el.parentElement
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX
        if (ox === 'hidden' || ox === 'auto' || ox === 'scroll' || ox === 'clip') return true
        p = p.parentElement
      }
      return false
    }
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width < 2 || r.height < 2) continue
      if (getComputedStyle(el).position === 'fixed') continue
      if (r.right > viewportW + 1.5 && !clippedByAncestor(el)) {
        overflowing.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 70), right: Math.round(r.right) })
      }
    }
    const unlabeledIconButtons = Array.from(document.querySelectorAll('button')).filter((b) => {
      // content-visibility:auto 的子树 innerText 为空，但 textContent 仍参与无障碍名称计算
      const text = (b.textContent || '').trim()
      const r = b.getBoundingClientRect()
      if (text || !b.querySelector('svg') || r.width === 0) return false
      return !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby') && !b.getAttribute('title')
    }).length
    return {
      title: document.title,
      overflowX: doc.scrollWidth - doc.clientWidth,
      overflowing: overflowing.slice(0, 6),
      emptyAnchors: document.querySelectorAll('a:empty').length,
      unlabeledIconButtons,
      contentVisibility: Array.from(document.querySelectorAll('body *')).filter((el) => getComputedStyle(el).contentVisibility === 'auto').length,
      cardFlow: (() => {
        const link = document.querySelector('a[href*="://"]')
        return link ? link.getBoundingClientRect().width > 0 : null
      })(),
    }
  })
  result[scope] = { ...result[scope], ...data }
  if (data.overflowX > 1) fail(scope, `横向溢出 ${data.overflowX}px`)
  if (data.overflowing.length) fail(scope, `越界元素 ${JSON.stringify(data.overflowing)}`)
  if (data.emptyAnchors > 0) fail(scope, `空锚点 ${data.emptyAnchors} 个`)
  if (data.unlabeledIconButtons > 0) fail(scope, `无名称图标按钮 ${data.unlabeledIconButtons} 个`)
  return data
}

;(async () => {
  // 优先用本机 Chrome（Windows 默认路径），不存在时回退 Playwright 自带 Chromium。
  // --no-proxy-server：本机验收必须直连，系统代理会把 localhost 也转发出去并回 502。
  const launchOptions = { headless: true, args: ['--no-sandbox', '--no-proxy-server'] }
  if (CHROME && fs.existsSync(CHROME)) launchOptions.executablePath = CHROME
  const browser = await chromium.launch(launchOptions)
  fs.mkdirSync(OUT, { recursive: true })

  for (const width of [1440, 768]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } })
    const page = await ctx.newPage()
    const runtimeErrors = []
    page.on('pageerror', (e) => runtimeErrors.push('pageerror: ' + e.message))
    page.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (/Failed to load resource|favicon|502|503/.test(t)) return
      runtimeErrors.push('console: ' + t.slice(0, 200))
    })

    // ---------- 首页 ----------
    let resp = await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await page.waitForTimeout(2500)
    await baseAudit(page, '/', 'home')
    result.home.status = resp.status()
    const home = await page.evaluate(() => {
      // 占位文案会调整（如「搜索导航…（中文 / 拼音 / 语义）」→「搜索站点、标签或拼音…」），
      // 用包含匹配而不是前缀匹配，避免文案一改就静默返回 null 造成假通过。
      const input = document.querySelector('input[placeholder*="搜索"]')
      const box = input?.closest('div')
      const kbd = box?.querySelector('kbd')
      const ir = input?.getBoundingClientRect()
      const kr = kbd?.getBoundingClientRect()
      const pad = input ? parseFloat(getComputedStyle(input).paddingInlineEnd || '0') : null
      return {
        paddingEnd: pad,
        contentRight: ir ? ir.right - (pad || 0) : null,
        badgeLeft: kr ? kr.left : null,
        placeholderSafe: ir && kr ? ir.right - (pad || 0) <= kr.left + 1 : null,
        searchWidth: ir ? Math.round(ir.width) : null,
      }
    })
    result.home.search = home
    if (home.placeholderSafe === null) fail('home', '找不到搜索框或快捷键徽标，无法验证占位安全区')
    if (home.placeholderSafe === false) fail('home', `搜索占位区被徽章压住 (contentRight=${home.contentRight}, badgeLeft=${home.badgeLeft})`)

    // 徽章由 WorkspaceSwitcher 的 useEffect → fetchWorkspaces() 异步拉回后渲染，
    // 直接 evaluate 会和这个请求抢跑（dev 冷编译慢时反而「刚好赶上」，属于假通过）。
    // 先等它出现，再断言布局，超时才判失败。
    await page
      .waitForFunction(
        () =>
          Array.from(document.querySelectorAll('span, div, p, li')).some(
            (el) => (el.textContent || '').trim() === '空间所有者',
          ),
        null,
        { timeout: 10_000 },
      )
      .catch(() => {})

    const badge = await page.evaluate(() => {
      // 徽章是 <div>（shadcn Badge），早期脚本只查 <span> 会得到 null 而静默跳过断言
      const all = Array.from(document.querySelectorAll('span, div, p, li')).filter(
        (el) => (el.textContent || '').trim() === '空间所有者',
      )
      if (!all.length) return null
      // 角色文字可能收进 `hidden min-[1680px]:inline` 的 span（窄屏只显示皇冠图标），
      // 那个 span 不参与 flex 布局；真正承载「不换行 / 不压缩」职责的是外层 Badge。
      // 取 Badge 容器断言，否则会把继承默认 flex-shrink:1 的文本节点误判成回归。
      const inner = all.find((el) => /rounded-full/.test((el.className || '').toString()))
        ?? all.reduce((a, b) => (b.children.length < a.children.length ? b : a))
      const host = inner.parentElement
      const box = (el) => {
        const r = el.getBoundingClientRect()
        return { right: Math.round(r.right), width: Math.round(r.width) }
      }
      return {
        tag: inner.tagName.toLowerCase(),
        clipped: inner.scrollWidth > inner.clientWidth + 1,
        hostClipped: host ? host.scrollWidth > host.clientWidth + 1 : null,
        whiteSpace: getComputedStyle(inner).whiteSpace,
        flexShrink: getComputedStyle(inner).flexShrink,
        insideHost: host ? box(inner).right <= box(host).right + 1 : null,
      }
    })
    result.home.ownerBadge = badge
    if (!badge) fail('home', '等待 10s 后仍找不到「空间所有者」徽章（WorkspaceSwitcher 未渲染或接口无数据）')
    if (badge?.clipped || badge?.hostClipped) fail('home', `空间所有者徽章被裁切 ${JSON.stringify(badge)}`)
    if (badge && badge.insideHost === false) fail('home', `空间所有者徽章溢出容器 ${JSON.stringify(badge)}`)
    if (badge && badge.whiteSpace !== 'nowrap') fail('home', `空间所有者徽章允许换行 ${badge.whiteSpace}`)
    if (badge && badge.flexShrink !== '0') fail('home', `空间所有者徽章会被压缩 flex-shrink=${badge.flexShrink}`)

    const padBottom = await page.evaluate(() => {
      // 内容容器（pb-28 sm:pb-36）给右下悬浮工具栏留出的安全区
      const el = document.querySelector('.pb-28') || document.querySelector('[class*="pb-28"]')
      return el ? parseFloat(getComputedStyle(el).paddingBottom || '0') : null
    })
    result.home.mainPaddingBottom = padBottom
    if (padBottom !== null && padBottom < 60) fail('home', `主容器底部预留不足 ${padBottom}px`)

    result.home.runtimeErrors = runtimeErrors.slice(0, 5)
    if (runtimeErrors.length) fail('home', `运行时错误 ${runtimeErrors.slice(0, 3).join(' | ')}`)
    await page.screenshot({ path: `${OUT}/verify-home-${width}.png`, fullPage: false })
    await ctx.close()

    // ---------- 插件市场 ----------
    const ctx2 = await browser.newContext({ viewport: { width, height: 900 } })
    const mp = await ctx2.newPage()
    const mpErrors = []
    mp.on('pageerror', (e) => mpErrors.push('pageerror: ' + e.message))
    mp.on('console', (m) => {
      if (m.type() !== 'error') return
      const t = m.text()
      if (/Failed to load resource|favicon|502|503/.test(t)) return
      mpErrors.push('console: ' + t.slice(0, 200))
    })
    resp = await mp.goto(BASE + '/marketplace', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await mp.waitForTimeout(2500)
    await baseAudit(mp, '/marketplace', 'marketplace')
    result.marketplace.status = resp.status()
    const market = await mp.evaluate(() => {
      const text = document.body.innerText
      return {
        backHome: text.includes('返回首页'),
        duplicateBreadcrumb: text.includes('首页 / 插件市场'),
        zeroInstalls: (text.match(/0 次安装/g) || []).length,
        noReviews: (text.match(/暂无评价/g) || []).length,
        swatches: document.querySelectorAll('[data-theme-swatch]').length,
        cards: document.querySelectorAll('a[href^="/marketplace/"]').length,
        totalLabel: (text.match(/共 (\d+) 个插件/) || [])[1] || null,
        truncatedTitles: Array.from(document.querySelectorAll('a[href^="/marketplace/"]')).filter((a) => /\.\.\.$/.test((a.innerText || '').trim())).length,
      }
    })
    result.marketplace.content = market
    if (!market.backHome) fail('marketplace', '缺少返回首页入口')
    if (market.duplicateBreadcrumb) fail('marketplace', '仍有双层面包屑')
    if (market.zeroInstalls || market.noReviews) fail('marketplace', `冷启动空文案残留 0安装=${market.zeroInstalls} 无评价=${market.noReviews}`)
    if (market.swatches === 0) fail('marketplace', '主题卡没有色板圆点')

    // 榜单互斥
    const trendingBtn = mp.getByRole('button', { name: /飙升榜/ }).first()
    const allTopicBtn = mp.getByRole('button', { name: /^全部插件$/ }).first()
    if (await trendingBtn.count()) {
      await trendingBtn.click()
      await mp.waitForTimeout(500)
      const afterTrend = await mp.evaluate(() => ({
        pressed: Array.from(document.querySelectorAll('button[aria-pressed="true"]')).map((b) => (b.innerText || '').trim()),
        total: (document.body.innerText.match(/共 (\d+) 个插件/) || [])[1] || null,
      }))
      result.marketplace.trending = afterTrend
      if (afterTrend.pressed.length > 1) fail('marketplace', `榜单非互斥 ${JSON.stringify(afterTrend.pressed)}`)
      if (await allTopicBtn.count()) {
        await allTopicBtn.click()
        await mp.waitForTimeout(400)
        const restored = await mp.evaluate(() => (document.body.innerText.match(/共 (\d+) 个插件/) || [])[1] || null)
        result.marketplace.restoredTotal = restored
        if (market.totalLabel && restored && Number(restored) < Number(market.totalLabel)) fail('marketplace', `返回全部后数量异常 ${restored} < ${market.totalLabel}`)
      }
    } else {
      fail('marketplace', '找不到「飙升榜」按钮')
    }

    // 150ms 防抖即时筛选
    const search = mp.getByLabel('搜索插件')
    const baselineTotal = Number(market.totalLabel || 0)
    await search.fill('mcp')
    // 150ms 防抖 + 真实网络往返：等「共 N 个」真的变小，而不是等一个固定时长
    await mp.waitForFunction((baseline) => {
      const m = document.body.innerText.match(/共 (\d+) 个插件/)
      return m && Number(m[1]) < baseline
    }, baselineTotal, { timeout: 8000 }).catch(() => {})
    const filtered = await mp.evaluate(() => {
      const t = document.body.innerText
      return { total: (t.match(/共 (\d+) 个插件/) || [])[1] || null, url: location.search, cards: document.querySelectorAll('a[href^="/marketplace/"]').length }
    })
    result.marketplace.filtered = filtered
    if (!filtered.total || Number(filtered.total) >= baselineTotal) fail('marketplace', `搜索未生效 ${JSON.stringify(filtered)}`)
    await search.fill('')
    await mp.waitForFunction((baseline) => (document.body.innerText.match(/共 (\d+) 个插件/) || [])[1] === String(baseline), baselineTotal, { timeout: 8000 }).catch(() => {})
    const restoredAfterClear = await mp.evaluate(() => (document.body.innerText.match(/共 (\d+) 个插件/) || [])[1] || null)
    result.marketplace.restoredAfterClear = restoredAfterClear
    if (baselineTotal && Number(restoredAfterClear) !== baselineTotal) fail('marketplace', `清空搜索后未恢复全量 ${restoredAfterClear} ≠ ${baselineTotal}`)

    result.marketplace.runtimeErrors = mpErrors.slice(0, 5)
    if (mpErrors.length) fail('marketplace', `运行时错误 ${mpErrors.slice(0, 3).join(' | ')}`)
    await mp.screenshot({ path: `${OUT}/verify-marketplace-${width}.png`, fullPage: false })
    await ctx2.close()

    // ---------- 书签导入 ----------
    const ctx3 = await browser.newContext({ viewport: { width, height: 900 } })
    const im = await ctx3.newPage()
    const imErrors = []
    im.on('pageerror', (e) => imErrors.push('pageerror: ' + e.message))
    im.on('console', (m) => {
      if (m.type() !== 'error') return
      if (/Failed to load resource|favicon|502|503/.test(m.text())) return
      imErrors.push('console: ' + m.text().slice(0, 200))
    })
    resp = await im.goto(BASE + '/import', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await im.waitForTimeout(1500)
    await baseAudit(im, '/import', 'import')
    result.import.status = resp.status()
    const layout = await im.evaluate(() => {
      const pills = ['纯前端本地解析', '启发式自动归类', '零外泄隐私保护'].map((t) =>
        Array.from(document.querySelectorAll('span')).find((s) => s.textContent?.trim() === t),
      )
      const tops = pills.map((p) => (p ? Math.round(p.getBoundingClientRect().top) : null))
      const fileInput = document.querySelector('input[type=file]')
      return {
        pillTops: tops,
        pillsInline: tops.every((t) => t !== null) && Math.max(...tops) - Math.min(...tops) <= 2,
        fileInputHidden: fileInput ? fileInput.className.includes('sr-only') : null,
        nativeFileText: document.body.innerText.includes('未选择任何文件'),
        tabs: Array.from(document.querySelectorAll('[aria-label="导入目标模式"] [role=tab]')).map((t) => (t.textContent || '').trim()),
      }
    })
    result.import.layout = layout
    if (!layout.pillsInline) fail('import', `Hero 胶囊未水平排列 ${JSON.stringify(layout.pillTops)}`)
    if (layout.fileInputHidden === false) fail('import', '原生 file input 没有 sr-only')
    if (layout.nativeFileText) fail('import', '页面出现「未选择任何文件」原生文本')
    if (layout.tabs.length !== 3) fail('import', `模式切换应有 3 个 Tab，实际 ${layout.tabs.length}`)

    // 解析性能：页面内 MutationObserver 计时
    await im.evaluate(() => {
      window.__t0 = performance.now()
      window.__dt = null
      const obs = new MutationObserver(() => {
        if (document.body.innerText.includes('解析出 20 个书签')) {
          window.__dt = Math.round(performance.now() - window.__t0)
          obs.disconnect()
        }
      })
      obs.observe(document.body, { subtree: true, childList: true, characterData: true })
    })
    await im.getByRole('button', { name: /加载示例书签体验解析/ }).click()
    await im.getByText('解析出 20 个书签').waitFor({ timeout: 15000 })
    await im.waitForTimeout(200)
    const staging = await im.evaluate(() => {
      const text = document.body.innerText
      const counts = {}
      for (const key of ['可投稿', '已收录', '隐私拦截']) {
        const m = text.match(new RegExp(key + ' (\\d+)'))
        counts[key] = m ? Number(m[1]) : null
      }
      const rows = document.querySelectorAll('[role=row]').length
      const privateBadge = Array.from(document.querySelectorAll('[role=row]')).find((r) => (r.textContent || '').includes('隐私内网已拦截'))
      const publicBox = privateBadge?.querySelector('input[aria-label*="提交至公共导航库"]')
      const options = document.querySelectorAll('select[aria-label^="为「"] option').length
      return {
        renderMs: window.__dt,
        counts,
        rows,
        options,
        privateLocked: publicBox ? publicBox.disabled : null,
        url: location.pathname,
      }
    })
    result.import.staging = staging
    if (!staging.rows) fail('import', '示例解析没有渲染预览行')
    if (!staging.counts['可投稿'] || !staging.counts['已收录'] || !staging.counts['隐私拦截']) fail('import', `三类状态不全 ${JSON.stringify(staging.counts)}`)
    if (staging.privateLocked !== true) fail('import', '隐私行的公共投稿没有被锁定')
    if (staging.renderMs === null) fail('import', '未测得解析渲染耗时')
    if (staging.url !== '/import') fail('import', `发生了跳转 ${staging.url}`)

    // 模式切换：仅个人收藏夹
    const privateTab = im.getByRole('tab', { name: /仅个人收藏夹/ })
    if (await privateTab.count()) {
      await privateTab.click()
      await im.waitForTimeout(250)
      const modeState = await im.evaluate(() => ({
        selected: Array.from(document.querySelectorAll('[aria-label="导入目标模式"] [role=tab]')).filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => (t.textContent || '').trim()),
        url: location.pathname,
      }))
      result.import.privateMode = modeState
      if (modeState.selected.length !== 1 || !modeState.selected[0].includes('仅个人收藏夹')) fail('import', `模式切换异常 ${JSON.stringify(modeState)}`)
      if (modeState.url !== '/import') fail('import', `切换模式发生跳转 ${modeState.url}`)
      // 私有模式：公共投稿必须锁死
      const privateLock = await im.evaluate(() => {
        const row = document.querySelector('[role=row]')
        return {
          publicDisabled: row?.querySelector('input[aria-label*="提交至公共导航库"]')?.disabled ?? null,
          privateDisabled: row?.querySelector('input[aria-label*="存入个人收藏"]')?.disabled ?? null,
        }
      })
      result.import.privateLock = privateLock
      if (privateLock.publicDisabled !== true) fail('import', `仅个人收藏模式下公共投稿仍可勾 ${JSON.stringify(privateLock)}`)
      // 公共模式：私有勾选必须锁死
      await im.getByRole('tab', { name: /仅贡献公共库/ }).click()
      await im.waitForTimeout(250)
      const publicLock = await im.evaluate(() => {
        const row = document.querySelector('[role=row]')
        return {
          publicDisabled: row?.querySelector('input[aria-label*="提交至公共导航库"]')?.disabled ?? null,
          privateDisabled: row?.querySelector('input[aria-label*="存入个人收藏"]')?.disabled ?? null,
        }
      })
      result.import.publicLock = publicLock
      if (publicLock.privateDisabled !== true) fail('import', `仅贡献公共库模式下私有勾选仍可点 ${JSON.stringify(publicLock)}`)
      const splitTab = im.getByRole('tab', { name: /双轨智能分流/ })
      await splitTab.click()
      await im.waitForTimeout(200)
    } else {
      fail('import', '找不到「仅个人收藏夹」Tab')
    }

    result.import.runtimeErrors = imErrors.slice(0, 5)
    if (imErrors.length) fail('import', `运行时错误 ${imErrors.slice(0, 3).join(' | ')}`)
    await im.screenshot({ path: `${OUT}/verify-import-${width}.png`, fullPage: false })
    await ctx3.close()
  }

  // ---------- 首页布局专项：多列数孤儿行 / 标签污染 / 浮层碰撞 ----------
  // 单独跑而不是塞进 1440/768 主循环：孤儿行只在 3 列（1200~1360px）出现，
  // 必须补 1280 这个断点；这里只开首页，不重复跑另外两页。
  for (const width of [1440, 1280, 1024]) {
    const lc = await browser.newContext({ viewport: { width, height: 900 } })
    const lp = await lc.newPage()
    await lp.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await lp.waitForTimeout(4000)
    result.layout[width] = await lp.evaluate(() => {
      const g = document.querySelector('[data-nav-grid]')
      const cols = g ? getComputedStyle(g).gridTemplateColumns.split(' ').filter(Boolean).length : 0
      const cards = g ? Array.from(g.children).filter((e) => e.hasAttribute('data-navhub-site-id')) : []
      const visible = cards.filter((e) => getComputedStyle(e).display !== 'none')
      // 卡片标签是 <a>，分类头热门标签条是 <button>，两种都要覆盖：
      // 只查 a/span 会让分类头的污染标签成为漏网之鱼（假阴性）。
      const polluted = Array.from(document.querySelectorAll('a,span,button')).filter((e) =>
        /^#(ai赋能|消费生活|公共服务|金融财经|前端开发|组件与-ui-体系|wasm-与-rust|浏览器与-pwa|ai-工具)$/
          .test((e.textContent || '').trim())).length
      return { cols, dom: cards.length, visible: visible.length, remainder: visible.length % (cols || 1), pollutedTags: polluted }
    })
    const l = result.layout[width]
    if (!l.cols) fail('layout', `${width}px 找不到卡片网格`)
    if (l.remainder !== 0) fail('layout', `${width}px 存在孤儿行 ${JSON.stringify(l)}`)
    if (l.pollutedTags > 0) fail('layout', `${width}px 仍有 ${l.pollutedTags} 个分类名/泛化污染标签`)
    await lc.close()
  }

  // 浮层：hover 最右卡，检查 Radix popper 是否越界 + 移开后是否销毁
  {
    const pc = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const pp = await pc.newPage()
    await pp.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 120000 })
    await pp.waitForTimeout(4000)
    const rightCard = pp.locator('[data-nav-grid]').first().locator('[data-navhub-site-id]').last()
    await rightCard.scrollIntoViewIfNeeded()
    await rightCard.hover()
    await pp.waitForTimeout(700)
    result.layout.popover = await pp.evaluate(() => {
      const vw = document.documentElement.clientWidth
      const tips = Array.from(document.querySelectorAll('[data-radix-popper-content-wrapper]'))
        .filter((e) => e.getBoundingClientRect().width > 0)
      return {
        count: tips.length,
        overflow: tips.filter((e) => { const r = e.getBoundingClientRect(); return r.right > vw + 1 || r.left < -1 }).length,
        boxes: tips.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.left), Math.round(r.right)] }),
      }
    })
    if (result.layout.popover.overflow > 0) fail('layout', `最右卡浮层越界 ${JSON.stringify(result.layout.popover)}`)
    await pp.mouse.move(2, 2)
    await pp.waitForTimeout(900)
    result.layout.popoverAfterLeave = await pp.evaluate(() =>
      document.querySelectorAll('[data-radix-popper-content-wrapper]').length)
    if (result.layout.popoverAfterLeave > 0) fail('layout', `移开鼠标后浮层仍驻留 ${result.layout.popoverAfterLeave} 个`)
    await pc.close()
  }

  await browser.close()
  result.ok = result.failures.length === 0
  console.log(JSON.stringify(result, null, 2))
  process.exit(result.ok ? 0 : 1)
})().catch((e) => {
  console.error(e)
  process.exit(2)
})
