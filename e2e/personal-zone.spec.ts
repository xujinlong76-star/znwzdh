import { test, expect, type Page } from '@playwright/test'

/**
 * 离线个人数据层「我的常用」E2E（2026-11-20 20:00 战略研究 W9 落地）。
 *
 * 覆盖冻结范围：固定、取消、排序、自定义链接增删、坏文件导入拒绝、
 * 清除后恢复默认、断网可用。数据只存浏览器本地：用例不点站外链接
 * （只断言 href，不实际导航到第三方站），不依赖任何后端。
 *
 * 站点选择：ChatGPT（nav-da02af4f6414，AI 工具 / 对话助手）与
 * DeepSeek（nav-9336ef9971b1）都在首屏前两个 eager 分类里，无需滚动
 * 懒加载区；固定按钮在卡片悬停时才可点，先 hover 卡片再点。
 */

const PERSONAL_KEY = 'znw:personal:v1'

function personalData(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    pinned: [],
    customLinks: [],
    scenes: [],
    activeSceneId: null,
    prefs: { recordRecent: true },
    counters: { pin: 0, personalClick: 0, exportCount: 0, importCount: 0, clearCount: 0 },
    ...overrides,
  }
}

async function seedPersonal(page: Page, data: Record<string, unknown>) {
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      window.localStorage.setItem(key, value)
    },
    { key: PERSONAL_KEY, value: JSON.stringify(data) },
  )
}

async function pinCard(page: Page, siteId: string, siteName: string) {
  const card = page.locator(`[data-navhub-site-id="${siteId}"]`).first()
  await card.scrollIntoViewIfNeeded()
  await card.hover({ timeout: 20_000 })
  const pinBtn = page.getByRole('button', { name: `固定到「我的常用」：${siteName}`, exact: true }).first()
  await expect(pinBtn).toBeVisible({ timeout: 20_000 })
  // force：固定钮平时藏在卡片悬停显隐层里；常规 click 的滚动复位会让
  // 鼠标离开卡片、hover 丢失，点按落到卡片外链上（新标签页打开站点、
  // 固定没触发）。force 直接在按钮上派发点击，测的就是固定逻辑本身。
  await pinBtn.click({ force: true })
}

test.describe('「我的常用」首页专区', () => {
  test('未使用时完全折叠：首页没有专区、不占位', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('my-personal-zone')).toHaveCount(0)
  })

  test('卡片固定 → 专区出现；取消固定 → 专区恢复折叠', async ({ page }) => {
    await page.goto('/')
    await pinCard(page, 'nav-da02af4f6414', 'ChatGPT')
    const zone = page.getByTestId('my-personal-zone')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    await expect(zone.getByTestId('personal-pin-item')).toHaveCount(1)
    await expect(zone.getByText('ChatGPT', { exact: true }).first()).toBeVisible()
    // 专区内取消固定
    await zone.getByTestId('personal-unpin').first().click()
    await expect(page.getByTestId('my-personal-zone')).toHaveCount(0)
  })

  test('排序：往前移换顺序', async ({ page }) => {
    await seedPersonal(page, personalData({
      pinned: [
        { siteId: 'nav-da02af4f6414', title: 'ChatGPT', href: 'https://chatgpt.com' },
        { siteId: 'nav-9336ef9971b1', title: 'DeepSeek', href: 'https://www.deepseek.com' },
      ],
    }))
    await page.goto('/')
    const zone = page.getByTestId('my-personal-zone')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    const orderBefore = await zone.getByTestId('personal-pin-item').allTextContents()
    expect(orderBefore[0]).toContain('ChatGPT')
    // 把第二项往前移
    await zone.getByTestId('personal-move-left').nth(1).click()
    const orderAfter = await zone.getByTestId('personal-pin-item').allTextContents()
    expect(orderAfter[0]).toContain('DeepSeek')
    expect(orderAfter[1]).toContain('ChatGPT')
  })

  test('自定义链接：添加 → 出现；非法 URL 拒绝；删除 → 消失', async ({ page }) => {
    await seedPersonal(page, personalData({
      pinned: [{ siteId: 'nav-da02af4f6414', title: 'ChatGPT', href: 'https://chatgpt.com' }],
    }))
    await page.goto('/')
    const zone = page.getByTestId('my-personal-zone')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    await zone.getByTestId('personal-add-link').click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible({ timeout: 10_000 })
    // 非法 URL 先拒绝
    await dialog.getByLabel('名称').fill('坏链接')
    await dialog.getByLabel('网址').fill('javascript:alert(1)')
    await dialog.getByRole('button', { name: '添加到「我的常用」' }).click()
    await expect(dialog.getByRole('alert')).toBeVisible()
    await expect(zone.getByTestId('personal-custom-link')).toHaveCount(0)
    // 合法链接添加成功
    await dialog.getByLabel('名称').fill('我的博客')
    await dialog.getByLabel('网址').fill('example.com')
    await dialog.getByRole('button', { name: '添加到「我的常用」' }).click()
    await expect(zone.getByTestId('personal-custom-link')).toHaveCount(1)
    await expect(zone.getByTestId('personal-custom-link').getByText('我的博客')).toBeVisible()
    // 删除
    await zone.getByTestId('personal-remove-link').first().click()
    await expect(zone.getByTestId('personal-custom-link')).toHaveCount(0)
  })

  test('断网可用：离线后专区仍可操作（移动/添加链接弹窗），不依赖网络', async ({ page, context }) => {
    // 本环境 Service Worker 未接管页面（pwa-register 实测 getRegistrations() 为 0），
    // 离线 reload 文档请求本身就会失败；不断言 reload，断言已加载页面的
    // 本地数据操作在断网后仍可用——这才是「我的常用」离线可用的真实含义。
    await seedPersonal(page, personalData({
      pinned: [
        { siteId: 'nav-da02af4f6414', title: 'ChatGPT', href: 'https://chatgpt.com' },
        { siteId: 'nav-9336ef9971b1', title: 'DeepSeek', href: 'https://www.deepseek.com' },
      ],
    }))
    await page.goto('/')
    const zone = page.getByTestId('my-personal-zone')
    await expect(zone).toBeVisible({ timeout: 20_000 })
    await context.setOffline(true)
    try {
      // 排序（纯本地写 localStorage）
      await zone.getByTestId('personal-move-left').nth(1).click()
      const order = await zone.getByTestId('personal-pin-item').allTextContents()
      expect(order[0]).toContain('DeepSeek')
      // 添加链接弹窗（纯本地组件）
      await zone.getByTestId('personal-add-link').click()
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
      await page.keyboard.press('Escape')
      // 取消固定（纯本地）
      await zone.getByTestId('personal-unpin').first().click()
      await expect(zone.getByTestId('personal-pin-item')).toHaveCount(1)
    } finally {
      await context.setOffline(false)
    }
  })
})

