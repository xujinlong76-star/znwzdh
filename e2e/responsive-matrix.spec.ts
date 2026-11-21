import { expect, test, type Page } from '@playwright/test'

/**
 * 全站多视口自适应验收矩阵（2026-11-21）。
 *
 * ## 为什么需要它
 *
 * 仓库里已有 toolbar-360-overflow.spec.ts（只测 360/390 顶栏）与
 * mobile-layout.spec.ts（几乎没有断言），缺的是**跨页面 x 跨视口的
 * 系统性回归**：历史上多次出现「修好 1920px 却悄悄压坏 390px 菜单」
 * 「1366px 首屏卡片换行了却没人发现」。
 *
 * ## 设计取舍：稳定优先于全面
 *
 * 这套测试要进 CI 当硬门禁，所以每条断言都必须确定可复现：
 *  - 不用截图比对（字体渲染跨平台有差异，必然 flaky）
 *  - 不依赖具体像素值（用「是否溢出 / 是否重叠」这类布尔判定）
 *  - 锚点全部用 data-testid 或语义选择器，不依赖 class 结构
 *  - 6 视口 x 8 页面 = 48 组合，用 describe 分组以便 --grep 单跑
 *
 * ## 运行
 *
 *   pnpm test:responsive              # 全量
 *   pnpm test:responsive -g 390       # 单跑某个视口
 *   pnpm test:responsive -g hot       # 单跑某个页面
 */

/**
 * 6 个核心视口档位（小屏安卓 -> 桌面标配）。
 *
 * tier 决定跑在哪个门禁：
 *   'pr'      PR 级必跑（最快发现「又改坏小屏/主流笔记本」）
 *   'nightly' 只在夜间全量跑（面积大、耗时长）
 *
 * 为什么 PR 只跑 390 与 1366：
 *   playwright.config 里 workers=1 / fullyParallel=false 是刻意设定
 *   （避免本地 SQLite 并发写锁争用），所以**不能靠并行提速**，
 *   只能靠减少用例数。390 覆盖手机底线、1366 覆盖主流办公笔记本，
 *   这两档恰好是历史上出问题最多的宽度。其余 4 档下沉 nightly。
 */
const VIEWPORTS = [
  { name: '360x800', width: 360, height: 800, tier: 'nightly' },
  { name: '390x844', width: 390, height: 844, tier: 'pr' },
  { name: '768x1024', width: 768, height: 1024, tier: 'nightly' },
  { name: '1024x768', width: 1024, height: 768, tier: 'nightly' },
  { name: '1366x768', width: 1366, height: 768, tier: 'pr' },
  { name: '1440x900', width: 1440, height: 900, tier: 'nightly' },
] as const

/**
 * 分层过滤（2026-11-22）。
 *
 *   RESPONSIVE_TIER=pr      只跑 390 + 1366（PR 门禁，约 6 分钟）
 *   RESPONSIVE_TIER=nightly 6 档全跑（夜间任务，约 25 分钟）
 *   未设置                  全跑（本地默认，行为与之前一致）
 *
 * 用环境变量而非 --grep：--grep 是按用例标题字符串匹配，
 * 遇到「1366」这种数字时会误伤路径里含相同数字的用例。
 */
const TIER = (process.env.RESPONSIVE_TIER || '').toLowerCase()
const ACTIVE_VIEWPORTS =
  TIER === 'pr' ? VIEWPORTS.filter((v) => v.tier === 'pr')
  : TIER === 'nightly' ? VIEWPORTS
  : VIEWPORTS

/** 8 条核心路由（7 个核心页 + /me 概览） */
const PAGES = [
  { name: 'home', path: '/' },
  { name: 'hot', path: '/hot' },
  { name: 'tags', path: '/tags' },
  { name: 'graph', path: '/graph' },
  { name: 'algorithms', path: '/algorithms' },
  { name: 'favorites', path: '/favorites' },
  { name: 'me', path: '/me' },
  { name: 'me-growth', path: '/me/growth' },
] as const

/** 移动端档位（触控热区断言只在这些宽度下生效） */
const MOBILE_WIDTHS = new Set([360, 390])

/** 页面稳定等待：等网络空闲 + 两帧布局稳定，不靠固定 sleep */
async function settle(page: Page) {
  await page.waitForLoadState('networkidle')
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}
/** 矩形相交面积（0 表示无重叠） */
interface Rect { left: number; top: number; right: number; bottom: number }

