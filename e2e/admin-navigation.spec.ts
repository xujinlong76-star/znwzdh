import { test, expect } from '@playwright/test'

test.describe('管理端导航分类：列表与表单按需加载', () => {
  test('拖拽列表和添加表单在数据/弹窗出现后才加载', async ({ page }) => {
    // 只 mock GET：避免 E2E 改写真实的 navigation.json。
    await page.route('**/api/navigation', async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fulfill({ json: { success: true } })
        return
      }
      await route.fulfill({
        json: {
          navigationItems: [
            {
              id: 'e2e-lazy-navigation',
              title: 'E2E 懒加载分类',
              icon: 'Folder',
              description: '用于验证列表 chunk 按需加载',
              enabled: true,
              items: [],
              subCategories: [],
            },
          ],
        },
      })
    })

    await page.goto('/admin/navigation')
    await page.waitForLoadState('domcontentloaded')
    if (page.url().includes('/auth/signin') || page.url().includes('/login')) {
      const bypassBtn = page.getByRole('button', { name: /以管理员身份一键进/ })
      await expect(bypassBtn).toBeVisible({ timeout: 15_000 })
      await bypassBtn.click()
      await page.waitForURL(
        (url: URL) =>
          !url.pathname.startsWith('/auth/signin') && !url.pathname.startsWith('/login'),
        { timeout: 30_000 },
      )
    }

    await expect(page.getByText('E2E 懒加载分类', { exact: true })).toBeVisible({ timeout: 30_000 })

    await page.getByRole('button', { name: '添加分类' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('textbox', { name: '标题' })).toBeVisible({ timeout: 30_000 })
  })
})
