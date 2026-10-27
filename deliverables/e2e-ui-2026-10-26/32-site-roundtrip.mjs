import { loginAsAdmin, launch } from './lib.mjs'

const BASE = 'http://127.0.0.1:3401'
const out = []
const log = (l) => { out.push(l); console.log(l) }

const { browser, page } = await launch()
let posts = 0
page.on('request', (r) => { if (r.url().endsWith('/api/site') && r.method() === 'POST') posts++ })

await loginAsAdmin(page)
await page.goto(BASE + '/admin/site', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)

const btn = page.locator('[role=tabpanel][data-state=active]').getByRole('button', { name: /保存/ })
const idle = async () => {
  for (let i = 0; i < 120; i++) {
    if (!(await btn.isDisabled().catch(() => true))) return
    await page.waitForTimeout(500)
  }
}

// 先把上一轮留下的非法标题修好
await page.getByLabel('网站标题').fill('山羊胡导航')
await page.getByLabel('关键词').fill('alpha, beta')
await idle()
posts = 0
await btn.click()
await page.waitForTimeout(3000)
log(`[F 保存] POST次数=${posts} 横幅="${(await page.locator('[role=alert]').allInnerTexts()).join('|').slice(0, 100)}"`)

await page.getByRole('button', { name: /重新读取/ }).click()
await page.waitForTimeout(3000)
log(`[F 重读] 关键词="${await page.getByLabel('关键词').inputValue()}"`)

const hub = await fetch('http://127.0.0.1:8900/api/storage?path=src/navsphere/content/site.json', { cache: 'no-store' }).then((x) => x.json())
log(`[F 中枢] keywords="${hub.basic.keywords}" 字段数=${Object.keys(hub).join(',')}`)

// 前台是否已在缓存窗口内刷新（本机 dev 无 Data Cache，生产才有 60s 窗口）
const home = await fetch(BASE + '/', { cache: 'no-store' }).then((x) => x.text())
log(`[F 前台] 首页含新关键词=${home.includes('alpha, beta')}（meta keywords 命中即说明读取链路实时）`)

// 降级保护：把 web 指向一个不存在的中枢端口，/admin/site 必须禁止保存
await browser.close()
