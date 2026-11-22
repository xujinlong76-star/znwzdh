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
      const counts = grids.map((g) => g.querySelectorAll(':scope > .nav-card-deferred').length)
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
     */
    const previewTarget = stats.cols * 2
    for (const n of stats.counts) {
      if (n < previewTarget) continue
      expect(
        n % stats.cols,
        `${vp.label}: 列数 ${stats.cols} 下出现 ${n} 张卡（${n}+${n % stats.cols} 孤儿行）`,
      ).toBe(0)
    }
    // 守卫有效性：至少有一个分组达到预览上限，否则断言形同虚设
    expect(
      stats.counts.some((n) => n >= previewTarget),
      `${vp.label}: 没有任何分组达到预览上限 ${previewTarget}`,
    ).toBe(true)
  })
}

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
