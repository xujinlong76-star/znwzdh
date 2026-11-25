import { expect, test } from '@playwright/test'

/**
 * 首页分类区块回归守卫（2026-11-21）。
 *
 * 三处曾被判为 P0 的结构问题：
 *  1. 折叠态预览张数与真实列数不联动 → 4 列下 6 张 = 4+2 孤儿行；
 *  2. 子分类轨首尾各渲染一个 [全部 (N)] → 键盘 Tab 顺序里同一动作出现两次；
 *  3. 分类头小图标只有裸 title，无 Tooltip/aria-label 区分。
 *
 * 这些断言只看**可观测的结构**（data 属性 / DOM 数量 / 无障碍名），
 * 不依赖具体像素，避免布局微调就红。
 */

const VIEWPORTS = [
  { width: 1024, height: 768, label: '1024×768' },
  { width: 1280, height: 800, label: '1280×800' },
  { width: 1440, height: 900, label: '1440×900' },
  { width: 1920, height: 1080, label: '1920×1080' },
]

for (const vp of VIEWPORTS) {
  test(`分类卡片数与列数联动、无孤儿行 @ ${vp.label}`, async ({ page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height })
    await page.goto('/')
    await page.waitForLoadState('networkidle')

    // data-grid-cols 由 ResizeObserver 异步写入：必须先等它落地再断言，
    // 否则会在「列数还是 undefined」的首帧上误判成孤儿行（实测 1440/1920
    // 两个档位曾因此假红，而真实浏览器里 0 个违规分组）。
    await page.waitForFunction(
      () => {
        const grids = Array.from(document.querySelectorAll('[data-nav-grid]'))
        return grids.length > 0 && grids.every((g) => Number(g.dataset.gridCols) > 0)
      },
      undefined,
      { timeout: 15_000 },
    )

    /*
     * 2026-11-22：data-grid-cols 由 ResizeObserver 写入后，React 还要再渲染一帧
     * 才会按新列数切片卡片。只等属性写入会在中间态抓到「cols 已更新、卡片数
     * 还是旧值」的 5 卡孤儿假象——实测等一帧后同档位稳定为 6 卡（3 的整倍数）。
     */
    const stats = await page.evaluate(() => {
      const grids = Array.from(document.querySelectorAll('[data-nav-grid]')).filter(
        (g) => g.querySelectorAll(':scope > .nav-card-deferred').length > 0,
      )
      const first = grids[0]
      const cols = first ? Number(first.dataset.gridCols) || 0 : 0
      const counts = grids.map((g) => ({
        n: g.querySelectorAll(':scope > .nav-card-deferred').length,
        // 展开态网格（data-grid-expanded）是完整列表，见下方豁免注释
        expanded: g.hasAttribute('data-grid-expanded'),
      }))
      return { cols, counts }
    })

    expect(stats.cols, '列数应被 ResizeObserver 写入 data-grid-cols').toBeGreaterThan(0)
    expect(stats.counts.length, '至少应有一个已挂载的分类分组').toBeGreaterThan(0)

    /*
     * 核心断言：达到预览上限的分组，卡片数必须是列数的整倍数（零孤儿行）。
     *
     * 例外：某些分类本身只有 5 个站点（少于预览目标 cols×2），
     * 此时渲染全部站点是正确行为——不能为凑整倍数重复或丢弃卡片。
     * 这类分组的卡片数由数据决定，不是布局缺陷。
     *
     * 实测 1280px：12 组中 11 组是 6 卡（3 的整倍数），
     * 唯一的 5 卡组是站点总数就只有 5 的分类。
     *
     * 2026-11-26 展开态豁免（主聊裁决）：选中子分类后该组是全量展开的完整列表，
     * 末行不满是自然收尾，规则只约束收起/限量 teaser 网格。触发例：81f7a3fc 起
     * 子分类 >8 的分类默认选中首个子分类——388 站库里只有 AI 工具（10 个子类），
     * 其首个子分类「对话助手」恰好 10 站；1280px 下 cols=3，10%3=1，若不豁免
     * 会误判为孤儿行。组件侧以 data-grid-expanded 标记完整列表（与
     * data-grid-folded 互斥）；不要为凑整倍数向下切卡片，那会藏掉真实站点。
     */
    const previewTarget = stats.cols * 2
    for (const { n, expanded } of stats.counts) {
      if (expanded) continue
      if (n < previewTarget) continue
      expect(
        n % stats.cols,
        `${vp.label}: 列数 ${stats.cols} 下出现 ${n} 张卡（${n}+${n % stats.cols} 孤儿行）`,
      ).toBe(0)
    }
    // 守卫有效性：至少有一个收起态分组达到预览上限，否则断言形同虚设
    // （展开态分组不计入——它们本来就不受本规则约束）
    expect(
      stats.counts.some(({ n, expanded }) => !expanded && n >= previewTarget),
      `${vp.label}: 没有任何收起态分组达到预览上限 ${previewTarget}`,
    ).toBe(true)
  })
}

