import { test, expect } from '@playwright/test'
import { todayFollowUpNodes, todayNodes } from '../apps/web-overlay/src/lib/exam-calendar'
import { safeHref } from '../apps/web-overlay/src/lib/safe-url'

/**
 * U-155 首页今日行挂行内直达链接：E2E 回归。
 *
 * 补 8574f171 的覆盖缺口：该提交只改了 home-today-zone.tsx + 单元测试，
 * e2e/* 下 grep home-today-zone 0 命中，E2E 两分片绿不代表行使了该改动。
 * 本规格在真实首页上断言同一条规则：有已核实官方 URL 的节点行渲染为
 * 行内直达链接（U-31 配方：href + target="_blank" + ArrowUpRight），
 * 无 URL 的节点行仍是纯文本（行内无 <a>）。
 *
 * 渲染路径（实测纠正：今日区不在首页首屏直出）：page.tsx 把
 * <HomeTodayZone /> 作 todaySlots.today 传给 NavigationContent，
 * 只在点工具栏「打开今日中心小窗」后才由 TodayCenterDialog 挂载
 * （navigation-content.tsx:1582 `todayOpen && todaySlots`，动态 import；
 * 对话框默认「专注与提醒」tab，todayContent 即今日区）。因此用例先点
 * 开今日中心小窗，再在对话框内断言；首版误以为首屏直出、等 section
 * 60 秒未找到而 2 failed，已按此修正。
 * todayNodes / todayFollowUpNodes 是零 import 纯函数，与服务端
 * HomeTodayZone 同源；nowMs 在用例开始时取一次，页面请求在几秒内发出，
 * 与服务端渲染落在同一个北京时间自然日。唯一已知错位窗口是跨 00:00
 * 的轮次（期望按昨日算、服务端按今日渲染），概率极低且失败形态明确。
 *
 * 作用域只收 `div[aria-label="今日节点"]`（今日行 + 接续展开区）：
 * 同一 section 里的倒计时「下一步」直链与今日短剧链接不在该 div 内，
 * 不会被误数；/exam CTA 没有「（新窗口打开）」aria-label，也不在计数内。
 * 接续区在闭合的 <details> 里也照常断言——用 DOM 取值，不依赖可见性，
 * 不用先点开「接续安排」。
 *
 * 不点按链接、不发站外请求：href / target / rel / 图标都在 DOM 上可验；
 * 站外站点可达性与本站链接目标无关（U-141：jdyw.jxeea.cn 在 CI 上曾
 * 77 秒零字节返回）；同一 URL 的点按发请求已由 U-124 E1 在 /exam 上覆盖。
 *
 * 跳过策略（诚实跳过，不空过）：今日无节点时今日行整块不渲染，
 * beforeEach 直接 skip；某分支当日无数据时对应测试 skip（如某日
 * 今日+接续节点均无 URL，链接测试无可断言对象）。skip 会在报告里
 * 留痕，不会伪装成通过。2026-11-19 实测：今日 2 项（江西成绩复核
 * 带链、上海自考成绩查询纯文本）+ 接续 4 项（均纯文本），两分支都行使。
 */
test.describe('U-155 今日中心入口可见文字标签（2026-11-19 01:22 轮新增）', () => {
  // 本轮改动：工具栏今日中心按钮加可见文字标签（navigation-toolbar.tsx），
  // 文案复用已 SSR 的 todayBadge.todayCount：有今日节点时「今日 N 项」，
  // 无节点时只写「今日」。aria-label 不动，本用例仍用它定位按钮。
  // 与服务端同源：todayCount = todayNodes(nowMs).length。
  // 意图变更（87b95e27，2026-11-20）：「今日」文字标签的显示断点由 xl 延后到
  // 2xl——<1536px 只留图标 + title Tooltip + 红点徽章，文字标签隐藏（1280px 档
  // 标签会把搜索容器压到 298px、输入框只剩 18px）。本用例随新行为改写：1280px
  // 与 390px 档断言标签隐藏（按钮本身仍可见），并补 1600px（2xl）档的标签可见
  // 用例；断言未删，只改断言方向。e2e2 分支的 toolbar-360-overflow 同款改写。
  test('首屏按钮「今日 N 项」标签按 2xl 断点隐藏（1280px 与 390px 移动端）', async ({
    page,
  }) => {
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 800 })
      await page.goto('/')
      const btn = page.getByRole('button', { name: '打开今日中心小窗', exact: true })
      await expect(btn).toBeVisible({ timeout: 60_000 })
      // 标签是按钮内真实可见的 span 文本，不是仅 title 悬停提示；<1536px 应隐藏。
      const label = btn.locator('span:not([aria-hidden])')
      await expect(label).toBeHidden()
    }
  })

  test('首屏按钮含可见「今日 N 项」标签（1600px，2xl）', async ({ page }) => {
    const nowMs = Date.now()
    const todayCount = todayNodes(nowMs).length
    const expected = todayCount > 0 ? `今日 ${todayCount} 项` : '今日'
    await page.setViewportSize({ width: 1600, height: 800 })
    await page.goto('/')
    const btn = page.getByRole('button', { name: '打开今日中心小窗', exact: true })
    await expect(btn).toBeVisible({ timeout: 60_000 })
    // 标签是按钮内真实可见的 span 文本，不是仅 title 悬停提示。
    const label = btn.locator('span:not([aria-hidden])')
    await expect(label).toBeVisible({ timeout: 10_000 })
    await expect(label).toHaveText(expected)
  })
})

