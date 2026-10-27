/**
 * 后台逐路由复扫：每个路由都新开一个浏览器上下文。
 *
 * 为什么必须这样：后台侧边栏的「收起/展开」态写在 localStorage，
 * 上一轮复用同一个页面时，先点中「收起侧边栏」之后，
 * 分组按钮在 `!isSidebarCollapsed` 门控下真的不再渲染子项，
 * 于是每个后台页的三个分组按钮全被判成「无响应」——这是自我污染，不是缺陷。
 * 重新加载同一 URL 也回不去（状态是持久化的），只能换干净上下文。
 */
import { session, sweep, BASE, OUT } from './harness.mjs'
import { buildRoutes } from './routes.mjs'
import { writeFileSync } from 'node:fs'

const { admin } = await buildRoutes()
const limit = Number(process.argv[2] || 22)
console.log(`[admin-resweep] routes=${admin.length} limit=${limit}（每路由独立上下文）`)

const rows = []
for (const route of admin) {
  const s = await session({ auth: true })
  const t0 = Date.now()
  try {
    const { results, links } = await sweep(s.page, route, { limit, skipRisk: ['danger'] })
    const clicked = results.filter((r) => !['skipped-danger', 'disabled', 'field', 'file-input'].includes(r.action))
    const dead = clicked.filter((r) => !r.responded && !r.alreadyActive)
    const noop = clicked.filter((r) => !r.responded && r.alreadyActive)
    const blocked = clicked.filter((r) => !r.clicked)
    const slow = clicked.filter((r) => r.responded && r.via === 'locator' && r.ms > 900)
    rows.push({
      route,
      ms: Date.now() - t0,
      controlsOnPage: results.length,
      clicked: clicked.length,
      responded: clicked.length - dead.length - noop.length,
      dead: dead.map((d) => ({ tag: d.tag, label: d.label.slice(0, 40), via: d.via, ms: d.ms, delta: d.delta, self: d.self || null })),
      noop: noop.map((d) => `${d.tag}[${d.label.slice(0, 30)}]`),
      blocked: blocked.map((d) => `${d.tag}[${d.label.slice(0, 30)}] via=${d.via}`),
      slow: slow.map((d) => `${d.label.slice(0, 30)}=${d.ms}ms`),
      skippedDanger: results.filter((r) => r.action === 'skipped-danger').map((r) => r.label.slice(0, 30)),
      disabled: results.filter((r) => r.action === 'disabled').map((r) => r.label.slice(0, 30)),
      links: { checked: links.length, bad: links.filter((l) => !l.ok || l.status >= 400).map((l) => `${l.status} ${l.href}`) },
      consoleErrors: s.logs.consoleErrors.slice(0, 5),
      pageErrors: s.logs.pageErrors.slice(0, 5),
      badResponses: [...new Set(s.logs.badResponses)].slice(0, 8),
      items: results,
    })
    console.log(`[done] ${route} 点击=${clicked.length} 有响应=${clicked.length - dead.length - noop.length} 无响应=${dead.length} 空点=${noop.length} 点不着=${blocked.length} 慢=${slow.length} 耗时=${((Date.now() - t0) / 1000).toFixed(0)}s`)
    if (dead.length) console.log('   无响应: ' + dead.slice(0, 6).map((d) => `${d.tag}[${d.label.replace(/\s+/g, ' ').slice(0, 22)}]`).join(' | '))
    if (blocked.length) console.log('   点不着: ' + blocked.slice(0, 4).map((d) => `${d.tag}[${d.label.replace(/\s+/g, ' ').slice(0, 22)}]`).join(' | '))
  } catch (e) {
    rows.push({ route, error: String(e.message).slice(0, 200) })
    console.log(`[FAIL] ${route} :: ${String(e.message).slice(0, 120)}`)
  }
  await s.browser.close()
}

writeFileSync(OUT + '03c-admin-resweep.json', JSON.stringify({ base: BASE, rows }, null, 2))
const all = rows.flatMap((r) => r.items || [])
const clickedAll = all.filter((a) => !['skipped-danger', 'disabled', 'field', 'file-input'].includes(a.action))
console.log(
  `\n[total] routes=${rows.length} 点击=${clickedAll.length} 有响应=${clickedAll.filter((a) => a.responded).length} 无响应=${rows.reduce((n, r) => n + (r.dead?.length || 0), 0)} 空点=${rows.reduce((n, r) => n + (r.noop?.length || 0), 0)} 点不着=${rows.reduce((n, r) => n + (r.blocked?.length || 0), 0)} 跳过危险=${all.filter((a) => a.action === 'skipped-danger').length}`
)
