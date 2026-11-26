import { test, expect, type Page } from '@playwright/test'

/**
 * DIY 排版工坊 Phase 2 端到端验收测试（12 列 Bento 自由画布 + 双层引擎协同）：
 * 1. V1 → V2 无损迁移：预置 Phase 1 LocalStorage 后加载页面，自动升维 version: 2 并保留顺序与回收站
 * 2. 左右并排与自由缩放：A/B 均设为 6 列宽左右并排（y 对齐且 B.x > A.x），刷新页面后持久化生效
 * 3. 双层拖拽零冲突：
 *    - 并排态拖 A 内部卡片到右侧 B 指定位置 → 卡片跨区落位成功且 A/B 外层坐标未偏移
 *    - 拖 A 标题栏抓手换位 → 区块整体换位成功且内部卡片顺序未误改
 * 4. 紧凑大纲态与防跳变：开启「大纲全景」所有区块折叠为紧凑胶囊，拖动后退出大纲正确恢复展开
 * 5. 撤销 / 重做：区块缩放与换位后 Ctrl+Z 精确还原、Ctrl+Shift+Z 恢复
 * 6. 多断点隔离：1440x900 双列并排 → 切 390x844 自动单列无溢出 → 切回 1440x900 双列完好无损
 */

async function enterDiyMode(page: Page) {
  const hud = page.locator('[data-diy-hud="true"]')
  if (await hud.isVisible().catch(() => false)) return hud
  const appearanceBtn = page.getByRole('button', { name: '打开外观排版与新手向导小窗' }).first()
  if (await appearanceBtn.isVisible().catch(() => false)) {
    await appearanceBtn.click()
    const startBtn = page.getByRole('button', { name: '开启 DIY', exact: true })
    await expect(startBtn).toBeVisible({ timeout: 10_000 })
    await startBtn.click()
  } else {
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+e')
  }
  await expect(hud).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('[data-bento-canvas="rgl"]')).toBeVisible({ timeout: 15_000 })
  return hud
}

async function dragMouse(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 12,
) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(80)
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(
      from.x + ((to.x - from.x) * i) / steps,
      from.y + ((to.y - from.y) * i) / steps,
    )
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(350)
}

