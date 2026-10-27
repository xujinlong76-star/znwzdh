import { session, sweep, open, OUT, BASE } from './harness.mjs'
import { buildRoutes } from './routes.mjs'
import { writeFileSync } from 'node:fs'

const group = process.argv[2] || 'public'
const limit = Number(process.argv[3] || 26)
const { staticRoutes, authed, admin, dyn } = await buildRoutes()

const sets = {
  public: staticRoutes.filter((r) => !r.startsWith('/auth') && !r.includes('404-probe')),
  dyn,
  authed,
  admin,
}
const targets = sets[group] || []
console.log(`[sweep] group=${group} routes=${targets.length} limit=${limit}`)

const s = await session({ auth: group !== 'public' && group !== 'dyn' })
const out = []
for (const route of targets) {
  const t0 = Date.now()
  try {
    const { results, links } = await sweep(s.page, route, { limit, skipRisk: ['danger'] })
    const clickedItems = results.filter((r) => !['skipped-danger', 'disabled', 'field', 'file-input'].includes(r.action))
    const dead = clickedItems.filter((r) => !r.responded && !r.alreadyActive)
    const noop = clickedItems.filter((r) => !r.responded && r.alreadyActive)
    const blocked = clickedItems.filter((r) => r.via === 'dom-fallback' || !r.clicked)
    const slow = clickedItems.filter((r) => r.responded && r.via === 'locator' && r.ms > 900)
    const badLinks = links.filter((l) => !l.ok || l.status >= 400)
    out.push({
      route,
      ms: Date.now() - t0,
      controlsOnPage: results.length,
      clicked: clickedItems.length,
      responded: clickedItems.length - dead.length - noop.length,
      dead,
      noop,
      blocked,
      slow,
      skippedDanger: results.filter((r) => r.action === 'skipped-danger').map((r) => r.label),
      disabled: results.filter((r) => r.action === 'disabled').map((r) => r.label),
      links: { checked: links.length, bad: badLinks, slowest: [...links].sort((a, b) => b.ms - a.ms).slice(0, 3).map((l) => `${l.href} ${l.ms}ms`) },
      items: results,
    })
    console.log(
      `[done] ${route} 控件=${clickedItems.length} 有响应=${clickedItems.length - dead.length - noop.length} 无响应=${dead.length} 已激活空点=${noop.length} 点不着=${blocked.length} 慢(${slow.length}) 链接=${links.length}坏=${badLinks.length} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`
    )
    if (dead.length) console.log('   无响应: ' + dead.slice(0, 8).map((d) => `${d.tag}[${d.label}]`).join(' | '))
    if (blocked.length) console.log('   点不着: ' + blocked.slice(0, 6).map((d) => `${d.tag}[${d.label.slice(0, 16)}]${d.clicked ? '' : '(未命中)'}`).join(' | '))
    if (slow.length) console.log('   响应慢: ' + slow.slice(0, 5).map((d) => `${d.label}=${d.ms}ms`).join(' | '))
    if (badLinks.length) console.log('   坏链接: ' + badLinks.slice(0, 8).map((l) => `${l.status} ${l.href}`).join(' | '))
  } catch (err) {
    out.push({ route, error: String(err.message).slice(0, 300) })
    console.log(`[FAIL] ${route} :: ${String(err.message).slice(0, 160)}`)
  }
  s.logs.consoleErrors = []
  s.logs.badResponses = []
}
writeFileSync(OUT + `03-sweep-${group}.json`, JSON.stringify({ base: BASE, group, rows: out }, null, 2))
const all = out.flatMap((r) => r.items || [])
const clickedAll = all.filter((a) => a.action !== 'skipped-danger' && a.action !== 'disabled')
console.log(
  `\n[total] routes=${out.length} 点击=${clickedAll.length} 有响应=${clickedAll.filter((a) => a.responded).length} 无响应=${out.reduce((n, r) => n + (r.dead?.length || 0), 0)} 已激活空点=${out.reduce((n, r) => n + (r.noop?.length || 0), 0)} 点不着=${out.reduce((n, r) => n + (r.blocked?.length || 0), 0)} 跳过危险=${all.filter((a) => a.action === 'skipped-danger').length} 禁用=${all.filter((a) => a.action === 'disabled').length}`
)
console.log('[links] 校验=' + out.reduce((n, r) => n + (r.links?.checked || 0), 0) + ' 坏=' + out.reduce((n, r) => n + (r.links?.bad?.length || 0), 0))
await s.browser.close()