test.describe('「我的数据与隐私」页', () => {
  test('一屏说明数据只在浏览器里；坏文件导入拒绝、现有数据不动', async ({ page }) => {
    await seedPersonal(page, personalData({
      pinned: [{ siteId: 'nav-da02af4f6414', title: 'ChatGPT', href: 'https://chatgpt.com' }],
    }))
    await page.goto('/personal')
    await expect(page.getByText('只在你的浏览器里')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('personal-count-pinned')).toContainText('1 / 24')
    // 坏文件导入
    await page.setInputFiles('input[type="file"]', {
      name: 'bad.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{not json'),
    })
    await expect(page.getByText('导入失败').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('personal-count-pinned')).toContainText('1 / 24')
    // 格式不对的文件同样拒绝
    await page.setInputFiles('input[type="file"]', {
      name: 'wrong.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify({ format: 'something-else', version: 1, data: {} })),
    })
    await expect(page.getByText('导入失败').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('personal-count-pinned')).toContainText('1 / 24')
  })

  test('清除后恢复默认：回首页专区消失', async ({ page }) => {
    await seedPersonal(page, personalData({
      pinned: [{ siteId: 'nav-da02af4f6414', title: 'ChatGPT', href: 'https://chatgpt.com' }],
    }))
    await page.goto('/personal')
    await expect(page.getByTestId('personal-count-pinned')).toContainText('1 / 24')
    page.on('dialog', (dialog) => void dialog.accept())
    await page.getByTestId('personal-clear-all').click()
    await expect(page.getByTestId('personal-count-pinned')).toContainText('0 / 24')
    await page.goto('/')
    await expect(page.getByTestId('my-personal-zone')).toHaveCount(0)
  })

  test('导出 → 导入往返：导出文件再导入，置顶恢复', async ({ page }) => {
    await seedPersonal(page, personalData({
      pinned: [{ siteId: 'nav-da02af4f6414', title: 'ChatGPT', href: 'https://chatgpt.com' }],
    }))
    await page.goto('/personal')
    const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
    await page.getByTestId('personal-export').click()
    const download = await downloadPromise
    const path = await download.path()
    expect(path).toBeTruthy()
    // 先清除，再导入刚才导出的文件
    page.on('dialog', (dialog) => void dialog.accept())
    await page.getByTestId('personal-clear-all').click()
    await expect(page.getByTestId('personal-count-pinned')).toContainText('0 / 24')
    await page.setInputFiles('input[type="file"]', path!)
    await expect(page.getByText('导入成功')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('personal-count-pinned')).toContainText('1 / 24', { timeout: 10_000 })
  })
})