test.describe('DIY 排版工坊 Phase 2 端到端验收（12 列 Bento 自由画布）', () => {
  test('1. V1 → V2 无损迁移：预置 Phase 1 LocalStorage 后自动升维 version: 2 并保留顺序与回收站', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })

    // 预置纯 Phase 1 存储数据（不含 workspaceLayoutV2）+ 回收站条目
    await page.evaluate(() => {
      const phase1 = {
        version: 3,
        viewMode: 'hybrid',
        cardDisplayMode: 'standard',
        canvasBackground: 'mesh',
        accentColor: 'default',
        heroDeckCollapsed: false,
        heroDeckWidgets: ['quick-search'],
        enableAdaptiveRanking: false,
        rankingMode: 'default',
        categoryOrder: ['frontend', 'ai-tools'],
        pinnedCategoryIds: [],
        hiddenCategoryIds: [],
        collapsedCategoryIds: [],
        pinnedSiteIdsByCategory: {},
        siteOrderByCategory: { 'ai-chat': ['site-demo-2', 'site-demo-1'] },
        customCategories: [],
        siteCategoryOverrides: {},
        updatedAt: Date.now(),
      }
      localStorage.setItem('navhub_home_diy_config_v3', JSON.stringify(phase1))
      localStorage.setItem(
        'navhub_feature_mask_v1',
        JSON.stringify({
          hiddenModules: [],
          hiddenCategories: [],
          hiddenSubcategories: [],
          hiddenSites: ['site:demo-trash-1'],
          hiddenFeatures: [],
          cardElements: { showDescription: true, showTags: true, showQuickLookBadge: true, showPinnedBadge: true },
          trashBin: [
            {
              id: 'site:demo-trash-1',
              level: 'L3_SITE',
              title: 'Phase1 已删除站点',
              deletedAt: 1700000000000,
            },
          ],
          bypassMaskTemporarily: false,
        }),
      )
    })

    await page.reload({ waitUntil: 'networkidle' })

    // 等待 hydrateHomeDiy 完成无损升维并回写 localStorage
    await expect
      .poll(
        async () =>
          page.evaluate(() => {
            const raw = localStorage.getItem('navhub_home_diy_config_v3')
            if (!raw) return null
            const parsed = JSON.parse(raw) as {
              workspaceLayoutV2?: {
                version?: number
                breakpoints?: { lg?: Array<{ id: string; w: number; x: number }> }
                blockOverrides?: Record<string, { siteOrder?: string[] }>
                trash?: Array<{ id: string; title: string }>
              }
            }
            return parsed.workspaceLayoutV2 ?? null
          }),
        { timeout: 10_000 },
      )
      .toMatchObject({
        version: 2,
        blockOverrides: { 'ai-chat': { siteOrder: ['site-demo-2', 'site-demo-1'] } },
      })

    const v2 = await page.evaluate(() => {
      const parsed = JSON.parse(localStorage.getItem('navhub_home_diy_config_v3') || '{}')
      return parsed.workspaceLayoutV2
    })
    expect(v2.breakpoints.lg.map((b: { id: string }) => b.id)).toEqual(['frontend', 'ai-tools'])
    expect(v2.trash.some((t: { id: string }) => t.id === 'site:demo-trash-1')).toBe(true)
  })

  test('2 & 5 & 6. 左右并排缩放 + 刷新持久化 + Ctrl+Z/Shift+Z 撤销重做 + 1440/390 多断点隔离', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('navhub_home_diy_config_v3')
      localStorage.removeItem('navhub_feature_mask_v1')
    })
    await page.reload({ waitUntil: 'networkidle' })

    await enterDiyMode(page)

    const blocks = page.locator('[data-bento-block-id]')
    await expect(blocks.nth(1)).toBeVisible({ timeout: 15_000 })
    const blockAId = await blocks.nth(0).getAttribute('data-bento-block-id')
    const blockBId = await blocks.nth(1).getAttribute('data-bento-block-id')
    expect(blockAId).toBeTruthy()
    expect(blockBId).toBeTruthy()

    // 1) 通过属性检查器将区块 A 与区块 B 均缩为 6 列（并排放置）
    await page.locator(`[data-testid="bento-inspect-${blockAId}"]`).click()
    await expect(page.locator('[data-testid="diy-block-inspector"]')).toBeVisible()
    await page.locator('[data-testid="inspector-width-6"]').click()
    await page.waitForTimeout(250)

    await page.locator(`[data-testid="bento-inspect-${blockBId}"]`).click()
    await page.locator('[data-testid="inspector-width-6"]').click()
    await page.waitForTimeout(300)

    // 关闭检查器方便拖拽 B 到 A 右侧（若自动吸附已并排则直接校验，否则拖到 A 右侧）
    await page.getByRole('button', { name: '关闭属性检查器' }).click()
    await page.waitForTimeout(200)

    const blockALoc = page.locator(`[data-bento-block-id="${blockAId}"]`)
    const blockBLoc = page.locator(`[data-bento-block-id="${blockBId}"]`)

    let boxA = await blockALoc.boundingBox()
    let boxB = await blockBLoc.boundingBox()
    expect(boxA).not.toBeNull()
    expect(boxB).not.toBeNull()

    if (Math.abs(boxA!.y - boxB!.y) > 20 || boxB!.x <= boxA!.x) {
      // 把区块 B 的标题栏抓手拖到区块 A 右侧并排位
      const handleB = page.locator(`[data-bento-drag-handle="${blockBId}"]`)
      await handleB.scrollIntoViewIfNeeded()
      const hBox = await handleB.boundingBox()
      boxA = await blockALoc.boundingBox()
      expect(hBox).not.toBeNull()
      await dragMouse(
        page,
        { x: hBox!.x + hBox!.width / 2, y: hBox!.y + hBox!.height / 2 },
        { x: boxA!.x + boxA!.width + 120, y: boxA!.y + 24 },
      )
      boxA = await blockALoc.boundingBox()
      boxB = await blockBLoc.boundingBox()
    }

    // 校验左右并排：y 对齐且 B.x > A.x
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThan(20)
    expect(boxB!.x).toBeGreaterThan(boxA!.x + 100)
    expect(await blockALoc.getAttribute('data-bento-w')).toBe('6')
    expect(await blockBLoc.getAttribute('data-bento-w')).toBe('6')

    // 2) 验证 Ctrl+Z 撤销（B 宽度/坐标回退）与 Ctrl+Shift+Z 重做恢复
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(300)
    const afterUndoW = await blockBLoc.getAttribute('data-bento-w')
    const afterUndoX = await blockBLoc.getAttribute('data-bento-x')
    expect(afterUndoW !== '6' || afterUndoX === '0').toBe(true)

    await page.keyboard.press('Control+Shift+Z')
    await page.waitForTimeout(300)
    expect(await blockBLoc.getAttribute('data-bento-w')).toBe('6')

    // 3) 退出编辑态并刷新页面，验证静态浏览态（Zero-RGL）持久化保持双列并排
    await page.waitForTimeout(500)
    await page.locator('[data-testid="diy-btn-done"]').click()
    await page.waitForTimeout(450)
    await page.reload({ waitUntil: 'networkidle' })

    await expect
      .poll(async () => page.locator(`[data-bento-block-id="${blockAId}"]`).getAttribute('data-bento-w'), {
        timeout: 10_000,
      })
      .toBe('6')
    await expect(page.locator(`[data-bento-block-id="${blockBId}"]`)).toHaveAttribute('data-bento-w', '6')

    const staticBoxA = await page.locator(`[data-bento-block-id="${blockAId}"]`).boundingBox()
    const staticBoxB = await page.locator(`[data-bento-block-id="${blockBId}"]`).boundingBox()
    expect(staticBoxA).not.toBeNull()
    expect(staticBoxB).not.toBeNull()
    expect(Math.abs(staticBoxA!.y - staticBoxB!.y)).toBeLessThan(20)
    expect(staticBoxB!.x).toBeGreaterThan(staticBoxA!.x + 100)

    // 4) 多断点隔离：切到 390x844 自动降级为 sm 单列无溢出，切回 1440x900 双列完好无损
    await page.setViewportSize({ width: 390, height: 844 })
    await expect
      .poll(async () => page.locator('[data-bento-canvas="static"]').getAttribute('data-bento-bp'), {
        timeout: 8_000,
      })
      .toBe('sm')
    const mobileBoxA = await page.locator(`[data-bento-block-id="${blockAId}"]`).boundingBox()
    const mobileBoxB = await page.locator(`[data-bento-block-id="${blockBId}"]`).boundingBox()
    expect(mobileBoxA).not.toBeNull()
    expect(mobileBoxB).not.toBeNull()
    expect(mobileBoxA!.x + mobileBoxA!.width).toBeLessThanOrEqual(392)
    expect(mobileBoxB!.y).toBeGreaterThan(mobileBoxA!.y + 40)

    await page.setViewportSize({ width: 1440, height: 900 })
    await expect
      .poll(async () => page.locator('[data-bento-canvas="static"]').getAttribute('data-bento-bp'), {
        timeout: 8_000,
      })
      .toBe('lg')
    const restoredBoxA = await page.locator(`[data-bento-block-id="${blockAId}"]`).boundingBox()
    const restoredBoxB = await page.locator(`[data-bento-block-id="${blockBId}"]`).boundingBox()
    expect(Math.abs(restoredBoxA!.y - restoredBoxB!.y)).toBeLessThan(20)
    expect(restoredBoxB!.x).toBeGreaterThan(restoredBoxA!.x + 100)
  })

  test('3. 双层拖拽零冲突：并排跨区块拖卡不偏移外层坐标 + 拖标题栏抓手不误改内部卡序', async ({ page }) => {
    test.setTimeout(120_000)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('navhub_home_diy_config_v3')
      localStorage.removeItem('navhub_feature_mask_v1')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.locator('[data-bento-block-id]').first()).toBeVisible({ timeout: 20_000 })

    await enterDiyMode(page)

    const blocks = page.locator('[data-bento-block-id]')
    await expect(blocks.nth(1)).toBeVisible({ timeout: 15_000 })
    const blockAId = (await blocks.nth(0).getAttribute('data-bento-block-id'))!
    const blockBId = (await blocks.nth(1).getAttribute('data-bento-block-id'))!

    // 将 A 与 B 均设为 6 列，并把 B 拖到 A 右侧形成真实左右并排
    await page.locator(`[data-testid="bento-inspect-${blockAId}"]`).click()
    await page.locator('[data-testid="inspector-width-6"]').click()
    await page.locator(`[data-testid="bento-inspect-${blockBId}"]`).click()
    await page.locator('[data-testid="inspector-width-6"]').click()
    await page.getByRole('button', { name: '关闭属性检查器' }).click()
    await page.waitForTimeout(250)

    const blockALoc = page.locator(`[data-bento-block-id="${blockAId}"]`)
    const blockBLoc = page.locator(`[data-bento-block-id="${blockBId}"]`)

    // 若 B 尚未在 A 右侧，先通过大纲全景把 B 拖至 A 右侧 (x=6, y=0) 再退出大纲态
    const bXNow = await blockBLoc.getAttribute('data-bento-x')
    if (bXNow === '0') {
      const outlineToggle = page.locator('[data-testid="diy-btn-outline"]')
      await outlineToggle.click()
      await expect(page.locator('[data-bento-canvas="rgl"]')).toHaveAttribute('data-bento-outline', 'true')
      await page.evaluate(() => window.scrollTo(0, 0))
      await page.waitForTimeout(250)
      const oA = await page.locator(`[data-bento-outline-card="${blockAId}"]`).boundingBox()
      const oB = await page.locator(`[data-bento-outline-card="${blockBId}"]`).boundingBox()
      expect(oA).not.toBeNull()
      expect(oB).not.toBeNull()
      await dragMouse(
        page,
        { x: oB!.x + 28, y: oB!.y + oB!.height / 2 },
        { x: oA!.x + oA!.width + 80, y: oA!.y + oA!.height / 2 },
      )
      await outlineToggle.click()
      await expect(page.locator('[data-bento-canvas="rgl"]')).toHaveAttribute('data-bento-outline', 'false')
      await page.waitForTimeout(300)
    }

    await page.evaluate(() => window.scrollTo(0, 0))
    await page.waitForTimeout(200)

    const boxA = await blockALoc.boundingBox()
    const boxB = await blockBLoc.boundingBox()
    expect(boxA).not.toBeNull()
    expect(boxB).not.toBeNull()
    expect(Math.abs(boxA!.y - boxB!.y)).toBeLessThan(20)
    expect(boxB!.x).toBeGreaterThan(boxA!.x + 100)

    const aCoordsBefore = {
      x: await blockALoc.getAttribute('data-bento-x'),
      y: await blockALoc.getAttribute('data-bento-y'),
      w: await blockALoc.getAttribute('data-bento-w'),
    }
    const bCoordsBefore = {
      x: await blockBLoc.getAttribute('data-bento-x'),
      y: await blockBLoc.getAttribute('data-bento-y'),
      w: await blockBLoc.getAttribute('data-bento-w'),
    }

    // 3a. 跨区块拖拽：从左侧区块 A 拖第一张卡片到右侧区块 B 第一张卡片位置
    const cardA0 = blockALoc.locator('[data-dnd-card]').first()
    const cardB0 = blockBLoc.locator('[data-dnd-card]').first()
    await expect(cardA0).toBeVisible()
    await expect(cardB0).toBeVisible()
    const movedCardId = (await cardA0.getAttribute('data-dnd-card'))!

    const cABox = await cardA0.boundingBox()
    const cBBox = await cardB0.boundingBox()
    expect(cABox).not.toBeNull()
    expect(cBBox).not.toBeNull()

    await dragMouse(
      page,
      { x: cABox!.x + cABox!.width / 2, y: cABox!.y + cABox!.height / 2 },
      { x: cBBox!.x + cBBox!.width / 2, y: cBBox!.y + cBBox!.height / 2 },
    )

    // 校验卡片跨区落位成功，且外层 A/B 坐标零偏移
    await expect
      .poll(
        async () =>
          blockBLoc
            .locator('[data-dnd-card]')
            .evaluateAll((els) => els.map((e) => e.getAttribute('data-dnd-card') || '')),
        { timeout: 8_000 },
      )
      .toContain(movedCardId)
    expect(await blockALoc.getAttribute('data-bento-x')).toBe(aCoordsBefore.x)
    expect(await blockALoc.getAttribute('data-bento-y')).toBe(aCoordsBefore.y)
    expect(await blockBLoc.getAttribute('data-bento-x')).toBe(bCoordsBefore.x)
    expect(await blockBLoc.getAttribute('data-bento-y')).toBe(bCoordsBefore.y)

    // 3b. 拖区块 A 标题栏抓手到右侧与 B 互换，验证区块换位成功且 A 内部卡片顺序未变
    const aCardsBeforeMove = await blockALoc
      .locator('[data-dnd-card]')
      .evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-dnd-card') || ''))
    const handleA = page.locator(`[data-bento-drag-handle="${blockAId}"]`)
    const handleB = page.locator(`[data-bento-drag-handle="${blockBId}"]`)
    const hABox = await handleA.boundingBox()
    const hBBox = await handleB.boundingBox()
    expect(hABox).not.toBeNull()
    expect(hBBox).not.toBeNull()

    await dragMouse(
      page,
      { x: hABox!.x + hABox!.width / 2, y: hABox!.y + hABox!.height / 2 },
      { x: hBBox!.x + hBBox!.width / 2 + 160, y: hBBox!.y + hBBox!.height / 2 },
    )

    const aCardsAfterMove = await blockALoc
      .locator('[data-dnd-card]')
      .evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-dnd-card') || ''))
    expect(aCardsAfterMove).toEqual(aCardsBeforeMove)
    expect(await blockALoc.getAttribute('data-bento-x')).not.toBe(aCoordsBefore.x)
  })

  test('4. 紧凑大纲态与防跳变：开启大纲全景折叠为紧凑胶囊，拖动落位后恢复展开', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('navhub_home_diy_config_v3')
      localStorage.removeItem('navhub_feature_mask_v1')
    })
    await page.reload({ waitUntil: 'networkidle' })

    await enterDiyMode(page)

    const outlineToggle = page.locator('[data-testid="diy-btn-outline"]')
    await expect(outlineToggle).toBeVisible()
    await outlineToggle.click()
    await expect(page.locator('[data-bento-canvas="rgl"]')).toHaveAttribute('data-bento-outline', 'true')

    const outlineCards = page.locator('[data-bento-outline-card]')
    await expect(outlineCards.nth(1)).toBeVisible({ timeout: 10_000 })

    const firstId = (await outlineCards.nth(0).getAttribute('data-bento-outline-card'))!
    const box0 = await outlineCards.nth(0).boundingBox()
    const box1 = await outlineCards.nth(1).boundingBox()
    expect(box0).not.toBeNull()
    expect(box1).not.toBeNull()
    // 紧凑胶囊高度应显著压缩（<= 120px）
    expect(box0!.height).toBeLessThanOrEqual(120)
    expect(box1!.height).toBeLessThanOrEqual(120)

    // 大纲态下把第 1 个区块拖到第 2 个区块下方
    await dragMouse(
      page,
      { x: box0!.x + box0!.width / 2, y: box0!.y + box0!.height / 2 },
      { x: box1!.x + box1!.width / 2, y: box1!.y + box1!.height + 30 },
    )

    // 退出大纲全景，恢复正常展开态
    await outlineToggle.click()
    await expect(page.locator('[data-bento-canvas="rgl"]')).toHaveAttribute('data-bento-outline', 'false')

    const expandedBox = await page.locator(`[data-bento-block-id="${firstId}"]`).boundingBox()
    expect(expandedBox).not.toBeNull()
    expect(expandedBox!.height).toBeGreaterThan(180)
  })
})
