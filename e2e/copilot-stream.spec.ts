import { test, expect } from '@playwright/test'
import { createServer, type Server } from 'node:http'

/**
 * Copilot 流式链路的真实浏览器验收（E1/E2/E3 + C5）。
 *
 * 为什么必须用真网关而不是 page.route：route.fulfill 只能一次性交回完整响应，
 * 测不到「首 token 之前停止」「已出草稿后停止」「上游中途掐线」这三种时序；
 * 也测不到 C5——浏览器 abort 是否真的穿透 Next 代理打到上游。
 *
 * 网关按用例切换脚本：
 *   slow   —— 收到请求后什么都不写（首 token 前的等待）
 *   stream —— 推一段草稿后保持连接（用于中途停止）
 *   break  —— 推一段后销毁连接（模拟上游掐线）
 */

type Plan = 'slow' | 'stream' | 'break'

const state = {
  plan: 'slow' as Plan,
  hits: 0,
  /** 上游连接在正常写完之前被关闭 ⇒ 浏览器/代理的取消真的穿透到了这一跳 */
  aborted: false,
}

let gateway: Server
let gatewayUrl = ''

const chunk = (text: string) =>
  'data: ' + JSON.stringify({ model: 'fake-e2e', choices: [{ index: 0, delta: { content: text } }] }) + '\n\n'

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  gateway = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => {
      raw += String(c)
    })
    req.on('end', () => {
      state.hits += 1
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      res.on('close', () => {
        if (!res.writableEnded) state.aborted = true
      })

      if (state.plan === 'slow') {
        // 故意一个字节都不写：测试要在首 token 之前点停止
        return
      }
      if (state.plan === 'stream') {
        res.write(chunk('第一段草稿已经推给前端了。'))
        // 保持连接不结束：第二段永远不该在停止之后出现
        setTimeout(() => {
          if (!res.destroyed) res.write(chunk('这一段不该被写出来。'))
        }, 600)
        return
      }
      res.write(chunk('这是被腰斩的半截答案，模型还没说完。'))
      setTimeout(() => {
        if (!res.destroyed) res.destroy()
      }, 60)
    })
  })
  await new Promise<void>((resolve) => gateway.listen(0, '127.0.0.1', () => resolve()))
  const addr = gateway.address()
  if (!addr || typeof addr === 'string') throw new Error('假网关没有拿到端口')
  gatewayUrl = `http://127.0.0.1:${addr.port}/v1`
})

test.afterAll(async () => {
  await new Promise<void>((resolve) => gateway.close(() => resolve()))
})

test.beforeEach(async ({ page }) => {
  state.plan = 'slow'
  state.hits = 0
  state.aborted = false

  // 系统级模型配置必须走 /api/hub 代理（web 侧没有直连中枢的路由）。
  // 管理端接口要求管理员会话：先走 E2E 登录旁路，再写配置。
  await page.goto('/auth/signin', { waitUntil: 'domcontentloaded' })
  const bypass = page.getByRole('button', { name: /以管理员身份一键进入/ })
  if (await bypass.isVisible().catch(() => false)) {
    await bypass.click()
    await page.waitForURL((url) => !url.pathname.startsWith('/auth/signin'), { timeout: 30_000 }).catch(() => {})
  }

  const data = {
    enabled: true,
    name: 'E2E Fake',
    baseUrl: gatewayUrl,
    model: 'fake-e2e',
    apiKey: 'sk-e2e',
    timeoutMs: 5000,
    thinking: false,
    allowPrivateNetwork: true,
    fallbacks: [],
  }
  const saved = await page.request.put('/api/hub/admin/ai/config', { data })
  expect(saved.status(), '系统级模型配置保存失败：' + (await saved.text())).toBe(200)
})

test.afterEach(async ({ page }) => {
  await page.request.post('/api/hub/admin/ai/config/reset')
})

async function openCopilot(page: import('@playwright/test').Page) {
  const logs: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') logs.push('[console] ' + m.text())
  })
  page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message))

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  // 等客户端挂载：搜索框是首屏交互元素，它可见说明 React 已水合
  await expect(page.getByPlaceholder(/搜索导航/).first()).toBeVisible({ timeout: 60_000 })

  const dialog = page.getByRole('dialog', { name: '智能导航伴侣' })
  // 首屏网关可能尚未挂载：重复派发直到抽屉出现（网关会把意图寄存给懒加载的抽屉）
  await expect
    .poll(
      async () => {
        await page.evaluate(() =>
          window.dispatchEvent(new CustomEvent('open-ai-copilot', { detail: { source: 'keyboard' } })),
        )
        return dialog.count()
      },
      { timeout: 30_000, intervals: [500, 1000, 2000] },
    )
    .toBeGreaterThan(0)
  await expect(dialog, '抽屉未出现：\n' + logs.join('\n')).toBeVisible({ timeout: 15_000 })
  return dialog
}

test('E1 首 token 之前停止：不产出终稿，显示「已停止」', async ({ page }) => {
  const dialog = await openCopilot(page)
  await dialog.getByLabel('输入你的问题或需求').fill('离线 Markdown 编辑器')
  await dialog.getByRole('button', { name: /发送/ }).click()

  // slow 计划下模型永不吐字：停止按钮应立刻出现
  const stop = dialog.getByRole('button', { name: '停止' })
  await expect(stop).toBeVisible({ timeout: 10_000 })
  await stop.click()

  await expect(dialog.getByText(/已停止本次回答/).first()).toBeVisible({ timeout: 10_000 })
  // 没有任何模型正文被当答案
  await expect(dialog.getByText(/第一段草稿/)).toHaveCount(0)
})

test('E2 已出草稿后停止：草稿清空，且 abort 穿透到上游（C5）', async ({ page }) => {
  state.plan = 'stream'
  const dialog = await openCopilot(page)
  await dialog.getByLabel('输入你的问题或需求').fill('离线 Markdown 编辑器')
  await dialog.getByRole('button', { name: /发送/ }).click()

  await expect(dialog.getByText('第一段草稿已经推给前端了。')).toBeVisible({ timeout: 15_000 })
  await dialog.getByRole('button', { name: '停止' }).click()

  await expect(dialog.getByText(/已停止本次回答/).first()).toBeVisible({ timeout: 10_000 })
  // 停止后不得留下未定稿草稿，也不得出现第二段
  await expect(dialog.getByText(/第二段/)).toHaveCount(0)

  // C5：浏览器 abort → Next 代理 → 中枢 → 假网关，上游连接必须被真的关掉
  await expect
    .poll(() => state.aborted, { timeout: 15_000, message: '上游连接没有被取消（abort 没有穿透到模型这一跳）' })
    .toBe(true)
})

test('E3 上游中途掐线：done 用兜底正文收口，半截原文不冒充完成', async ({ page }) => {
  state.plan = 'break'
  const dialog = await openCopilot(page)
  await dialog.getByLabel('输入你的问题或需求').fill('离线 Markdown 编辑器')
  await dialog.getByRole('button', { name: /发送/ }).click()

  await expect(dialog.getByText(/模型这次调用失败，以下结果由站内混合检索给出/).first()).toBeVisible({ timeout: 20_000 })
  // 草稿已在终稿到达时整体作废
  await expect(dialog.getByText(/半截答案/)).toHaveCount(0)
})
