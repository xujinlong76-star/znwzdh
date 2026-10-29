/**
 * [AI-6c] 浏览器实测脚本：管理端 AI 页新增的「模型单价簿」与成本/质量读数。
 *
 * 隔离栈（见 README）：web 127.0.0.1:3420 → hub 127.0.0.1:8920（空库）→ 假上游 127.0.0.1:8929。
 * 判据全部来自真实 DOM 文本与真实接口响应，不做源码断言。
 *
 * 流程：
 *  1. 凭证登录（NAVHUB_ADMIN_PASSWORD=sk-ai6-admin）
 *  2. 单价簿：空行保存 → 重复模型 → 负单价 → 合法保存（stub-model-1 / 0.002 / 0.006）
 *  3. 配置页：接上假上游（私网开关打开），stub-model-1 测试连接成功；改 stub-model-2 再测一次
 *     ⇒ 造出「有价 1 次 + 无价 1 次」的用量样本
 *  4. 保存配置，再经真实中枢接口两次画布生成（一次干净、一次保底）
 *  5. 观测大盘：成本来源/覆盖、分模型表、画布首过率、copilot 引用有效率
 */
import { chromium } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB = 'http://127.0.0.1:3420'
const HUB = 'http://127.0.0.1:8920'
const OUT = join(process.cwd(), 'deliverables/ai6-cost-2026-10-30/results')
const evidence = { startedAt: new Date().toISOString(), steps: [], assertions: [], errors: [] }

