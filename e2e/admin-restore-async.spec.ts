/**
 * /admin/data/restore 的**异步**路径（E2E）。
 *
 * 与 admin-restore.spec.ts 的分工：那边验同步路径（小包：单事务、失败可整体回滚），
 * 这边验后台任务路径（大包：分片提交、失败**不会**回滚）。两条路径的措辞必须不同，
 * 这是本文件最主要断言的东西——把「已回滚」说给分片提交的失败场景，会让人误判
 * 库里没有脏数据。
 *
 * 只有跑起来才知道的四件事：
 *   1. 阈值分支真的走到 `POST /restore/async`，而不是仍然同步提交；
 *   2. 轮询真的在跑（进度条数字会变），终态会停（不再打 status 端点）；
 *   3. 「转到后台」真的停轮询（用请求计数验证，不看文案）；
 *   4. 失败态同时给出「已写入 N 条」与「这些会保留」。
 *
 * 只 mock 传输层，断言请求与页面事实，不断言 toast。
 */
import { test, expect, type Page } from '@playwright/test'
import { loginViaAdmin } from './helpers'

/**
 * 包内只有 3 条站点，但预演 mock 会返回 6000——
 * 阈值判定必须由**服务端算出的将写入条数**驱动，而不是本地包里的原始条数。
 * 这一点如果写错，重复率高的备份会被无谓推给后台任务（见守卫同名用例）。
 */
const BACKUP = {
  version: '1.0',
  generator: 'NavHub 2026 Sovereign Backup Engine',
  exportedAt: Date.now(),
  categories: [{ id: 'e2e-a1', title: 'E2E 异步分类', slug: 'e2e-async-cat' }],
  sites: [
    { id: 'e2e-as1', title: 'E2E 异步站点一', url: 'https://e2e-async-1.example.com', categoryId: 'e2e-a1' },
    { id: 'e2e-as2', title: 'E2E 异步站点二', url: 'https://e2e-async-2.example.com', categoryId: 'e2e-a1' },
    { id: 'e2e-as3', title: 'E2E 异步站点三', url: 'https://e2e-async-3.example.com', categoryId: 'e2e-a1' },
  ],
  stats: { categoryCount: 1, siteCount: 3 },
}

const JOB_ID = '9f2c1a44-e2e0-4a11-9c3d-000000000001'

interface AsynCalls {
  asyncPosts: Array<{ url: string; body: unknown }>
  statusHits: number
}

interface StatusStep {
  status: string
  done: number
  total: number
  error?: string
  retryable?: boolean
}

/**
 * 装一套 mock。
 * - 预演返回 6000 条（高于 5000 阈值）
 * - async 提交返回 202
 * - status 按 steps 依次返回，最后一步之后一直重复最后一步
 */
async function mockAsync(
  page: Page,
  options: { steps: StatusStep[]; asyncStatus?: number; asyncBody?: unknown },
): Promise<() => AsynCalls> {
  const calls: AsynCalls = { asyncPosts: [], statusHits: 0 }
  let stepIndex = 0

  await page.route('**/api/hub/backup/restore**', async (route) => {
    const request = route.request()
    const url = request.url()

    if (url.includes('/restore/status/')) {
      calls.statusHits += 1
      const step = options.steps[Math.min(stepIndex, options.steps.length - 1)]!
      stepIndex += 1
      await route.fulfill({
        json: {
          jobId: JOB_ID,
          status: step.status,
          progress: { done: step.done, total: step.total },
          startedAt: Date.now() - 4000,
          finishedAt: step.status === 'done' || step.status === 'failed' ? Date.now() : null,
          error: step.error ?? null,
          retryable: step.retryable ?? false,
        },
      })
      return
    }

    if (url.includes('/restore/async')) {
      let body: unknown = null
      try {
        body = JSON.parse(request.postData() ?? 'null')
      } catch {
        body = null
      }
      calls.asyncPosts.push({ url, body })

      if (options.asyncStatus && options.asyncStatus >= 400) {
        await route.fulfill({ status: options.asyncStatus, json: options.asyncBody ?? {} })
        return
      }
      await route.fulfill({
        status: 202,
        json: {
          ok: true,
          jobId: JOB_ID,
          accepted: { categories: 1, sites: 6000 },
          skipped: { duplicateCategories: 0, invalidUrls: 0, duplicateUrls: 0 },
          statusUrl: `/api/backup/restore/status/${JOB_ID}`,
          message: '已入队：将恢复 1 个分类与 6000 个站点（进度见 statusUrl）',
        },
      })
      return
    }

    // dryRun=true
    await route.fulfill({
      json: {
        ok: true,
        dryRun: true,
        wouldRestore: { categories: 1, sites: 6000 },
        skipped: { duplicateCategories: 0, invalidUrls: 0, duplicateUrls: 0 },
        sample: { categories: ['E2E 异步分类'], sites: ['https://e2e-async-1.example.com'] },
        message: '预演：将新增 1 个分类与 6000 个站点（未落库）',
      },
    })
  })

  return () => calls
}

async function gotoPage(page: Page) {
  // 会话建立与冷编译预热交给共享助手：它会在「点了没跳转」时再点一次。
  // 自己内联一份更弱的版本曾在这里偶发失败（首测冷编译，点击早于 hydration）。
  await loginViaAdmin(page)
  await page.goto('/admin/data/restore', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: '恢复冷备' })).toBeVisible({ timeout: 120_000 })
}

