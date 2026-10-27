/**
 * DOM 形态侦察：在断言「控件失效」之前，先确认我盯的是不是正确的元素集合。
 *  1) 后台侧边栏分组按钮：点一次，比较 aside/nav 内链接数量、aria-expanded、箭头 rotate 类
 *  2) /videos 的列表容器到底是什么标签（上一轮用 `a[href*="/videos/"]` 只命中 1 个导航项）
 *  3) /hot 两个榜单页签的真实条目容器与 innerText 摘要
 */
import { session, open, BASE, OUT, clickText } from './harness.mjs'
import { writeFileSync } from 'node:fs'

const out = {}

// ---- 1) 侧边栏分组 ----
{
  const s = await session({ auth: true })
  const { page } = s
  await open(page, '/admin/stats', { settle: 3500 })
  const read = () =>
    page.evaluate(() => {
      const nav = document.querySelector('aside') || document.querySelector('nav')
      const btn = [...document.querySelectorAll('button')].find((b) => /导航管理/.test(b.getAttribute('aria-label') || b.textContent || ''))
      return {
        navLinks: nav ? nav.querySelectorAll('a').length : -1,
        navText: nav ? (nav.innerText || '').replace(/\s+/g, ' ').slice(0, 240) : '',
        btnTag: btn ? btn.tagName : 'none',
        btnExpanded: btn?.getAttribute('aria-expanded') ?? null,
        btnClass: btn ? btn.className.slice(0, 90) : '',
        chevronRotated: nav ? [...nav.querySelectorAll('svg')].filter((s) => /rotate-180|rotate-90/.test(s.className.baseVal || s.getAttribute('class') || '')).length : -1,
        subLinksVisible: nav ? [...nav.querySelectorAll('a')].filter((a) => /站点目录|类目|导航配置|菜单|收录/.test(a.textContent || '')).length : -1,
      }
    })
  const before = await read()
  const c = await clickText(page, /导航管理/, { timeout: 5000 })
  await page.waitForTimeout(1200)
  const after = await read()
  await page.keyboard.press('Escape')
  const collapsed = await read()
  out.sidebar = { clicked: c.clicked, before, after, secondClick: collapsed, delta: { links: after.navLinks - before.navLinks, chevron: after.chevronRotated - before.chevronRotated } }
  console.log('[sidebar] 点击=' + c.clicked)
  console.log('  before', JSON.stringify(before))
  console.log('  after ', JSON.stringify(after))
  console.log('  2nd   ', JSON.stringify(collapsed))
  await s.browser.close()
}

// ---- 2) /videos 容器 ----
{
  const s = await session()
  const { page } = s
  await open(page, '/videos', { settle: 4000 })
  out.videosDom = await page.evaluate(() => {
    const main = document.querySelector('main')
    const counts = {}
    for (const sel of ['a', 'article', 'li', '[data-video-id]', 'iframe', 'video', '[class*="video"]', '[class*="card"]']) counts[sel] = main ? main.querySelectorAll(sel).length : -1
    const firstCard = main?.querySelector('[class*="video"], article, li')
    return {
      counts,
      text: (main?.innerText || '').replace(/\s+/g, ' ').slice(0, 300),
      filters: [...(main?.querySelectorAll('button') || [])].map((b) => (b.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 14)).filter(Boolean).slice(0, 24),
      sampleHtml: firstCard ? firstCard.outerHTML.slice(0, 500) : '',
    }
  })
  console.log('[videos dom]', JSON.stringify(out.videosDom.counts), '| filters=', out.videosDom.filters.slice(0, 12).join('/'))
  console.log('  text:', out.videosDom.text.slice(0, 160))
  await s.browser.close()
}

// ---- 3) /hot 容器 + 页签前后文本 ----
{
  const s = await session()
  const { page } = s
  await open(page, '/hot', { settle: 4000 })
  const snap = () =>
    page.evaluate(() => {
      const main = document.querySelector('main')
      const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => ({ t: (t.textContent || '').trim().slice(0, 12), sel: t.getAttribute('aria-selected') }))
      const list = main?.querySelectorAll('a[href^="/site/"], [data-navhub-site-id]')
      return {
        tabs,
        items: list ? list.length : -1,
        head: (main?.innerText || '').replace(/\s+/g, ' ').slice(0, 200),
        first3: [...(list || [])].slice(0, 3).map((e) => (e.getAttribute('aria-label') || e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26)),
      }
    })
  const a = await snap()
  const c = await clickText(page, /新品/, { role: 'tab', timeout: 5000 }).catch(() => ({ clicked: false }))
  await page.waitForTimeout(2500)
  const b = await snap()
  out.hot = { clickNew: c.clicked, before: a, after: b, url: page.url().replace(BASE, ''), changed: JSON.stringify(a.first3) !== JSON.stringify(b.first3) }
  console.log('[hot] 切新品=' + c.clicked, 'items', a.items, '->', b.items, 'first3 变化=' + out.hot.changed)
  console.log('  before tabs', JSON.stringify(a.tabs), a.first3.join(' / '))
  console.log('  after  tabs', JSON.stringify(b.tabs), b.first3.join(' / '))
  await s.browser.close()
}

writeFileSync(OUT + '13-dom.json', JSON.stringify({ base: BASE, out }, null, 2))
console.log('\n[saved] 13-dom.json')
