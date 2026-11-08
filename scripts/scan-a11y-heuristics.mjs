
import { createRequire } from 'module'
const req = createRequire(import.meta.url)
const { chromium } = req('C:/Users/88/Desktop/web/源码镜像/node_modules/.pnpm/playwright@1.64.1/node_modules/playwright')

;(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1500)

  const report = await page.evaluate(() => {
    const q = (s) => Array.from(document.querySelectorAll(s))
    const imgsNoAlt = q('img:not([alt])').length
    const imgsEmptyAlt = q('img[alt=""]').length
    const btnsNoName = q('button').filter(b => !(b.textContent || '').trim() && !b.getAttribute('aria-label') && !b.getAttribute('title')).length
    const linksNoName = q('a').filter(a => !(a.textContent || '').trim() && !a.getAttribute('aria-label') && !a.getAttribute('title')).length
    const headings = q('h1,h2,h3,h4,h5,h6').map(h => h.tagName)
    const h1Count = headings.filter(h => h === 'h1').length
    // 检查标题层级跳跃
    let jumps = 0
    let prev = 0
    for (const h of headings) {
      const lvl = +h[1]
      if (prev && lvl > prev + 1) jumps++
      prev = lvl
    }
    const inputsNoLabel = q('input,select,textarea').filter(el => {
      if (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.id && document.querySelector('label[for="'+el.id+'"]')) return false
      if (el.getAttribute('type') === 'hidden') return false
      const p = el.closest('label')
      return !p
    }).length
    const smallTargets = q('button,a[href],[role="button"]').filter(el => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24)
    }).length
    const totalInteractive = q('button,a[href],[role="button"]').length
    const tabbables = q('[tabindex="0"], button:not([disabled]), a[href], input:not([disabled]), select, textarea').length
    return { imgsNoAlt, imgsEmptyAlt, btnsNoName, linksNoName, h1Count, headingCount: headings.length, headingJumps: jumps, inputsNoLabel, smallTargets, totalInteractive, tabbables }
  })
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
})()