async function prepare(page: Page) {
  await page.locator('#backup-file').setInputFiles({
    name: 'e2e-async-backup.nhbak.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(BACKUP), 'utf8'),
  })
  await expect(page.getByText('e2e-async-backup.nhbak.json')).toBeVisible()
  await page.getByRole('button', { name: /预演（不写库）/ }).click()
  await expect(page.getByText('预演结果')).toBeVisible({ timeout: 10_000 })
}

test.describe('恢复冷备：后台任务路径', () => {
  test('超过阈值自动提交后台任务，进度可见，完成后展示结果', async ({ page }) => {
    const calls = await mockAsync(page, {
      steps: [
        { status: 'running', done: 2000, total: 6000 },
        { status: 'done', done: 6000, total: 6000 },
      ],
    })

    await gotoPage(page)
    await prepare(page)

    // 提交前就要说明「会走后台」——否则用户以为点了会卡住几十秒
    await expect(page.getByText(/将提交后台任务/)).toBeVisible()

    await page.locator('#confirm-restore').click()
    await page.getByRole('button', { name: '执行恢复' }).click()

    // 任务卡出现，第一轮轮询（立即执行）拿到 running 2000/6000
    await expect(page.getByText('3 · 后台恢复')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/已写入\s*2000\s*\/\s*6000\s*条/)).toBeVisible({ timeout: 10_000 })

    // 第二轮轮询拿到 done → 成功态
    await expect(page.getByText('成功恢复 1 个分类与 6000 个站点')).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('progressbar', { name: '恢复进度' })).toHaveAttribute('aria-valuenow', '6000')

    const recorded = calls()
    expect(recorded.asyncPosts).toHaveLength(1)
    // 提交的必须是完整备份包，不是摘要，也不是 6000 条占位数据
    const sent = recorded.asyncPosts[0]!.body as { sites?: unknown[]; categories?: unknown[] }
    expect(sent.sites).toHaveLength(3)
    expect(sent.categories).toHaveLength(1)
    // 终态后不应再轮询
    const hitsAtDone = recorded.statusHits
    await page.waitForTimeout(3500)
    expect(calls().statusHits).toBe(hitsAtDone)
  })

  test('失败态说清「已写入 N 条会保留」，绝不声称回滚', async ({ page }) => {
    await mockAsync(page, {
      steps: [
        { status: 'running', done: 2000, total: 6000 },
        { status: 'failed', done: 2000, total: 6000, error: 'insert sites failed: constraint', retryable: true },
      ],
    })

    await gotoPage(page)
    await prepare(page)
    await page.locator('#confirm-restore').click()
    await page.getByRole('button', { name: '执行恢复' }).click()

    await expect(page.getByText(/恢复中断：已写入\s*2000\s*条后失败/)).toBeVisible({ timeout: 20_000 })
    // 关键：分片已提交，不能说回滚。用具体措辞定位，避免与页首横幅的同句重复命中
    await expect(page.getByText(/已写入的那 2000 条会保留/)).toBeVisible()
    await expect(page.getByText('恢复失败，已整体回滚')).toHaveCount(0)
    // 可重试时要给出口
    await expect(page.getByRole('button', { name: /重跑（跳过已存在的 URL）/ })).toBeVisible()
  })

  test('提交阶段被拒（400）时说明任务未创建，不显示后台卡片', async ({ page }) => {
    await mockAsync(page, {
      steps: [{ status: 'pending', done: 0, total: 0 }],
      asyncStatus: 400,
      asyncBody: { error: 'INVALID_BACKUP', message: '无效的备份文件：sites 缺失必填字段' },
    })

    await gotoPage(page)
    await prepare(page)
    await page.locator('#confirm-restore').click()
    await page.getByRole('button', { name: '执行恢复' }).click()

    await expect(page.getByText('任务未创建，未写入任何数据')).toBeVisible({ timeout: 15_000 })
    // 一条都没写，就不该出现「已回滚」或进度卡
    await expect(page.getByText('恢复失败，已整体回滚')).toHaveCount(0)
    await expect(page.getByText('3 · 后台恢复')).toHaveCount(0)
  })

  test('「转到后台」真的停轮询（用请求计数验证，不看文案）', async ({ page }) => {
    const calls = await mockAsync(page, {
      // 一直 running：这样只有 watching 关掉才能停
      steps: [{ status: 'running', done: 1000, total: 6000 }],
    })

    await gotoPage(page)
    await prepare(page)
    await page.locator('#confirm-restore').click()
    await page.getByRole('button', { name: '执行恢复' }).click()

    await expect(page.getByText(/已写入\s*1000\s*\/\s*6000\s*条/)).toBeVisible({ timeout: 15_000 })

    await page.getByRole('button', { name: /转到后台，先离开本页/ }).click()
    await expect(page.getByText(/已转后台运行/)).toBeVisible()

    // 等两轮轮询间隔，计数不应再涨
    const before = calls().statusHits
    await page.waitForTimeout(4000)
    expect(calls().statusHits).toBe(before)

    // 还能接回来
    await page.getByRole('button', { name: '继续查看进度' }).click()
    await expect
      .poll(() => calls().statusHits, { timeout: 10_000 })
      .toBeGreaterThan(before)
  })
})
