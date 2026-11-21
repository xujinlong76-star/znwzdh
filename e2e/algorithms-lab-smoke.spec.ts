import { expect, test } from '@playwright/test'

/**
 * /algorithms 实验室冒烟（2026-11-21）。
 *
 * 覆盖 12 个引擎面板的「可理解性与一致性」底线：
 *  1. 每个 Tab 切进去都有实质内容（不缺省为空态）；
 *  2. 三档视口无横向溢出；
 *  3. 无运行时错误；
 *  4. 一键对比剧本可点。
 */

const TABS = [
  'linucb', 'hyperbolic', 'graph', 'visual', 'webmcp', 'federated',
  'speculation', 'synthesizer', 'mesh', 'health', 'intent', 'vault',
]

const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]

for (const vp of VIEWPORTS) {
  test(`12 个引擎面板均有内容且无溢出 @ ${vp.width}x${vp.height}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))

    await page.setViewportSize(vp)
    await page.goto('/algorithms#linucb')
    await page.waitForLoadState('networkidle')

    const tabs = page.locator('[role="tab"]')
    const count = await tabs.count()
    expect(count, '应有 12 个引擎 Tab').toBeGreaterThanOrEqual(12)

    for (let i = 0; i < count; i++) {
      await tabs.nth(i).click()
      await page.waitForTimeout(400)

      const panelText = await page.evaluate(() => {
        const panel =
          document.querySelector('[role="tabpanel"][data-state="active"]') ??
          document.querySelector('[role="tabpanel"]')
        return panel?.textContent?.trim().length ?? 0
      })
      // 空态容忍下限：任何面板切进去都该有实质文字
      expect(panelText, `第 ${i + 1} 个 Tab 内容过少`).toBeGreaterThan(50)

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      )
      expect(overflow, `第 ${i + 1} 个 Tab 出现横向溢出`).toBe(false)
    }

    expect(errors, '不应有运行时错误').toEqual([])
  })
}

test('一键对比剧本存在且可点击', async ({ page }) => {
  await page.goto('/algorithms#linucb')
  await page.waitForLoadState('networkidle')

  for (const label of ['英文缩写', '全拼检索', '中文意图', '长尾错拼']) {
    const btn = page.getByRole('button', { name: new RegExp(label) })
    await expect(btn, `应存在剧本按钮「${label}」`).toBeVisible()
  }

  // 点一个剧本：应填入词条并自动出 A/B 结果
  await page.getByRole('button', { name: /全拼检索/ }).click()
  await page.waitForTimeout(2500)
  const hasAb = await page.evaluate(() => /静态 RRF Top 3/.test(document.body.textContent ?? ''))
  expect(hasAb, '点击剧本后应自动渲染 A/B 对比').toBe(true)
})

test('公式卡默认折叠，展开后可见权重表', async ({ page }) => {
  await page.goto('/algorithms#linucb')
  await page.waitForLoadState('networkidle')

  const trigger = page.getByRole('button', { name: /查看评分公式与静态权重/ })
  await expect(trigger).toBeVisible()
  await expect(trigger).toHaveAttribute('aria-expanded', 'false')

  await trigger.click()
  await expect(trigger).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('[id="ab-formula-body"]')).toBeVisible()
})
