import { expect, test, type Page } from '@playwright/test'

/**
 * 「7 大网址展示模式 × 4 核心视口」Playwright 自动化布局与交互验收矩阵。
 *
 * 覆盖：
 *  - 7 大展示模式：standard / icon-wall / list / minimal / compact / rich / directory
 *  - 4 大核心视口：390×844 / 1024×768 / 1280×800 / 1440×900
 *
 * 五大硬门禁：
 *  1. 零横向溢出（scrollWidth <= innerWidth + 1）；
 *  2. 书签目录与列表类模式无幽灵留白截断（站点文本容器占用宽度 > 所在单元格宽度的 65%）；
 *  3. 顶栏搜索输入框文字区域与右侧 [AI] 按钮 BoundingBox 零交集；
 *  4. nav_view_mode Cookie 持久化 + page.reload() 首屏保态 + 控制台零 React Hydration Warning；
 *  5. 键盘无障碍一致性：任意模式下聚焦首张站点项按 Space 均可呼出站点速览面板（Esc 正常关闭）；
 *  6. 附带右下角小猫挂件空胶囊防回归校验（无有效文案/计数时不渲染空块）。
 */

const ALL_VIEW_MODES = [
  'standard',
  'icon-wall',
  'list',
  'minimal',
  'compact',
  'rich',
  'directory',
] as const

type ViewModeId = (typeof ALL_VIEW_MODES)[number]

const VIEWPORTS = [
  { name: '390x844', width: 390, height: 844, isMobile: true, isBelowMd: true },
  { name: '1024x768', width: 1024, height: 768, isMobile: false, isBelowMd: false },
  { name: '1280x800', width: 1280, height: 800, isMobile: false, isBelowMd: false },
  { name: '1440x900', width: 1440, height: 900, isMobile: false, isBelowMd: false },
] as const

const HYDRATION_RE =
  /hydrat|did not match|server rendered html|text content does not match|minified react error #(418|423|425)/i

interface RectBox {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

function intersectionArea(a: RectBox, b: RectBox): number {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left)
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/** 根据 VIEW_MODE_REGISTRY 契约计算当前视口下实际渲染模式（<640px 时 list 自动降级 standard） */
function expectedEffectiveMode(mode: ViewModeId, viewportWidth: number): ViewModeId {
  if (viewportWidth < 640 && mode === 'list') return 'standard'
  return mode
}

/** 等两帧布局稳定，不靠硬 sleep */
async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  )
}

/** 等待首页水合、懒加载搜索栏与首批卡片渲染就绪 */
async function waitForHomeReady(page: Page) {
  await page.waitForSelector('[data-testid="site-display-mode-trigger"]', {
    state: 'visible',
    timeout: 60_000,
  })
  await page.waitForSelector('input[placeholder*="搜索"]:visible', {
    state: 'visible',
    timeout: 60_000,
  })
  await page.waitForSelector('button[aria-label*="AI 模式"]', {
    state: 'visible',
    timeout: 60_000,
  })
  await page.waitForSelector('[data-navhub-site-id] a[data-prefetch-target="true"]', {
    state: 'visible',
    timeout: 60_000,
  })
  await settleLayout(page)
}

/** 通过顶栏可视化切换面板（桌面 Popover / 移动端 Bottom Sheet）切换模式 */
async function switchViewModeViaToolbar(
  page: Page,
  targetMode: ViewModeId,
  viewport: (typeof VIEWPORTS)[number],
) {
  const trigger = page.getByTestId('site-display-mode-trigger')
  await expect(trigger).toBeVisible()
  await trigger.click()

  if (viewport.isBelowMd) {
    await expect(page.getByTestId('site-display-mode-sheet')).toBeVisible()
  }

  const option = page.locator(`[data-display-mode-option="${targetMode}"]`)
  await expect(option).toBeVisible()
  await option.click()

  if (viewport.isBelowMd) {
    await expect(page.getByTestId('site-display-mode-sheet')).toBeHidden({ timeout: 10_000 })
  }

  const effective = expectedEffectiveMode(targetMode, viewport.width)
  await expect(page.locator('#main-content')).toHaveAttribute('data-card-mode', effective)
  await expect(
    page.locator(`[data-navhub-site-id][data-card-variant="${effective}"]`).first(),
  ).toBeVisible()
  await settleLayout(page)
}

