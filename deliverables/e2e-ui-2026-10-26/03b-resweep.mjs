/**
 * 定向复扫：只重跑上一轮判成「无响应」的路由。
 *
 * 为什么要重跑：页面级信号原先只比 innerText 的「长度」，
 * 于是三类真实响应被漏判 ——
 *   1) 展开/折叠只加十几个字（低于 40 字阈值）；
 *   2) 排序/切榜只是同一批卡片换顺序（长度一字不差）；
 *   3) 图谱的节点文字在 SVG 里，根本不属于 innerText。
 * 现在改用内容指纹 + SVG 指纹 + 浮层/下拉计数，必须复扫才能给出可信结论。
 */
import { session, sweep, open, OUT, BASE } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const TARGETS = [
  ['/videos', false], ['/graph', false], ['/marketplace', false], ['/custom', false],
  ['/preferences', false], ['/submit', false], ['/me', false], ['/favorites', false],
  ['/me/data', true], ['/me/workspaces', true], ['/marketplace/installed', true],
  ['/marketplace/publish', true], ['/marketplace/import', true],
]

const out = []
for (const [route, auth] of TARGETS) {
  const s = await session({ auth })
  try {
    const { results } = await sweep(s.page, route, { limit: 30, skipRisk: ['danger'] })
    const clicked = results.filter((r) => !['skipped-danger', 'disabled', 'field', 'file-input'].includes(r.action))
    const dead = clicked.filter((r) => !r.responded && !r.alreadyActive)
    out.push({
      route,
      auth,
      clicked: clicked.length,
      responded: clicked.length - dead.length,
      dead: dead.map((d) => ({ tag: d.tag, label: d.label.slice(0, 40), via: d.via, ms: d.ms, delta: d.delta, self: d.self || null })),
      items: results,
    })
    console.log(`[resweep] ${route}${auth ? ' (登录态)' : ''} 点击=${clicked.length} 有响应=${clicked.length - dead.length} 无响应=${dead.length}`)
    for (const d of dead) console.log(`    仍无响应: ${d.tag}[${d.label.replace(/\s+/g, ' ').slice(0, 26)}] via=${d.via} self=${JSON.stringify(d.self)}`)
  } catch (e) {
    out.push({ route, auth, error: String(e.message).slice(0, 200) })
    console.log(`[FAIL] ${route} ${String(e.message).slice(0, 120)}`)
  }
  await s.browser.close()
}
writeFileSync(OUT + '03b-resweep.json', JSON.stringify({ base: BASE, rows: out }, null, 2))
console.log('\n[saved] 03b-resweep.json  仍判无响应合计=' + out.reduce((n, r) => n + (r.dead?.length || 0), 0))
