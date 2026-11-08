
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

const results = {}

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })

  // ── 桌面：首页 DOM 规模 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    results.home = await page.evaluate(() => ({
      domNodes: document.getElementsByTagName('*').length,
      cards: document.querySelectorAll('[data-navhub-site-id]').length,
      tabbablesInMain: (() => {
        const main = document.querySelector('#main-content')
        const isTab = (el) => {
          if (el.disabled) return false
          const ti = el.getAttribute('tabindex')
          if (ti !== null) { const n = parseInt(ti, 10); return !isNaN(n) && n >= 0 }
          return ['A','BUTTON','INPUT','SELECT','TEXTAREA'].includes(el.tagName)
        }
        return main ? Array.from(main.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')).filter(isTabbable0 => isTab(isTabbable0)).length : 0
      })()
    }))

    // 编辑态进入耗时 + DOM
    const t0 = Date.now()
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
      b && b.click()
    })
    let hudMs = null
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(200)
      if (await page.evaluate(() => !!document.querySelector('[data-diy-hud="true"]'))) { hudMs = Date.now() - t0; break }
    }
    results.editMode = await page.evaluate(() => ({
      domNodes: document.getElementsByTagName('*').length,
      categoryControls: document.querySelectorAll('[data-category-in-situ]').length
    }))
    results.editMode.hudMs = hudMs
    await ctx.close()
  }

  // ── /videos ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    await page.goto('http://localhost:3000/videos', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    results.videos = await page.evaluate(() => ({
      domNodes: document.getElementsByTagName('*').length,
      sections: document.querySelectorAll('section[id]').length,
      scrollH: document.body.scrollHeight
    }))
    await ctx.close()
  }

  // ── /graph ──
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const bad = []
    page.on('response', r => { if (r.status() >= 400) bad.push(r.status() + ' ' + r.url().slice(0, 70)) })
    await page.goto('http://localhost:3000/graph', { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    results.graph = await page.evaluate(() => ({
      badge: (document.body.innerText.match(/实时 \d+ 个站点|示例数据（未接入站点库）/) || [])[0] || null
    }))
    results.graph.failures = bad
    await ctx.close()
  }

  // ── 移动端：DIY 入口 ──
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    const t0 = Date.now()
    await page.goto('http://localhost:3000', { waitUntil: 'commit' })
    let info = null
    for (let i = 0; i < 60; i++) {
      info = await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
        if (!b) return null
        const r = b.getBoundingClientRect()
        if (r.width === 0) return null
        const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
        return { bottom: Math.round(window.innerHeight - r.bottom), clickable: el === b || b.contains(el) }
      })
      if (info && info.clickable) { info.ms = Date.now() - t0; break }
      await page.waitForTimeout(400)
    }
    results.mobile = { docWidth: await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, win: window.innerWidth })), diy: info }
    await ctx.close()
  }

  console.log(JSON.stringify(results, null, 2))
  await browser.close()
})()