function record(step, data) {
  evidence.steps.push({ step, at: new Date().toISOString(), ...data })
}
function assert(name, ok, detail) {
  evidence.assertions.push({ name, ok: Boolean(ok), detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + JSON.stringify(detail) : ''))
  if (!ok) evidence.errors.push({ name, detail })
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const page = await context.newPage()
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      evidence.steps.push({ step: 'console', type: msg.type(), text: msg.text().slice(0, 400) })
    }
  })

  // ---------- 1. 登录 ----------
  await page.goto(WEB + '/auth/signin?callbackUrl=%2Fadmin%2Fai', { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('#password', { timeout: 180_000 })
  await page.fill('#password', 'sk-ai6-admin')
  await page.getByRole('button', { name: /登\s*录/ }).click()
  await page.waitForURL(/\/admin\/ai/, { timeout: 60_000 })
  await page.waitForSelector('text=AI 模型中枢与效能管理', { timeout: 180_000 })
  record('login', { url: page.url() })

  // ---------- 2. 单价簿 ----------
  await page.getByRole('button', { name: '切换到模型单价簿' }).click()
  await page.waitForSelector('text=模型单价簿（元 / 1K tokens）', { timeout: 60_000 })
  await page.waitForSelector('text=还没有任何分模型单价', { timeout: 60_000 })
  const legacyBefore = await page.locator('text=/旧版单一价/').first().innerText()
  assert('单价簿初始为空且提示回退语义', (await page.locator('body').innerText()).includes('还没有任何分模型单价'), { legacyBefore })

  // 2a. 空模型名
  await page.getByRole('button', { name: '添加模型' }).click()
  await page.getByRole('button', { name: '保存单价簿' }).click()
  await page.waitForSelector('text=第 1 行的模型名为空', { timeout: 15_000 })
  assert('空模型名被前端拦下', true)

  // 2b. 负单价
  await page.getByLabel('第 1 行模型 ID').fill('stub-model-1')
  await page.getByLabel('第 1 行输入单价').fill('-1')
  await page.getByLabel('第 1 行输出单价').fill('0.006')
  await page.getByRole('button', { name: '保存单价簿' }).click()
  await page.waitForSelector('text=单价必须是 0~10000 之间的数字', { timeout: 15_000 })
  assert('负数单价被前端拦下', true)

  // 2c. 重复模型（先把第一行修成合法价，确保走到查重分支）
  await page.getByLabel('第 1 行输入单价').fill('0.002')
  await page.getByRole('button', { name: '添加模型' }).click()
  await page.getByLabel('第 2 行模型 ID').fill('stub-model-1')
  await page.getByLabel('第 2 行输入单价').fill('0.002')
  await page.getByLabel('第 2 行输出单价').fill('0.006')
  await page.getByRole('button', { name: '保存单价簿' }).click()
  await page.waitForTimeout(800)
  const dupBanner = await page.locator('div.text-destructive').first().innerText().catch(() => '')
  const dupRows = await page.getByLabel(/第 \d+ 行模型 ID/).evaluateAll((els) => els.map((e) => e.value))
  assert('重复模型被前端拦下', dupBanner.includes('重复'), { dupBanner, dupRows })

  // 2d. 合法保存（删掉第二行，修好第一行）
  await page.getByRole('button', { name: '删除模型 stub-model-1' }).nth(1).click()
  await page.getByLabel('第 1 行输入单价').fill('0.002')
  await page.getByRole('button', { name: '保存单价簿' }).click()
  await page.waitForSelector('text=已保存', { timeout: 30_000 })
  const savedRows = await page.getByLabel(/第 \d+ 行模型 ID/).evaluateAll((els) => els.map((e) => e.value))
  assert('单价簿保存成功后回到已保存状态', savedRows.length === 1 && savedRows[0] === 'stub-model-1', { savedRows })
  const priceShot = join(OUT, 'shot-price-book.png')
  await page.screenshot({ path: priceShot, fullPage: false })
  record('price-book-saved', { savedRows, screenshot: priceShot })

  // 服务端核对：单价簿真的落库
  const prices = await page.evaluate(async () => (await fetch('/api/hub/api/admin/ai/prices')).json())
  assert(
    'GET /api/admin/ai/prices 返回刚保存的单价',
    prices?.prices?.length === 1 &&
      prices.prices[0].model === 'stub-model-1' &&
      prices.prices[0].promptPer1kRmb === 0.002 &&
      prices.prices[0].completionPer1kRmb === 0.006,
    prices,
  )

  // ---------- 3. 配置页：测试连接两次 ----------
  await page.getByRole('button', { name: '切换到模型配置' }).click()
  await page.waitForSelector('#llm-base', { timeout: 60_000 })
  await page.fill('#llm-base', 'http://127.0.0.1:8929/v1')
  await page.fill('#llm-model', 'stub-model-1')
  await page.fill('#llm-key', 'sk-stub-local-only')
  const privateToggle = page.locator('label:has-text("允许内网接口地址") input[type="checkbox"]')
  if (!(await privateToggle.isChecked())) await privateToggle.check()

  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForSelector('text=连通成功', { timeout: 60_000 })
  const test1 = await page.locator('text=/连通成功/').first().innerText()
  assert('stub-model-1 测试连接成功', test1.includes('连通成功'), { test1 })

  await page.fill('#llm-model', 'stub-model-2')
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForFunction(
    () => !document.body.innerText.includes('连通成功'),
    undefined,
    { timeout: 15_000 },
  ).catch(() => undefined)
  await page.waitForSelector('text=连通成功', { timeout: 60_000 })
  const test2 = await page.locator('text=/连通成功/').first().innerText()
  const test2Detail = await page.locator('p:has-text("回复预览")').first().innerText()
  assert('第二次测试连接由 stub-model-2 应答（无单价样本）', test2Detail.includes('stub-model-2'), { test2, test2Detail })
  record('test-connections', { first: test1, second: test2, test2Detail })

  // 保存配置（stub-model-1），画布生成走系统层
  await page.fill('#llm-model', 'stub-model-1')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForSelector('text=已保存', { timeout: 30_000 })
  record('config-saved', { model: 'stub-model-1', base: 'http://127.0.0.1:8929/v1' })

  // ---------- 4. 两次真实画布生成 ----------
  const canvas = async (prompt) => {
    const res = await fetch(HUB + '/api/user/ai/canvas/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-navhub-anon-id': 'ai6-e2e-anon' },
      body: JSON.stringify({ prompt }),
    })
    const json = await res.json().catch(() => null)
    return { status: res.status, json }
  }
  const clean = await canvas('给我一个工作台')
  const fallback = await canvas('给我一个保底工作台')
  assert(
    '干净画布生成成功且未用保底',
    clean.status === 200 &&
      clean.json?.fallbackUsed === false &&
      Array.isArray(clean.json?.layout?.widgets) &&
      clean.json.layout.widgets.length === 1,
    { status: clean.status, fallbackUsed: clean.json?.fallbackUsed, widgets: clean.json?.layout?.widgets?.length },
  )
  assert(
    '全幻觉画布走保底并记账',
    fallback.status === 200 && fallback.json?.fallbackUsed === true && (fallback.json?.canvasIssueTotal ?? 0) > 0,
    { status: fallback.status, fallbackUsed: fallback.json?.fallbackUsed, issues: fallback.json?.canvasIssueTotal },
  )
  writeFileSync(join(OUT, 'api-canvas.json'), JSON.stringify({ clean, fallback }, null, 2))

  // ---------- 5. 观测大盘 ----------
  await page.getByRole('button', { name: '切换到效能与 Token 遥测大盘' }).click()
  await page.waitForSelector('text=分模型成本与用量', { timeout: 120_000 })
  await page.waitForSelector('text=画布生成质量（首过率）', { timeout: 120_000 })

  const observability = await page.evaluate(async () => (await fetch('/api/hub/api/admin/ai/observability?window=24h')).json())
  writeFileSync(join(OUT, 'api-observability.json'), JSON.stringify(observability, null, 2))

  const bodyText = await page.locator('body').innerText()
  const costCaption = bodyText.includes('按调用时单价快照折算')
    ? (bodyText.match(/按调用时单价快照折算[^\n]*/) ?? [''])[0]
    : ''
  assert('成本卡显示「按调用时单价快照折算」', bodyText.includes('按调用时单价快照折算'), { costCaption })
  assert(
    '成本覆盖显示 3/4 次调用',
    bodyText.includes('3/4 次调用有单价'),
    { sample: (bodyText.match(/覆盖 [^\n]*/) ?? [''])[0] },
  )
  assert('总额按快照折算为 ¥0.0042', bodyText.includes('¥0.0042'), {
    estimated: observability?.estimatedCostRmb,
    costSource: observability?.costSource,
    coverage: observability?.costCoverage,
  })

  const modelTable = await page
    .locator('table')
    .filter({ hasText: '有价调用' })
    .first()
    .evaluate((t) => Array.from(t.querySelectorAll('tbody tr')).map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim())))
  const row1 = modelTable.find((r) => r[0] === 'stub-model-1')
  const row2 = modelTable.find((r) => r[0] === 'stub-model-2')
  assert(
    '分模型表：stub-model-1 全部有价、¥0.0042',
    Boolean(row1) && row1[4] === '3/3' && row1[5] === '¥0.0042',
    { row1 },
  )
  assert('分模型表：stub-model-2 显示「无价」而不是 ¥0', Boolean(row2) && row2[5] === '无价', { row2 })

  const canvasText = (bodyText.match(/画布生成质量（首过率）[\s\S]*?最近调用流/) ?? [''])[0]
  assert('画布首过率 50.0%（1/2）', canvasText.includes('50.0%') && canvasText.includes('1 / 2'), { sample: canvasText.slice(0, 400) })
  assert('画布保底 1 次、丢弃 2 张', /保底布局\s*1/.test(canvasText) && /丢弃卡片\s*2/.test(canvasText), null)
  assert('copilot 引用有效率一行存在（无样本时如实写未采集）', bodyText.includes('引用有效率'), {
    sample: (bodyText.match(/引用有效率[^\n]*/) ?? [''])[0],
  })

  // 服务端数值核对（DOM 之外的第二证据）
  assert(
    'observability 接口数值与页面一致',
    observability?.costSource === 'snapshot' &&
      observability?.costCoverage?.pricedCalls === 3 &&
      observability?.costCoverage?.totalCalls === 4 &&
      observability?.canvasQuality?.generations === 2 &&
      observability?.canvasQuality?.cleanGenerations === 1,
    {
      costSource: observability?.costSource,
      coverage: observability?.costCoverage,
      canvasQuality: observability?.canvasQuality,
    },
  )

  const shotTop = join(OUT, 'shot-observability-cost.png')
  await page.screenshot({ path: shotTop, fullPage: false })
  const quality = page.locator('div', { has: page.locator('text=画布生成质量（首过率）') }).last()
  await quality.scrollIntoViewIfNeeded()
  const shotQuality = join(OUT, 'shot-canvas-quality.png')
  await page.screenshot({ path: shotQuality, fullPage: false })
  record('observability', {
    costCaption,
    modelTable,
    screenshots: [shotTop, shotQuality],
    recentLogs: observability?.recentLogs?.length,
  })

  await browser.close()
  evidence.finishedAt = new Date().toISOString()
  evidence.ok = evidence.errors.length === 0
  writeFileSync(join(OUT, 'browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log('evidence written, ok=' + evidence.ok + ', failures=' + evidence.errors.length)
  if (!evidence.ok) process.exitCode = 1
}

main().catch((err) => {
  evidence.errors.push({ fatal: String(err?.stack ?? err) })
  evidence.finishedAt = new Date().toISOString()
  writeFileSync(join(OUT, 'browser-evidence.json'), JSON.stringify(evidence, null, 2))
  console.error(err)
  process.exit(1)
})
