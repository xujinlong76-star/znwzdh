
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const seeds = ['/', '/sites', '/category/ai-tools', '/tags', '/videos', '/marketplace', '/collections', '/hot']
  const hrefs = new Set()
  for (const s of seeds) {
    await page.goto('http://localhost:3000' + s, { waitUntil: 'domcontentloaded', timeout: 60000 })
    await page.waitForTimeout(1200)
    const found = await page.evaluate(() => [...new Set(Array.from(document.querySelectorAll('a[href^="/"]')).map(a => a.getAttribute('href')))])
    for (const h of found) hrefs.add(h)
  }
  const list = [...hrefs]
  console.log('collected:', list.length)

  const bad = await page.evaluate(async (ls) => {
    const out = []
    let i = 0
    const workers = new Array(6).fill(0).map(async () => {
      while (i < ls.length) {
        const h = ls[i++]
        try {
          const r = await fetch(h, { redirect: 'follow' })
          if (r.status >= 400) out.push({ href: h, status: r.status })
        } catch { out.push({ href: h, status: 'ERR' }) }
      }
    })
    await Promise.all(workers)
    return out
  }, list)
  console.log('bad links:', bad.length)
  console.log(JSON.stringify(bad.slice(0, 30), null, 1))
  await browser.close()
})()