/** 断言 1：零横向溢出（scrollWidth <= innerWidth + 1） */
async function assertNoHorizontalOverflow(page: Page, contextLabel: string) {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }))
  expect(
    metrics.scrollWidth,
    `${contextLabel} 横向溢出：scrollWidth(${metrics.scrollWidth}) > innerWidth(${metrics.innerWidth}) + 1`,
  ).toBeLessThanOrEqual(metrics.innerWidth + 1)
}

/** 断言 2：书签目录与列表类模式下站点文本容器实际占用宽度 > 所在单元格宽度的 65% */
async function assertTextWidthRatio(
  page: Page,
  effectiveMode: ViewModeId,
  contextLabel: string,
) {
  if (effectiveMode !== 'directory' && effectiveMode !== 'list' && effectiveMode !== 'compact') {
    return
  }

  const samples = await page.evaluate((mode) => {
    const cards = Array.from(
      document.querySelectorAll<HTMLElement>(`[data-navhub-site-id][data-card-variant="${mode}"]`),
    )
      .filter((el) => {
        const r = el.getBoundingClientRect()
        return r.width > 40 && r.height > 10
      })
      .slice(0, 6)

    return cards.map((card) => {
      const cellRect = card.getBoundingClientRect()
      // 定位承载站点标题（与简介）的主文本容器：
      // - directory：内层含标题与简介的纯文本列（不含 18px 图标）
      // - list：内层含标题+简介+域名的主文本列
      // - compact：内容区主列（不含右侧星标）
      let textBox: HTMLElement | null = null
      if (mode === 'directory') {
        const p = card.querySelector<HTMLElement>('p')
        textBox = p?.parentElement ?? card.querySelector<HTMLElement>('.min-w-0.flex-1')
      } else if (mode === 'list') {
        const p = card.querySelector<HTMLElement>('p')
        textBox =
          p?.parentElement ??
          card.querySelector<HTMLElement>('.pointer-events-none .min-w-0.flex-1')
      } else {
        textBox = card.querySelector<HTMLElement>('.pointer-events-none.min-w-0.flex-1')
      }

      const textRect = textBox?.getBoundingClientRect()
      const titleText =
        (card.querySelector<HTMLElement>('a[href^="/site/"], span[title]')?.textContent || '').trim()
      return {
        title: titleText,
        cellWidth: Math.round(cellRect.width * 10) / 10,
        textWidth: textRect ? Math.round(textRect.width * 10) / 10 : 0,
        ratio: textRect && cellRect.width > 0 ? textRect.width / cellRect.width : 0,
      }
    })
  }, effectiveMode)

  expect(samples.length, `${contextLabel} 未采样到可见站点单元格`).toBeGreaterThan(0)
  for (const s of samples) {
    expect(
      s.ratio,
      `${contextLabel} 站点「${s.title}」文本容器宽度 ${s.textWidth}px / 单元格 ${s.cellWidth}px = ${(s.ratio * 100).toFixed(1)}%，低于 65% 下限（疑似幽灵留白截断回归）`,
    ).toBeGreaterThan(0.65)
    expect(
      s.textWidth,
      `${contextLabel} 站点「${s.title}」文本容器过窄 (${s.textWidth}px)`,
    ).toBeGreaterThan(100)
  }
}

/** 断言 3：顶栏搜索框文字区域与右侧 [AI] 按钮 BoundingBox 零交集 */
async function assertSearchInputAndAiButtonNoOverlap(page: Page, contextLabel: string) {
  const boxes = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[placeholder*="搜索"]'))
    const input = inputs.find((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 10 && r.height > 10
    })
    const aiButtons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button[aria-label*="AI 模式"]'),
    )
    const aiBtn = aiButtons.find((el) => {
      const r = el.getBoundingClientRect()
      return r.width > 10 && r.height > 10
    })
    if (!input || !aiBtn) return null
    const ir = input.getBoundingClientRect()
    const ar = aiBtn.getBoundingClientRect()
    return {
      input: {
        left: ir.left,
        top: ir.top,
        right: ir.right,
        bottom: ir.bottom,
        width: ir.width,
        height: ir.height,
      },
      aiBtn: {
        left: ar.left,
        top: ar.top,
        right: ar.right,
        bottom: ar.bottom,
        width: ar.width,
        height: ar.height,
      },
    }
  })

  expect(boxes, `${contextLabel} 未找到可见的顶栏搜索输入框或 [AI] 按钮`).not.toBeNull()
  if (!boxes) return

  const overlap = intersectionArea(boxes.input, boxes.aiBtn)
  expect(
    overlap,
    `${contextLabel} 搜索框 (${Math.round(boxes.input.left)}..${Math.round(boxes.input.right)}) 与 [AI] 按钮 (${Math.round(boxes.aiBtn.left)}..${Math.round(boxes.aiBtn.right)}) 重叠 ${overlap.toFixed(1)}px²`,
  ).toBe(0)
  expect(
    boxes.input.right,
    `${contextLabel} 搜索输入框右缘超出 [AI] 按钮左缘`,
  ).toBeLessThanOrEqual(boxes.aiBtn.left + 1)
  expect(boxes.input.width, `${contextLabel} 搜索输入框被过度挤压`).toBeGreaterThanOrEqual(80)
}

