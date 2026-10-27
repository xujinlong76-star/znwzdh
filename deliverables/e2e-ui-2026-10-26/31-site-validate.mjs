import { loginAsAdmin, launch } from './lib.mjs'
import { writeFileSync } from 'node:fs'

const BASE = 'http://127.0.0.1:3401'
const out = []
const log = (l) => { out.push(l); console.log(l) }

const { browser, page } = await launch()

// 只统计「真正发出去的 /api/site 写请求」，避免上一轮请求的响应串到本轮计数里
let writes = []
page.on('request', (r) => {
  if (r.url().includes('/api/site') && r.method() === 'POST') writes.push(r.url())
})

await loginAsAdmin(page)
await page.goto(BASE + '/admin/site', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

const panel = page.locator('[role=tabpanel][data-state=active]')
const btn = panel.getByRole('button', { name: /保存/ })
const idle = async () => {
  for (let i = 0; i < 120; i++) {
    if (!(await btn.isDisabled().catch(() => true))) return
    await page.waitForTimeout(500)
  }
}

/* A. 非法 URL 应被前端拦下：0 次 POST + 内联红字 + 顶部横幅 */
await page.getByRole('tab', { name: '外观设置' }).click()
await page.waitForTimeout(800)
await page.getByLabel('Logo').fill('javascript:alert(1)')
await idle()
writes = []
await btn.click()
await page.waitForTimeout(2500)
log(`[A 非法URL] POST次数=${writes.length}`)
log(`[A] 横幅="${(await page.locator('[role=alert]').allInnerTexts()).join('|').slice(0, 120)}"`)
const msgs = await panel.evaluate((root) => Array.from(root.querySelectorAll('p')).map((p) => p.innerText).filter((t) => t.includes('必须是')))
log(`[A] 内联报错=${JSON.stringify(msgs)}`)

/* B. 超长标题 */
await page.getByRole('tab', { name: '基本信息' }).click()
await page.waitForTimeout(800)
writes = []
await page.getByLabel('网站标题').fill('超'.repeat(150))
await idle()
await btn.click()
await page.waitForTimeout(2000)
log(`[B 超长标题] POST次数=${writes.length} 横幅="${(await page.locator('[role=alert]').allInnerTexts()).join('|').slice(0, 90)}"`)

/* C. 备案号注入尝试（只允许白名单字符） */
writes = []
await page.getByRole('tab', { name: '页脚与备案' }).click()
await page.waitForTimeout(600)
await page.getByLabel('备案号').fill('<script>alert(1)</script>')
await idle()
await btn.click()
await page.waitForTimeout(2000)
log(`[C 恶意备案号] POST次数=${writes.length} 横幅="${(await page.locator('[role=alert]').allInnerTexts()).join('|').slice(0, 90)}"`)
const hubAfter = await fetch('http://127.0.0.1:8900/api/storage?path=src/navsphere/content/site.json', { cache: 'no-store' }).then((x) => x.json())
log(`[C] 中枢 footer=${JSON.stringify(hubAfter.footer)}`)

/* D. 打字不丢焦点（内联组件曾经的自伤） */
await page.getByRole('tab', { name: '基本信息' }).click()
await page.waitForTimeout(600)
const input = page.getByLabel('关键词')
await input.click()
await input.fill('')
await input.type('a,b,c,d,e,f', { delay: 120 })
const typed = await input.inputValue()
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id ?? document.activeElement?.tagName)
log(`[D 连续输入] 值="${typed}" 焦点仍在=${focused === 'INPUT' ? 'INPUT' : focused}`)

/* E. 保存后立刻重读要拿到新值（绕过缓存） */
await input.fill('alpha, beta')
await idle()
await btn.click()
await page.waitForTimeout(2500)
await page.getByRole('button', { name: /重新读取/ }).click()
await page.waitForTimeout(2500)
log(`[E 保存后重读] 关键词="${await input.inputValue()}"`)

await browser.close()
writeFileSync(new URL('./results/31-site-validate.log', import.meta.url), out.join('\n'))