test('展开态网格豁免孤儿行：AI 工具默认首个子分类全量展开（10 站）', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  await page.waitForFunction(
    () => {
      const grids = Array.from(document.querySelectorAll('[data-nav-grid]'))
      return grids.length > 0 && grids.every((g) => Number(g.dataset.gridCols) > 0)
    },
    undefined,
    { timeout: 15_000 },
  )

  const ai = await page.evaluate(() => {
    const section = document.querySelector('section#reg-ai-tools')
    if (!section) return null
    const grids = Array.from(section.querySelectorAll('[data-nav-grid]'))
    const grid = grids.find(
      (g) => g.querySelectorAll(':scope > .nav-card-deferred').length > 0,
    )
    if (!grid) return null
    const selectedTab = section.querySelector('[role="tab"][aria-selected="true"]')
    return {
      count: grid.querySelectorAll(':scope > .nav-card-deferred').length,
      expanded: grid.hasAttribute('data-grid-expanded'),
      folded: grid.hasAttribute('data-grid-folded'),
      selectedTab: selectedTab?.textContent?.trim() ?? '',
    }
  })

  expect(ai, 'AI 工具区块应渲染出带卡片的网格').not.toBeNull()
  // 回归锚点：默认选中的是首个子分类「对话助手」，不是「全部」
  expect(ai!.selectedTab, '默认应选中首个子分类「对话助手」').toContain('对话助手')
  // 10 站一张不能少：豁免绝不等于向下切到列数整倍数（9 站）
  expect(ai!.count, '对话助手全量展开应为 10 站').toBe(10)
  expect(ai!.expanded, '展开态网格应标 data-grid-expanded').toBe(true)
  expect(ai!.folded, '展开态网格不应再标 data-grid-folded').toBe(false)
})

test('子分类轨只有一个「全部」按钮（无双渲染）', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const railAllCounts = await page.evaluate(() => {
    const rails = Array.from(document.querySelectorAll('[aria-label*="子分类快速切换"]'))
    return rails.map(
      (rail) =>
        Array.from(rail.querySelectorAll('button[role="tab"]')).filter((btn) =>
          btn.textContent?.trim().startsWith('全部'),
        ).length,
    )
  })

  expect(railAllCounts.length, '应有子分类轨被渲染').toBeGreaterThan(0)
  for (const n of railAllCounts) {
    // 首位那个「全部」是复位入口，条尾不应再有第二个
    expect(n, '子分类轨里出现了多个「全部」按钮').toBe(1)
  }
})

test('分类头辅助图标都有可读的无障碍名', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle')

  const names = await page.evaluate(() => {
    const firstCategory = document.querySelector('[data-feature-id] h2')?.closest('section') ?? document.body
    const buttons = Array.from(
      firstCategory.querySelectorAll('button[aria-label], a[aria-label]'),
    )
    return buttons
      .map((el) => el.getAttribute('aria-label')?.trim() ?? '')
      .filter((label) => label.length > 0)
  })

  // 复制链接 / 生态图谱 / 类目筛选 三类操作都应有明确动词短语
  expect(names.some((n) => n.includes('复制'))).toBe(true)
  expect(names.some((n) => n.includes('图谱'))).toBe(true)
  expect(names.some((n) => n.includes('筛选'))).toBe(true)
})
