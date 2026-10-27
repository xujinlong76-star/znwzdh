/**
 * 最后一轮精判（三件事都用真实元素，不再靠猜测文案）：
 *  A) 后台侧边栏分组：测「加载后第几秒点击才真正生效」——上一轮巡检在 settle=1200ms 就点，
 *     若那时还没 hydration，按钮看起来就是死的；把延迟量出来才能区分「控件坏」与「可交互慢」。
 *  B) /hot 榜单页签：真实页签文案是「访问量榜 / 最新入库榜」，点它并读 aria-selected 与列表首条。
 *  C) /videos 筛选：真实筛选是 chip 按钮（精选视频 / 七年级 / 语文…），比较视频源卡标题集合。
 */
import { session, open, BASE, OUT } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const out = {}

// ---------- A) hydration 后可交互延迟 ----------
{
  const s = await session({ auth: true })
  const { page } = s
  const t0 = Date.now()
  await page.goto(BASE + '/admin/stats', { waitUntil: 'domcontentloaded' })
  const domReady = Date.now() - t0
  const readNav = () => page.evaluate(() => (document.querySelector('aside')?.querySelectorAll('a').length ?? -1))
  const base = await readNav()
  const timeline = []
  let firstEffect = null
  let attempt = 0
  while (attempt < 30 && firstEffect === null) {
    attempt++
    await page.locator('button:has-text("导航管理")').first().click({ timeout: 500 }).catch(() => {})
    await page.waitForTimeout(500)
    const n = await readNav()
    timeline.push({ at: Date.now() - t0, links: n })
    if (n !== base) firstEffect = { atMs: Date.now() - t0, attempt, links: n }
  }
  const extra = await page.evaluate(() => {
    const v = window.__v || {}
    return { lcp: Math.round(v.lcp || 0), longTasks: (v.long || []).length, longMs: (v.long || []).reduce((a, b) => a + b, 0) }
  })
  out.adminSidebarTTA = { domReady, baseLinks: base, firstEffect, attempts: attempt, timeline, extra }
  console.log(`[A] /admin/stats DOM就绪=${domReady}ms 侧边栏首次生效=${firstEffect ? firstEffect.atMs + 'ms(第' + firstEffect.attempt + '次点击)' : '>15s 未生效'} 长任务=${extra.longTasks}(${extra.longMs}ms)`)
  console.log('    时间线: ' + timeline.map((t) => `${t.at}:${t.links}`).join(' '))
  await s.browser.close()
}

// ---------- B) /hot 页签 ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/hot', { settle: 3500 })
  const snap = () =>
    page.evaluate(() => {
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => ({ txt: (t.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14), sel: t.getAttribute('aria-selected') }))
      const main = document.querySelector('main')
      const rows = [...(main?.querySelectorAll('ol li, [role="tabpanel"] a, main a[href^="/site/"]') || [])]
        .map((e) => (e.getAttribute('aria-label') || e.title || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 22))
        .filter((t) => t && t !== '站内详情')
      return { tabs, panelText: (main?.innerText || '').replace(/\s+/g, ' ').slice(0, 140), rows: rows.slice(0, 6), url: location.pathname + location.search }
    })
  const a = await snap()
  await page.locator('[role="tab"]:has-text("最新入库榜")').first().click({ timeout: 6000 }).catch(() => {})
  await page.waitForTimeout(2500)
  const b = await snap()
  out.hotTabs = { before: a, after: b, rowsChanged: JSON.stringify(a.rows) !== JSON.stringify(b.rows), selChanged: JSON.stringify(a.tabs) !== JSON.stringify(b.tabs) }
  console.log(`[B] /hot 页签 aria-selected 变化=${out.hotTabs.selChanged} 行内容变化=${out.hotTabs.rowsChanged} URL ${a.url} -> ${b.url}`)
  console.log('    before', JSON.stringify(a.tabs), a.rows.slice(0, 3).join(' / '))
  console.log('    after ', JSON.stringify(b.tabs), b.rows.slice(0, 3).join(' / '))
  await s.browser.close()
}

// ---------- C) /videos 筛选 chip ----------
{
  const s = await session()
  const { page } = s
  await open(page, '/videos', { settle: 4000 })
  const snap = () =>
    page.evaluate(() => {
      const main = document.querySelector('main')
      const chips = [...(main?.querySelectorAll('button') || [])].map((b) => ({ txt: (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 16), pressed: b.getAttribute('aria-pressed'), dataState: b.dataset.state || '' })).filter((x) => x.txt)
      const titles = [...(main?.querySelectorAll('a[target="_blank"], [class*="card"]') || [])]
        .map((e) => (e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 20))
        .filter((t) => t.length > 3)
      return { chipCount: chips.length, chips: chips.slice(0, 14), titles: titles.slice(0, 8), text: (main?.innerText || '').replace(/\s+/g, ' ').slice(0, 120) }
    })
  const a = await snap()
  const res = []
  for (const label of ['精选视频', '语文', '七年级']) {
    await page.locator(`main button:has-text("${label}")`).first().click({ timeout: 4000 }).catch(() => {})
    await page.waitForTimeout(1800)
    const b = await snap()
    res.push({ label, titlesChanged: JSON.stringify(a.titles) !== JSON.stringify(b.titles), textLenDelta: b.text.length - a.text.length, pressed: b.chips.find((c) => c.txt === label)?.pressed ?? null, titles: b.titles.slice(0, 3) })
    await page.locator(`main button:has-text("${label}")`).first().click({ timeout: 2000 }).catch(() => {})
    await page.waitForTimeout(1200)
  }
  out.videosChips = { base: a, res }
  console.log(`[C] /videos 基线条目=${a.titles.length} ${a.titles.slice(0, 3).join(' / ')}`)
  for (const r of res) console.log(`    ${r.label}: 条目变化=${r.titlesChanged} 文本差=${r.textLenDelta} aria-pressed=${r.pressed} -> ${r.titles.join(' / ')}`)
  await s.browser.close()
}

writeFileSync(OUT + '14-final.json', JSON.stringify({ base: BASE, out }, null, 2))
console.log('\n[saved] 14-final.json')
