import { session, open, metrics, state, OUT, BASE } from './harness.mjs'
import { buildRoutes } from './routes.mjs'
import { writeFileSync } from 'node:fs'

const only = process.argv[2]
const { staticRoutes, authed, admin, dyn } = await buildRoutes()
const groups = { public: staticRoutes, dyn, authed, admin }
const targets = only ? groups[only] : [...new Set([...staticRoutes, ...dyn, ...authed, ...admin])]

// 先建立登录态快照，供后续阶段复用
{
  const s = await session()
  await open(s.page, '/admin', { settle: 2500 })
  if (s.page.url().includes('/auth/signin')) {
    const bypass = s.page.getByRole('button', { name: /一键进入/ }).first()
    await bypass.waitFor({ state: 'visible', timeout: 20_000 })
    await bypass.click()
    await s.page.waitForURL((u) => !u.pathname.startsWith('/auth/signin'), { timeout: 40_000 }).catch(() => {})
  }
  console.log('[login] final url=', s.page.url())
  await s.context.storageState({ path: OUT + 'storage-state.json' })
  await s.browser.close()
}

const rows = []
const s = await session({ auth: true })
for (const route of targets) {
  s.logs.consoleErrors = []; s.logs.consoleWarnings = []; s.logs.pageErrors = []; s.logs.failedRequests = []; s.logs.badResponses = []
  let row
  try {
    const wall = await open(s.page, route, { settle: 1800 })
    const m = await metrics(s.page)
    const st = await state(s.page)
    const ctl = await s.page.evaluate(() => {
      const sel = 'button,[role="button"],a[href],input,select,textarea,[role="switch"],[role="tab"],[role="menuitem"],[role="combobox"],[role="checkbox"],summary,[aria-haspopup="menu"]'
      return [...document.querySelectorAll(sel)].map((el) => {
        const r = el.getBoundingClientRect()
        return {
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute('role') || '',
          label: (el.getAttribute('aria-label') || el.title || el.textContent || el.placeholder || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 46),
          href: el.getAttribute('href') || '',
          disabled: el.disabled === true || el.getAttribute('aria-disabled') === 'true',
          visible: r.width > 0 && r.height > 0,
        }
      })
    })
    const h1 = (await s.page.locator('h1').first().textContent().catch(() => '') || '').trim()
    row = {
      route,
      status: 'ok',
      wall,
      h1: h1.slice(0, 40),
      counts: {
        btn: ctl.filter((c) => (c.tag === 'button' || c.role === 'button') && c.visible).length,
        link: ctl.filter((c) => c.tag === 'a' && c.visible).length,
        field: ctl.filter((c) => ['input', 'select', 'textarea'].includes(c.tag) && c.visible).length,
        toggle: ctl.filter((c) => c.role === 'switch' || c.role === 'checkbox').length,
        tab: ctl.filter((c) => c.role === 'tab').length,
        popup: ctl.filter((c) => c.role === 'combobox').length,
        disabled: ctl.filter((c) => c.disabled).length,
      },
      controls: ctl,
      metrics: m,
      url: st.url,
      resultCount: st.resultCount,
      consoleErrors: s.logs.consoleErrors,
      pageErrors: s.logs.pageErrors,
      failedRequests: s.logs.failedRequests,
      badResponses: s.logs.badResponses,
      consoleWarnings: s.logs.consoleWarnings.slice(0, 10),
    }
    console.log(`[ok] ${route} wall=${wall} ttfb=${m.ttfb} lcp=${m.lcp} btn=${row.counts.btn} link=${row.counts.link} err=${row.consoleErrors.length} bad=${row.badResponses.length}`)
  } catch (err) {
    row = { route, status: 'fail', error: String(err.message).slice(0, 240), consoleErrors: s.logs.consoleErrors, badResponses: s.logs.badResponses }
    console.log(`[FAIL] ${route} :: ${String(err.message).slice(0, 110)}`)
  }
  rows.push(row)
  await s.page.screenshot({ path: `shots/route${route.replace(/[^a-z0-9]/gi, '_').slice(0, 46)}.png` }).catch(() => {})
}

const ok = rows.filter((r) => r.status === 'ok')
const summary = {
  base: BASE,
  total: rows.length,
  okCount: ok.length,
  failed: rows.filter((r) => r.status !== 'ok').map((r) => `${r.route} :: ${r.error}`),
  withConsoleError: ok.filter((r) => r.consoleErrors.length).map((r) => `${r.route} (${r.consoleErrors.length}) ${r.consoleErrors[0].slice(0, 90)}`),
  withPageError: ok.filter((r) => r.pageErrors.length).map((r) => `${r.route} ${r.pageErrors[0].slice(0, 90)}`),
  withBadResponse: ok.filter((r) => r.badResponses.length).map((r) => `${r.route} -> ${[...new Set(r.badResponses)].slice(0, 3).join(' , ')}`),
  withFailedRequest: ok.filter((r) => r.failedRequests.length).map((r) => `${r.route} -> ${r.failedRequests.slice(0, 2).join(' , ')}`),
  horizontalOverflow: ok.filter((r) => r.metrics.scrollOverflow).map((r) => r.route),
  slowestWall: [...ok].sort((a, b) => b.wall - a.wall).slice(0, 10).map((r) => `${r.route} wall=${r.wall}ms ttfb=${r.metrics.ttfb}ms lcp=${r.metrics.lcp}ms`),
  worstTtfb: [...ok].sort((a, b) => b.metrics.ttfb - a.metrics.ttfb).slice(0, 10).map((r) => `${r.route} ttfb=${r.metrics.ttfb}ms load=${r.metrics.loadEnd}ms`),
  worstLcp: [...ok].sort((a, b) => b.metrics.lcp - a.metrics.lcp).slice(0, 10).map((r) => `${r.route} lcp=${r.metrics.lcp}ms nodes=${r.metrics.domNodes} htmlKB=${r.metrics.htmlKB} jsKB=${r.metrics.jsKB}`),
  heaviest: [...ok].sort((a, b) => b.metrics.bytesKB - a.metrics.bytesKB).slice(0, 8).map((r) => `${r.route} ${r.metrics.bytesKB}KB res=${r.metrics.resources} dom=${r.metrics.domNodes} html=${r.metrics.htmlKB}KB`),
  longTasks: [...ok].sort((a, b) => b.metrics.longTaskMsTotal - a.metrics.longTaskMsTotal).slice(0, 10).map((r) => `${r.route} long=${r.metrics.longTasks} totalMs=${r.metrics.longTaskMsTotal} cls=${r.metrics.cls}`),
}
writeFileSync(OUT + '01-crawl.json', JSON.stringify({ summary, rows }, null, 2))
console.log('\n===== SUMMARY =====\n' + JSON.stringify(summary, null, 2))
await s.browser.close()
