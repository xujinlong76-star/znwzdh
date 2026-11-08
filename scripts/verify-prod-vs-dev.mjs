
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const results = {}

  for (const [label, base] of [['prod', 'http://localhost:3100'], ['dev', 'http://localhost:3000']]) {
    // 首页
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      const t0 = Date.now()
      await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 })
      const loadMs = Date.now() - t0
      await page.waitForTimeout(1500)
      const m = await page.evaluate(() => {
        const nav = performance.getEntriesByType('navigation')[0]
        return {
          domNodes: document.getElementsByTagName('*').length,
          cards: document.querySelectorAll('[data-navhub-site-id]').length,
          domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd - nav.startTime) : null,
          transferKB: nav ? Math.round(nav.transferSize / 1024) : null
        }
      })
      // 进入编辑态耗时
      const t1 = Date.now()
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
        b && b.click()
      })
      let hudMs = null
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(150)
        if (await page.evaluate(() => !!document.querySelector('[data-diy-hud="true"]'))) { hudMs = Date.now() - t1; break }
      }
      results[label] = { home: { ...m, loadMs }, editModeHudMs: hudMs }
      await ctx.close()
    }
    // /videos
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      const page = await ctx.newPage()
      const t0 = Date.now()
      await page.goto(base + '/videos', { waitUntil: 'load', timeout: 60000 })
      const loadMs = Date.now() - t0
      await page.waitForTimeout(1200)
      results[label].videos = await page.evaluate(() => ({ domNodes: document.getElementsByTagName('*').length }))
      results[label].videos.loadMs = loadMs
      await ctx.close()
    }
    // 移动端 DIY
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
      const page = await ctx.newPage()
      const t0 = Date.now()
      await page.goto(base + '/', { waitUntil: 'commit', timeout: 60000 })
      let info = null
      for (let i = 0; i < 80; i++) {
        info = await page.evaluate(() => {
          const b = Array.from(document.querySelectorAll('button')).find(x => (x.getAttribute('title') || '').includes('DIY'))
          if (!b) return null
          const r = b.getBoundingClientRect()
          if (!r.width) return null
          const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
          return { clickable: el === b || b.contains(el) }
        })
        if (info && info.clickable) { info.ms = Date.now() - t0; break }
        await page.waitForTimeout(250)
      }
      results[label].mobileDiy = info
      await ctx.close()
    }
  }

  console.log(JSON.stringify(results, null, 2))
  await browser.close()
})()
