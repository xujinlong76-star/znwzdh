/**
 * /admin/data/restore 的真实交互（E2E）。
 *
 * 源码守卫（`restore-page-guard.test.ts`）只能证明「代码里写了 dryRun=false」，
 * 证明不了「点了执行真的发出去、勾选框真的拦住」。这四件事只有跑起来才知道：
 *
 *   1. `<input type="file">` + `file.text()` 能不能读出中文 JSON；
 *   2. Radix Checkbox 的受控行为（受控组件不更新的话按钮永远不可用）；
 *   3. 预演与执行打的是**不同** query（写反等于预演就落库）；
 *   4. 失败时是否真的展示「已整体回滚」与 reason 译文。
 *
 * 只 mock 传输层，断言的是**实际发出的请求**（URL 的 query 与请求体），
 * 不去断言 toast 文案——那属于另一层，且 toast 有两份 DOM 容易 strict 冲突。
 */
import { test, expect, type Page } from '@playwright/test'
import { loginViaAdmin } from './helpers'

const BACKUP = {
  version: '1.0',
  generator: 'NavHub 2026 Sovereign Backup Engine',
  exportedAt: Date.now(),
  categories: [{ id: 'e2e-c1', title: 'E2E 恢复分类', slug: 'e2e-restore-cat' }],
  sites: [
    { id: 'e2e-s1', title: 'E2E 恢复站点一', url: 'https://e2e-restore-1.example.com', categoryId: 'e2e-c1' },
    { id: 'e2e-s2', title: 'E2E 恢复站点二', url: 'https://e2e-restore-2.example.com', categoryId: 'e2e-c1' },
    { id: 'e2e-s3', title: 'E2E 恢复站点三', url: 'https://e2e-restore-3.example.com', categoryId: 'e2e-c1' },
  ],
  stats: { categoryCount: 1, siteCount: 3 },
}

interface Captured {
  url: string
  body: unknown
}

/** 装 mock：记录每次 backup/restore 调用的完整 URL 与 body */
async function mockRestore(page: Page): Promise<() => Captured[]> {
  const calls: Captured[] = []
  await page.route('**/api/hub/backup/restore**', async (route) => {
    const request = route.request()
    const url = request.url()
    let body: unknown = null
    try {
      body = JSON.parse(request.postData() ?? 'null')
    } catch {
      body = null
    }
    calls.push({ url, body })

    if (url.includes('dryRun=false')) {
      // 让失败态可测：URL 里带一个约定标记
      if (url.includes('e2e-fail')) {
        await route.fulfill({
          status: 409,
          json: { error: 'RESTORE_FAILED', reason: 'duplicate_key', message: '备份恢复失败，已整体回滚；请修正备份内容后重试' },
        })
        return
      }
      await route.fulfill({
        json: {
          ok: true,
          message: '成功恢复 1 个分类与 3 个站点',
          restored: { categories: 1, sites: 3 },
          durationMs: 1234,
          reindexQueued: true,
        },
      })
      return
    }
    await route.fulfill({
      json: {
        ok: true,
        dryRun: true,
        wouldRestore: { categories: 1, sites: 3 },
        skipped: { duplicateCategories: 0, invalidUrls: 0, duplicateUrls: 0 },
        sample: { categories: ['E2E 恢复分类'], sites: ['https://e2e-restore-1.example.com'] },
        message: '预演：将新增 1 个分类与 3 个站点（未落库；确认后以 dryRun=false 执行）',
      },
    })
  })
  return () => calls
}

async function gotoPage(page: Page) {
  // 与 admin-restore-async 同口径：会话交给共享助手（含冷编译预热与重试点击）
  await loginViaAdmin(page)
  await page.goto('/admin/data/restore', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '恢复冷备' })).toBeVisible({ timeout: 120_000 })
}

/**
 * 选文件并等本地解析摘要出现。
 *
 * 重试的原因：`setInputFiles` 给 input 赋值并派发 change，但**React 还没 hydrate 时
 * 没有监听器接收**，表现为"文件选上了、页面没反应"，而且不报错。改用共享的
 * loginViaAdmin 后登录更快，这个窗口从偶发变成了必现。显式重试比 waitForTimeout
 * 赌一个毫秒数更可靠。
 */
