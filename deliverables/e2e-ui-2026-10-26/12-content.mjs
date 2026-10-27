/**
 * 内容层面的复核：只看「卡片数量」会把「换了一批内容」误判成「没反应」。
 * 这里改成比对首屏条目标题与 URL 参数，判定「切换是否真的换了数据集」。
 */
import { session, open, BASE, OUT, clickText } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const top = (page, sel) =>
  page.evaluate(
    (s) =>
      [...document.querySelectorAll(s)]
        .slice(0, 5)
        .map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 28)),
    sel
  )

const out = {}
const s = await session()
const { page } = s

// (a) /hot 飙升榜 ↔ 新品榜
await open(page, '/hot', { settle: 3000 })
const CARD = 'main a[href^="/site/"], main [data-navhub-site-id], main article, main li'
const hotA = { titles: await top(page, CARD), url: page.url().replace(BASE, '') }
const c1 = await clickText(page, /新品/, { role: 'tab', timeout: 5000 }).catch(() => ({ clicked: false }))
await page.waitForTimeout(2500)
const hotB = { titles: await top(page, CARD), url: page.url().replace(BASE, '') }
const hotChanged = JSON.stringify(hotA.titles) !== JSON.stringify(hotB.titles)
out.hotTabs = { clickNew: c1.clicked, before: hotA, after: hotB, changed: hotChanged }
console.log(`[hot] 切到新品=${c1.clicked} 标题集变化=${hotChanged} URL ${hotA.url} -> ${hotB.url}`)
console.log('   before:', hotA.titles.slice(0, 3).join(' / '))
console.log('   after :', hotB.titles.slice(0, 3).join(' / '))

// (b) /category 下一页
await open(page, '/category/ai-tools', { settle: 3000 })
const catA = { titles: await top(page, 'main a[href^="/site/"]'), url: page.url().replace(BASE, '') }
const next = page.locator('a:has-text("下一页"), a:has-text("下页"), a[rel="next"], button:has-text("下一页")').first()
const nextKind = await next.evaluate((e) => e.tagName + '|' + (e.getAttribute('href') || '')).catch(() => 'none')
const c2 = await clickText(page, /下一页|下页|Next/, { timeout: 5000 }).catch(() => ({ clicked: false }))
await page.waitForTimeout(2500)
const catB = { titles: await top(page, 'main a[href^="/site/"]'), url: page.url().replace(BASE, '') }
out.categoryPaging = { nextKind, clicked: c2.clicked, before: catA, after: catB, urlChanged: catA.url !== catB.url, titlesChanged: JSON.stringify(catA.titles) !== JSON.stringify(catB.titles) }
console.log(`[category] 下一页元素=${nextKind} 点击=${c2.clicked} URL ${catA.url} -> ${catB.url} 标题变化=${out.categoryPaging.titlesChanged}`)

// (c) 首页内联搜索：输入后回车会怎样
await open(page, '/', { settle: 4000 })
const input = page.locator('input[type="search"], input[placeholder*="搜索"]').first()
await input.click().catch(() => {})
await input.fill('figma').catch(() => {})
await page.waitForTimeout(1800)
const sug = await top(page, '[role="listbox"] [role="option"], [data-search-suggestion]')
const cardsBefore = await page.locator('[data-navhub-site-id]').count()
await page.keyboard.press('Enter')
await page.waitForTimeout(2500)
const afterEnter = { url: page.url().replace(BASE, ''), cards: await page.locator('[data-navhub-site-id]').count(), dialog: await page.locator('[role="dialog"]').count() }
out.inlineSearch = { suggestions: sug.slice(0, 4), cardsBefore, afterEnter }
console.log(`[search] 建议=${JSON.stringify(sug.slice(0, 3))} 卡片 ${cardsBefore} -> 回车后 ${afterEnter.cards} URL=${afterEnter.url} dialog=${afterEnter.dialog}`)

// (d) /videos 顶部筛选：点前点后「视频条目」标题集
await open(page, '/videos', { settle: 3500 })
const V = 'main a[href*="/videos/"], main [data-video-id], main article'
const vA = await top(page, V)
for (const label of ['精选视频', '语文']) {
  await clickText(page, new RegExp(label), { timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(2200)
  const vB = await top(page, V)
  out[`videos:${label}`] = { before: vA.slice(0, 3), after: vB.slice(0, 3), changed: JSON.stringify(vA) !== JSON.stringify(vB), count: vB.length }
  console.log(`[videos:${label}] 变化=${out[`videos:${label}`].changed} 条目数=${vB.length} ${vA.slice(0, 2).join('/')} -> ${vB.slice(0, 2).join('/')}`)
}

writeFileSync(OUT + '12-content.json', JSON.stringify({ base: BASE, out }, null, 2))
console.log('\n[saved] 12-content.json')
await s.browser.close()