/** 断言 4：Cookie 持久化 + page.reload() 首屏保持所选模式 + 零 React Hydration Warning */
async function assertCookiePersistenceAndZeroHydration(
  page: Page,
  selectedMode: ViewModeId,
  viewport: (typeof VIEWPORTS)[number],
  hydrationWarnings: string[],
  pageErrors: string[],
) {
  const cookieStr = await page.evaluate(() => document.cookie)
  expect(
    cookieStr,
    `[${viewport.name}/${selectedMode}] document.cookie 缺少 nav_view_mode=${selectedMode}（实际：${cookieStr}）`,
  ).toContain(`nav_view_mode=${selectedMode}`)

  const warnBefore = hydrationWarnings.length
  const errBefore = pageErrors.length

  await page.reload({ waitUntil: 'domcontentloaded' })
  await waitForHomeReady(page)

  const effective = expectedEffectiveMode(selectedMode, viewport.width)
  await expect(page.locator('#main-content')).toHaveAttribute('data-card-mode', effective)
  await expect(
    page.locator(`[data-navhub-site-id][data-card-variant="${effective}"]`).first(),
  ).toBeVisible()

  expect(
    hydrationWarnings.slice(warnBefore),
    `[${viewport.name}/${selectedMode}] reload 后出现 React Hydration Warning`,
  ).toEqual([])
  expect(
    pageErrors.slice(errBefore),
    `[${viewport.name}/${selectedMode}] reload 后出现页面未捕获异常`,
  ).toEqual([])
}

/** 断言 5：键盘无障碍一致性——聚焦首张站点项按 Space 呼出速览弹窗，Esc 正常关闭 */
async function assertKeyboardSpaceOpensPeek(
  page: Page,
  effectiveMode: ViewModeId,
  contextLabel: string,
) {
  const firstAnchor = page
    .locator(`[data-navhub-site-id][data-card-variant="${effectiveMode}"] a[data-prefetch-target="true"]`)
    .first()
  await expect(firstAnchor, `${contextLabel} 首张卡片主链接不可见`).toBeVisible()
  await firstAnchor.scrollIntoViewIfNeeded()
  await firstAnchor.focus()
  await expect(firstAnchor).toBeFocused()

  await page.keyboard.press('Space')
  // 精准匹配 Radix SitePeekDialog（排除隐藏态常驻的 #mobile-nav-drawer 与小猫 .xm-panel）
  const peekDialog = page
    .locator('[role="dialog"][data-state="open"]')
    .filter({ has: page.getByRole('button', { name: '访问主站' }) })
  await expect(peekDialog, `${contextLabel} 按 Space 后未呼出站点速览面板`).toBeVisible({
    timeout: 15_000,
  })

  await page.keyboard.press('Escape')
  await expect(peekDialog, `${contextLabel} 按 Esc 后站点速览面板未关闭`).toHaveCount(0, {
    timeout: 10_000,
  })
}