function intersectionArea(a: Rect, b: Rect): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** 取元素相对视口的矩形；不存在或不可见时返回 null */
async function rectOf(page: Page, selector: string): Promise<Rect | null> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 1 || r.height < 1) return null
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
  }, selector)
}

/** 整页横向溢出量（px）：>0 即整页被撑宽，这是最常见的响应式事故 */
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
}
interface HomeGridMetrics {
  containerWidth: number
  columns: number
  cardsPerGroup: number
  fullCardsInView: number
  cardAreaRatio: number
}

/** 采集首页站点网格度量（列数 / 首屏完整卡片数 / 卡片区面积占比） */
async function measureHomeGrid(page: Page): Promise<HomeGridMetrics | null> {
  return page.evaluate(() => {
    // 2026-11-21：优先用 data-nav-grid 定位——data-grid-cols 也可能挂在
    // 12 列的 DIY 模块网格上，按属性盲选会读到 12 列（实测踩过）。
    const flagged = document.querySelector('[data-nav-grid]')
    const grid =
      flagged ??
      Array.from(document.querySelectorAll('div')).find(
        (el) => el.querySelector('a[href^="/site/"]') && getComputedStyle(el).display === 'grid',
      )
    if (!grid) return null
    const cs = getComputedStyle(grid)
    const columns = cs.gridTemplateColumns.split(' ').filter(Boolean).length || 1
    const gridRect = grid.getBoundingClientRect()
    const cards = Array.from(grid.querySelectorAll('a[href^="/site/"]'))
    const fullCardsInView = cards.filter((c) => c.getBoundingClientRect().bottom <= window.innerHeight + 1).length
    const visibleGridHeight = Math.max(0, Math.min(gridRect.bottom, window.innerHeight) - Math.max(gridRect.top, 0))
    const cardAreaRatio = (gridRect.width * visibleGridHeight) / (window.innerWidth * window.innerHeight)
    return {
      containerWidth: Math.round(gridRect.width),
      columns,
      cardsPerGroup: cards.length,
      fullCardsInView,
      cardAreaRatio: Math.round(cardAreaRatio * 1000) / 1000,
    }
  })
}
/* ==========================================================================
 * 断言 1+2+6：整页溢出 / 导航裁切 / 控制台报错
 * ========================================================================== */

for (const vp of ACTIVE_VIEWPORTS) {
  test.describe('viewport ' + vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const pg of PAGES) {
      test(pg.name + ' · 无横向溢出 + 无控制台错误 + 无 404', async ({ page }) => {
        const errors: string[] = []
        const notFound: string[] = []

        page.on('pageerror', (e) => errors.push(e.message))
        page.on('response', (res) => {
          // 站内静态资源 404（含 favicon / 图标）
          if (res.status() === 404 && res.url().startsWith('http')) {
            const u = new URL(res.url())
            if (u.origin === new URL(page.url() || 'http://localhost').origin) {
              notFound.push(u.pathname)
            }
          }
        })

        await page.goto(pg.path)
        await settle(page)

        const overflow = await pageOverflow(page)
        expect(
          overflow,
          pg.path + ' 在 ' + vp.name + ' 下整页横向溢出 ' + overflow + 'px',
        ).toBeLessThanOrEqual(1)

        expect(errors, pg.path + ' 控制台报错: ' + errors.join(' | ')).toEqual([])
        expect(notFound, pg.path + ' 静态资源 404: ' + notFound.join(', ')).toEqual([])
      })

      test(pg.name + ' · 导航与关键按钮不被裁切', async ({ page }) => {
        await page.goto(pg.path)
        await settle(page)

        const problems = await page.evaluate(() => {
          const issues: string[] = []
          const vw = window.innerWidth
          // 顶栏内的按钮：右缘不得超出视口
          const bar = document.querySelector('[data-testid="nav-toolbar-actions"]')
          if (bar) {
            for (const el of Array.from(bar.querySelectorAll('button, a'))) {
              const r = el.getBoundingClientRect()
              if (r.width < 1) continue
              if (r.right > vw + 1) {
                const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 12) || 'button'
                issues.push('顶栏按钮「' + name + '」右缘 ' + Math.round(r.right) + ' > 视口 ' + vw)
              }
            }
          }
          // 关键品牌词/导航词不得被 text-overflow 截断
          const KEYWORDS = ['个人私有空间', '安全与数据', '概览', '内容与收藏', '扩展与工作台']
          for (const el of Array.from(document.querySelectorAll('span, a, button'))) {
            const text = (el.textContent || '').trim()
            if (!KEYWORDS.includes(text)) continue
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden') continue
            if (el.scrollWidth > el.clientWidth + 1) {
              issues.push('关键文案「' + text + '」被截断 ' + el.scrollWidth + '>' + el.clientWidth)
            }
          }
          return issues
        })

        expect(problems, pg.path + ' @ ' + vp.name + ': ' + problems.join('; ')).toEqual([])
      })
    }
  })
}

