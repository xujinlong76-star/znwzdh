/**
 * /admin/sitelist 的写路径（E2E）。
 *
 * 筛选那 4 例只覆盖读取。真正容易回归的是写入：表单校验、分类必填、
 * 组装 `navigationItems` 后整包提交——这几十行逻辑没有任何单测能触达
 * （组件渲染测试在本仓不可行，见 admin-sitelist.spec.ts 的说明）。
 *
 * 断言策略：只 mock 传输层，断言**实际发出的请求体**。
 * 不去 mock 组件、也不断言「页面显示了什么」——写路径的事实指标是
 * 「后端收到了什么」，UI 提示属于另一层。
 */
import { test, expect, type Page } from '@playwright/test'

const NAV = {
  navigationItems: [
    {
      id: 'e2e-w-cat',
      title: 'E2E写路径分类',
      icon: 'Bot',
      description: '',
      enabled: true,
      items: [
        { id: 'e2e-w-site', title: 'E2E待删站点', href: 'https://e2e-delete.example.com', description: '' },
      ],
      subCategories: [],
    },
  ],
}

interface Captured {
  method: string
  body: Record<string, unknown> | null
}

/** 装好 mock，返回「最后一次写请求」的取值器 */
async function mockApi(page: Page): Promise<() => Captured | null> {
  let last: Captured | null = null
  await page.route('**/api/navigation', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      await route.fulfill({ json: NAV })
      return
    }
    last = {
      method: request.method(),
      body: (() => {
        try {
          return JSON.parse(request.postData() ?? 'null')
        } catch {
          return null
        }
      })(),
    }
    await route.fulfill({ json: { success: true } })
  })
  // 表单会做 1 秒防抖的自动抓取；给个空元信息，避免真实出网并缩短等待
  await page.route('**/api/website-metadata', async (route) => {
    await route.fulfill({ json: { title: '', description: '', icon: '' } })
  })
  return () => last
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
  await expect(page.getByText('E2E待删站点', { exact: true })).toBeVisible({ timeout: 30_000 })
}

test.describe('管理端站点列表：写路径', () => {
  test('添加站点：填写 URL/名称/分类后整包提交，且新条目落在所选分类下', async ({ page }) => {
    const captured = await mockApi(page)
    await gotoList(page)

    await page.getByRole('button', { name: '添加站点' }).first().click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.locator('#url').fill('https://e2e-new.example.com/page')
    await dialog.locator('#name').fill('E2E新增站点')

    // Radix Select：必须先点开触发器、等 listbox 出现，再点 option。
    // 直接点 combobox 而不等列表，会因为弹层尚未挂载而静默不选中——
    // 随后「缺必填字段」会把失败伪装成表单校验问题。
    const categoryCombo = dialog.getByRole('combobox', { name: '选择分类' })
    await categoryCombo.scrollIntoViewIfNeeded()
    await categoryCombo.click()
    await expect(page.getByRole('listbox')).toBeVisible({ timeout: 10_000 })
    await page.getByRole('option', { name: 'E2E写路径分类' }).click()
    // 选中后触发器上应显示分类名（确认状态真的进了 newSite.categoryId）
    await expect(categoryCombo).toContainText('E2E写路径分类')

    await dialog.getByRole('button', { name: '添加站点' }).click()

    await expect.poll(() => captured() !== null, { timeout: 15_000 }).toBe(true)
    const sent = captured()!
    const items = ((sent.body?.navigationItems ?? []) as Array<Record<string, unknown>>)
    const category = items.find((cat) => cat.id === 'e2e-w-cat') as
      | { items?: Array<Record<string, unknown>> }
      | undefined
    expect(category).toBeTruthy()
    const added = (category!.items ?? []).find((item) => item.title === 'E2E新增站点')
    expect(added, '新站点应出现在所选分类的 items 里').toBeTruthy()
    expect(added!.href).toBe('https://e2e-new.example.com/page')
    // 原有条目必须保留（整包覆盖写最容易把它丢掉）
    expect((category!.items ?? []).some((item) => item.title === 'E2E待删站点')).toBe(true)
  })

  test('缺少分类时拒绝提交（前端必填校验而非静默丢弃）', async ({ page }) => {
    const captured = await mockApi(page)
    await gotoList(page)

    await page.getByRole('button', { name: '添加站点' }).first().click()
    const dialog = page.getByRole('dialog')
    await dialog.locator('#url').fill('https://e2e-nocat.example.com')
    await dialog.locator('#name').fill('E2E无分类')
    // 刻意不选分类
    await dialog.getByRole('button', { name: '添加站点' }).click()

    // 校验发生在本地：不应发出任何写请求
    // toast 在 DOM 里有两份（可见的 body + aria-live 通知区），用 first 避免 strict 冲突
    await expect(page.getByText('请填写必填字段').first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(800)
    expect(captured(), '缺必填字段时不应提交').toBeNull()
  })

  test('删除站点：确认后整包提交，且被删条目不再出现', async ({ page }) => {
    const captured = await mockApi(page)
    await gotoList(page)

    await page.getByRole('button', { name: '删除' }).first().click()
    const confirm = page.getByRole('alertdialog')
    await expect(confirm).toBeVisible()
    await expect(confirm).toContainText('E2E待删站点')
    await confirm.getByRole('button', { name: '删除' }).click()

    await expect.poll(() => captured() !== null, { timeout: 15_000 }).toBe(true)
    const sent = captured()!
    const items = ((sent.body?.navigationItems ?? []) as Array<Record<string, unknown>>)
    const category = items.find((cat) => cat.id === 'e2e-w-cat') as
      | { items?: Array<Record<string, unknown>> }
      | undefined
    expect(category).toBeTruthy()
    expect(
      (category!.items ?? []).some((item) => item.title === 'E2E待删站点'),
      '被删条目不应再出现在提交体里',
    ).toBe(false)
  })
})