async function pickBackup(page: Page) {
  const input = page.locator('#backup-file')
  for (let attempt = 0; attempt < 5; attempt++) {
    await input.setInputFiles({
      name: 'e2e-backup.nhbak.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(BACKUP), 'utf8'),
    })
    const ok = await page
      .getByText('e2e-backup.nhbak.json')
      .waitFor({ state: 'visible', timeout: 3_000 })
      .then(() => true)
      .catch(() => false)
    if (ok) break
    if (attempt === 4) throw new Error('选择文件后页面始终没显示文件名（hydration 未接管 input）')
  }
}

test.describe('恢复冷备：真实交互', () => {
  test('预演 → 勾选 → 执行：两处 query 不同，执行前勾选框是硬门槛', async ({ page }) => {
    const calls = await mockRestore(page)
    await gotoPage(page)
    await pickBackup(page)

    // 未预演时执行按钮不存在（它不是 disabled，而是根本没渲染出来）
    await expect(page.getByRole('button', { name: '执行恢复' })).toHaveCount(0)

    await page.getByRole('button', { name: /预演（不写库）/ }).click()
    await expect(page.getByText('预演结果')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByText('将新增站点')).toBeVisible()

    // 执行按钮出现但仍是 disabled（未勾选）
    const runBtn = page.getByRole('button', { name: '执行恢复' })
    await expect(runBtn).toBeVisible()
    await expect(runBtn).toBeDisabled()

    // 勾选后才可用 —— Radix Checkbox 是受控组件，这里同时验证受控更新
    await page.locator('#confirm-restore').click()
    await expect(runBtn).toBeEnabled()

    await runBtn.click()

    // 成功态：展示新增数量与耗时
    await expect(page.getByText('成功恢复 1 个分类与 3 个站点')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('1.2s')).toBeVisible()

    const recorded = calls()
    expect(recorded).toHaveLength(2)
    expect(recorded[0]!.url).toContain('dryRun=true')
    expect(recorded[1]!.url).toContain('dryRun=false')
    // 请求体必须是完整备份包（不是摘要），否则服务端会 400
    const sent = recorded[1]!.body as { sites?: unknown[]; categories?: unknown[] }
    expect(sent.sites).toHaveLength(3)
    expect(sent.categories).toHaveLength(1)
  })

  test('预演结果里的跳过项如实展示（非法 URL 会单独提示）', async ({ page }) => {
    await page.route('**/api/hub/backup/restore**', async (route) => {
      await route.fulfill({
        json: {
          ok: true,
          dryRun: true,
          wouldRestore: { categories: 0, sites: 2 },
          skipped: { duplicateCategories: 1, invalidUrls: 4, duplicateUrls: 7 },
          sample: { categories: [], sites: [] },
          message: '预演：将新增 0 个分类与 2 个站点（未落库；确认后以 dryRun=false 执行）',
        },
      })
    })
    await gotoPage(page)
    await pickBackup(page)
    await page.getByRole('button', { name: /预演（不写库）/ }).click()

    await expect(page.getByText('重复 URL')).toBeVisible()
    // 非法 URL 单独一行提示，而不是混进「重复」
    await expect(page.getByText(/另有 4 条 URL 非法/)).toBeVisible()
  })

  test('失败时展示「已整体回滚」与 reason 译文，不显示成功态', async ({ page }) => {
    await page.route('**/api/hub/backup/restore**', async (route) => {
      const url = route.request().url()
      if (url.includes('dryRun=true')) {
        await route.fulfill({
          json: {
            ok: true,
            dryRun: true,
            wouldRestore: { categories: 1, sites: 3 },
            skipped: { duplicateCategories: 0, invalidUrls: 0, duplicateUrls: 0 },
            sample: { categories: [], sites: [] },
            message: 'preview',
          },
        })
        return
      }
      await route.fulfill({
        status: 409,
        json: {
          error: 'RESTORE_FAILED',
          reason: 'duplicate_key',
          message: '备份恢复失败，已整体回滚；请修正备份内容后重试',
        },
      })
    })

    await gotoPage(page)
    await pickBackup(page)
    await page.getByRole('button', { name: /预演（不写库）/ }).click()
    await page.locator('#confirm-restore').click()
    await page.getByRole('button', { name: '执行恢复' }).click()

    // exact: 服务端 message 里也含「已整体回滚」，不用精确匹配会命中两处（strict 冲突）
    await expect(page.getByText('恢复失败，已整体回滚', { exact: true })).toBeVisible({ timeout: 15_000 })
    // reason 必须翻成人话，而不是把 duplicate_key 原样丢给用户
    await expect(page.getByText(/备份里有重复的主键/)).toBeVisible()
    await expect(page.getByText('成功恢复', { exact: false })).toHaveCount(0)
  })
})