/* ==========================================================================
 * 断言 3：悬浮浮坞不遮挡核心可点击元素与页脚版权
 * ========================================================================== */

for (const vp of ACTIVE_VIEWPORTS) {
  test.describe('dock-overlap ' + vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const pg of PAGES) {
      test(pg.name + ' · 浮坞与核心按钮/页脚零重叠', async ({ page }) => {
        await page.goto(pg.path)
        await settle(page)

        // 首屏：浮坞（挂件 + 回顶钮）与页面内核心 CTA 不得重叠
        const dock = await rectOf(page, '[data-testid="global-floating-dock"]')
        const cat = await rectOf(page, '#xiaomaomao')
        const zones = [dock, cat].filter((r): r is Rect => r !== null)

        if (zones.length > 0) {
          const hits = await page.evaluate(
            (zs) => {
              const hit: string[] = []
              const inter = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) => {
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
                return w > 0 && h > 0 ? w * h : 0
              }
              // 收藏星标 + 主 CTA
              const targets = Array.from(
                document.querySelectorAll('button[aria-label*="收藏"], main button, main a[href^="/site/"]'),
              )
              for (const el of targets) {
                const r = el.getBoundingClientRect()
                if (r.width < 2 || r.height < 2) continue
                if (r.bottom < 0 || r.top > window.innerHeight) continue
                for (const z of zs) {
                  if (inter(r, z) > 0) {
                    const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 14) || el.tagName
                    hit.push(String(name))
                  }
                }
              }
              return Array.from(new Set(hit))
            },
            zones,
          )
          expect(hits, pg.path + ' @ ' + vp.name + ' 浮坞遮挡: ' + hits.join(', ')).toEqual([])
        }

        // 滚到底：浮坞不得压住页脚版权文本
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
        await page.waitForTimeout(300)

        const dockBottom = await rectOf(page, '[data-testid="global-floating-dock"]')
        const catBottom = await rectOf(page, '#xiaomaomao')
        const zonesBottom = [dockBottom, catBottom].filter((r): r is Rect => r !== null)

        if (zonesBottom.length > 0) {
          const footHits = await page.evaluate(
            (zs) => {
              const hit: string[] = []
              const inter = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) => {
                const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
                const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
                return w > 0 && h > 0 ? w * h : 0
              }
              const footer = document.querySelector('footer')
              if (!footer) return []
              const walker = document.createTreeWalker(footer, NodeFilter.SHOW_TEXT)
              let n: Node | null
              while ((n = walker.nextNode())) {
                const t = (n.textContent || '').trim()
                if (!t) continue
                const range = document.createRange()
                range.selectNodeContents(n)
                const r = range.getBoundingClientRect()
                if (r.width < 2 || r.height < 2) continue
                for (const z of zs) {
                  if (inter(r, z) > 0) hit.push(t.slice(0, 20))
                }
              }
              return Array.from(new Set(hit))
            },
            zonesBottom,
          )
          expect(footHits, pg.path + ' @ ' + vp.name + ' 浮坞压住页脚: ' + footHits.join(' | ')).toEqual([])
        }
      })
    }
  })
}

/* ==========================================================================
 * 断言 4：移动端触控热区达标（360 / 390）
 * ========================================================================== */

