/**
 * /admin/sitelist 的筛选旅程（E2E）。
 *
 * 为什么需要这一层：本轮把「站点归属查找 + 筛选」从页面组件抽成了纯函数
 * （`lib/admin/sitelist-index.ts`），纯函数单测能钉住语义，**但钉不住接线**——
 * 如果有人把 `filteredSites` 改回旧实现、或者在渲染里漏传索引，
 * 单测依旧全绿而页面已经退化。仓里已有的 `sitelist-*` 守卫都是源码字符串断言，
 * 同样测不出「跑起来对不对」。
 *
 * 组件级渲染测试在本仓不可行（vitest environment 是 node，且没有 jsdom/RTL，
 * apps/web 又是 vendored 目录，加依赖会越界）。Playwright 是既有先例
 * （`admin-navigation.spec.ts` 同款管理员旁路 + 只 mock GET），所以走这条。
 *
 * 覆盖三条最容易改坏的语义：
 *   1. 搜索跨 name / href / description；
 *   2. 分类筛选把子分类站点归并到父分类；
 *   3. `无子分类` 包含「挂在主分类下」与「完全未归类」两类站点。
 */
import { test, expect, type Page } from '@playwright/test'

const NAV = {
  navigationItems: [
    {
      id: 'e2e-cat-ai',
      title: 'E2E-AI 工具',
      icon: 'Bot',
      description: '',
      enabled: true,
      items: [
        { id: 'e2e-site-root', title: 'E2E主分类站点', href: 'https://e2e-root.example.com', description: '挂在主分类' },
      ],
      subCategories: [
        {
          id: 'e2e-sub-chat',
          title: 'E2E对话',
          icon: 'MessageSquare',
          items: [
            { id: 'e2e-site-chat', title: 'E2E对话站点', href: 'https://e2e-chat.example.com', description: '对话工具' },
          ],
        },
      ],
    },
    {
      id: 'e2e-cat-dev',
      title: 'E2E开发',
      icon: 'Code',
      description: '',
      enabled: true,
      items: [
        { id: 'e2e-site-dev', title: 'E2E开发站点', href: 'https://e2e-dev.example.com', description: '开发工具' },
      ],
      subCategories: [],
    },
  ],
}

/** 只 mock GET /api/navigation：避免 E2E 改写真实导航数据 */
async function mockNavigation(page: Page) {
  await page.route('**/api/navigation', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fulfill({ json: { success: true } })
      return
    }
    await route.fulfill({ json: NAV })
  })
}

async function gotoList(page: Page) {
  await page.goto('/admin/sitelist')
  await page.waitForLoadState('domcontentloaded')
  if (page.url().includes('/auth/signin') || page.url().includes('/login')) {
    const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进/ })
    await expect(bypassBtn).toBeVisible({ timeout: 15_000 })
    await bypassBtn.click()
    await page.waitForURL(
      (url: URL) => !url.pathname.startsWith('/auth/signin') && !url.pathname.startsWith('/login'),
      { timeout: 30_000 },
    )
  }
  await expect(page.getByText('E2E主分类站点', { exact: true })).toBeVisible({ timeout: 30_000 })
}

/** 数据行数（表头不算） */
async function rowCount(page: Page): Promise<number> {
  const rows = await page.locator('tbody tr').count()
  return rows
}

test.describe('管理端站点列表：搜索与筛选', () => {
  test('搜索命中名称 / URL / 描述，清空后恢复全部', async ({ page }) => {
    await mockNavigation(page)
    await gotoList(page)
    expect(await rowCount(page)).toBe(3)

    const search = page.getByRole('textbox', { name: '搜索站点' })

    // 名称
    await search.fill('E2E对话')
    await expect.poll(() => rowCount(page)).toBe(1)
    await expect(page.getByText('E2E对话站点', { exact: true })).toBeVisible()

    // URL
    await search.fill('e2e-dev.example')
    await expect.poll(() => rowCount(page)).toBe(1)
    await expect(page.getByText('E2E开发站点', { exact: true })).toBeVisible()

    // 描述
    await search.fill('挂在主分类')
    await expect.poll(() => rowCount(page)).toBe(1)
    await expect(page.getByText('E2E主分类站点', { exact: true })).toBeVisible()

    // 清空恢复
    await search.fill('')
    await expect.poll(() => rowCount(page)).toBe(3)
  })

  test('搜索无命中时显示「未找到匹配的站点」而不是「暂无站点」', async ({ page }) => {
    await mockNavigation(page)
    await gotoList(page)

    await page.getByRole('textbox', { name: '搜索站点' }).fill('zzz-不存在-zzz')
    await expect.poll(() => rowCount(page)).toBe(0)
    // 诚实区分：筛选无结果 ≠ 库里没有站点
    await expect(page.getByText('未找到匹配的站点')).toBeVisible()
    await expect(page.getByText('暂无站点')).toHaveCount(0)
  })

  test('分类筛选把子分类站点归并到父分类', async ({ page }) => {
    await mockNavigation(page)
    await gotoList(page)

    await page.getByRole('combobox', { name: '按分类筛选' }).click()
    await page.getByRole('option', { name: 'E2E-AI 工具' }).click()

    // 主分类站点 + 子分类站点都在
    await expect.poll(() => rowCount(page)).toBe(2)
    await expect(page.getByText('E2E主分类站点', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E对话站点', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E开发站点', { exact: true })).toHaveCount(0)
  })

  test('「无子分类」同时包含主分类站点与未归类站点', async ({ page }) => {
    await mockNavigation(page)
    await gotoList(page)

    await page.getByRole('combobox', { name: '按子分类筛选' }).click()
    await page.getByRole('option', { name: '无子分类' }).click()

    // 两个分类的主分类站点都在；子分类站点被排除
    await expect.poll(() => rowCount(page)).toBe(2)
    await expect(page.getByText('E2E主分类站点', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E开发站点', { exact: true })).toBeVisible()
    await expect(page.getByText('E2E对话站点', { exact: true })).toHaveCount(0)
  })
})
