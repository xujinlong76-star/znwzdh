import { expect, test, type Locator, type Page } from '@playwright/test'

// P0-6：用户中心设置摘要——单选 pill 可见焦点（A-02）+ 方向键（A-01）。
// 匿名态即可测：设置摘要是本机设置，不需要登录。

test.use({ viewport: { width: 1440, height: 1000 } })

async function openMe(page: Page, theme: 'light' | 'dark' = 'light') {
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme)
  await page.goto('/me')
  await page
    .locator('[role="radiogroup"][aria-label="卡片展示密度"]:visible')
    .first()
    .waitFor()
}

function group(page: Page, label: string): Locator {
  return page.locator(`[role="radiogroup"][aria-label="${label}"]:visible`).first()
}

async function focused(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null
    if (!el) return { role: null, text: '', focusVisible: false, boxShadow: 'none' }
    return {
      role: el.getAttribute('role'),
      text: (el.textContent ?? '').trim(),
      focusVisible: el.matches(':focus-visible'),
      boxShadow: getComputedStyle(el).boxShadow,
    }
  })
}

async function expectRingVisible(page: Page) {
  const f = await focused(page)
  expect(f.focusVisible, `焦点元素应匹配 :focus-visible，当前为 ${f.role}「${f.text}」`).toBe(true)
  expect(f.boxShadow, `焦点环 box-shadow 不应为空，当前为 ${f.role}「${f.text}」`).not.toBe('none')
}

async function waitGroupReady(g: Locator, count: number) {
  await expect(g.locator('[role="radio"]')).toHaveCount(count)
  await expect(g.locator('[role="radio"]:not([disabled])')).toHaveCount(count)
}

async function expectChecked(g: Locator, name: string) {
  await expect(g.getByRole('radio', { name })).toHaveAttribute('aria-checked', 'true')
  const tabs = await g.locator('[role="radio"]').evaluateAll((els) =>
    els.map((el) => ({ name: (el.textContent ?? '').trim(), tab: el.getAttribute('tabindex') })),
  )
  expect(tabs.find((t) => t.name === name)?.tab).toBe('0')
  expect(tabs.filter((t) => t.name !== name).every((t) => t.tab === '-1')).toBe(true)
}

async function tabUntil(page: Page, key: 'Tab' | 'Shift+Tab', match: (f: Awaited<ReturnType<typeof focused>>) => boolean, max = 80) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key)
    const f = await focused(page)
    if (match(f)) return i
  }
  const f = await focused(page)
  throw new Error(`按 ${key} ${max} 次未到达目标，当前焦点为 ${f.role}「${f.text}」`)
}

test('密度组：Tab 只停一次，方向键移动并选中，焦点环全程可见（浅色）', async ({ page }) => {
  await openMe(page, 'light')
  const density = group(page, '卡片展示密度')
  const retention = group(page, '历史保留周期')
  await waitGroupReady(density, 3)
  await waitGroupReady(retention, 4)

  // 默认选中「舒适」，且整组只有一个 Tab 停靠点。
  await expectChecked(density, '舒适')
  await expectChecked(retention, '180 天')

  // Tab 走通：从页首一路 Tab 到密度组，中间不会停在组内其他 pill 上。
  const steps = await tabUntil(page, 'Tab', (f) => f.role === 'radio' && f.text === '舒适')
  expect(steps).toBeGreaterThan(0)
  // 下一个 Tab 停靠点是保留周期组的选中项，不是密度组内其他 pill。
  await page.keyboard.press('Tab')
  const after = await focused(page)
  expect(after.role).toBe('radio')
  expect(after.text).toBe('180 天')

  // 回到密度组：Shift+Tab 一次。
  await page.keyboard.press('Shift+Tab')
  expect((await focused(page)).text).toBe('舒适')

  // 方向键：Right → 紧凑密排，焦点环可见；Left 回去；Down/Up 同理。
  await page.keyboard.press('ArrowRight')
  await expectChecked(density, '紧凑密排')
  expect((await focused(page)).text).toBe('紧凑密排')
  await expectRingVisible(page)
  await page.keyboard.press('ArrowLeft')
  await expectChecked(density, '舒适')
  await page.keyboard.press('ArrowDown')
  await expectChecked(density, '紧凑密排')
  await page.keyboard.press('ArrowUp')
  await expectChecked(density, '舒适')
  // End → 末项，Home → 首项。
  await page.keyboard.press('End')
  await expectChecked(density, '宽松沉浸')
  await expectRingVisible(page)
  await page.keyboard.press('Home')
  await expectChecked(density, '舒适')

  // 保留周期组：方向键同样移动并选中。
  await page.keyboard.press('Tab')
  expect((await focused(page)).text).toBe('180 天')
  await page.keyboard.press('ArrowRight')
  await expectChecked(retention, '365 天')
  expect((await focused(page)).text).toBe('365 天')
  await expectRingVisible(page)
  await page.keyboard.press('ArrowLeft')
  await expectChecked(retention, '180 天')
})

test('「知道了」：改 pill 后出现提示，键盘 Tab 能到达、焦点环可见、回车可关闭', async ({ page }) => {
  await openMe(page, 'light')
  const density = group(page, '卡片展示密度')
  await waitGroupReady(density, 3)

  await density.getByRole('radio', { name: '紧凑密排' }).click()
  const gotIt = page.getByRole('button', { name: '知道了' }).first()
  await expect(gotIt).toBeVisible()

  // 焦点在刚点的 pill 上；Shift+Tab 往回走，应能到达「知道了」按钮。
  await tabUntil(page, 'Shift+Tab', (f) => f.role === null && f.text === '知道了')
  await expectRingVisible(page)
  await page.keyboard.press('Enter')
  await expect(gotIt).toBeHidden()
})

test('深色：密度组方向键与焦点环可见', async ({ page }) => {
  await openMe(page, 'dark')
  await page.waitForFunction(() => document.documentElement.classList.contains('dark'))
  const density = group(page, '卡片展示密度')
  await waitGroupReady(density, 3)
  await expectChecked(density, '舒适')

  await tabUntil(page, 'Tab', (f) => f.role === 'radio' && f.text === '舒适')
  await page.keyboard.press('ArrowRight')
  await expectChecked(density, '紧凑密排')
  expect((await focused(page)).text).toBe('紧凑密排')
  await expectRingVisible(page)
  await page.keyboard.press('End')
  await expectChecked(density, '宽松沉浸')
  await expectRingVisible(page)
})
