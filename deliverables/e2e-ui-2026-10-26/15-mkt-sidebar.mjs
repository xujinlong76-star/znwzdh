/**
 * 两个悬而未决的点，用最小可信证据定论：
 *  1) /marketplace 顶部的「全部插件 / 飙升榜 / …」到底是分类页签还是卡片：
 *     点击后比较「插件卡片的名称集合」，而不是卡片数量（上一轮选择器命中 0 张卡）。
 *  2) 后台侧边栏分组按钮：连续点两次，直接数 aside 里的 <a> 数量（13-dom 测到 16→19，
 *     07-verify 的子项判定却给 false，必须复核哪个判定可信）。
 */
import { session, open, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const out = {}

// ---------- 1) 市场页签 ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/marketplace', { settle: 4000 })
  const snap = () =>
    page.evaluate(() => {
      const names = [...document.querySelectorAll('a[href^="/marketplace/"]')]
        .map((a) => ({ href: a.getAttribute('href'), txt: (a.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26) }))
        .filter((x) => x.txt.length > 1)
      const chips = [...document.querySelectorAll('main button')].slice(0, 12).map((b) => {
        const cs = getComputedStyle(b)
        return { txt: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14), bg: cs.backgroundColor, color: cs.color }
      })
      return { names: names.slice(0, 10), count: names.length, chips }
    })
  const a = await snap()
  const seq = []
  for (const label of ['飙升榜', '全部插件']) {
    await page.locator(`main button:has-text("${label}")`).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(2000)
    const b = await snap()
    seq.push({ label, count: b.count, head: b.names.slice(0, 3).map((n) => n.href), changed: JSON.stringify(a.names.map((n) => n.href)) !== JSON.stringify(b.names.map((n) => n.href)), chipStyleChanged: JSON.stringify(a.chips) !== JSON.stringify(b.chips) })
    await page.screenshot({ path: `shots/15-mkt-${label}.png` })
  }
  out.market = { base: a, seq }
  console.log('[mkt] 基线卡片=' + a.count, '首个=' + JSON.stringify(a.names[0]), 'chips=' + JSON.stringify(a.chips.slice(0, 4)))
  for (const q of seq) console.log(`  ${q.label}: 卡片=${q.count} 集合变化=${q.changed} 页签样式变化=${q.chipStyleChanged} head=${JSON.stringify(q.head)}`)
  await s.browser.close()
}

// ---------- 2) 侧边栏分组复测 ----------
{
  const s = await session({ auth: true })
  const { page } = s
  await open(page, '/admin/trash', { settle: 4000 })
  const nav = () =>
    page.evaluate(() => {
      const aside = document.querySelector('aside') || document.querySelector('nav')
      return {
        links: [...(aside?.querySelectorAll('a') || [])].map((a) => a.getAttribute('href')),
        expanded: [...(aside?.querySelectorAll('button') || [])].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 12) + '#' + (b.getAttribute('aria-expanded') ?? '-')),
      }
    })
  const r0 = await nav()
  await page.locator('aside button:has-text("导航管理"), nav button:has-text("导航管理")').first().click({ timeout: 5000 }).catch(() => {})
  await page.waitForTimeout(900)
  const r1 = await nav()
  await page.locator('aside button:has-text("导航管理"), nav button:has-text("导航管理")').first().click({ timeout: 3000 }).catch(() => {})
  await page.waitForTimeout(900)
  const r2 = await nav()
  out.sidebar = {
    n0: r0.links.length,
    n1: r1.links.length,
    n2: r2.links.length,
    added: r1.links.filter((h) => !r0.links.includes(h)),
    removed: r2.links.filter((h) => !r1.links.includes(h)),
    ariaExpandedSample: r0.expanded.slice(0, 8),
  }
  console.log(`[sidebar] 链接数 ${r0.links.length} -> ${r1.links.length} -> ${r2.links.length}`)
  console.log('  展开新增=' + JSON.stringify(out.sidebar.added), '折叠移除=' + JSON.stringify(out.sidebar.removed))
  console.log('  aria-expanded 采样=' + JSON.stringify(out.sidebar.ariaExpandedSample))
  await s.browser.close()
}

writeFileSync(OUT + '15-mkt-sidebar.json', JSON.stringify({ base: BASE, out }, null, 2))
console.log('\n[saved] 15-mkt-sidebar.json')
