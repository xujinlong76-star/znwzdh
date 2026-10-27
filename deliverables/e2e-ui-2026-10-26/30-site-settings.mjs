import { loginAsAdmin, launch, observe, newBag, BASE } from './lib.mjs'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const out = []
const log = (line) => { out.push(line); console.log(line) }

const bag = newBag()
const { browser, page } = await launch()
observe(page, bag)

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
const pngPath = fileURLToPath(new URL('./fixtures-upload.png', import.meta.url))
writeFileSync(pngPath, PNG)

await loginAsAdmin(page)
log(`[login] ${page.url()}`)

await page.goto(BASE + '/admin/site', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('load').catch(() => {})
await page.waitForTimeout(3000)

log(`[page] tabs=${await page.locator('[role=tab]').count()} degradedBanner=${await page.locator('text=中枢当前不可达').count()} saveButtons=${await page.getByRole('button', { name: /保存更改/ }).count()}`)
log(`[page] 初始标题="${await page.getByLabel('网站标题').inputValue().catch(() => 'N/A')}"`)

const tab = async (name) => {
  await page.getByRole('tab', { name }).click()
  await page.waitForTimeout(500)
  return page.locator(`[role=tabpanel][data-state=active]`)
}
const freshRead = async () => {
  await page.getByRole('button', { name: /重新读取/ }).click()
  await page.waitForTimeout(2500)
}
const waitIdle = async (btn) => {
  for (let i = 0; i < 180; i++) {
    const disabled = await btn.isDisabled().catch(() => true)
    if (!disabled) return
    await page.waitForTimeout(500)
  }
  throw new Error('保存按钮始终不可用')
}
const saveTab = async () => {
  const reqs = []
  const btn = page.locator('[role=tabpanel][data-state=active]').getByRole('button', { name: /保存/ })
  // dev 首帧编译 /api/site 很慢，按钮会停在 disabled 的「保存中」；不等它空闲就会点空
  await waitIdle(btn)
  const handler = (r) => { if (r.url().includes('/api/site')) reqs.push(`${r.request().method()}→${r.status()}`) }
  page.on('response', handler)
  await btn.click()
  await page.waitForTimeout(800)
  await waitIdle(btn).catch(() => {})
  await page.waitForTimeout(800)
  page.off('response', handler)
  const banner = (await page.locator('[role=alert]').allInnerTexts().catch(() => [])).join(' | ').slice(0, 220)
  return { reqs, banner }
}

/* 1. 基本信息 */
await page.getByLabel('网站标题').fill('山羊胡导航')
await page.getByLabel('网站描述').fill('AI 原生网址导航：站点设置中心端到端验证专用描述文案')
await page.getByLabel('关键词').fill('导航, 测试, 设置中心')
let r = await saveTab()
log(`[basic] ${r.reqs.join(',')} banner="${r.banner}"`)
await freshRead()
log(`[basic] 重读标题="${await page.getByLabel('网站标题').inputValue()}"`)

/* 2. 隐形校验（历史缺陷：错误藏在看不见的 tab 里，按钮看着是死的） */
const ap = await tab('外观设置')
await page.getByLabel('Logo').fill('javascript:alert(1)')
r = await saveTab()
const inlineErr = await ap.evaluate((root) => {
  const ps = Array.from(root.querySelectorAll('p'))
  return ps.map((p) => p.innerText).find((t) => t.includes('必须是')) ?? ps.map((p) => p.innerText).filter(Boolean)[0] ?? ''
})
log(`[validate] 非法URL 发出请求数=${r.reqs.length} 内联报错="${inlineErr.slice(0, 70)}" banner="${r.banner.slice(0, 90)}"`)
await page.getByLabel('Logo').fill('')

/* 3. 主题 + 品牌色 */
await ap.getByRole('combobox').first().click()
await page.waitForTimeout(600)
await page.locator('[role=option]').filter({ hasText: '始终深色' }).first().click()
await page.waitForTimeout(400)
await page.getByLabel('品牌色').fill('#22AA55')
r = await saveTab()
log(`[appearance] ${r.reqs.join(',')} banner="${r.banner}"`)
await freshRead()
log(`[appearance] 重读主题="${(await ap.getByRole('combobox').first().innerText().catch(() => '?')).trim()}" 品牌色="${await page.getByLabel('品牌色').inputValue()}"`)

/* 4. 上传 logo（assetField 的第一个 file input 属于 Logo） */
await page.locator('input[type=file]').first().setInputFiles(pngPath)
await page.waitForTimeout(4000)
const logoVal = await page.getByLabel('Logo').inputValue()
log(`[upload] 上传后 Logo 字段="${logoVal}"`)
r = await saveTab()
log(`[upload] 保存 ${r.reqs.join(',')} banner="${r.banner}"`)

/* 5. 分享图 */
await tab('分享图')
await page.getByLabel('默认分享大图').fill('/icons/icon-192.png')
r = await saveTab()
log(`[share] ${r.reqs.join(',')} banner="${r.banner}"`)

/* 6. 页脚与备案 */
await tab('页脚与备案')
await page.getByLabel('页脚文案').fill('本页文案来自站点设置中心·端到端验证')
await page.getByLabel('备案号').fill('京ICP备 2026000000号-1')
r = await saveTab()
log(`[footer] ${r.reqs.join(',')} banner="${r.banner}"`)

/* 7. 导航设置 */
const nv = await tab('导航设置')
await nv.getByRole('combobox').first().click()
await page.waitForTimeout(600)
await page.locator('[role=option]').filter({ hasText: '_self' }).first().click()
await page.waitForTimeout(400)
r = await saveTab()
log(`[nav] ${r.reqs.join(',')} banner="${r.banner}"`)

/* 8. 消费方真的生效了吗（全新请求，绕开浏览器缓存） */
await page.waitForTimeout(1500)
const home = await fetch(BASE + '/', { cache: 'no-store' }).then((x) => x.text())
const pick = (re) => (home.match(re) ?? [])[1] ?? '(缺席)'
log(`[consume][首页] <title>="${pick(/<title>([^<]*)<\/title>/)}"`)
log(`[consume][首页] rel=icon=${pick(/rel="icon"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*rel="icon"/)}`)
log(`[consume][首页] og:image=${pick(/property="og:image"[^>]*content="([^"]+)"|content="([^"]+)"[^>]*property="og:image"/)}`)
log(`[consume][首页] 页脚文案出现=${home.includes('端到端验证')} 备案号出现=${home.includes('ICP备 2026000000')}`)
log(`[consume][首页] 卡片 target=_self 出现=${/target="_self"/.test(home)}`)

const man = await fetch(BASE + '/manifest.webmanifest', { cache: 'no-store' }).then((x) => x.json())
log(`[consume][manifest] name=${man.name} short=${man.short_name} theme_color=${man.theme_color}`)

if (logoVal.startsWith('/api/site/asset/')) {
  const a = await fetch(BASE + logoVal, { cache: 'no-store' })
  log(`[consume][asset] ${a.status} ${a.headers.get('content-type')} cache=${a.headers.get('cache-control')} nosniff=${a.headers.get('x-content-type-options')}`)
}

/* 中枢里真正落库的内容（多 tab 连续保存是否互相抹字段） */
const raw = await fetch('http://127.0.0.1:8900/api/storage?path=src/navsphere/content/site.json', { cache: 'no-store' }).then((x) => x.json())
log(`[hub] 落库=${JSON.stringify(raw)}`)
log(`[hub] 字段齐全=${['title', 'themeColor', 'ogImage', 'linkTarget'].every((k) => JSON.stringify(raw).includes(k)) && !!raw.footer?.icp}`)

/* 9. 默认主题对全新访客生效（无 localStorage） */
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const anon = await ctx2.newPage()
await anon.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await anon.waitForTimeout(3000)
log(`[consume][新访客首页] html.dark=${await anon.evaluate(() => document.documentElement.classList.contains('dark'))}`)
await anon.goto(BASE + '/tags', { waitUntil: 'domcontentloaded' }).catch(() => {})
await anon.waitForTimeout(2500)
const footerText = (await anon.locator('footer').innerText().catch(() => '(无页脚)')).replace(/\s+/g, ' ')
log(`[consume][新访客/tags 页脚] …${footerText.slice(-90)}`)
await ctx2.close()

log(`[console] errors=${bag.consoleErrors.length} warnings=${bag.consoleWarnings.length}`)
bag.consoleErrors.slice(0, 6).forEach((e) => log('  ! ' + e.slice(0, 170)))

writeFileSync(new URL('./results/30-site-settings.log', import.meta.url), out.join('\n'))
await browser.close()