for (const vp of ACTIVE_VIEWPORTS) {
  if (!MOBILE_WIDTHS.has(vp.width)) continue
  test.describe('touch ' + vp.name, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    for (const pg of PAGES) {
      test(pg.name + ' · 顶栏触控热区 >= 40px', async ({ page }) => {
        await page.goto(pg.path)
        await settle(page)

        const tooSmall = await page.evaluate(() => {
          const bad: string[] = []
          const bar = document.querySelector('[data-testid="nav-toolbar-actions"]')
          if (!bar) return bad
          for (const el of Array.from(bar.querySelectorAll('button, a'))) {
            const r = el.getBoundingClientRect()
            if (r.width < 1 || r.height < 1) continue
            const cs = getComputedStyle(el)
            if (cs.display === 'none' || cs.visibility === 'hidden') continue
            // 40px 是可达性下限；44px 是理想值，这里卡 40 保证不误杀紧凑布局
            if (r.width < 40 || r.height < 40) {
              const name = el.getAttribute('aria-label') || el.textContent?.trim().slice(0, 12) || 'button'
              bad.push('「' + name + '」' + Math.round(r.width) + 'x' + Math.round(r.height))
            }
          }
          return bad
        })

        expect(tooSmall, pg.path + ' @ ' + vp.name + ' 触控热区不足: ' + tooSmall.join('; ')).toEqual([])
      })
    }
  })
}

/* ==========================================================================
 * 断言 5：首页网格列数与首屏露出基线（量测报告）
 * ========================================================================== */

const MEASURE_VIEWPORTS = ['390x844', '1024x768', '1366x768', '1440x900'] as const

test.describe('grid-metrics', () => {
  // 2026-11-22：网格度量也要遵循分层。
  // 此前 PR 档过滤了主矩阵 6→2 视口，但这里仍写死 4 档，
  // 导致 PR 多跑 1024/1440 两条 nightly 用例（分层形同虚设）。
  // 量测报告至少保留 390 与 1366 两档——恰好是 PR 要盯的手机底线与主流笔记本。
  const activeMetrics = MEASURE_VIEWPORTS.filter((name) => {
    const v = VIEWPORTS.find((x) => x.name === name)
    return v && ACTIVE_VIEWPORTS.some((a) => a.name === name)
  })
  for (const vpName of activeMetrics) {
    const vp = VIEWPORTS.find((v) => v.name === vpName)!
    test('home · ' + vpName + ' 网格度量', async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/')
      await settle(page)

      const m = await measureHomeGrid(page)
      expect(m, '首页站点网格未找到（data-grid-cols 或 /site/ 链接）').not.toBeNull()
      if (!m) return

      const report = {
        page: '/',
        viewport: vpName,
        containerWidth: m.containerWidth,
        columns: m.columns,
        cardsPerGroup: m.cardsPerGroup,
        fullCardsInView: m.fullCardsInView,
        cardAreaRatio: m.cardAreaRatio,
      }

      // 打印 JSON（CI 可解析）+ 控制台表格（人眼可读）
      console.log('[grid-metrics] ' + JSON.stringify(report))
      console.table([report])

      /*
       * 列数硬约束：用**区间**而不是精确值。
       *
       * 为什么不写死具体列数：容器断点由 Tailwind 的 --container-* 变量决定，
       * 版本升级或主题覆盖都可能微调；写死会在无害的边界漂移上误报。
       * 但「小屏不能多列、大屏不能少列」这条业务底线必须守——
       * 那才是历史上真正出问题的地方（修好大屏压坏小屏）。
       */
      const minCols = vp.width <= 430 ? 1 : vp.width <= 1100 ? 2 : 3
      const maxCols = vp.width <= 430 ? 1 : vp.width <= 1100 ? 2 : 4
      expect(
        m.columns,
        vpName + ' 列数 ' + m.columns + ' 不在允许区间 [' + minCols + ',' + maxCols + ']（主区 ' + m.containerWidth + 'px）',
      ).toBeGreaterThanOrEqual(minCols)
      expect(
        m.columns,
        vpName + ' 列数 ' + m.columns + ' 不在允许区间 [' + minCols + ',' + maxCols + ']（主区 ' + m.containerWidth + 'px）',
      ).toBeLessThanOrEqual(maxCols)

      // 首屏至少要露出一整行卡片，否则等于「打开页面看不到内容」
      expect(
        m.fullCardsInView,
        vpName + ' 首屏完整可见卡片仅 ' + m.fullCardsInView + ' 张（应 >= 列数 ' + m.columns + '）',
      ).toBeGreaterThanOrEqual(m.columns)
    })
  }
})