/** 断言 6：右下角小猫挂件无空白文字胶囊（无有效文案/数字时不渲染可见空块） */
async function assertNoEmptyCatCapsule(page: Page, contextLabel: string) {
  const emptyVisibleCapsules = await page.evaluate(() => {
    const xm = document.getElementById('xiaomaomao')
    if (!xm) return []
    const problems: string[] = []
    for (const sel of ['.xm-bubble', '.xm-fish-n', '.xm-p-lv']) {
      const el = xm.querySelector<HTMLElement>(sel)
      if (!el) continue
      const cs = getComputedStyle(el)
      const r = el.getBoundingClientRect()
      const text = (el.textContent || '').trim()
      const visible =
        cs.display !== 'none' &&
        cs.visibility !== 'hidden' &&
        parseFloat(cs.opacity || '1') > 0.05 &&
        r.width > 1 &&
        r.height > 1
      if (visible && text.length === 0) {
        problems.push(`${sel} (${Math.round(r.width)}x${Math.round(r.height)})`)
      }
    }
    return problems
  })
  expect(
    emptyVisibleCapsules,
    `${contextLabel} 小猫挂件存在无文字空胶囊：${emptyVisibleCapsules.join(', ')}`,
  ).toEqual([])
}

test.describe('7 大网址展示模式 × 多视口自动化布局与交互验收矩阵', () => {
  test.setTimeout(180_000)

  for (const vp of VIEWPORTS) {
    test(`视口 ${vp.name}：遍历全部 7 种展示模式（溢出 / 文本宽度占比 / 搜索栏零重叠 / Cookie 重载零水合告警 / Space 速览）`, async ({
      page,
    }) => {
      const hydrationWarnings: string[] = []
      const pageErrors: string[] = []

      page.on('console', (msg) => {
        const text = msg.text()
        if (HYDRATION_RE.test(text)) {
          hydrationWarnings.push(`[${msg.type()}] ${text.slice(0, 300)}`)
        }
      })
      page.on('pageerror', (err) => {
        pageErrors.push(String(err).slice(0, 300))
      })

      await page.setViewportSize({ width: vp.width, height: vp.height })
      await page.goto('/', { waitUntil: 'domcontentloaded' })
      await waitForHomeReady(page)

      // 1280×800 主力桌面档对全部 7 种模式逐一做 reload + Space 全检；
      // 其余 3 档视口同样遍历全部 7 种模式检验布局/溢出/文本宽度/搜索栏，并对代表模式验证 reload 与 Space，
      // 保证整套 4×7=28 组合全覆盖且总耗时稳定可控。
      const reloadModes: ReadonlySet<ViewModeId> =
        vp.width === 1280
          ? new Set(ALL_VIEW_MODES)
          : vp.isMobile
            ? new Set<ViewModeId>(['directory', 'list'])
            : new Set<ViewModeId>(['directory', 'icon-wall'])

      const spaceModes: ReadonlySet<ViewModeId> =
        vp.width === 1280
          ? new Set(ALL_VIEW_MODES)
          : new Set<ViewModeId>(['directory', 'standard'])

      for (const mode of ALL_VIEW_MODES) {
        const ctx = `[${vp.name} / ${mode}]`
        const effective = expectedEffectiveMode(mode, vp.width)

        await switchViewModeViaToolbar(page, mode, vp)
        await assertNoHorizontalOverflow(page, ctx)
        await assertTextWidthRatio(page, effective, ctx)
        await assertSearchInputAndAiButtonNoOverlap(page, ctx)

        if (reloadModes.has(mode)) {
          await assertCookiePersistenceAndZeroHydration(
            page,
            mode,
            vp,
            hydrationWarnings,
            pageErrors,
          )
          // reload 之后再次复核零溢出与无幽灵留白
          await assertNoHorizontalOverflow(page, `${ctx} after-reload`)
          await assertTextWidthRatio(page, effective, `${ctx} after-reload`)
        }

        if (spaceModes.has(mode)) {
          await assertKeyboardSpaceOpensPeek(page, effective, ctx)
        }
      }

      // 移动端切回桌面时验证 list 自动恢复
      if (vp.isMobile) {
        await switchViewModeViaToolbar(page, 'list', vp)
        await expect(page.locator('#main-content')).toHaveAttribute('data-card-mode', 'standard')
        await page.setViewportSize({ width: 1280, height: 800 })
        await settleLayout(page)
        await expect(page.locator('#main-content')).toHaveAttribute('data-card-mode', 'list')
      }

      await assertNoEmptyCatCapsule(page, `[${vp.name}]`)

      expect(hydrationWarnings, `[${vp.name}] 控制台存在 React Hydration Warning`).toEqual([])
      expect(pageErrors, `[${vp.name}] 页面存在未捕获运行时异常`).toEqual([])
    })
  }
})
