/**
 * /marketplace 专题胶囊第二轮取证。
 * 上一轮点的是「飙升榜 / 全部插件」——两者在默认状态下等价，无变化是正确行为。
 * 本轮只点**会改状态**的专题，并顺带检查是否有多个胶囊同时高亮（激活态歧义）。
 */
import { session, open, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const s = await session({ auth: true })
const { page } = s
await open(page, '/marketplace', { settle: 3500 })

const snap = () =>
  page.evaluate(() => {
    const chips = [...document.querySelectorAll('button')].filter((b) =>
      /^(🌐 )?(全部插件|🔥 飙升榜|🚀 极客全栈装备|🔍 快捷直达引擎|📊 生产力工作台|🎨 赛博与暗黑美学|🧩 精选组合包)$/.test(
        (b.textContent || '').trim(),
      ),
    )
    const isActive = (el) => (el.className || '').includes('bg-primary')
    const sel = (label) => {
      const el = document.querySelector(`select[aria-label="${label}"]`)
      return el ? el.value : null
    }
    return {
      cards: [...document.querySelectorAll('a[href^="/marketplace/"]')]
        .map((a) => a.getAttribute('href'))
        .filter((h) => h && !/installed|import|mine|publish/.test(h))
        .slice(0, 60),
      chipActive: chips.filter(isActive).map((b) => (b.textContent || '').trim()),
      chipCount: chips.length,
      kind: sel('插件类型') ?? sel('类型'),
      sort: sel('排序方式'),
      search: (document.querySelector('input[type="search"],input[placeholder*="搜索"]') || {}).value ?? null,
      total: ((document.body.innerText.match(/全部\s*\((\d+)\)/) || [])[1]) ?? null,
    }
  })

const rows = []
const base = await snap()
console.log('[mkt2] 基线 chips=' + base.chipCount + ' 同时高亮=' + JSON.stringify(base.chipActive) + ' 卡片=' + base.cards.length + ' sort=' + base.sort + ' total=' + base.total)

for (const label of ['🚀 极客全栈装备', '🎨 赛博与暗黑美学', '🧩 精选组合包', '🔍 快捷直达引擎', '全部插件', '🔥 飙升榜']) {
  const loc = page.locator(`button:has-text("${label}")`).first()
  if ((await loc.count()) === 0) {
    rows.push({ label, found: false })
    console.log(`[mkt2] ${label} 未找到`)
    continue
  }
  const before = await snap()
  await loc.scrollIntoViewIfNeeded().catch(() => {})
  await loc.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(1800)
  const after = await snap()
  const sameSet = JSON.stringify(before.cards) === JSON.stringify(after.cards)
  const r = {
    label,
    found: true,
    cards: before.cards.length + ' -> ' + after.cards.length,
    listChanged: !sameSet,
    chipActive: after.chipActive,
    dualActive: after.chipActive.length > 1,
    kind: before.kind + ' -> ' + after.kind,
    sort: before.sort + ' -> ' + after.sort,
    search: JSON.stringify(before.search) + ' -> ' + JSON.stringify(after.search),
    total: before.total + ' -> ' + after.total,
  }
  rows.push(r)
  console.log(`[mkt2] ${label} ` + JSON.stringify(r))
}

writeFileSync(OUT + '18-mkt2.json', JSON.stringify({ base: BASE, baseSnap: base, rows }, null, 2))
console.log('\n[saved] 18-mkt2.json')
await s.browser.close()
