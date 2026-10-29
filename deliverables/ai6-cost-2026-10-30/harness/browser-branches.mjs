/**
 * [AI-6c] 补充：成本卡在「旧版单一价 / 未配置单价」两种来源下的界面话术。
 *
 * 真实中枢此刻是 snapshot 来源（见 browser.mjs 与 api-observability.json），
 * 这两种分支用 Playwright route 注入受控响应来验证渲染，服务端产物本身由
 * apps/api/test/llm-prices-api.test.ts（legacy / no-price 两个独立 ctx）覆盖。
 */
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const WEB = 'http://127.0.0.1:3420'
const OUT = join(process.cwd(), 'deliverables/ai6-cost-2026-10-30/results')
const real = JSON.parse(readFileSync(join(OUT, 'api-observability.json'), 'utf8'))
const evidence = { startedAt: new Date().toISOString(), assertions: [], errors: [] }

function assert(name, ok, detail) {
  evidence.assertions.push({ name, ok: Boolean(ok), detail })
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + JSON.stringify(detail) : ''))
  if (!ok) evidence.errors.push({ name, detail })
}

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: 'zh-CN' })
  const page = await context.newPage()

  // 登录
  await page.goto(WEB + '/auth/signin?callbackUrl=%2Fadmin%2Fai', { waitUntil: 'domcontentloaded', timeout: 180_000 })
  await page.waitForSelector('#password', { timeout: 180_000 })
  await page.fill('#password', 'sk-ai6-admin')
  await page.getByRole('button', { name: /登\s*录/ }).click()
  await page.waitForURL(/\/admin\/ai/, { timeout: 60_000 })
  await page.waitForSelector('text=AI 模型中枢与效能管理', { timeout: 180_000 })

  // A. 单价簿：旧版单一价已配置的徽标
  await page.route('**/api/hub/admin/ai/prices', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ prices: [], legacyUnitPriceRmb: 0.003 }) }),
  )
  await page.getByRole('button', { name: '切换到模型单价簿' }).click()
  await page.waitForSelector('text=旧版单一价 ¥0.003/1K', { timeout: 60_000 })
  assert('单价簿在 legacy 已配置时显示单一价徽标', true)

  // B. 观测大盘：legacy 来源话术
  const legacyPayload = { ...real, costSource: 'legacy', costUnitPriceRmb: 0.003, estimatedCostRmb: 0.003 }
  await page.route('**/api/hub/admin/ai/observability*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(legacyPayload) }),
  )
  await page.getByRole('button', { name: '切换到效能与 Token 遥测大盘' }).click()
  await page.waitForSelector('text=按旧版单一价', { timeout: 120_000 })
  const legacyText = await page.locator('body').innerText()
  assert(
    'legacy 来源：成本卡写明单一价并指引单价簿',
    legacyText.includes('按旧版单一价 ¥0.003/1K tokens 估算') && legacyText.includes('模型单价簿'),
    { sample: (legacyText.match(/按旧版单一价[^\n]*/) ?? [''])[0] },
  )

  // C. 观测大盘：未配置任何单价
  const nonePayload = { ...real, costSource: 'none', costUnitPriceRmb: null, estimatedCostRmb: null }
  await page.unroute('**/api/hub/admin/ai/observability*')
  await page.route('**/api/hub/admin/ai/observability*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(nonePayload) }),
  )
  await page.getByRole('button', { name: '切换到模型配置' }).click()
  await page.getByRole('button', { name: '切换到效能与 Token 遥测大盘' }).click()
  await page.waitForSelector('text=尚未填写单价', { timeout: 120_000 })
  const noneText = await page.locator('body').innerText()
  const costCard = noneText.slice(noneText.indexOf('预估折合资费'), noneText.indexOf('预估折合资费') + 200)
  assert('none 来源：金额显示「未配置」且不报假 ¥ 数', costCard.includes('未配置') && !/¥\d/.test(costCard), { sample: costCard })
  assert('none 来源：指向模型单价簿 / 环境变量', noneText.includes('NAVHUB_LLM_COST_PER_1K_TOKENS'), null)

  await browser.close()
  evidence.finishedAt = new Date().toISOString()
  evidence.ok = evidence.errors.length === 0
  writeFileSync(join(OUT, 'browser-branches-evidence.json'), JSON.stringify(evidence, null, 2))
  console.log('branch evidence ok=' + evidence.ok)
  if (!evidence.ok) process.exitCode = 1
}

main().catch((err) => {
  evidence.errors.push({ fatal: String(err?.stack ?? err) })
  writeFileSync(join(OUT, 'browser-branches-evidence.json'), JSON.stringify(evidence, null, 2))
  console.error(err)
  process.exit(1)
})