test.describe('U-155 首页今日行行内直达链接', () => {
  // 与服务端同源的期望数据：一次 nowMs 派生今日行与接续区。
  let nowMs = 0
  let todayItems: ReturnType<typeof todayNodes> = []
  let followUpItems: ReturnType<typeof todayFollowUpNodes> = []

  test.beforeEach(async ({ page }) => {
    nowMs = Date.now()
    todayItems = todayNodes(nowMs)
    followUpItems = todayFollowUpNodes(nowMs)
    if (todayItems.length === 0) {
      test.skip(true, '今日无考试节点：首页今日行不渲染，U-155 链接分支无可断言对象')
    }
    await page.goto('/')
    // 打开今日中心小窗（工具栏按钮，navigation-toolbar.tsx:149）：
    // 今日区只在对话框挂载后才进 DOM；对话框是动态 import，首开需等
    // chunk 加载，60 秒预算只防冷启动长尾，不代表常规耗时。
    await page
      .getByRole('button', { name: '打开今日中心小窗', exact: true })
      .click({ timeout: 60_000 })
    await expect(page.locator('section[aria-label="今日一件事"]')).toBeVisible({
      timeout: 60_000,
    })
  })

  test('有 URL 的节点渲染为行内直达链接（新窗口 + ArrowUpRight）', async ({ page }) => {
    const linked = [...todayItems, ...followUpItems].filter((item) => item.node.url)
    if (linked.length === 0) {
      test.skip(true, '今日节点与接续节点均无 URL：链接分支无可断言对象')
    }
    const zone = page.locator('div[aria-label="今日节点"]')
    await expect(zone).toHaveCount(1)

    const links = await zone
      .locator('a[aria-label$="（新窗口打开）"]')
      .evaluateAll((els) =>
        els.map((el) => ({
          href: el.getAttribute('href'),
          target: el.getAttribute('target'),
          rel: el.getAttribute('rel'),
          text: el.textContent?.trim() ?? '',
          svgCount: el.querySelectorAll('svg').length,
        })),
      )
    const expected = linked
      .map(({ exam, node }) => ({
        href: safeHref(node.url),
        label: `${exam.shortName} · ${node.label}`,
      }))
      .sort((a, b) => a.href.localeCompare(b.href))
    const actual = [...links].sort((a, b) => (a.href ?? '').localeCompare(b.href ?? ''))
    // href 精确集合：不多一条（无 URL 的行被误挂链会多出来），不少一条。
    expect(actual.map((l) => l.href)).toEqual(expected.map((e) => e.href))
    for (const link of actual) {
      expect(link.target).toBe('_blank')
      expect(link.rel?.split(' ') ?? []).toEqual(
        expect.arrayContaining(['noopener', 'noreferrer']),
      )
      // ArrowUpRight 图标：链接内恰一个 <svg>。
      expect(link.svgCount).toBe(1)
      const entry = expected.find((e) => e.href === link.href)
      expect(entry).toBeDefined()
      expect(link.text).toContain(entry!.label)
    }
  })

  test('无 URL 的节点仍为纯文本（行内无链接）', async ({ page }) => {
    const plain = [...todayItems, ...followUpItems].filter((item) => !item.node.url)
    if (plain.length === 0) {
      test.skip(true, '今日节点与接续节点均有 URL：纯文本分支无可断言对象')
    }
    const zone = page.locator('div[aria-label="今日节点"]')
    await expect(zone).toHaveCount(1)

    const rows = await zone.locator('li').evaluateAll((els) =>
      els.map((el) => ({
        text: el.textContent ?? '',
        linkCount: el.querySelectorAll('a').length,
      })),
    )
    // 行数 = 今日行 + 接续行：不多不少，行本身没丢、没多。
    expect(rows).toHaveLength(todayItems.length + followUpItems.length)
    for (const { exam, node } of plain) {
      const label = `${exam.shortName} · ${node.label}`
      const hits = rows.filter((row) => row.text.includes(label))
      expect(hits).toHaveLength(1)
      expect(hits[0].linkCount).toBe(0)
    }
    // 兜底：区内「（新窗口打开）」链接数 = 带 URL 节点数，无 URL 的行
    // 一条链接也没混进来（与上一测试的 href 集合断言互为印证）。
    const linkedCount = [...todayItems, ...followUpItems].filter(
      (item) => item.node.url,
    ).length
    await expect(zone.locator('a[aria-label$="（新窗口打开）"]')).toHaveCount(linkedCount)
  })
})
