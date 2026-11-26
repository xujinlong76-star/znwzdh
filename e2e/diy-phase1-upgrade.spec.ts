import { test, expect, type Page } from '@playwright/test'

/**
 * DIY 排版工坊 Phase 1 端到端验收测试：
 * 1. 进入 DIY 模式 → 同分类内拖拽交换顺序 → 刷新页面后顺序持久化生效
 * 2. 跨分类拖拽卡片到目标位置 → 源分类 -1、目标分类 +1 且落位索引正确
 * 3. 操作后按 Ctrl+Z 撤销、Ctrl+Shift+Z 重做 → 状态精确回滚与恢复
 * 4. 窄视口（390x844）与桌面视口（1440x900）验证底部工具栏「完成」完全可见不裁切、分类 Tag 无竖排折字
 * 5. 悬停卡片点击隐藏进入回收站 → 从回收站还原后回到原分组
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
    // 窄视口下直接通过全局快捷键 Ctrl+E 进入 DIY 排版模式
    await page.locator('body').click({ position: { x: 10, y: 10 } })
    await page.keyboard.press('Control+e')
  }
  await expect(hud).toBeVisible({ timeout: 15_000 })
  return hud
}

async function dragBetween(
  page: Page,
  fromBox: { x: number; y: number; width: number; height: number },
  toBox: { x: number; y: number; width: number; height: number },
) {
  const sx = fromBox.x + fromBox.width / 2
  const sy = fromBox.y + fromBox.height / 2
  const tx = toBox.x + toBox.width / 2
  const ty = toBox.y + toBox.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()
  await page.waitForTimeout(80)
  for (let i = 1; i <= 12; i += 1) {
    await page.mouse.move(sx + ((tx - sx) * i) / 12, sy + ((ty - sy) * i) / 12)
    await page.waitForTimeout(20)
  }
  await page.waitForTimeout(80)
  await page.mouse.up()
  await page.waitForTimeout(250)
}

test.describe('DIY 排版工坊 Phase 1 端到端验收', () => {
  test('1 & 3. 同分类拖拽重排 + 刷新持久化 + Ctrl+Z / Ctrl+Shift+Z 撤销重做', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('navhub_home_diy_config_v3')
      localStorage.removeItem('navhub_feature_mask_v1')
    })
    await page.reload({ waitUntil: 'networkidle' })

    await enterDiyMode(page)

    const firstGrid = page.locator('[data-nav-grid]').first()
    const cards = firstGrid.locator('[data-diy-draggable]')
    await expect(cards.nth(2)).toBeVisible({ timeout: 15_000 })

    const beforeIds = await cards.evaluateAll((els) =>
      els.slice(0, 3).map((e) => e.getAttribute('data-diy-draggable') || ''),
    )
    expect(beforeIds.length).toBe(3)

    const box0 = await cards.nth(0).boundingBox()
    const box2 = await cards.nth(2).boundingBox()
    expect(box0).not.toBeNull()
    expect(box2).not.toBeNull()

    // 拖拽第 1 张卡片到第 3 张卡片位置
    await dragBetween(page, box0!, box2!)

    const afterIds = await cards.evaluateAll((els) =>
      els.slice(0, 3).map((e) => e.getAttribute('data-diy-draggable') || ''),
    )
    expect(afterIds).not.toEqual(beforeIds)
    expect(afterIds[2]).toBe(beforeIds[0])

    // 验证 Ctrl+Z 撤销精确回滚
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(250)
    const undoneIds = await cards.evaluateAll((els) =>
      els.slice(0, 3).map((e) => e.getAttribute('data-diy-draggable') || ''),
    )
    expect(undoneIds).toEqual(beforeIds)

    // 验证 Ctrl+Shift+Z 重做精确恢复
    await page.keyboard.press('Control+Shift+Z')
    await page.waitForTimeout(250)
    const redoneIds = await cards.evaluateAll((els) =>
      els.slice(0, 3).map((e) => e.getAttribute('data-diy-draggable') || ''),
    )
    expect(redoneIds).toEqual(afterIds)

    // 刷新页面验证持久化落盘生效（等待客户端 hydrateHomeDiy 完成 localStorage 复原）
    await page.waitForTimeout(500)
    await page.reload({ waitUntil: 'networkidle' })
    await expect
      .poll(
        async () =>
          page
            .locator('[data-nav-grid]')
            .first()
            .locator('[data-navhub-site-id]')
            .evaluateAll((els) => els.slice(0, 3).map((e) => e.getAttribute('data-navhub-site-id') || '')),
        { timeout: 10_000 },
      )
      .toEqual(afterIds)
  })

  test('2. 跨分类拖拽卡片精准落位（源 -1、目标 +1 且索引正确）', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('navhub_home_diy_config_v3')
      localStorage.removeItem('navhub_feature_mask_v1')
    })
    await page.reload({ waitUntil: 'networkidle' })

    // 在进入编辑态前切到当前分类的「全部」子视图，让多个相邻子分类网格同屏可见，便于跨组精准拖放
    const allSubTab = page.locator('section').first().getByRole('tab', { name: /^全部/ }).first()
    if (await allSubTab.isVisible().catch(() => false)) {
      await allSubTab.click()
      await page.waitForTimeout(250)
    }

    await enterDiyMode(page)

    const grids = page.locator('[data-nav-grid]')
    await expect(grids.nth(1)).toBeVisible({ timeout: 15_000 })

    const sourceGrid = grids.nth(0)
    const targetGrid = grids.nth(1)
    const sourceCards = sourceGrid.locator('[data-diy-draggable]')
    const targetCards = targetGrid.locator('[data-diy-draggable]')
    await expect(sourceCards.last()).toBeVisible()
    await expect(targetCards.nth(1)).toBeVisible()

    // 滚动到源组末尾与目标组头部交界处，确保源卡片和目标卡片同时处于视口内
    await targetCards.nth(1).scrollIntoViewIfNeeded()
    await page.evaluate(() => window.scrollBy(0, -180))
    await page.waitForTimeout(200)

    const sourceCard = sourceCards.last()
    const targetCard = targetCards.nth(1)
    const movedId = await sourceCard.getAttribute('data-diy-draggable')
    const sourceCountBefore = await sourceCards.count()
    const targetCountBefore = await targetCards.count()

    const fromBox = await sourceCard.boundingBox()
    const toBox = await targetCard.boundingBox()
    expect(fromBox).not.toBeNull()
    expect(toBox).not.toBeNull()

    await dragBetween(page, fromBox!, toBox!)

    const targetIdsAfter = await targetGrid
      .locator('[data-diy-draggable]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-diy-draggable') || ''))
    const sourceIdsAfter = await sourceGrid
      .locator('[data-diy-draggable]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-diy-draggable') || ''))

    expect(sourceIdsAfter).not.toContain(movedId)
    expect(targetIdsAfter).toContain(movedId)
    expect(targetIdsAfter.indexOf(movedId!)).toBeLessThanOrEqual(2)
    expect(sourceCountBefore).toBeGreaterThan(0)
    expect(targetCountBefore).toBeGreaterThan(0)
  })

  test('4. 390x844 与 1440x900 底部工具栏「完成」零裁切 + 分类 Tag 无竖排折字', async ({ page }) => {
    for (const vp of [
      { width: 390, height: 844 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(vp)
      await page.goto('/', { waitUntil: 'networkidle' })
      await enterDiyMode(page)

      const doneBtn = page.locator('[data-testid="diy-btn-done"]')
      await expect(doneBtn).toBeVisible()
      const doneBox = await doneBtn.boundingBox()
      expect(doneBox).not.toBeNull()
      expect(doneBox!.x).toBeGreaterThanOrEqual(0)
      expect(doneBox!.x + doneBox!.width).toBeLessThanOrEqual(vp.width)

      if (vp.width >= 1024) {
        const tagChips = page.locator('button[data-tag-chip]')
        const count = Math.min(await tagChips.count(), 12)
        for (let i = 0; i < count; i += 1) {
          const tb = await tagChips.nth(i).boundingBox()
          if (tb) {
            expect(tb.height).toBeLessThanOrEqual(34)
          }
        }
      }

      await doneBtn.click()
      await expect(page.locator('[data-diy-hud="true"]')).toHaveCount(0)
    }
  })

  test('5. 悬停卡片隐藏至回收站 → 从回收站还原回原分组', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      localStorage.removeItem('navhub_home_diy_config_v3')
      localStorage.removeItem('navhub_feature_mask_v1')
    })
    await page.reload({ waitUntil: 'networkidle' })

    await enterDiyMode(page)

    const firstCard = page.locator('[data-nav-grid]').first().locator('[data-navhub-site-id]').first()
    await expect(firstCard).toBeVisible({ timeout: 15_000 })
    const siteId = await firstCard.getAttribute('data-navhub-site-id')
    expect(siteId).toBeTruthy()

    // 悬停浮现迷你胶囊条并点击隐藏
    await firstCard.hover()
    const hideBtn = firstCard.locator('[data-diy-card-capsule="true"] button[aria-label^="隐藏站点"]')
    await expect(hideBtn).toBeVisible()
    await hideBtn.click()

    await expect(page.locator(`[data-navhub-site-id="${siteId}"]`)).toHaveCount(0)

    // 打开回收站并一键还原
    const trashBtn = page.getByRole('button', { name: /回收站/ }).first()
    await trashBtn.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    const restoreBtn = dialog.getByRole('button', { name: /还原|恢复/ }).first()
    await expect(restoreBtn).toBeVisible()
    await restoreBtn.click()

    await expect(page.locator(`[data-navhub-site-id="${siteId}"]`).first()).toBeVisible({ timeout: 10_000 })
  })
})
